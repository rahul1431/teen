import os
import pickle
import logging
import threading
import time
from typing import Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import psycopg2
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("difficulty-predictor")

DATABASE_URL = os.getenv("DATABASE_URL")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "difficulty_model.pkl")
SCALER_PATH = os.path.join(os.path.dirname(__file__), "scaler.pkl")

DIFFICULTY_LEVELS = ['easy', 'medium', 'hard']
GAME_TYPES = ['teen_patti', 'ludo', 'aviator', 'matka']

# game_participants.final_rank was never written for Ludo before this fix
# (services/game-gateway/src/matchmaking.ts handleLudoEnd) — every pre-fix
# Ludo row shows a fabricated 0% win rate regardless of the real outcome.
# Excluded from training/prediction features so the model isn't taught that
# every Ludo player always loses.
LUDO_FINAL_RANK_FIX_CUTOVER = '2026-07-25 06:04:03+00'

# Minimum real post-cutover Ludo game_participants rows required before
# /train-difficulty is allowed to produce a model — below this, the Random
# Forest would be fit on too few genuine Ludo examples to trust.
MIN_LUDO_TRAINING_ROWS = 200

@dataclass
class PredictionResult:
    """Result of difficulty prediction."""
    recommended_difficulty: str
    confidence_score: float
    player_id: str
    game_type: str
    current_difficulty: Optional[str] = None
    prediction_type: str = "model"  # "model" or "fallback"


class DifficultyPredictor:
    """
    Personalized difficulty prediction model for optimal player engagement.

    Uses Random Forest classifier to predict optimal difficulty (easy/medium/hard)
    based on player performance features. Stores predictions in bot_player_profiles table.
    Supports async training and timeout-based fallback logic.
    """

    def __init__(self):
        self.model: Optional[RandomForestClassifier] = None
        self.scaler: Optional[StandardScaler] = None
        self.training_in_progress: bool = False
        self.model_lock = threading.Lock()
        self.test_accuracy: float = 0.0
        self._last_training_ludo_rows: int = 0

    def get_db_connection(self):
        """Create database connection."""
        return psycopg2.connect(DATABASE_URL)

    def get_player_features(self, player_id: str = None) -> pd.DataFrame:
        """
        Get player performance features for training or prediction.

        Features:
        - current_win_rate: Player's win percentage
        - game_count: Number of games played
        - avg_session_duration: Average session length in minutes
        - bet_aggression: Aggression score (0-1)
        - playstyle_cluster: Cluster assignment from player profiles

        Args:
            player_id: Optional specific player_id to fetch features for

        Returns:
            DataFrame with player features
        """
        conn = self.get_db_connection()
        try:
            # gp fully aggregates to exactly one row per (user_id, game_type)
            # inside the CTE — every downstream reference to it (including
            # AVG(...) for avg_session_duration) is over ALREADY-aggregated
            # columns, so the outer query needs no GROUP BY of its own. (The
            # previous version aggregated gp per (user_id, game_type,
            # joined_at, left_at) — leaving multiple rows per game_type — and
            # then referenced gp.games_won ungrouped in the outer SELECT,
            # which Postgres rejects outright: "column gp.games_won must
            # appear in the GROUP BY clause".)
            query = f"""
            WITH gp AS (
              SELECT
                user_id,
                CASE WHEN room_id IN (
                  SELECT id FROM game_rooms WHERE game_type = 'teen_patti'
                ) THEN 'teen_patti'
                WHEN room_id IN (
                  SELECT id FROM game_rooms WHERE game_type = 'ludo'
                ) THEN 'ludo'
                WHEN room_id IN (
                  SELECT id FROM game_rooms WHERE game_type = 'aviator'
                ) THEN 'aviator'
                WHEN room_id IN (
                  SELECT id FROM game_rooms WHERE game_type = 'matka'
                ) THEN 'matka'
                ELSE 'teen_patti'
                END as game_type,
                COUNT(*) as games_played,
                SUM(CASE WHEN final_rank = 1 THEN 1 ELSE 0 END) as games_won,
                SUM(COALESCE(prize_won, 0)) as total_bets,
                AVG(EXTRACT(EPOCH FROM (left_at - joined_at)) / 60) as avg_session_duration
              FROM game_participants
              WHERE user_id IS NOT NULL
                -- final_rank was never written for Ludo before this cutover
                -- (see LUDO_FINAL_RANK_FIX_CUTOVER) — every earlier Ludo row
                -- looks like a 0% win rate regardless of the real outcome,
                -- so exclude them here rather than teach the model that lie.
                AND (
                  room_id NOT IN (SELECT id FROM game_rooms WHERE game_type = 'ludo')
                  OR joined_at >= '{LUDO_FINAL_RANK_FIX_CUTOVER}'
                )
              GROUP BY user_id, game_type
            )
            SELECT
              u.id as player_id,
              COALESCE(gp.game_type, 'teen_patti') as game_type,
              CASE
                WHEN gp.games_played > 0 THEN ROUND((gp.games_won::numeric / gp.games_played) * 100, 2)
                ELSE 0
              END as current_win_rate,
              COALESCE(gp.games_played, 0) as game_count,
              COALESCE(gp.avg_session_duration, 0) as avg_session_duration,
              COALESCE(
                (COALESCE(gp.total_bets, 0) / NULLIF(gp.games_played, 0))::numeric,
                0
              ) as bet_aggression,
              COALESCE(bpp.cluster_id, 0) as playstyle_cluster
            FROM users u
            LEFT JOIN gp ON gp.user_id = u.id
            -- bot_player_profiles (migration 052) is owned by
            -- playstyle_clusterer.py: one cross-game row per player
            -- (UNIQUE(player_id)), not per (player, game_type) — join on
            -- player_id alone.
            LEFT JOIN bot_player_profiles bpp ON bpp.player_id = u.id
            WHERE u.is_bot = false AND u.status = 'active'
            """

            if player_id:
                query += " AND u.id = %s"
                df = pd.read_sql_query(query, conn, params=(player_id,))
            else:
                df = pd.read_sql_query(query, conn)

            # Fill NaN values with defaults
            df = df.fillna(0)

            return df
        finally:
            conn.close()

    def get_optimal_difficulty(self, win_rate: float, game_count: int) -> str:
        """
        Derive optimal difficulty from player performance.

        Logic:
        - Easy: win_rate < 40% or game_count < 10
        - Medium: 40% <= win_rate <= 60% and game_count >= 10
        - Hard: win_rate > 60% and game_count >= 20

        Args:
            win_rate: Player's win rate percentage
            game_count: Number of games played

        Returns:
            Optimal difficulty level
        """
        if game_count < 10 or win_rate < 40:
            return 'easy'
        elif win_rate > 60 and game_count >= 20:
            return 'hard'
        else:
            return 'medium'

    def create_training_data(self) -> Tuple[pd.DataFrame, pd.Series]:
        """
        Create training dataset with optimal difficulty labels.

        Returns:
            Tuple of (X: feature DataFrame, y: target Series)
        """
        df = self.get_player_features()

        if len(df) < 5:
            logger.warning(f"Insufficient training data: {len(df)} records")
            self._last_training_ludo_rows = 0
            # Generate synthetic data for testing
            return self._generate_synthetic_training_data()

        self._last_training_ludo_rows = int((df['game_type'] == 'ludo').sum()) if 'game_type' in df.columns else 0

        # Create target variable: optimal_difficulty
        df['optimal_difficulty'] = df.apply(
            lambda row: self.get_optimal_difficulty(
                row['current_win_rate'],
                row['game_count']
            ),
            axis=1
        )

        # Select features
        feature_columns = [
            'current_win_rate',
            'game_count',
            'avg_session_duration',
            'bet_aggression',
            'playstyle_cluster'
        ]

        X = df[feature_columns].fillna(0)
        y = df['optimal_difficulty']

        return X, y

    def _generate_synthetic_training_data(self) -> Tuple[pd.DataFrame, pd.Series]:
        """
        Generate synthetic training data for testing when real data is insufficient.

        Returns:
            Tuple of (X: feature DataFrame, y: target Series)
        """
        np.random.seed(42)
        n_samples = 200

        data = {
            'current_win_rate': np.random.uniform(20, 80, n_samples),
            'game_count': np.random.randint(5, 100, n_samples),
            'avg_session_duration': np.random.uniform(5, 120, n_samples),
            'bet_aggression': np.random.uniform(0, 1, n_samples),
            'playstyle_cluster': np.random.randint(0, 5, n_samples)
        }

        X = pd.DataFrame(data)

        # Create synthetic labels based on win_rate
        y = X['current_win_rate'].apply(
            lambda x: 'hard' if x > 60 else ('easy' if x < 40 else 'medium')
        )

        return X, y

    def train(self) -> Dict[str, Any]:
        """
        Train Random Forest model on player data.

        Uses 80/20 train/test split with stratification.
        Target accuracy: >= 75%

        Returns:
            Dict with training metrics (accuracy, test_accuracy, etc.)

        Raises:
            ValueError: If test accuracy < 0.75 (quality gate)
        """
        try:
            logger.info("Starting difficulty predictor training...")

            X, y = self.create_training_data()

            if len(X) < 5:
                raise ValueError("Insufficient training data even after synthetic generation")

            # get_player_features already excludes pre-cutover Ludo rows, so
            # any 'ludo' rows counted here are real post-fix outcomes. Don't
            # let a Random Forest fit on a handful of them go live.
            ludo_rows = self._last_training_ludo_rows
            if 0 < ludo_rows < MIN_LUDO_TRAINING_ROWS:
                raise ValueError(
                    f"Ludo training volume gate failed: {ludo_rows} real post-cutover "
                    f"Ludo rows < {MIN_LUDO_TRAINING_ROWS} required minimum"
                )

            # Encode target variable
            y_encoded = pd.Categorical(y, categories=DIFFICULTY_LEVELS).codes

            # Split data: 80% train, 20% test with stratification
            X_train, X_test, y_train, y_test = train_test_split(
                X, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded
            )

            # Scale features
            self.scaler = StandardScaler()
            X_train_scaled = self.scaler.fit_transform(X_train)
            X_test_scaled = self.scaler.transform(X_test)

            # Train Random Forest classifier
            self.model = RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                random_state=42,
                n_jobs=-1
            )
            self.model.fit(X_train_scaled, y_train)

            # Compute metrics
            train_accuracy = float(self.model.score(X_train_scaled, y_train))
            test_accuracy = float(self.model.score(X_test_scaled, y_test))

            # Store test accuracy
            self.test_accuracy = test_accuracy

            # Quality gate: reject if test_accuracy < 0.75
            if test_accuracy < 0.75:
                raise ValueError(
                    f"Model quality gate failed: test_accuracy ({test_accuracy:.4f}) < 0.75 threshold"
                )

            logger.info(
                f"Model training completed - Train Acc: {train_accuracy:.4f}, "
                f"Test Acc: {test_accuracy:.4f}, samples: {len(X)}"
            )

            # Save model and scaler
            self._save_model()

            return {
                "success": True,
                "train_accuracy": round(train_accuracy, 4),
                "test_accuracy": round(test_accuracy, 4),
                "samples": len(X)
            }
        except Exception as e:
            logger.error(f"Training failed: {e}")
            raise

    def _save_model(self):
        """Save trained model and scaler to disk."""
        with open(MODEL_PATH, "wb") as f:
            pickle.dump(self.model, f)
        with open(SCALER_PATH, "wb") as f:
            pickle.dump(self.scaler, f)
        logger.info(f"Model saved to {MODEL_PATH}, Scaler saved to {SCALER_PATH}")

    def load_model(self) -> bool:
        """
        Load model and scaler from disk.

        Returns:
            True if successfully loaded, False otherwise
        """
        try:
            if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
                with open(MODEL_PATH, "rb") as f:
                    self.model = pickle.load(f)
                with open(SCALER_PATH, "rb") as f:
                    self.scaler = pickle.load(f)
                logger.info("Model and scaler loaded from disk")
                return True
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
        return False

    def predict(self, player_id: str, game_type: str, timeout_ms: int = 100) -> PredictionResult:
        """
        Predict optimal difficulty for a player.

        Implements non-blocking prediction with timeout-based fallback.
        If prediction takes > timeout_ms, returns current_difficulty as fallback.

        Args:
            player_id: Player ID
            game_type: Type of game ('teen_patti', 'ludo', 'aviator', 'matka')
            timeout_ms: Timeout in milliseconds (default 100ms)

        Returns:
            PredictionResult with recommended_difficulty and confidence_score
        """
        start_time = time.time()

        try:
            # Get current player profile
            conn = self.get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT current_difficulty FROM personalized_difficulty_predictions WHERE player_id = %s AND game_type = %s",
                    (player_id, game_type)
                )
                result = cursor.fetchone()
                current_difficulty = result[0] if result else None
            finally:
                conn.close()

            # Check if we have a model
            if self.model is None:
                logger.info(f"No model loaded, returning fallback for player {player_id}")
                return PredictionResult(
                    recommended_difficulty=current_difficulty or 'medium',
                    confidence_score=0.0,
                    player_id=player_id,
                    game_type=game_type,
                    current_difficulty=current_difficulty,
                    prediction_type="fallback"
                )

            # Get player features
            df = self.get_player_features(player_id)

            if df.empty:
                logger.warning(f"No features found for player {player_id}, returning fallback")
                return PredictionResult(
                    recommended_difficulty=current_difficulty or 'medium',
                    confidence_score=0.0,
                    player_id=player_id,
                    game_type=game_type,
                    current_difficulty=current_difficulty,
                    prediction_type="fallback"
                )

            # Filter by game_type
            df_game = df[df['game_type'] == game_type]
            if df_game.empty:
                logger.warning(f"No game features for {game_type}, returning fallback")
                return PredictionResult(
                    recommended_difficulty=current_difficulty or 'medium',
                    confidence_score=0.0,
                    player_id=player_id,
                    game_type=game_type,
                    current_difficulty=current_difficulty,
                    prediction_type="fallback"
                )

            # Extract features
            feature_columns = [
                'current_win_rate',
                'game_count',
                'avg_session_duration',
                'bet_aggression',
                'playstyle_cluster'
            ]

            X = df_game[feature_columns].fillna(0).iloc[0:1]

            # Scale features
            X_scaled = self.scaler.transform(X)

            # Predict
            pred_class = self.model.predict(X_scaled)[0]
            pred_proba = self.model.predict_proba(X_scaled)[0]

            recommended_difficulty = DIFFICULTY_LEVELS[pred_class]
            confidence_score = float(np.max(pred_proba))

            # Check timeout
            elapsed_ms = (time.time() - start_time) * 1000
            if elapsed_ms > timeout_ms:
                logger.warning(
                    f"Prediction timeout ({elapsed_ms:.1f}ms > {timeout_ms}ms), "
                    f"returning fallback for {player_id}"
                )
                return PredictionResult(
                    recommended_difficulty=current_difficulty or recommended_difficulty,
                    confidence_score=0.0,
                    player_id=player_id,
                    game_type=game_type,
                    current_difficulty=current_difficulty,
                    prediction_type="fallback"
                )

            logger.info(
                f"Predicted difficulty={recommended_difficulty} (conf={confidence_score:.3f}) "
                f"for player {player_id}, game={game_type}, elapsed={elapsed_ms:.1f}ms"
            )

            return PredictionResult(
                recommended_difficulty=recommended_difficulty,
                confidence_score=confidence_score,
                player_id=player_id,
                game_type=game_type,
                current_difficulty=current_difficulty,
                prediction_type="model"
            )
        except Exception as e:
            logger.error(f"Prediction error: {e}")
            return PredictionResult(
                recommended_difficulty='medium',
                confidence_score=0.0,
                player_id=player_id,
                game_type=game_type,
                prediction_type="fallback"
            )

    def store_prediction(self, prediction: PredictionResult):
        """
        Store prediction in the personalized_difficulty_predictions table
        (migration 090 — dedicated table, not bot_player_profiles, which is
        a cross-game table owned by playstyle_clusterer.py).

        Args:
            prediction: PredictionResult to store
        """
        try:
            conn = self.get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT INTO personalized_difficulty_predictions
                        (player_id, game_type, current_difficulty, recommended_difficulty, confidence_score)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (player_id, game_type) DO UPDATE SET
                        current_difficulty = EXCLUDED.current_difficulty,
                        recommended_difficulty = EXCLUDED.recommended_difficulty,
                        confidence_score = EXCLUDED.confidence_score,
                        updated_at = NOW()
                    """,
                    (
                        prediction.player_id,
                        prediction.game_type,
                        prediction.current_difficulty or 'medium',
                        prediction.recommended_difficulty,
                        prediction.confidence_score,
                    )
                )

                conn.commit()
                logger.info(f"Stored prediction for {prediction.player_id}")
            finally:
                conn.close()
        except Exception as e:
            logger.error(f"Failed to store prediction: {e}")

    def async_train(self):
        """
        Run model training in background thread asynchronously.
        Non-blocking training that updates global model state when complete.
        """
        try:
            with self.model_lock:
                if self.training_in_progress:
                    logger.info("Training already in progress, skipping duplicate request")
                    return
                self.training_in_progress = True

            self.train()

        except Exception as e:
            logger.error(f"Async training failed: {e}")
        finally:
            with self.model_lock:
                self.training_in_progress = False

    def nightly_training(self):
        """
        Run nightly training job asynchronously.
        Called by scheduler to retrain model daily.
        """
        logger.info("Starting nightly model training...")
        training_thread = threading.Thread(target=self.async_train, daemon=True)
        training_thread.start()


# Global predictor instance
_predictor: Optional[DifficultyPredictor] = None

def get_predictor() -> DifficultyPredictor:
    """Get global predictor instance."""
    global _predictor
    if _predictor is None:
        _predictor = DifficultyPredictor()
        _predictor.load_model()
    return _predictor
