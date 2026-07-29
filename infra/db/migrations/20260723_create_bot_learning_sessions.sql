-- Migration: Create bot_learning_sessions table for bot coordination audit trail
-- Tracks every coordinated game: elected winner, actual winner, performance metrics

CREATE TABLE bot_learning_sessions (
  id BIGSERIAL PRIMARY KEY,
  game_id VARCHAR(255) NOT NULL UNIQUE,
  winner_bot_id BIGINT NOT NULL,
  actual_winner_id BIGINT NOT NULL,
  bot_ids JSONB NOT NULL,  -- [bot_id_1, bot_id_2, bot_id_3]
  rp_id BIGINT NOT NULL,
  strategy_used VARCHAR(50) NOT NULL DEFAULT 'lifetime_winrate',
  target_win_rate NUMERIC(3, 2) NOT NULL DEFAULT 0.85,
  bot_performance JSONB NOT NULL,  -- { bot_id: { moves_made, tokens_advanced, blocks_on_rp }, ... }
  rp_performance JSONB NOT NULL,  -- { moves_made, tokens_advanced, blocks_avoided }
  coordination_success BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Regular indexes for common queries
CREATE INDEX idx_bot_learning_game ON bot_learning_sessions(game_id);
CREATE INDEX idx_bot_learning_created ON bot_learning_sessions(created_at);
CREATE INDEX idx_bot_learning_rp ON bot_learning_sessions(rp_id);
CREATE INDEX idx_bot_learning_winner ON bot_learning_sessions(winner_bot_id);

-- GIN index for JSONB filtering (PostgreSQL)
CREATE INDEX idx_bot_learning_bots ON bot_learning_sessions USING GIN (bot_ids);
