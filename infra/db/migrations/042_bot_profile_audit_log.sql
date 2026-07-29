-- infra/db/migrations/042_bot_profile_audit_log.sql
-- Phase 3: Bot Learning — audit logging for all profile changes

BEGIN;

CREATE TABLE IF NOT EXISTS bot_profile_audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type             VARCHAR(30) NOT NULL,
  difficulty            VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  admin_user_id         UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  changes               JSONB NOT NULL,
  reason                TEXT,
  timestamp             TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_bot_profile_audit_log_game_type
  ON bot_profile_audit_log(game_type);

CREATE INDEX IF NOT EXISTS idx_bot_profile_audit_log_difficulty
  ON bot_profile_audit_log(difficulty);

CREATE INDEX IF NOT EXISTS idx_bot_profile_audit_log_timestamp
  ON bot_profile_audit_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_bot_profile_audit_log_admin_user
  ON bot_profile_audit_log(admin_user_id)
  WHERE admin_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bot_profile_audit_log_game_difficulty
  ON bot_profile_audit_log(game_type, difficulty)
  WHERE timestamp > NOW() - INTERVAL '30 days';

COMMIT;
