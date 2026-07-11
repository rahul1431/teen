-- infra/db/migrations/052_playstyle_clustering.sql
-- Phase 2: Adaptive Features — player playstyle clustering
-- Implements K-means clustering to categorize players into distinct playstyles:
-- - Casual: Low session length, low bet aggression, stable win rate
-- - Aggressive: High bet aggression, high volatility, churn risk
-- - Grind: High session length, steady game counts, stable profit
-- - Risky (optional): Detected anomalies and outliers

BEGIN;

-- Create bot_player_profiles table for storing player clustering results
CREATE TABLE IF NOT EXISTS bot_player_profiles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    cluster_id              INT,
    cluster_name            VARCHAR(30),
    avg_session_length      NUMERIC(10,2),
    bet_aggression          NUMERIC(5,3),
    win_rate_volatility     NUMERIC(5,3),
    churn_risk_score        NUMERIC(5,2),
    game_count_per_week     NUMERIC(5,2),
    game_count              INT,
    last_clustered_at       TIMESTAMPTZ DEFAULT NOW(),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Index for player_id lookups
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_player_id
    ON bot_player_profiles(player_id);

-- Index for cluster_id queries (used for cluster-based analysis)
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_cluster_id
    ON bot_player_profiles(cluster_id);

-- Index for time-based queries (last clustering time)
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_last_clustered_at
    ON bot_player_profiles(last_clustered_at DESC);

-- Index for churn risk analysis
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_churn_risk
    ON bot_player_profiles(churn_risk_score DESC);

-- Index for composite queries on cluster and features
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_cluster_churn
    ON bot_player_profiles(cluster_id, churn_risk_score);

COMMIT;

-- ========== DOWN: Drop table and indices (for manual rollback) ==========
-- To rollback, run:
-- DROP TABLE IF EXISTS bot_player_profiles CASCADE;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_player_id;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_cluster_id;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_last_clustered_at;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_churn_risk;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_cluster_churn;
