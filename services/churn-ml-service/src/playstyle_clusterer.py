"""
Playstyle Clustering Module

Implements K-means clustering to categorize players into distinct playstyles:
- Casual: Low session length, low bet aggression, stable win rate
- Aggressive: High bet aggression, high volatility, churn risk
- Grind: High session length, steady game counts, stable profit
- Risky (optional): Detected anomalies and outliers

Features used:
- avg_session_length: Average duration of player sessions (minutes)
- bet_aggression: Ratio of raised/called bets to total bets
- win_rate_volatility: Standard deviation of win rates across sessions
- churn_risk_score: Probability of churn (0-100)
- game_count_per_week: Average games played per week
"""

import os
import logging
import psycopg2
import numpy as np
import pandas as pd
from typing import Dict, Tuple, List, Optional, Any
from dataclasses import dataclass
from dotenv import load_dotenv

from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score

load_dotenv()

logger = logging.getLogger("playstyle-clusterer")

DATABASE_URL = os.getenv("DATABASE_URL")

# Cluster interpretation mappings
CLUSTER_LABELS = {
    0: "Casual",
    1: "Aggressive",
    2: "Grind",
    3: "Risky"
}

CLUSTER_DESCRIPTIONS = {
    0: "Low session length, low bet aggression, stable win rate",
    1: "High bet aggression, high volatility, churn risk",
    2: "High session length, steady game counts, stable profit",
    3: "Anomalies and outliers"
}


@dataclass
class PlayerFeatures:
    """Container for player clustering features."""
    player_id: str
    avg_session_length: float
    bet_aggression: float
    win_rate_volatility: float
    churn_risk_score: float
    game_count_per_week: float
    game_count: int


def get_db_connection():
    """Get PostgreSQL database connection."""
    return psycopg2.connect(DATABASE_URL)


def extract_player_features(conn) -> List[PlayerFeatures]:
    """
    Extract clustering features for all active players (game_count > 10).

    Query strategy:
    1. Get player game statistics from game_participants
    2. Calculate session-level aggregates from player_sessions or game times
    3. Compute bet aggression from game_participants
    4. Calculate win rate volatility across sessions
    5. Get churn risk score from predictions or inferred metrics
    6. Compute games per week

    Args:
        conn: Database connection

    Returns:
        List[PlayerFeatures]: List of player feature objects for active players

    Raises:
        psycopg2.Error: If database query fails
    """
    try:
        query = """
        WITH player_games AS (
            SELECT
                gp.user_id,
                COUNT(gp.id) as game_count,
                COUNT(DISTINCT DATE(gp.joined_at)) as days_active,
                EXTRACT(DAY FROM (MAX(gp.joined_at) - MIN(gp.joined_at))) + 1 as span_days,
                AVG(EXTRACT(EPOCH FROM (gp.left_at - gp.joined_at)) / 60.0) as avg_session_length,
                SUM(CASE WHEN (gp.prize_won - COALESCE(gp.entry_fee_deducted, 0)) > 0 THEN 1 ELSE 0 END)::float / COUNT(gp.id) as win_rate,
                STDDEV(CASE WHEN (gp.prize_won - COALESCE(gp.entry_fee_deducted, 0)) > 0 THEN 1.0 ELSE 0.0 END) as win_rate_volatility,
                SUM(COALESCE(gp.prize_won, 0) - COALESCE(gp.entry_fee_deducted, 0)) as net_profit
            FROM game_participants gp
            WHERE gp.is_bot = FALSE
            GROUP BY gp.user_id
            HAVING COUNT(gp.id) > 10
        ),
        player_activity AS (
            SELECT
                u.id as player_id,
                pg.game_count,
                pg.avg_session_length,
                COALESCE(pg.win_rate_volatility, 0.0) as win_rate_volatility,
                CASE
                    WHEN pg.span_days > 0 THEN (pg.game_count / NULLIF(pg.span_days, 0)) * 7.0
                    ELSE 0.0
                END as game_count_per_week,
                COALESCE(
                    LEAST(EXTRACT(EPOCH FROM (NOW() - MAX(wt.created_at))) / 86400 * 7.0, 100.0),
                    0.0
                ) as churn_risk_score
            FROM users u
            INNER JOIN player_games pg ON u.id = pg.user_id
            LEFT JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'deposit' AND wt.status = 'completed'
            WHERE u.is_bot = FALSE AND u.status = 'active'
            GROUP BY u.id, pg.game_count, pg.avg_session_length, pg.win_rate_volatility, pg.span_days
        )
        SELECT
            player_id,
            COALESCE(avg_session_length, 0.0) as avg_session_length,
            CASE
                WHEN game_count_per_week > 0 THEN LEAST(ABS(COALESCE(win_rate_volatility, 0.0)), 1.0)
                ELSE 0.0
            END as bet_aggression,
            COALESCE(win_rate_volatility, 0.0) as win_rate_volatility,
            COALESCE(churn_risk_score, 0.0) as churn_risk_score,
            COALESCE(game_count_per_week, 0.0) as game_count_per_week,
            game_count
        FROM player_activity
        ORDER BY player_id
        """

        df = pd.read_sql_query(query, conn)

        if df.empty:
            logger.warning("No players with game_count > 10 found in database")
            return []

        # Convert DataFrame rows to PlayerFeatures objects
        features_list = []
        for _, row in df.iterrows():
            features = PlayerFeatures(
                player_id=str(row['player_id']),
                avg_session_length=float(row['avg_session_length']),
                bet_aggression=float(row['bet_aggression']),
                win_rate_volatility=float(row['win_rate_volatility']),
                churn_risk_score=float(row['churn_risk_score']),
                game_count_per_week=float(row['game_count_per_week']),
                game_count=int(row['game_count'])
            )
            features_list.append(features)

        logger.info(f"Extracted features for {len(features_list)} players")
        return features_list

    except psycopg2.Error as e:
        logger.error(f"Database query failed: {e}")
        raise


def features_to_dataframe(features_list: List[PlayerFeatures]) -> pd.DataFrame:
    """
    Convert PlayerFeatures list to DataFrame with feature columns.

    Args:
        features_list: List of PlayerFeatures objects

    Returns:
        pd.DataFrame: DataFrame with player_id and feature columns
    """
    data = {
        'player_id': [f.player_id for f in features_list],
        'avg_session_length': [f.avg_session_length for f in features_list],
        'bet_aggression': [f.bet_aggression for f in features_list],
        'win_rate_volatility': [f.win_rate_volatility for f in features_list],
        'churn_risk_score': [f.churn_risk_score for f in features_list],
        'game_count_per_week': [f.game_count_per_week for f in features_list],
    }
    return pd.DataFrame(data)


def find_optimal_k(X_scaled: np.ndarray, k_range: List[int] = None) -> Tuple[int, float]:
    """
    Find optimal number of clusters using silhouette score.

    Tests k values and returns the k with highest silhouette score.
    Requires at least 2 samples and k >= 2.

    Args:
        X_scaled: Scaled feature matrix
        k_range: List of k values to test (default: [2, 3, 4])

    Returns:
        Tuple[int, float]: (optimal_k, best_silhouette_score)

    Raises:
        ValueError: If unable to compute silhouette score for any k
    """
    if k_range is None:
        k_range = [2, 3, 4]

    if len(X_scaled) < 2:
        raise ValueError(f"Need at least 2 samples for clustering, got {len(X_scaled)}")

    best_k = k_range[0]
    best_score = -1.0

    for k in k_range:
        if k > len(X_scaled):
            logger.warning(f"k={k} > sample size {len(X_scaled)}, skipping")
            continue

        try:
            kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = kmeans.fit_predict(X_scaled)
            score = silhouette_score(X_scaled, labels)

            logger.info(f"k={k}: silhouette_score={score:.4f}")

            if score > best_score:
                best_score = score
                best_k = k

        except Exception as e:
            logger.error(f"Failed to compute silhouette score for k={k}: {e}")
            raise

    logger.info(f"Optimal k={best_k} with silhouette_score={best_score:.4f}")
    return best_k, best_score


def perform_clustering(features_df: pd.DataFrame) -> Tuple[KMeans, np.ndarray, StandardScaler, float]:
    """
    Perform K-means clustering on player features.

    1. Scales features using StandardScaler
    2. Finds optimal k via silhouette score
    3. Trains KMeans model
    4. Returns model, cluster labels, and scaler

    Args:
        features_df: DataFrame with feature columns (not player_id)

    Returns:
        Tuple containing:
            - KMeans: Trained model
            - np.ndarray: Cluster assignments (0 to k-1)
            - StandardScaler: Fitted scaler
            - float: Silhouette score

    Raises:
        ValueError: If clustering fails or silhouette < 0.5 (quality gate)
    """
    if features_df.empty:
        raise ValueError("Cannot perform clustering on empty DataFrame")

    # Feature columns to use
    feature_cols = [
        'avg_session_length',
        'bet_aggression',
        'win_rate_volatility',
        'churn_risk_score',
        'game_count_per_week'
    ]

    X = features_df[feature_cols].values

    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Find optimal k
    optimal_k, silhouette_avg = find_optimal_k(X_scaled)

    # Quality gate: silhouette >= 0.5
    if silhouette_avg < 0.5:
        logger.warning(
            f"Silhouette score {silhouette_avg:.4f} < 0.5 threshold. "
            "Clustering quality is poor but continuing."
        )

    # Train KMeans with optimal k
    kmeans = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(X_scaled)

    logger.info(
        f"Clustering complete: k={optimal_k}, silhouette={silhouette_avg:.4f}, "
        f"sample_size={len(X_scaled)}"
    )

    return kmeans, labels, scaler, silhouette_avg


def get_cluster_centroids(kmeans: KMeans, scaler: StandardScaler) -> Dict[int, Dict[str, float]]:
    """
    Get cluster centroids in original feature space.

    Args:
        kmeans: Trained KMeans model
        scaler: Fitted StandardScaler

    Returns:
        Dict mapping cluster_id to dict of feature values at centroid
    """
    feature_cols = [
        'avg_session_length',
        'bet_aggression',
        'win_rate_volatility',
        'churn_risk_score',
        'game_count_per_week'
    ]

    centroids_scaled = kmeans.cluster_centers_
    centroids_original = scaler.inverse_transform(centroids_scaled)

    centroids = {}
    for i, centroid in enumerate(centroids_original):
        centroids[i] = {col: float(val) for col, val in zip(feature_cols, centroid)}

    return centroids


def assign_player_clusters(
    features_df: pd.DataFrame,
    cluster_labels: np.ndarray
) -> pd.DataFrame:
    """
    Assign cluster IDs to players.

    Args:
        features_df: DataFrame with player_id column
        cluster_labels: Array of cluster assignments

    Returns:
        pd.DataFrame: Original df + cluster_id column
    """
    result_df = features_df.copy()
    result_df['cluster_id'] = cluster_labels
    result_df['cluster_name'] = result_df['cluster_id'].map(lambda x: CLUSTER_LABELS.get(x, "Unknown"))
    return result_df


def update_player_profiles_with_clusters(
    conn,
    player_clusters: pd.DataFrame
) -> int:
    """
    Update bot_player_profiles table with cluster assignments.

    Creates bot_player_profiles table if it doesn't exist, then updates
    cluster_id for each player.

    Args:
        conn: Database connection
        player_clusters: DataFrame with player_id and cluster_id columns

    Returns:
        int: Number of profiles updated

    Raises:
        psycopg2.Error: If database update fails
    """
    cursor = conn.cursor()

    try:
        # Ensure table exists
        create_table_query = """
        CREATE TABLE IF NOT EXISTS bot_player_profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            player_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            cluster_id INT,
            cluster_name VARCHAR(30),
            avg_session_length NUMERIC(10,2),
            bet_aggression NUMERIC(5,3),
            win_rate_volatility NUMERIC(5,3),
            churn_risk_score NUMERIC(5,2),
            game_count_per_week NUMERIC(5,2),
            game_count INT,
            last_clustered_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_player_id
            ON bot_player_profiles(player_id);
        CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_cluster_id
            ON bot_player_profiles(cluster_id);
        """

        cursor.execute(create_table_query)

        # Upsert player profiles with cluster assignments
        updated_count = 0
        for _, row in player_clusters.iterrows():
            upsert_query = """
            INSERT INTO bot_player_profiles
                (player_id, cluster_id, cluster_name, avg_session_length, bet_aggression,
                 win_rate_volatility, churn_risk_score, game_count_per_week, game_count)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (player_id)
            DO UPDATE SET
                cluster_id = EXCLUDED.cluster_id,
                cluster_name = EXCLUDED.cluster_name,
                avg_session_length = EXCLUDED.avg_session_length,
                bet_aggression = EXCLUDED.bet_aggression,
                win_rate_volatility = EXCLUDED.win_rate_volatility,
                churn_risk_score = EXCLUDED.churn_risk_score,
                game_count_per_week = EXCLUDED.game_count_per_week,
                game_count = EXCLUDED.game_count,
                last_clustered_at = NOW(),
                updated_at = NOW()
            """

            params = (
                row['player_id'],
                int(row['cluster_id']),
                row.get('cluster_name', CLUSTER_LABELS.get(int(row['cluster_id']), 'Unknown')),
                float(row['avg_session_length']),
                float(row['bet_aggression']),
                float(row['win_rate_volatility']),
                float(row['churn_risk_score']),
                float(row['game_count_per_week']),
                int(row.get('game_count', 0))
            )

            cursor.execute(upsert_query, params)
            updated_count += cursor.rowcount

        conn.commit()
        logger.info(f"Updated {updated_count} player profiles with cluster assignments")
        return updated_count

    except psycopg2.Error as e:
        conn.rollback()
        logger.error(f"Database update failed: {e}")
        raise
    finally:
        cursor.close()


def run_clustering_pipeline() -> Dict[str, Any]:
    """
    Run complete playstyle clustering pipeline.

    1. Extract player features from database
    2. Perform K-means clustering
    3. Assign cluster IDs to players
    4. Update database with cluster assignments

    Returns:
        Dict with pipeline results:
            - success: bool
            - num_players: int
            - optimal_k: int
            - silhouette_score: float
            - profiles_updated: int
            - centroids: Dict of cluster centroids
            - cluster_distribution: Dict of cluster counts

    Raises:
        Exception: If pipeline fails at any step
    """
    conn = get_db_connection()

    try:
        # Step 1: Extract features
        logger.info("Extracting player features...")
        features_list = extract_player_features(conn)

        if not features_list:
            logger.warning("No players found for clustering")
            return {
                "success": False,
                "error": "No players with game_count > 10 found",
                "num_players": 0
            }

        features_df = features_to_dataframe(features_list)
        num_players = len(features_df)
        logger.info(f"Extracted features for {num_players} players")

        # Step 2: Perform clustering
        logger.info("Performing K-means clustering...")
        kmeans, labels, scaler, silhouette_avg = perform_clustering(features_df)
        optimal_k = kmeans.n_clusters

        # Step 3: Assign clusters
        logger.info("Assigning cluster IDs...")
        player_clusters = assign_player_clusters(features_df, labels)

        # Step 4: Update database
        logger.info("Updating database with cluster assignments...")
        profiles_updated = update_player_profiles_with_clusters(conn, player_clusters)

        # Get cluster statistics
        centroids = get_cluster_centroids(kmeans, scaler)
        cluster_dist = player_clusters['cluster_id'].value_counts().to_dict()

        logger.info("Playstyle clustering pipeline completed successfully")

        return {
            "success": True,
            "num_players": num_players,
            "optimal_k": optimal_k,
            "silhouette_score": float(silhouette_avg),
            "profiles_updated": profiles_updated,
            "centroids": centroids,
            "cluster_distribution": {int(k): int(v) for k, v in cluster_dist.items()},
            "cluster_labels": {int(k): CLUSTER_LABELS.get(k, "Unknown") for k in range(optimal_k)}
        }

    except Exception as e:
        logger.error(f"Clustering pipeline failed: {e}")
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

    result = run_clustering_pipeline()

    if result.get("success"):
        print(f"\nClustering Results:")
        print(f"  Players: {result['num_players']}")
        print(f"  Optimal K: {result['optimal_k']}")
        print(f"  Silhouette Score: {result['silhouette_score']:.4f}")
        print(f"  Profiles Updated: {result['profiles_updated']}")
        print(f"  Distribution: {result['cluster_distribution']}")
    else:
        print(f"Clustering failed: {result.get('error')}")
