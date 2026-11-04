-- Migration 040: Add agent profile, bank details, and KYC columns to agents table
ALTER TABLE agents 
  ADD COLUMN IF NOT EXISTS email VARCHAR(100),
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS bank_details JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS kyc_data JSONB DEFAULT '{}'::jsonb;

