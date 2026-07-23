-- Migration: Create bot_learning_sessions table for bot coordination audit trail
-- Tracks every coordinated game: elected winner, actual winner, performance metrics

CREATE TABLE bot_learning_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  game_id VARCHAR(255) NOT NULL UNIQUE,
  winner_bot_id BIGINT NOT NULL,
  actual_winner_id BIGINT NOT NULL,
  bot_ids JSON NOT NULL COMMENT '[bot_id_1, bot_id_2, bot_id_3]',
  rp_id BIGINT NOT NULL,
  strategy_used VARCHAR(50) NOT NULL DEFAULT 'lifetime_winrate',
  target_win_rate DECIMAL(3, 2) NOT NULL DEFAULT 0.85,
  bot_performance JSON NOT NULL COMMENT '{ bot_id: { moves_made, tokens_advanced, blocks_on_rp }, ... }',
  rp_performance JSON NOT NULL COMMENT '{ moves_made, tokens_advanced, blocks_avoided }',
  coordination_success BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_bot_learning_game (game_id),
  KEY idx_bot_learning_created (created_at),
  KEY idx_bot_learning_rp (rp_id),
  KEY idx_bot_learning_winner (winner_bot_id)
);

-- JSON index for bot_ids filtering (MySQL 5.7.8+)
CREATE FULLTEXT INDEX idx_bot_learning_bots ON bot_learning_sessions(bot_ids);
