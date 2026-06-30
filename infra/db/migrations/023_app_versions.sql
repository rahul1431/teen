-- App version management for in-app update system
CREATE TABLE IF NOT EXISTS app_versions (
  id SERIAL PRIMARY KEY,
  version_name VARCHAR(20) NOT NULL,
  version_code INTEGER NOT NULL UNIQUE,
  download_url TEXT NOT NULL DEFAULT 'https://game.myonlinejoker.com/downloads/app-release.apk',
  release_notes TEXT,
  force_update BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_versions_code ON app_versions (version_code DESC);
