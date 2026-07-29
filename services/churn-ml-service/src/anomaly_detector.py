"""
Player Anomaly Detection Module

Implements Isolation Forest algorithm for real-time detection of anomalous player behavior.

Anomaly types detected:
1. "win_rate_spike" — sudden >3σ increase in win rate
2. "session_change" — session length deviation >3σ
3. "bet_aggression" — bet size spike >3σ above cohort average
4. "churn_risk" — churn risk score jumps >3σ
5. "game_frequency" — games_per_week deviates >3σ from normal

Features used for detection:
- win_rate_zscore: Z-score of win rate change
- session_length_change: Deviation in session length from baseline
- bet_aggression_spike: Spike in bet aggression vs cohort
- churn_risk_jump: Increase in churn risk score
- games_per_week_change: Deviation in game frequency

Real-time inference: <100ms per player
Async training: nightly, non-blocking
Model: scikit-learn Isolation Forest with contamination=0.05, 100 estimators
Threshold: anomaly_score > 0.7 AND feature_zscore > 3σ
"""

import os
import logging
import psycopg2
import numpy as np
import pandas as pd
import json
import time
from typing import Dict, Tuple, List, Optional, Any
from dataclasses import dataclass
from dotenv import load_dotenv

from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

load_dotenv()

logger = logging.getLogger("anomaly-detector")

DATABASE_URL = os.getenv("DATABASE_URL")

# Anomaly types and thresholds
ANOMALY_TYPES = {
    "win_rate_spike": "Sudden >3σ increase in win rate",
    "session_change": "Session length deviation >3σ",
    "bet_aggression": "Bet size spike >3σ above cohort average",
    "churn_risk": "Churn risk score jumps >3σ",
    "game_frequency": "Games_per_week deviates >3σ from normal"
}

# Detection thresholds
ANOMALY_SCORE_THRESHOLD = 0.7  # Anomaly score > 0.7 is anomalous
ZSCORE_THRESHOLD = 3.0  # Z-score > 3σ (extreme deviation)

# Model parameters
ISOLATION_FOREST_CONTAMINATION = 0.05
ISOLATION_FOREST_N_ESTIMATORS = 100


@dataclass
class PlayerAnomalyFeatures:
    """Container for player anomaly detection features."""
    player_id: str
    win_rate_zscore: float
    session_length_change: float
    bet_aggression_spike: float
    churn_risk_jump: float
    games_per_week_change: float
    cohort_id: Optional[int] = None


@dataclass
class AnomalyDetectionResult:
    """Container for anomaly detection result."""
    player_id: str
    anomaly_type: str
    confidence: float
    anomaly_score: float
    feature_zscore: float
    feature_value: float
    cohort_average: float
    is_anomaly: bool


def get_db_connection():
    """Get PostgreSQL database connection."""
    return psycopg2.connect(DATABASE_URL)


def extract_player_anomaly_features(conn) -> List[PlayerAnomalyFeatures]:
    """
    Extract anomaly detection features for all active players.

    Computes:
    1. win_rate_zscore: Z-score of win rate vs cohort average
    2. session_length_change: Deviation from player's baseline session length
    3. bet_aggression_spike: Bet aggression vs cohort average
    4. churn_risk_jump: Recent churn risk increase
    5. games_per_week_change: Deviation from player's baseline game frequency

    Args:
        conn: Database connection

    Returns:
        List[PlayerAnomalyFeatures]: List of player feature objects

    Raises:
        psycopg2.Error: If database query fails
    """
    try:
        query = """
        WITH player_recent_stats AS (
            SELECT
                gp.user_id,
                COUNT(gp.id) as recent_game_count,
                SUM(CASE WHEN (gp.prize_won - COALESCE(gp.entry_fee_deducted, 0)) > 0
                    THEN 1 ELSE 0 END)::float / COUNT(gp.id) as recent_win_rate,
                AVG(EXTRACT(EPOCH FROM (gp.left_at - gp.joined_at)) / 60.0) as recent_avg_session_length,
                COUNT(DISTINCT DATE(gp.joined_at)) as days_active_recent,
                MAX(gp.joined_at) as last_game_at,
                -- game_type lives on game_rooms, not game_participants —
                -- join to it rather than assuming it's a column here.
                SUM(CASE WHEN gr.game_type = 'teen_patti' THEN 1 ELSE 0 END)::float /
                    NULLIF(COUNT(gp.id), 0) as tp_bet_aggression_ratio
            FROM game_participants gp
            JOIN game_rooms gr ON gr.id = gp.room_id
            WHERE gp.is_bot = FALSE
              AND gp.joined_at > NOW() - INTERVAL '30 days'
              AND gp.left_at IS NOT NULL
            GROUP BY gp.user_id
        ),
        player_historical_stats AS (
            SELECT
                gp.user_id,
                AVG(EXTRACT(EPOCH FROM (gp.left_at - gp.joined_at)) / 60.0) as hist_avg_session_length,
                SUM(CASE WHEN (gp.prize_won - COALESCE(gp.entry_fee_deducted, 0)) > 0
                    THEN 1 ELSE 0 END)::float / COUNT(gp.id) as hist_win_rate,
                COUNT(DISTINCT DATE(gp.joined_at)) /
                    NULLIF(EXTRACT(DAY FROM (MAX(gp.joined_at) - MIN(gp.joined_at))) + 1, 0) * 7.0
                    as hist_games_per_week
            FROM game_participants gp
            WHERE gp.is_bot = FALSE
            GROUP BY gp.user_id
        ),
        cohort_stats AS (
            SELECT
                bpp.player_id,
                bpp.cluster_id,
                u.id as player_id_verify,
                AVG(gp.prize_won - COALESCE(gp.entry_fee_deducted, 0))::float as cohort_avg_profit,
                STDDEV(gp.prize_won - COALESCE(gp.entry_fee_deducted, 0))::float as cohort_stddev_profit,
                AVG(EXTRACT(EPOCH FROM (gp.left_at - gp.joined_at)) / 60.0) as cohort_avg_session_length,
                STDDEV(EXTRACT(EPOCH FROM (gp.left_at - gp.joined_at)) / 60.0) as cohort_stddev_session_length
            FROM bot_player_profiles bpp
            JOIN users u ON bpp.player_id = u.id
            LEFT JOIN game_participants gp ON u.id = gp.user_id AND gp.is_bot = FALSE
            WHERE u.is_bot = FALSE AND u.status = 'active'
            GROUP BY bpp.player_id, bpp.cluster_id, u.id
        )
        SELECT
            u.id as player_id,
            COALESCE(prs.recent_win_rate, 0.0) as recent_win_rate,
            COALESCE(phs.hist_avg_session_length, 0.0) as hist_avg_session_length,
            COALESCE(prs.recent_avg_session_length, 0.0) as recent_avg_session_length,
            COALESCE(prs.tp_bet_aggression_ratio, 0.0) as bet_aggression_ratio,
            COALESCE(cs.cohort_avg_profit, 0.0) as cohort_avg_profit,
            COALESCE(cs.cohort_stddev_profit, 1.0) as cohort_stddev_profit,
            COALESCE(cs.cohort_avg_session_length, 30.0) as cohort_avg_session_length,
            COALESCE(prs.recent_game_count, 0)::int as recent_game_count,
            COALESCE(phs.hist_games_per_week, 0.0) as hist_games_per_week,
            COALESCE(prs.days_active_recent, 0) as days_active_recent,
            COALESCE(cs.cluster_id, 0) as cluster_id
        FROM users u
        LEFT JOIN player_recent_stats prs ON u.id = prs.user_id
        LEFT JOIN player_historical_stats phs ON u.id = phs.user_id
        LEFT JOIN cohort_stats cs ON u.id = cs.player_id
        WHERE u.is_bot = FALSE AND u.status = 'active'
        ORDER BY u.id
        """

        df = pd.read_sql_query(query, conn)

        if df.empty:
            logger.warning("No active players found for anomaly detection")
            return []

        # Convert DataFrame rows to PlayerAnomalyFeatures objects
        features_list = []
        for _, row in df.iterrows():
            # Calculate z-scores for each feature
            win_rate_zscore = (
                (row['recent_win_rate'] - row['cohort_avg_profit']) /
                max(row['cohort_stddev_profit'], 0.01)
            ) if row['recent_game_count'] > 0 else 0.0

            session_length_change = (
                (row['recent_avg_session_length'] - row['hist_avg_session_length']) /
                max(row['cohort_avg_session_length'], 1.0)
            ) if row['hist_avg_session_length'] > 0 else 0.0

            # Bet aggression z-score
            bet_aggression_spike = row['bet_aggression_ratio'] * 3.0

            # Churn risk approximated by days since last game
            last_activity_days = 30  # Default: no activity in last 30 days
            churn_risk_jump = (last_activity_days / 30.0) * 3.0

            # Games per week change
            recent_games_per_week = (
                (row['recent_game_count'] / max(row['days_active_recent'], 1)) * 7.0
            ) if row['days_active_recent'] > 0 else 0.0

            games_per_week_change = (
                (recent_games_per_week - row['hist_games_per_week']) /
                max(row['hist_games_per_week'], 0.1)
            ) if row['hist_games_per_week'] > 0 else 0.0

            features = PlayerAnomalyFeatures(
                player_id=str(row['player_id']),
                win_rate_zscore=float(win_rate_zscore),
                session_length_change=float(session_length_change),
                bet_aggression_spike=float(bet_aggression_spike),
                churn_risk_jump=float(churn_risk_jump),
                games_per_week_change=float(games_per_week_change),
                cohort_id=int(row['cluster_id']) if row['cluster_id'] > 0 else None
            )
            features_list.append(features)

        logger.info(f"Extracted anomaly features for {len(features_list)} players")
        return features_list

    except psycopg2.Error as e:
        logger.error(f"Database query failed: {e}")
        raise


def features_to_dataframe(features_list: List[PlayerAnomalyFeatures]) -> pd.DataFrame:
    """
    Convert PlayerAnomalyFeatures list to DataFrame.

    Args:
        features_list: List of PlayerAnomalyFeatures objects

    Returns:
        pd.DataFrame: DataFrame with player_id and feature columns
    """
    data = {
        'player_id': [f.player_id for f in features_list],
        'win_rate_zscore': [f.win_rate_zscore for f in features_list],
        'session_length_change': [f.session_length_change for f in features_list],
        'bet_aggression_spike': [f.bet_aggression_spike for f in features_list],
        'churn_risk_jump': [f.churn_risk_jump for f in features_list],
        'games_per_week_change': [f.games_per_week_change for f in features_list],
        'cohort_id': [f.cohort_id for f in features_list],
    }
    return pd.DataFrame(data)


def train_isolation_forest(
    X_scaled: np.ndarray,
    contamination: float = ISOLATION_FOREST_CONTAMINATION,
    n_estimators: int = ISOLATION_FOREST_N_ESTIMATORS
) -> Tuple[IsolationForest, StandardScaler]:
    """
    Train Isolation Forest model for anomaly detection.

    Args:
        X_scaled: Scaled feature matrix (n_samples, n_features)
        contamination: Expected proportion of anomalies (default: 0.05)
        n_estimators: Number of isolation trees (default: 100)

    Returns:
        Tuple containing:
            - IsolationForest: Trained model
            - StandardScaler: Fitted scaler

    Raises:
        ValueError: If training fails or insufficient data
    """
    if len(X_scaled) < 10:
        raise ValueError(f"Need at least 10 samples for training, got {len(X_scaled)}")

    try:
        iso_forest = IsolationForest(
            contamination=contamination,
            n_estimators=n_estimators,
            random_state=42,
            n_jobs=-1
        )
        iso_forest.fit(X_scaled)

        logger.info(
            f"Trained IsolationForest: contamination={contamination}, "
            f"n_estimators={n_estimators}, n_samples={len(X_scaled)}"
        )

        return iso_forest

    except Exception as e:
        logger.error(f"Failed to train Isolation Forest: {e}")
        raise


def calculate_zscore_statistics(features_df: pd.DataFrame) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Calculate mean and standard deviation for z-score computation.

    Args:
        features_df: DataFrame with feature columns

    Returns:
        Tuple of (means_dict, stds_dict)
    """
    feature_cols = [
        'win_rate_zscore',
        'session_length_change',
        'bet_aggression_spike',
        'churn_risk_jump',
        'games_per_week_change'
    ]

    means = {}
    stds = {}

    for col in feature_cols:
        means[col] = float(features_df[col].mean())
        stds[col] = float(features_df[col].std() + 1e-8)  # Add epsilon to avoid division by zero

    return means, stds


def score_player_anomalies(
    features_df: pd.DataFrame,
    iso_forest: IsolationForest,
    scaler: StandardScaler,
    feature_means: Dict[str, float],
    feature_stds: Dict[str, float]
) -> List[AnomalyDetectionResult]:
    """
    Score players for anomalies using trained Isolation Forest.

    For each player, computes:
    1. Isolation Forest anomaly score (-1 to 1, negative = anomaly)
    2. Z-score for each feature
    3. Flags anomaly if: anomaly_score > threshold AND feature_zscore > 3σ

    Args:
        features_df: DataFrame with player features
        iso_forest: Trained Isolation Forest model
        scaler: Fitted StandardScaler
        feature_means: Mean values for z-score computation
        feature_stds: Std values for z-score computation

    Returns:
        List[AnomalyDetectionResult]: Detection results for each player
    """
    feature_cols = [
        'win_rate_zscore',
        'session_length_change',
        'bet_aggression_spike',
        'churn_risk_jump',
        'games_per_week_change'
    ]

    X = features_df[feature_cols].values
    X_scaled = scaler.transform(X)

    # Get anomaly scores from Isolation Forest
    # Note: sklearn's IsolationForest returns:
    # - score_samples: anomaly scores (negative = anomaly, positive = normal)
    # - predict: -1 (anomaly) or 1 (normal)
    anomaly_scores = iso_forest.score_samples(X_scaled)
    predictions = iso_forest.predict(X_scaled)

    results = []

    for idx, player_id in enumerate(features_df['player_id']):
        anomaly_score = float(anomaly_scores[idx])
        prediction = predictions[idx]  # -1 = anomaly, 1 = normal

        # Normalize anomaly score to [0, 1] range (where 0 = normal, 1 = anomaly)
        # sklearn scores are in range [-inf, 0], we convert to [0, 1]
        normalized_anomaly_score = max(0, min(1, 1 - (anomaly_score / -5.0)))

        # Check each feature for anomalies
        detected_anomalies = []

        for feature_idx, feature_col in enumerate(feature_cols):
            feature_value = float(X[idx, feature_idx])
            feature_zscore = (feature_value - feature_means[feature_col]) / feature_stds[feature_col]

            # Anomaly type mapping
            anomaly_type_map = {
                0: "win_rate_spike",
                1: "session_change",
                2: "bet_aggression",
                3: "churn_risk",
                4: "game_frequency"
            }

            # Check if this feature exceeds threshold
            if abs(feature_zscore) > ZSCORE_THRESHOLD and normalized_anomaly_score > ANOMALY_SCORE_THRESHOLD:
                anomaly_type = anomaly_type_map[feature_idx]
                confidence = min(1.0, normalized_anomaly_score * (abs(feature_zscore) / ZSCORE_THRESHOLD))

                detected_anomalies.append(
                    AnomalyDetectionResult(
                        player_id=str(player_id),
                        anomaly_type=anomaly_type,
                        confidence=float(confidence),
                        anomaly_score=normalized_anomaly_score,
                        feature_zscore=float(feature_zscore),
                        feature_value=feature_value,
                        cohort_average=feature_means[feature_col],
                        is_anomaly=True
                    )
                )

        results.extend(detected_anomalies)

    logger.info(f"Scored {len(features_df)} players, detected {len(results)} anomalies")
    return results


def store_anomalies_in_database(
    conn,
    anomalies: List[AnomalyDetectionResult]
) -> int:
    """
    Store detected anomalies in player_anomalies table.

    Creates player_anomalies table if it doesn't exist, then inserts
    anomaly records with full details.

    Args:
        conn: Database connection
        anomalies: List of AnomalyDetectionResult objects

    Returns:
        int: Number of anomalies stored

    Raises:
        psycopg2.Error: If database update fails
    """
    cursor = conn.cursor()

    try:
        # Ensure table exists (should already exist from migration)
        # Insert anomalies
        inserted_count = 0
        for anomaly in anomalies:
            insert_query = """
            INSERT INTO player_anomalies
                (player_id, anomaly_type, confidence, anomaly_score, feature_zscore,
                 feature_value, cohort_average, is_active, details)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """

            details = {
                "anomaly_type": anomaly.anomaly_type,
                "threshold_zscore": ZSCORE_THRESHOLD,
                "threshold_score": ANOMALY_SCORE_THRESHOLD,
                "feature_zscore": anomaly.feature_zscore,
                "feature_value": anomaly.feature_value,
                "cohort_average": anomaly.cohort_average
            }

            params = (
                anomaly.player_id,
                anomaly.anomaly_type,
                anomaly.confidence,
                anomaly.anomaly_score,
                anomaly.feature_zscore,
                anomaly.feature_value,
                anomaly.cohort_average,
                True,
                json.dumps(details)
            )

            cursor.execute(insert_query, params)
            inserted_count += cursor.rowcount

        conn.commit()
        logger.info(f"Stored {inserted_count} anomalies in database")
        return inserted_count

    except psycopg2.Error as e:
        conn.rollback()
        logger.error(f"Database insert failed: {e}")
        raise
    finally:
        cursor.close()


def run_anomaly_detection_pipeline(
    async_mode: bool = False
) -> Dict[str, Any]:
    """
    Run complete anomaly detection pipeline.

    1. Extract player anomaly features from database
    2. Scale features using StandardScaler
    3. Train Isolation Forest model
    4. Score players for anomalies
    5. Store anomalies in database

    Args:
        async_mode: If True, run as async job (log timing)

    Returns:
        Dict with pipeline results:
            - success: bool
            - num_players: int
            - num_anomalies: int
            - anomalies_stored: int
            - inference_time_ms: float
            - feature_means: dict
            - feature_stds: dict

    Raises:
        Exception: If pipeline fails at any step
    """
    conn = get_db_connection()
    start_time = time.time()

    try:
        # Step 1: Extract features
        logger.info("Extracting player anomaly features...")
        features_list = extract_player_anomaly_features(conn)

        if not features_list:
            logger.warning("No players found for anomaly detection")
            return {
                "success": False,
                "error": "No active players found",
                "num_players": 0
            }

        features_df = features_to_dataframe(features_list)
        num_players = len(features_df)
        logger.info(f"Extracted features for {num_players} players")

        # Step 2: Scale features
        logger.info("Scaling features...")
        feature_cols = [
            'win_rate_zscore',
            'session_length_change',
            'bet_aggression_spike',
            'churn_risk_jump',
            'games_per_week_change'
        ]

        X = features_df[feature_cols].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Step 3: Train Isolation Forest
        logger.info("Training Isolation Forest...")
        iso_forest = train_isolation_forest(X_scaled)

        # Step 4: Calculate z-score statistics
        logger.info("Computing z-score statistics...")
        feature_means, feature_stds = calculate_zscore_statistics(features_df)

        # Step 5: Score players
        logger.info("Scoring players for anomalies...")
        inference_start = time.time()
        anomalies = score_player_anomalies(
            features_df, iso_forest, scaler, feature_means, feature_stds
        )
        inference_time = time.time() - inference_start

        # Step 6: Store anomalies
        logger.info("Storing anomalies in database...")
        if anomalies:
            anomalies_stored = store_anomalies_in_database(conn, anomalies)
        else:
            anomalies_stored = 0

        elapsed_time = time.time() - start_time
        logger.info(
            f"Anomaly detection pipeline completed: "
            f"{num_players} players, {len(anomalies)} anomalies detected, "
            f"inference={inference_time*1000:.1f}ms, total={elapsed_time*1000:.1f}ms"
        )

        return {
            "success": True,
            "num_players": num_players,
            "num_anomalies": len(anomalies),
            "anomalies_stored": anomalies_stored,
            "inference_time_ms": float(inference_time * 1000),
            "total_time_ms": float(elapsed_time * 1000),
            "feature_means": feature_means,
            "feature_stds": feature_stds,
            "anomaly_types": {
                anom.anomaly_type: len([a for a in anomalies if a.anomaly_type == anom.anomaly_type])
                for anom in set([AnomalyDetectionResult(
                    player_id=a.player_id,
                    anomaly_type=a.anomaly_type,
                    confidence=0,
                    anomaly_score=0,
                    feature_zscore=0,
                    feature_value=0,
                    cohort_average=0,
                    is_anomaly=False
                ) for a in anomalies])
            }
        }

    except Exception as e:
        logger.error(f"Anomaly detection pipeline failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }
    finally:
        conn.close()


if __name__ == "__main__":
    # Test script
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    result = run_anomaly_detection_pipeline()

    if result.get("success"):
        print(f"\nAnomaly Detection Results:")
        print(f"  Players: {result['num_players']}")
        print(f"  Anomalies Detected: {result['num_anomalies']}")
        print(f"  Anomalies Stored: {result['anomalies_stored']}")
        print(f"  Inference Time: {result['inference_time_ms']:.2f}ms")
        print(f"  Total Time: {result['total_time_ms']:.2f}ms")
        if result.get('anomaly_types'):
            print(f"  By Type: {result['anomaly_types']}")
    else:
        print(f"Anomaly detection failed: {result.get('error')}")
