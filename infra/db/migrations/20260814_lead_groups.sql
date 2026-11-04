-- Add lead_group column to marketing_leads table
ALTER TABLE marketing_leads ADD COLUMN IF NOT EXISTS lead_group VARCHAR(100) DEFAULT 'all_users';
