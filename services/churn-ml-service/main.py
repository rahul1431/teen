import os
import pickle
import logging
from typing import Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
import psycopg2
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("churn-ml-service")

app = FastAPI(title="Teen Patti Churn ML Service")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://teen:password@127.0.0.1:5432/teen_db")

class PredictRequest(BaseModel):
    user_id: str

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

@app.post("/train")
def train_model() -> Dict[str, Any]:
    try:
        logger.info("Starting model training cycle...")
        df = get_user_features()
        
        if len(df) < 5:
            # Insufficient data, fallback to training a dummy model to avoid failing
            logger.warning(f"Insufficient real data for training (found {len(df)} records). Training a fallback model.")
            # Create synthetic training set so we have at least some data
            data = {
                'days_since_deposit': [1.0, 2.0, 15.0, 20.0, 3.0, 18.0],
                'total_deposits': [5.0, 3.0, 1.0, 0.0, 10.0, 1.0],
                'deposits_last_14': [2.0, 1.0, 0.0, 0.0, 4.0, 0.0],
                'deposits_prior_14': [2.0, 1.0, 1.0, 0.0, 3.0, 1.0],
                'total_games': [20.0, 15.0, 2.0, 0.0, 50.0, 1.0],
                'net_profit': [150.0, -50.0, -10.0, 0.0, 500.0, -20.0],
                'churned': [0, 0, 1, 1, 0, 1]
            }
            df = pd.DataFrame(data)

        X = df[['days_since_deposit', 'total_deposits', 'deposits_last_14', 'deposits_prior_14', 'total_games', 'net_profit']]
        y = df['churned']

        # Train a Random Forest Classifier
        model = RandomForestClassifier(n_estimators=100, random_state=42)
        model.fit(X, y)

        # Evaluate training score
        score = float(model.score(X, y))

        with open(MODEL_PATH, "wb") as f:
            pickle.dump(model, f)
            
        logger.info(f"Model trained successfully. Accuracy: {score:.4f}, samples: {len(df)}")
        return {"success": True, "accuracy": score, "samples": len(df)}
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

@app.post("/predict")
def predict_churn(req: PredictRequest) -> Dict[str, Any]:
    # 1. Load model, train if missing
    if not os.path.exists(MODEL_PATH):
        logger.info("Model file not found. Auto-triggering model training...")
        train_model()

    try:
        with open(MODEL_PATH, "rb") as f:
            model = pickle.load(f)
    except Exception as e:
        logger.error(f"Failed to load model file: {e}")
        raise HTTPException(status_code=500, detail="Model file corrupted or missing.")

    # 2. Get user features
    df = get_user_features(req.user_id)
    if df.empty:
        raise HTTPException(status_code=404, detail="User not found or is a bot/suspended.")

    X = df[['days_since_deposit', 'total_deposits', 'deposits_last_14', 'deposits_prior_14', 'total_games', 'net_profit']]
    
    # 3. Predict probability
    try:
        prob = model.predict_proba(X)[0][1] # Probability of class 1 (churned)
        churn_risk = float(prob * 100)
    except Exception as e:
        logger.error(f"Prediction computation failed: {e}")
        # Default fallback probability based on inactivity
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
    # Remove label
    feature_map.pop('churned', None)

    return {
        "user_id": req.user_id,
        "churn_risk": round(churn_risk, 2),
        "risk_level": risk_level,
        "features": feature_map
    }

@app.get("/health")
def health():
    model_loaded = os.path.exists(MODEL_PATH)
    return {"status": "healthy", "model_trained": model_loaded}
