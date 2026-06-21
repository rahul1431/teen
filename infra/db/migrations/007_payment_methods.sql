-- Manual payment system: admin-configured deposit destinations + proof columns
-- Users pay to one of these (UPI / bank / QR), then submit a reference + screenshot.

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  method_type VARCHAR(20) NOT NULL,          -- 'upi' | 'bank' | 'qr'
  label VARCHAR(120) NOT NULL,               -- e.g. "Primary UPI", "HDFC Current A/c"
  upi_id VARCHAR(120),                        -- for method_type = 'upi'
  account_name VARCHAR(120),                  -- bank fields
  account_number VARCHAR(40),
  ifsc VARCHAR(20),
  bank_name VARCHAR(120),
  qr_image_url VARCHAR(300),                  -- for method_type = 'qr'
  instructions TEXT,                          -- optional note shown to the user
  min_amount NUMERIC(15,2) NOT NULL DEFAULT 100,
  max_amount NUMERIC(15,2) NOT NULL DEFAULT 100000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_active ON payment_methods(is_active, sort_order);

-- Proof-of-payment columns on the existing deposit/withdrawal orders.
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS reference_number VARCHAR(120);
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS screenshot_url VARCHAR(300);
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES payment_methods(id);
