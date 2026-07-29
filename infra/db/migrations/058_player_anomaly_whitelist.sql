-- infra/db/migrations/058_player_anomaly_whitelist.sql
-- Player Anomalies Dashboard: whitelist flag to exclude a player from anomaly auto-pause/detection

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_anomaly_whitelisted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_anomaly_whitelisted
  ON users(is_anomaly_whitelisted) WHERE is_anomaly_whitelisted = TRUE;

COMMIT;

-- ========== DOWN: Rollback (for manual rollback) ==========
-- ALTER TABLE users DROP COLUMN IF EXISTS is_anomaly_whitelisted;
