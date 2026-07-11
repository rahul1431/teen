-- infra/db/migrations/054_bot_profiles_cohort_targets.sql
-- Phase 2: Adaptive Features — cohort-based difficulty thresholds
-- Adds cohort tracking to bot profiles to enable adaptive fairness targets per player cluster

BEGIN;

-- Add cohort_id and cohort_target_win_rate to bot_profiles table
ALTER TABLE bot_profiles
ADD COLUMN IF NOT EXISTS cohort_id INTEGER,
ADD COLUMN IF NOT EXISTS cohort_target_win_rate NUMERIC(4,3);

-- Index for cohort lookups
CREATE INDEX IF NOT EXISTS idx_bot_profiles_cohort_id
  ON bot_profiles(cohort_id);

-- Index for game_type + cohort queries (analyzing cohort-specific profiles)
CREATE INDEX IF NOT EXISTS idx_bot_profiles_game_cohort
  ON bot_profiles(game_type, cohort_id);

-- Create table to store detailed cohort targets for each (game_type, difficulty, cluster_id) combination
-- This allows tracking targets for all cohorts, not just the dominant one
CREATE TABLE IF NOT EXISTS bot_profiles_cohort_targets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type               VARCHAR(30) NOT NULL,
  difficulty              VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  cluster_id              INTEGER NOT NULL,
  cluster_name            VARCHAR(30),
  cohort_target_win_rate  NUMERIC(4,3),
  player_count            INTEGER DEFAULT 0,
  avg_win_rate            NUMERIC(5,3),
  last_calculated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_bot_profiles_cohort UNIQUE (game_type, difficulty, cluster_id)
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_bot_profiles_cohort_targets_game_difficulty
  ON bot_profiles_cohort_targets(game_type, difficulty);

CREATE INDEX IF NOT EXISTS idx_bot_profiles_cohort_targets_cluster
  ON bot_profiles_cohort_targets(cluster_id);

CREATE INDEX IF NOT EXISTS idx_bot_profiles_cohort_targets_last_calculated
  ON bot_profiles_cohort_targets(last_calculated_at DESC);

COMMIT;

-- ========== DOWN: Drop columns and tables (for manual rollback) ==========
-- To rollback, run:
-- DROP TABLE IF EXISTS bot_profiles_cohort_targets CASCADE;
-- DROP INDEX IF EXISTS idx_bot_profiles_cohort_id;
-- DROP INDEX IF EXISTS idx_bot_profiles_game_cohort;
-- ALTER TABLE bot_profiles DROP COLUMN IF EXISTS cohort_id;
-- ALTER TABLE bot_profiles DROP COLUMN IF EXISTS cohort_target_win_rate;
