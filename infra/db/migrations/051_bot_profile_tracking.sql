-- infra/db/migrations/051_bot_profile_tracking.sql
-- Phase 1: Fairness & Metrics Dashboard — track which bot profile was used in each game
-- Enables metrics aggregator to link game outcomes to specific bot profiles

BEGIN;

-- Add bot_profile_id to game_participants to track which profile a bot was using
ALTER TABLE game_participants
  ADD COLUMN bot_profile_id UUID REFERENCES bot_profiles(id) ON DELETE SET NULL;

-- Index for efficient lookup by bot_profile_id
CREATE INDEX IF NOT EXISTS idx_game_participants_bot_profile_id
  ON game_participants(bot_profile_id)
  WHERE bot_profile_id IS NOT NULL;

-- Index for querying bot results by profile and time
CREATE INDEX IF NOT EXISTS idx_game_participants_bot_profile_joined_at
  ON game_participants(bot_profile_id, joined_at DESC)
  WHERE is_bot = TRUE AND bot_profile_id IS NOT NULL;

COMMIT;

-- ========== DOWN: Drop column and indices (for manual rollback) ==========
-- To rollback, run:
-- ALTER TABLE game_participants DROP COLUMN bot_profile_id;
-- DROP INDEX IF EXISTS idx_game_participants_bot_profile_id;
-- DROP INDEX IF EXISTS idx_game_participants_bot_profile_joined_at;
