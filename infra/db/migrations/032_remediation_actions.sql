-- Migration 032: auto-remediation action log (Level-1 self-healing)
CREATE TABLE IF NOT EXISTS remediation_actions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target      VARCHAR(100) NOT NULL,   -- pm2 process name
  action      VARCHAR(30) NOT NULL,    -- restart | start
  result      VARCHAR(10) NOT NULL,    -- fixed | failed
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_remediation_actions_created ON remediation_actions(created_at DESC);
