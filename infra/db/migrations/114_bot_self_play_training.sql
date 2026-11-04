-- Migration: 114_bot_self_play_training.sql
-- Description: Audit and telemetry table for autonomous bot self-play simulations and policy retraining.
-- Stores simulated batch iterations (100-1000+ games), empirical win rates, bluff metrics,
-- and derived optimal policy weights across Easy, Medium, and Hard tiers.

CREATE TABLE IF NOT EXISTS bot_self_play_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type           VARCHAR(30) NOT NULL,
  games_simulated     INTEGER NOT NULL,
  duration_ms         INTEGER NOT NULL,
  trigger_source      VARCHAR(50) NOT NULL DEFAULT 'nightly_rebuild',
  results_summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  calibrated_profiles JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied             BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_self_play_runs_game_created ON bot_self_play_runs(game_type, created_at DESC);

