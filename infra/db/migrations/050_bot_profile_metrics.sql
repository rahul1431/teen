-- infra/db/migrations/050_bot_profile_metrics.sql
-- Phase 1: Fairness & Metrics Dashboard — hourly aggregation of bot profile metrics
-- Enables efficient metric tracking and anomaly detection for bot performance monitoring

-- ========== UP: Create bot_profile_metrics table and indices ==========
BEGIN;

CREATE TABLE IF NOT EXISTS bot_profile_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL REFERENCES bot_profiles(id) ON DELETE CASCADE,
  game_type             VARCHAR(50) NOT NULL,
  difficulty            VARCHAR(20) NOT NULL,
  hour                  TIMESTAMP NOT NULL,
  game_count            INTEGER NOT NULL DEFAULT 0,
  avg_win_rate          NUMERIC(4,3),
  win_rate_std          NUMERIC(4,3),
  percentile_rank       INTEGER,
  sample_size           INTEGER NOT NULL DEFAULT 0,
  drift_from_target     NUMERIC(4,3),
  is_alert              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- Index for efficient lookup by game_type, difficulty, and hour
CREATE INDEX IF NOT EXISTS idx_bot_profile_metrics_game_difficulty_hour
  ON bot_profile_metrics(game_type, difficulty, hour DESC);

-- Index for alert queries
CREATE INDEX IF NOT EXISTS idx_bot_profile_metrics_is_alert
  ON bot_profile_metrics(is_alert)
  WHERE is_alert = TRUE;

-- Index for profile-based queries
CREATE INDEX IF NOT EXISTS idx_bot_profile_metrics_profile_id
  ON bot_profile_metrics(profile_id);

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS idx_bot_profile_metrics_hour_desc
  ON bot_profile_metrics(hour DESC);

COMMIT;

-- ========== DOWN: Drop table and indices (for manual rollback) ==========
-- To rollback, run:
-- DROP TABLE IF EXISTS bot_profile_metrics CASCADE;
-- DROP INDEX IF EXISTS idx_bot_profile_metrics_game_difficulty_hour;
-- DROP INDEX IF EXISTS idx_bot_profile_metrics_is_alert;
-- DROP INDEX IF EXISTS idx_bot_profile_metrics_profile_id;
-- DROP INDEX IF EXISTS idx_bot_profile_metrics_hour_desc;
