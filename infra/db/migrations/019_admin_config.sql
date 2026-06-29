-- Migration 019: admin_config key-value store for ML config and other admin settings
CREATE TABLE IF NOT EXISTS admin_config (
  key        VARCHAR(128) PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_config_key ON admin_config(key);
