import os
import pickle
import logging
import threading
import time
from typing import Dict, Any, Optional
from dataclasses import dataclass
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
import psycopg2
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from dotenv import load_dotenv
from synthetic_data import generate_synthetic_training_data, validate_synthetic_data
from model_versioning import save_model_versioned, activate_model, get_active_model_path
from src.difficulty_predictor import get_predictor as get_difficulty_predictor

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("churn-ml-service")

@dataclass
class ModelResult:
    """Result of model training with train/test split and cross-validation metrics."""
    model: Any
    train_accuracy: float
    test_accuracy: float
    cv_scores: Any  # numpy array of cross-validation scores
    cv_mean: float
    cv_std: float

app = FastAPI(title="Teen Patti Churn ML Service")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://teen:password@127.0.0.1:5432/teen_db")

# Global state for async model training
model: Optional[Any] = None
training_in_progress: bool = False
model_lock = threading.Lock()

class PredictRequest(BaseModel):
    user_id: str

class DifficultyPredictRequest(BaseModel):
    player_id: str
    game_type: str

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def get_user_features(user_id: str = None) -> pd.DataFrame:
    conn = get_db_connection()
    try:
        query = """
        SELECT 
          u.id as user_id,
          COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(wt.created_at))) / 86400, 30.0) as days_since_deposit,
          COUNT(wt.id)::float as total_deposits,
          COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '14 days' THEN 1 END)::float as deposits_last_14,
          COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '28 days' AND wt.created_at <= NOW() - INTERVAL '14 days' THEN 1 END)::float as deposits_prior_14,
          COALESCE(gp.games_played, 0)::float as total_games,
          COALESCE(gp.total_profit, 0)::float as net_profit,
          CASE WHEN MAX(wt.created_at) < NOW() - INTERVAL '14 days' OR MAX(wt.created_at) IS NULL THEN 1 ELSE 0 END as churned
        FROM users u
        LEFT JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'deposit' AND wt.status = 'completed'
        LEFT JOIN (
          SELECT 
            user_id,
            COUNT(id) as games_played,
            SUM(prize_won - COALESCE(entry_fee_deducted, 0)) as total_profit
          FROM game_participants
          GROUP BY user_id
        ) gp ON gp.user_id = u.id
        WHERE u.is_bot = false AND u.status = 'active'
        """
        
        if user_id:
            query += " AND u.id = %s"
            query += " GROUP BY u.id, gp.games_played, gp.total_profit"
            df = pd.read_sql_query(query, conn, params=(user_id,))
        else:
            query += " GROUP BY u.id, gp.games_played, gp.total_profit"
            df = pd.read_sql_query(query, conn)
            
        return df
    finally:
        conn.close()

def train_churn_model(X, y) -> ModelResult:
    """
    Train churn model with train/test split and cross-validation.

    Args:
        X: Feature matrix
        y: Target labels

    Returns:
        ModelResult containing model, train_accuracy, test_accuracy, cv_scores, cv_mean, cv_std

    Raises:
        ValueError: If test_accuracy < 0.65 (quality gate check)
    """
    # Split data: 80% train, 20% test with stratification
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Train Random Forest Classifier
    model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
    model.fit(X_train, y_train)

    # Compute train and test accuracy
    train_accuracy = float(model.score(X_train, y_train))
    test_accuracy = float(model.score(X_test, y_test))

    # Perform cross-validation with 5 folds
    cv_scores = cross_val_score(model, X, y, cv=5)
    cv_mean = float(cv_scores.mean())
    cv_std = float(cv_scores.std())

    # Quality gate: reject if test_accuracy < 0.65
    if test_accuracy < 0.65:
        raise ValueError(
            f"Model quality gate failed: test_accuracy ({test_accuracy:.4f}) < 0.65 threshold"
        )

    # Log metrics
    logger.info(
        f"Model training completed - Train Acc: {train_accuracy:.4f}, Test Acc: {test_accuracy:.4f}, "
        f"CV Mean: {cv_mean:.4f}, CV Std: {cv_std:.4f}"
    )

    return ModelResult(
        model=model,
        train_accuracy=train_accuracy,
        test_accuracy=test_accuracy,
        cv_scores=cv_scores,
        cv_mean=cv_mean,
        cv_std=cv_std
    )


def async_train_model():
    """
    Run model training in background thread asynchronously.
    Updates global model state when training completes successfully.
    """
    global model, training_in_progress

    try:
        with model_lock:
            if training_in_progress:
                logger.info("Training already in progress, skipping duplicate request")
                return
            training_in_progress = True

        logger.info("Starting async background training...")
        df = get_user_features()

        if len(df) < 5:
            logger.warning(f"Insufficient real data for training (found {len(df)} records). Generating synthetic training data.")
            df = generate_synthetic_training_data(n_samples=100)

        X = df[['days_since_deposit', 'total_deposits', 'deposits_last_14', 'deposits_prior_14', 'total_games', 'net_profit']]
        y = df['churned']

        # Train model with train/test split and cross-validation
        result = train_churn_model(X, y)

        # Save model with versioning system
        version = save_model_versioned(
            model=result.model,
            train_acc=result.train_accuracy,
            test_acc=result.test_accuracy,
            cv_mean=result.cv_mean,
            cv_std=result.cv_std
        )

        # Activate the new model version
        activate_model(version)

        # Save to legacy MODEL_PATH for backward compatibility
        with open(MODEL_PATH, "wb") as f:
            pickle.dump(result.model, f)

        with model_lock:
            model = result.model

        logger.info(
            f"Async training completed successfully. Train Acc: {result.train_accuracy:.4f}, "
            f"Test Acc: {result.test_accuracy:.4f}, CV Mean: {result.cv_mean:.4f}, "
            f"CV Std: {result.cv_std:.4f}, samples: {len(df)}, version: {version}"
        )
    except ValueError as e:
        logger.error(f"Async training failed (quality gate): {e}")
    except Exception as e:
        logger.error(f"Async training failed: {e}")
    finally:
        with model_lock:
            training_in_progress = False


@app.on_event("startup")
def startup_event():
    """Load model on startup if it exists."""
    global model
    if os.path.exists(MODEL_PATH):
        try:
            with open(MODEL_PATH, "rb") as f:
                model = pickle.load(f)
            logger.info("Model loaded on startup")
        except Exception as e:
            logger.error(f"Failed to load model on startup: {e}")

    # Load (or leave unloaded — predict() falls back gracefully) the
    # personalized-difficulty model so the first /predict-difficulty call
    # doesn't pay disk I/O.
    get_difficulty_predictor()


@app.post("/train")
def train_model() -> Dict[str, Any]:
    try:
        logger.info("Starting model training cycle...")
        df = get_user_features()

        if len(df) < 5:
            # Insufficient data, fallback to training with synthetic data to avoid failing
            logger.warning(f"Insufficient real data for training (found {len(df)} records). Generating synthetic training data.")
            # Generate realistic synthetic training data based on empirical distributions
            df = generate_synthetic_training_data(n_samples=100)

        X = df[['days_since_deposit', 'total_deposits', 'deposits_last_14', 'deposits_prior_14', 'total_games', 'net_profit']]
        y = df['churned']

        # Train model with train/test split and cross-validation
        result = train_churn_model(X, y)

        # Save model with versioning system
        version = save_model_versioned(
            model=result.model,
            train_acc=result.train_accuracy,
            test_acc=result.test_accuracy,
            cv_mean=result.cv_mean,
            cv_std=result.cv_std
        )

        # Activate the new model version
        activate_model(version)

        # Also save to legacy MODEL_PATH for backward compatibility
        with open(MODEL_PATH, "wb") as f:
            pickle.dump(result.model, f)

        # Update global model state
        with model_lock:
            global model
            model = result.model

        logger.info(
            f"Model trained successfully. Train Acc: {result.train_accuracy:.4f}, "
            f"Test Acc: {result.test_accuracy:.4f}, CV Mean: {result.cv_mean:.4f}, "
            f"CV Std: {result.cv_std:.4f}, samples: {len(df)}, version: {version}"
        )
        return {
            "success": True,
            "train_accuracy": round(result.train_accuracy, 4),
            "test_accuracy": round(result.test_accuracy, 4),
            "cv_mean": round(result.cv_mean, 4),
            "cv_std": round(result.cv_std, 4),
            "samples": len(df),
            "version": version
        }
    except ValueError as e:
        logger.error(f"Training failed (quality gate): {e}")
        raise HTTPException(status_code=400, detail=f"Training failed: {str(e)}")
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

@app.post("/predict")
def predict_churn(req: PredictRequest) -> Dict[str, Any]:
    global model, training_in_progress

    # 1. Get user features early (before model check) to compute fallback
    try:
        df = get_user_features(req.user_id)
        if df.empty:
            raise HTTPException(status_code=404, detail="User not found or is a bot/suspended.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user features: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve user features")

    # 2. If model is None (cold-start), queue async training and return fallback immediately (<100ms)
    if model is None:
        if not training_in_progress:
            # Queue async training in background thread (non-blocking)
            training_thread = threading.Thread(target=async_train_model, daemon=True)
            training_thread.start()
            logger.info(f"Queued async training for user {req.user_id}, returning fallback")

        # Return fast fallback based on user inactivity
        days = float(df['days_since_deposit'].iloc[0])
        churn_risk = min(days * 7.0, 100.0)

        if churn_risk >= 80:
            risk_level = "high"
        elif churn_risk >= 60:
            risk_level = "medium"
        elif churn_risk >= 30:
            risk_level = "low"
        else:
            risk_level = "none"

        feature_map = df.iloc[0].to_dict()
        feature_map.pop('churned', None)

        return {
            "user_id": req.user_id,
            "churn_risk": round(churn_risk, 2),
            "risk_level": risk_level,
            "features": feature_map,
            "prediction_type": "fallback"  # Indicate this is a fallback prediction
        }

    # 3. Model exists (warm), predict normally
    X = df[['days_since_deposit', 'total_deposits', 'deposits_last_14', 'deposits_prior_14', 'total_games', 'net_profit']]

    try:
        prob = model.predict_proba(X)[0][1]  # Probability of class 1 (churned)
        churn_risk = float(prob * 100)
    except Exception as e:
        logger.error(f"Prediction computation failed: {e}")
        # Fallback probability based on inactivity
        days = float(df['days_since_deposit'].iloc[0])
        churn_risk = min(days * 7.0, 100.0)

    # 4. Map to risk levels
    if churn_risk >= 80:
        risk_level = "high"
    elif churn_risk >= 60:
        risk_level = "medium"
    elif churn_risk >= 30:
        risk_level = "low"
    else:
        risk_level = "none"

    feature_map = df.iloc[0].to_dict()
    feature_map.pop('churned', None)

    return {
        "user_id": req.user_id,
        "churn_risk": round(churn_risk, 2),
        "risk_level": risk_level,
        "features": feature_map,
        "prediction_type": "model"  # Indicate this is a model prediction
    }

@app.post("/predict-difficulty")
def predict_difficulty(req: DifficultyPredictRequest) -> Dict[str, Any]:
    """Personalized bot-difficulty recommendation for one player/game_type.
    Called by game-gateway's matchmaking under the PERSONALIZATION_CANARY_PCT
    flag; always returns within ~100ms (falls back to the player's current
    difficulty, or 'medium', rather than blocking matchmaking)."""
    predictor = get_difficulty_predictor()
    result = predictor.predict(req.player_id, req.game_type)
    predictor.store_prediction(result)
    return {
        "player_id": result.player_id,
        "game_type": result.game_type,
        "recommended_difficulty": result.recommended_difficulty,
        "confidence_score": round(result.confidence_score, 4),
        "prediction_type": result.prediction_type,
    }

@app.post("/train-difficulty")
def train_difficulty_model() -> Dict[str, Any]:
    try:
        predictor = get_difficulty_predictor()
        result = predictor.train()
        return result
    except ValueError as e:
        logger.error(f"Difficulty model training failed (quality gate): {e}")
        raise HTTPException(status_code=400, detail=f"Training failed: {str(e)}")
    except Exception as e:
        logger.error(f"Difficulty model training failed: {e}")
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

@app.get("/health")
def health():
    model_loaded = os.path.exists(MODEL_PATH)
    difficulty_model_loaded = os.path.exists(
        os.path.join(os.path.dirname(__file__), "src", "difficulty_model.pkl")
    )
    return {
        "status": "healthy",
        "model_trained": model_loaded,
        "difficulty_model_trained": difficulty_model_loaded,
    }
