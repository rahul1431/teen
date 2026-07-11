-- infra/db/migrations/053_bot_player_profiles.sql
-- Phase 2: Adaptive Features — personalized difficulty prediction model
-- Tracks player profiles and recommended difficulties based on player performance history

BEGIN;

CREATE TABLE IF NOT EXISTS bot_player_profiles (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_type                 VARCHAR(50) NOT NULL,
  current_difficulty        VARCHAR(20) NOT NULL CHECK (current_difficulty IN ('easy', 'medium', 'hard')),
  recommended_difficulty    VARCHAR(20) CHECK (recommended_difficulty IN ('easy', 'medium', 'hard')),
  playstyle_cluster         INTEGER,
  win_rate                  NUMERIC(5, 3),
  game_count                INTEGER NOT NULL DEFAULT 0,
  last_updated              TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_player_game_type UNIQUE (player_id, game_type),
  CONSTRAINT fk_player_id FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_type CHECK (game_type IN ('teen_patti', 'ludo', 'aviator', 'matka'))
);

-- Index for efficient lookup by player_id
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_player_id
  ON bot_player_profiles(player_id);

-- Index for efficient lookup by game_type
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_game_type
  ON bot_player_profiles(game_type);

-- Index for querying profiles by recommended difficulty
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_recommended_difficulty
  ON bot_player_profiles(recommended_difficulty)
  WHERE recommended_difficulty IS NOT NULL;

-- Index for time-based queries (e.g., profiles not updated in X days)
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_last_updated
  ON bot_player_profiles(last_updated DESC);

-- Index for player_id + game_type lookups (composite for faster queries)
CREATE INDEX IF NOT EXISTS idx_bot_player_profiles_player_game
  ON bot_player_profiles(player_id, game_type);

COMMIT;

-- ========== DOWN: Drop table and indices (for manual rollback) ==========
-- To rollback, run:
-- DROP TABLE IF EXISTS bot_player_profiles CASCADE;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_player_id;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_game_type;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_recommended_difficulty;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_last_updated;
-- DROP INDEX IF EXISTS idx_bot_player_profiles_player_game;
