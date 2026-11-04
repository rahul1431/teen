-- Migration 104: Review Mode, Dynamic Cashier & KYC URLs, and Tester Whitelist
-- Used for targeted Google Play Store review gating and Alt 2 Web Cashier.

INSERT INTO system_settings (key, value) VALUES
  ('review_version_code', '0'),
  ('review_mode_active',  'false'),
  ('cashier_url',         'https://game.myonlinejoker.com/cashier'),
  ('kyc_url',             'https://game.myonlinejoker.com/cashier/kyc'),
  ('tester_phones',       '')
ON CONFLICT (key) DO NOTHING;
