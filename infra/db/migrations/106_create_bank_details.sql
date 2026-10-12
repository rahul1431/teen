-- Migration 106: Create bank_details table for user payout / withdrawal bank accounts
CREATE TABLE IF NOT EXISTS bank_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  holder_name VARCHAR(100) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  ifsc_code VARCHAR(20) NOT NULL,
  upi_id VARCHAR(100),
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_details_user_id ON bank_details(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_details_verified ON bank_details(verified);
