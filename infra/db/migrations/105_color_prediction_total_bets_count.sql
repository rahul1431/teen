-- Migration 105: Add total_bets_count column to color_prediction_rounds if not exists
ALTER TABLE color_prediction_rounds ADD COLUMN IF NOT EXISTS total_bets_count INTEGER NOT NULL DEFAULT 0;
