-- infra/db/migrations/090_ludo_personalized_difficulty_predictions.sql
-- churn-ml-service's difficulty_predictor.py was written assuming
-- bot_player_profiles had per-(player,game_type) columns (game_type,
-- current_difficulty, recommended_difficulty, win_rate) that were never
-- actually part of that table's real schema (migration 052 — that table is
-- correctly owned by playstyle_clusterer.py as one cross-game row per
-- player, keyed UNIQUE(player_id) alone). The mismatch made every real
-- prediction/training DB call fail (500, silently swallowed by predict()'s
-- broad exception fallback) since the feature was first built.
--
-- Fix: give personalized-difficulty its own table instead of overloading
-- the clustering table. difficulty_predictor.py updated to match.

BEGIN;

CREATE TABLE IF NOT EXISTS personalized_difficulty_predictions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_type              VARCHAR(20) NOT NULL,
  current_difficulty     VARCHAR(10),
  recommended_difficulty VARCHAR(10) NOT NULL,
  confidence_score       NUMERIC(5,4),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, game_type)
);

CREATE INDEX IF NOT EXISTS idx_personalized_difficulty_predictions_player_game
  ON personalized_difficulty_predictions(player_id, game_type);

COMMIT;

-- ========== DOWN: Rollback (for manual rollback) ==========
-- DROP TABLE IF EXISTS personalized_difficulty_predictions CASCADE;
