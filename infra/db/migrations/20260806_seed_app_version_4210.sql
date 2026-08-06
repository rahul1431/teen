-- Seed mandatory app version in app_versions table for in-app update
INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update)
VALUES (
  '1.3.15',
  4210,
  'https://game.myonlinejoker.com/downloads/app-release.apk',
  '60-Second Matchmaking Timer & Players Joined Popup for Teen Patti and Ludo',
  true
)
ON CONFLICT (version_code) DO UPDATE SET
  version_name = EXCLUDED.version_name,
  download_url = EXCLUDED.download_url,
  release_notes = EXCLUDED.release_notes,
  force_update = EXCLUDED.force_update,
  created_at = NOW();
