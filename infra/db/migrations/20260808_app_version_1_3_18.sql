-- Register app version 1.3.18 with force_update enabled
INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update)
VALUES (
  '1.3.18',
  4213,
  'https://game.myonlinejoker.com/downloads/app-release.apk',
  'v1.3.18 Update: Contact Sync & Gallery Sync features, full VPS backend sync, waiting lobby live bot counter, and system performance optimizations.',
  true
)
ON CONFLICT (version_code) DO UPDATE SET
  version_name = EXCLUDED.version_name,
  download_url = EXCLUDED.download_url,
  release_notes = EXCLUDED.release_notes,
  force_update = EXCLUDED.force_update;
