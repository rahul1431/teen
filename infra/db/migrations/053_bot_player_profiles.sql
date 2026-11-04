-- infra/db/migrations/053_bot_player_profiles.sql
-- Phase 2: Adaptive Features — personalized difficulty prediction model
-- Tracks player profiles and recommended difficulties based on player performance history

BEGIN;

CREATE TABLE IF NOT EXISTS bot_player_profiles (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_type                 VARCHAR(50) NOT NULL DEFAULT 'teen_patti',
  current_difficulty        VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (current_difficulty IN ('easy', 'medium', 'hard')),
  recommended_difficulty    VARCHAR(20) CHECK (recommended_difficulty IN ('easy', 'medium', 'hard')),
  playstyle_cluster         INTEGER,
  win_rate                  NUMERIC(5, 3),
  game_count                INTEGER NOT NULL DEFAULT 0,
  last_updated              TIMESTAMP DEFAULT NOW()
);

-- Ensure columns exist if table was created by a previous migration
ALTER TABLE bot_player_profiles ADD COLUMN IF NOT EXISTS game_type VARCHAR(50) DEFAULT 'teen_patti';
ALTER TABLE bot_player_profiles ADD COLUMN IF NOT EXISTS current_difficulty VARCHAR(20) DEFAULT 'medium';
ALTER TABLE bot_player_profiles ADD COLUMN IF NOT EXISTS recommended_difficulty VARCHAR(20);
ALTER TABLE bot_player_profiles ADD COLUMN IF NOT EXISTS playstyle_cluster INTEGER;
ALTER TABLE bot_player_profiles ADD COLUMN IF NOT EXISTS win_rate NUMERIC(5, 3);
ALTER TABLE bot_player_profiles ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP DEFAULT NOW();

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
