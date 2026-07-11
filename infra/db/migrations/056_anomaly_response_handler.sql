-- infra/db/migrations/056_anomaly_response_handler.sql
-- Phase 2: Adaptive Features — anomaly response handler
-- Adds status tracking for anomaly responses, admin overrides, and audit logging

BEGIN;

-- Add user_status_enum value for paused_anomaly if not exists
-- Note: In PostgreSQL, you cannot conditionally add enum values
-- So we use ALTER TYPE ... ADD VALUE if not exists with a version check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'user_status_enum'::regtype
    AND enumlabel = 'paused_anomaly'
  ) THEN
    ALTER TYPE user_status_enum ADD VALUE 'paused_anomaly';
  END IF;
END $$;

-- Add status column to player_anomalies for response tracking
ALTER TABLE player_anomalies ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'new' CHECK (status IN ('new', 'responded', 'paused', 'overridden', 'dismissed'));

-- Add columns to track anomaly response actions
ALTER TABLE player_anomalies ADD COLUMN IF NOT EXISTS support_ticket_id UUID;
ALTER TABLE player_anomalies ADD COLUMN IF NOT EXISTS player_paused_at TIMESTAMPTZ;
ALTER TABLE player_anomalies ADD COLUMN IF NOT EXISTS slack_message_ts TEXT;
ALTER TABLE player_anomalies ADD COLUMN IF NOT EXISTS admin_override_at TIMESTAMPTZ;
ALTER TABLE player_anomalies ADD COLUMN IF NOT EXISTS override_reason VARCHAR(255);
ALTER TABLE player_anomalies ADD COLUMN IF NOT EXISTS override_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;

-- Create anomaly response audit log table
CREATE TABLE IF NOT EXISTS anomaly_response_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id            UUID NOT NULL REFERENCES player_anomalies(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action                VARCHAR(50) NOT NULL CHECK (action IN (
    'detected',
    'paused',
    'alert_sent',
    'ticket_created',
    'override_requested',
    'override_approved',
    'dismissed'
  )),
  details               JSONB,
  actor_type            VARCHAR(20) CHECK (actor_type IN ('system', 'admin')),
  actor_id              UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_anomaly_response_log_anomaly_id
  ON anomaly_response_log(anomaly_id);

CREATE INDEX IF NOT EXISTS idx_anomaly_response_log_player_id
  ON anomaly_response_log(player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_response_log_action
  ON anomaly_response_log(action, created_at DESC);

-- Create admin override audit table
CREATE TABLE IF NOT EXISTS admin_anomaly_overrides (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id            UUID NOT NULL REFERENCES player_anomalies(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  override_reason       VARCHAR(255) NOT NULL,
  notes                 TEXT,
  overridden_at         TIMESTAMPTZ DEFAULT NOW(),
  overridden_by         UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for admin overrides
CREATE INDEX IF NOT EXISTS idx_admin_anomaly_overrides_player_id
  ON admin_anomaly_overrides(player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_anomaly_overrides_admin_id
  ON admin_anomaly_overrides(overridden_by, created_at DESC);

-- Add index on player_anomalies status for efficient response handler queries
CREATE INDEX IF NOT EXISTS idx_player_anomalies_status
  ON player_anomalies(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_anomalies_status_confidence
  ON player_anomalies(status, confidence DESC) WHERE status = 'new';

COMMIT;

-- ========== DOWN: Rollback (for manual rollback) ==========
-- To rollback, run:
-- DROP TABLE IF EXISTS admin_anomaly_overrides CASCADE;
-- DROP TABLE IF EXISTS anomaly_response_log CASCADE;
-- ALTER TABLE player_anomalies DROP COLUMN IF EXISTS override_by;
-- ALTER TABLE player_anomalies DROP COLUMN IF EXISTS admin_override_at;
-- ALTER TABLE player_anomalies DROP COLUMN IF EXISTS override_reason;
-- ALTER TABLE player_anomalies DROP COLUMN IF EXISTS slack_message_ts;
-- ALTER TABLE player_anomalies DROP COLUMN IF EXISTS player_paused_at;
-- ALTER TABLE player_anomalies DROP COLUMN IF EXISTS support_ticket_id;
-- ALTER TABLE player_anomalies DROP COLUMN IF EXISTS status;
