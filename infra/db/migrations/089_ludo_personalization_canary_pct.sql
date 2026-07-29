-- infra/db/migrations/089_ludo_personalization_canary_pct.sql
-- ML Training tab (Ludo admin panel): move the personalized-difficulty
-- canary rollout percentage from an env var into game_configs, per game
-- type, so admins can ramp/rollback from the UI without SSH + restart.
-- Each game_type already has exactly one row (UNIQUE constraint), so this
-- is naturally per-game — no cross-game leakage risk like the old shared
-- env var had.

BEGIN;

ALTER TABLE game_configs ADD COLUMN IF NOT EXISTS personalization_canary_pct SMALLINT
  NOT NULL DEFAULT 0 CHECK (personalization_canary_pct BETWEEN 0 AND 100);

COMMIT;

-- ========== DOWN: Rollback (for manual rollback) ==========
-- ALTER TABLE game_configs DROP COLUMN IF EXISTS personalization_canary_pct;
