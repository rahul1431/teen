-- infra/db/migrations/052_incremental_profile_rebuild.sql
-- Phase 2, Task 19: Add support for 6-hourly incremental profile rebuilds

BEGIN;

-- Add columns to bot_profiles for incremental rebuild tracking
ALTER TABLE bot_profiles
ADD COLUMN IF NOT EXISTS rebuild_frequency VARCHAR(20) DEFAULT 'daily' CHECK (rebuild_frequency IN ('hourly', '6hourly', 'daily')),
ADD COLUMN IF NOT EXISTS last_rebuild_at TIMESTAMPTZ DEFAULT NOW();

-- Create index for efficient querying by rebuild_frequency
CREATE INDEX IF NOT EXISTS idx_bot_profiles_rebuild_frequency ON bot_profiles(rebuild_frequency);

-- Seed fallback values for existing profiles
UPDATE bot_profiles
SET rebuild_frequency = '6hourly'
WHERE rebuild_frequency IS NULL;

COMMIT;
