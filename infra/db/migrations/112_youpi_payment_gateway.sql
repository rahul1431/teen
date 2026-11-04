-- Migration 112: YouPI-PG Gateway Integration
-- Creates youpi_orders table and registers default system settings for sovereign UPI gateway.

CREATE TABLE IF NOT EXISTS youpi_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  order_id VARCHAR(64) UNIQUE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  vpa VARCHAR(120) NOT NULL,
  merchant_name VARCHAR(120) NOT NULL,
  upi_intent_url TEXT NOT NULL,
  utr VARCHAR(64),
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCESS, EXPIRED, FAILED, UNMATCHED
  payer_vpa VARCHAR(120),
  raw_sms TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure user_id can be null if created previously with NOT NULL
ALTER TABLE youpi_orders ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_youpi_orders_status ON youpi_orders(status);
CREATE INDEX IF NOT EXISTS idx_youpi_orders_user ON youpi_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_youpi_orders_order_id ON youpi_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_youpi_orders_utr ON youpi_orders(utr);

-- Default configuration parameters in system_settings
INSERT INTO system_settings (key, value)
VALUES 
  ('youpi_enabled', 'true'),
  ('youpi_vpa', 'myonlinejoker@upi'),
  ('youpi_merchant_name', 'My Online Joker'),
  ('youpi_webhook_secret', 'youpi_sec_moj_2026_prod'),
  ('youpi_min_deposit', '100'),
  ('youpi_max_deposit', '50000')
ON CONFLICT (key) DO NOTHING;
