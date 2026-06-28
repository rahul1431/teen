-- Migration 013: Fraud Detection System
-- Purpose: Store fraud detection events, device fingerprints, and manual flags

-- Create device_fingerprints table for co-location detection
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint VARCHAR(255) NOT NULL,
  device_info JSONB,
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indices for device fingerprint queries
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_fingerprint ON device_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_user_id ON device_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_created ON device_fingerprints(created_at DESC);

-- Create fraud_events table for logging all fraud detections
CREATE TABLE IF NOT EXISTS fraud_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  game_type VARCHAR(50),
  rule_triggered VARCHAR(100),
  fraud_score NUMERIC(3,2) NOT NULL,
  confidence NUMERIC(3,2) NOT NULL,
  evidence TEXT,
  action VARCHAR(20) NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  resolved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indices for fraud_events queries
CREATE INDEX IF NOT EXISTS idx_fraud_events_user_id ON fraud_events(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_events_created_at ON fraud_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_action ON fraud_events(action);
CREATE INDEX IF NOT EXISTS idx_fraud_events_fraud_score ON fraud_events(fraud_score DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_resolved ON fraud_events(resolved);
CREATE INDEX IF NOT EXISTS idx_fraud_events_game_type ON fraud_events(game_type);
CREATE INDEX IF NOT EXISTS idx_fraud_events_rule_triggered ON fraud_events(rule_triggered);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_fraud_events_action_created ON fraud_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_user_action ON fraud_events(user_id, action, created_at DESC);

-- Create materialized view for fraud statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS fraud_events_daily_stats AS
SELECT
  DATE(created_at) as date,
  action,
  rule_triggered,
  COUNT(*) as event_count,
  COUNT(DISTINCT user_id) as unique_users,
  AVG(fraud_score) as avg_score,
  MAX(fraud_score) as max_score,
  MIN(fraud_score) as min_score,
  COUNT(CASE WHEN resolved = true THEN 1 END) as resolved_count
FROM fraud_events
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at), action, rule_triggered;

-- Index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_events_daily_stats
ON fraud_events_daily_stats(date, action, rule_triggered);

-- Create table for fraud detection configuration history
CREATE TABLE IF NOT EXISTS fraud_config_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config JSONB NOT NULL,
  changed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for config history
CREATE INDEX IF NOT EXISTS idx_fraud_config_history_created ON fraud_config_history(created_at DESC);

-- Create table for manual user flags
CREATE TABLE IF NOT EXISTS user_fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_flagged BOOLEAN DEFAULT TRUE,
  reason TEXT NOT NULL,
  flagged_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for user fraud flags
CREATE INDEX IF NOT EXISTS idx_user_fraud_flags_user_id ON user_fraud_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_user_fraud_flags_is_flagged ON user_fraud_flags(is_flagged);
CREATE INDEX IF NOT EXISTS idx_user_fraud_flags_expires_at ON user_fraud_flags(expires_at);

-- Create referral relationships table for referral chain detection
-- (Assuming this might not exist, but many apps track referrals)
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code VARCHAR(50),
  bonus_awarded DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indices for referral queries
CREATE INDEX IF NOT EXISTS idx_referrals_referee_id ON referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_unique_pair ON referrals(referee_id, referrer_id);

-- Grant permissions
GRANT SELECT ON device_fingerprints TO readonly_user;
GRANT SELECT, INSERT, UPDATE ON device_fingerprints TO monitoring_user;
GRANT SELECT ON fraud_events TO readonly_user;
GRANT SELECT, INSERT, UPDATE ON fraud_events TO monitoring_user;
GRANT SELECT ON fraud_events_daily_stats TO readonly_user;
GRANT SELECT ON fraud_config_history TO readonly_user;
GRANT SELECT, INSERT ON user_fraud_flags TO monitoring_user;
GRANT SELECT ON referrals TO readonly_user;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
CREATE TRIGGER update_device_fingerprints_updated_at BEFORE UPDATE
  ON device_fingerprints FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fraud_events_updated_at BEFORE UPDATE
  ON fraud_events FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_fraud_flags_updated_at BEFORE UPDATE
  ON user_fraud_flags FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
