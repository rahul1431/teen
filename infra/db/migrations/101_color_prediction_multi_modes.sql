-- Migration 101: Add game_mode support to Color Prediction rounds and bets
ALTER TABLE color_prediction_rounds ADD COLUMN IF NOT EXISTS game_mode VARCHAR(10) NOT NULL DEFAULT '30s';
ALTER TABLE color_prediction_bets ADD COLUMN IF NOT EXISTS game_mode VARCHAR(10) NOT NULL DEFAULT '30s';

CREATE INDEX IF NOT EXISTS idx_cp_rounds_mode_status ON color_prediction_rounds(game_mode, status);
CREATE INDEX IF NOT EXISTS idx_cp_bets_mode ON color_prediction_bets(game_mode);
