-- Migration 103: System-wide feature flags for Admin Panel controls
-- Allows toggling wallet deposits/withdrawals and individual games without an APK release.

CREATE TABLE IF NOT EXISTS system_settings (
  key        VARCHAR(128) PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);

-- Wallet feature flags (default: enabled so existing behavior is preserved)
INSERT INTO system_settings (key, value) VALUES
  ('wallet_deposit_enabled',    'true'),
  ('wallet_withdrawal_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Game feature flags: use game_configs.is_active (already exists).
-- Ensure all known game types have a row so toggles always have a target.
INSERT INTO game_configs (game_type, is_active, rake_percent, special_rules)
VALUES
  ('teen_patti',       true, 5.0, '{}'),
  ('ludo',             true, 0.0, '{}'),
  ('aviator',          true, 5.0, '{}'),
  ('matka',            true, 0.0, '{}'),
  ('lottery',          true, 0.0, '{}'),
  ('rummy',            true, 5.0, '{}'),
  ('color_prediction', true, 5.0, '{}')
ON CONFLICT (game_type) DO NOTHING;
