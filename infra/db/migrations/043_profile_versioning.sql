-- infra/db/migrations/043_profile_versioning.sql
-- Profile versioning system: snapshot-based bot profile versioning with rollback capability

BEGIN;

-- Add active_profile_version to bot_learning_config
ALTER TABLE bot_learning_config ADD COLUMN IF NOT EXISTS active_profile_version INTEGER DEFAULT 0;

-- Create profile_versions table for version metadata tracking
CREATE TABLE IF NOT EXISTS profile_versions (
  version           INTEGER PRIMARY KEY,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  is_active         BOOLEAN DEFAULT false,
  description       TEXT,
  created_by        UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT uq_profile_versions_id UNIQUE (version)
);

-- Create indices for version management
CREATE INDEX IF NOT EXISTS idx_profile_versions_created_at
  ON profile_versions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_versions_is_active
  ON profile_versions(is_active)
  WHERE is_active = true;

-- Insert initial version 0 record if not exists
INSERT INTO profile_versions (version, is_active, description)
VALUES (0, true, 'Initial profile baseline')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Note: Individual bot_profiles_v{N} tables are created dynamically by the ProfileBuilder
-- during rebuild operations. They follow the same schema as bot_profiles but are named
-- with version suffixes.
