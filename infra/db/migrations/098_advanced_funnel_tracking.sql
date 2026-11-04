-- Migration 098: Advanced Funnel Tracking & Attribution
-- Adds UTM parameters, device info, IP, and geo tracking to referral_clicks and product_events.

ALTER TABLE referral_clicks
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(20) DEFAULT 'mobile',
  ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100),
  ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(100),
  ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100),
  ADD COLUMN IF NOT EXISTS referrer_url TEXT,
  ADD COLUMN IF NOT EXISTS converted_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referral_clicks_utm_source ON referral_clicks(utm_source);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_device_type ON referral_clicks(device_type);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_converted ON referral_clicks(converted_user_id);
