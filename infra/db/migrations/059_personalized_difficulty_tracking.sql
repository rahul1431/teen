-- infra/db/migrations/059_personalized_difficulty_tracking.sql
-- Phase 2 Task 18/19/23: personalized bot-difficulty canary + retention comparison
-- Records which mechanism chose a room's bot_difficulty, so the retention
-- dashboard (Task 23) can compare D1/D7/D30 retention for players who got
-- personalized vs standard (game_configs) difficulty.

BEGIN;

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS bot_difficulty_source VARCHAR(20)
  NOT NULL DEFAULT 'standard' CHECK (bot_difficulty_source IN ('standard', 'personalized'));

CREATE INDEX IF NOT EXISTS idx_game_rooms_bot_difficulty_source
  ON game_rooms(bot_difficulty_source, created_at DESC);

COMMIT;

-- ========== DOWN: Rollback (for manual rollback) ==========
-- ALTER TABLE game_rooms DROP COLUMN IF EXISTS bot_difficulty_source;
