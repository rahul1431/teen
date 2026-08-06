---
name: flutter-release-manager
description: Automates building Flutter release APKs, managing version codes in pubspec.yaml and app_versions database table, and publishing APKs for in-app force updates.
---

# Flutter Release Manager Skill

Use this skill whenever building a release APK, updating version codes, triggering in-app force updates, or deploying APK binaries to the live server.

## Release Process Checklist

### 1. Version Bump in `mobile/pubspec.yaml`
Ensure `version` is incremented (e.g. `1.3.15+4209` → `1.3.16+4210`):
```yaml
version: 1.3.16+4210
```

### 2. Build Release APK
Run the Flutter build command inside `mobile/`:
```bash
cd mobile
flutter build apk --release
```

### 3. Copy & Upload Binary
Copy output APK to root directory and SFTP upload to the VPS downloads directory:
```bash
Copy-Item -Force "mobile/build/app/outputs/flutter-apk/app-release.apk" "app-release.apk"
```
SFTP target path on VPS: `/home/admin/web/game.myonlinejoker.com/public_html/downloads/app-release.apk`

### 4. Synchronize Database `app_versions`
The database `version_code` MUST MATCH the built `buildNumber` in `pubspec.yaml` so that updated apps do not repeatedly prompt:
```sql
INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update)
VALUES ('1.3.16', 4210, 'https://game.myonlinejoker.com/downloads/app-release.apk', 'Release Notes', true)
ON CONFLICT (version_code) DO UPDATE SET
  version_name = EXCLUDED.version_name,
  download_url = EXCLUDED.download_url,
  release_notes = EXCLUDED.release_notes,
  force_update = EXCLUDED.force_update;
```
