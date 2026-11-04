-- infra/db/migrations/060_bot_profile_metrics_win_rate_target.sql
-- Adds missing win_rate_target column to bot_profile_metrics table
-- This column is required by drift-detector.ts and metrics-routes.ts

BEGIN;

ALTER TABLE bot_profile_metrics
  ADD COLUMN IF NOT EXISTS win_rate_target NUMERIC(5,2);

COMMIT;
