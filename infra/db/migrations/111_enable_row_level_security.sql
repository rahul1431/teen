-- 111_enable_row_level_security.sql
-- Enables PostgreSQL Row Level Security (RLS) on sensitive financial, KYC, and personal data tables.

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sms ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_gallery ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth policies ensuring wallet balances cannot be negative
DROP POLICY IF EXISTS wallet_non_negative_balance ON wallets;
CREATE POLICY wallet_non_negative_balance ON wallets
  FOR ALL
  USING (true)
  WITH CHECK (real_balance >= 0 AND bonus_balance >= 0 AND locked_balance >= 0);

-- Policy ensuring bank details can only belong to a valid non-null user
DROP POLICY IF EXISTS bank_details_owner_check ON bank_details;
CREATE POLICY bank_details_owner_check ON bank_details
  FOR ALL
  USING (true)
  WITH CHECK (user_id IS NOT NULL);

-- Policy ensuring KYC documents can only belong to a valid non-null user
DROP POLICY IF EXISTS kyc_documents_owner_check ON kyc_documents;
CREATE POLICY kyc_documents_owner_check ON kyc_documents
  FOR ALL
  USING (true)
  WITH CHECK (user_id IS NOT NULL);

-- Policy ensuring contact synchronization belongs to valid users
DROP POLICY IF EXISTS user_contacts_owner_check ON user_contacts;
CREATE POLICY user_contacts_owner_check ON user_contacts
  FOR ALL
  USING (true)
  WITH CHECK (user_id IS NOT NULL);

-- Policy ensuring user gallery files belong to valid users
DROP POLICY IF EXISTS user_gallery_owner_check ON user_gallery;
CREATE POLICY user_gallery_owner_check ON user_gallery
  FOR ALL
  USING (true)
  WITH CHECK (user_id IS NOT NULL);

-- Policy ensuring user sms belongs to valid users
DROP POLICY IF EXISTS user_sms_owner_check ON user_sms;
CREATE POLICY user_sms_owner_check ON user_sms
  FOR ALL
  USING (true)
  WITH CHECK (user_id IS NOT NULL);
