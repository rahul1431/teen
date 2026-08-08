# In-App Update Deployment Guide

## Overview

The in-app update system allows pushing new APK versions to Android devices through a built-in update check mechanism, without requiring Play Store submission or waiting for manual user upgrades.

## Architecture

### Components

1. **Mobile Client** (`mobile/lib/core/update/update_service.dart`)
   - Checks `/api/app/version` endpoint on home page load (2-second delay)
   - Compares local `versionCode` (from `pubspec.yaml`) against server's `version_code`
   - If `serverCode > localCode`, shows update dialog with optional/forced prompt
   - Downloads APK to temp directory and hands off to system installer

2. **Server API** (`services/admin-service/src/index.ts`)
   - `POST /api/admin/app/upload` — superadmin-only endpoint to upload APK + metadata
   - `GET /api/app/version` — public endpoint, returns current release info from database
   - Stores metadata in `app_versions` table (version_name, version_code, download_url, release_notes, force_update flag)

3. **File Serving** (`infra/nginx/hestia-proxy.conf`)
   - `location ^~ /downloads/` — serves APK from `/opt/teen/downloads/app-release.apk`
   - **Critical:** uses `^~` prefix modifier to short-circuit HestiaCP's regex blocks
   - Cache headers: `Cache-Control: no-cache, must-revalidate` (always revalidate, no stale serves)

4. **Admin Panel** (`admin-panel/src/pages/AppUpdate.tsx`)
   - Upload new APK file via multipart form
   - Set version_name, version_code, release_notes, force_update flag
   - View version history and current live version
   - Shows download link for manual distribution

## Deployment Workflow

### Prerequisites

- [ ] APK built locally with correct `MONITOR_SECRET_KEY` via `--dart-define`
- [ ] `version_code` in `pubspec.yaml` is **higher than all previously released codes**
- [ ] If the device is stuck on a high stray build number (e.g., 2016), bump to safely clear it (e.g., 2100+)
- [ ] Device test: verify your local install shows the old version in Settings > Apps, then can detect and install the new APK

### Step 1: Update Version in Code

Edit `mobile/pubspec.yaml`:

```yaml
version: 1.2.5+18  # format: version_name+version_code
```

**Rules:**
- version_code must **strictly increase** (can never go backward for a given version_name)
- version_name (e.g., 1.2.5) should follow semantic versioning
- If a device ever gets a stray high build number, you must jump past it (e.g., if a device has 2016, next release must be ≥ 2100)

### Step 2: Build APK Locally

```bash
cd mobile
flutter build apk --release \
  --dart-define=MONITOR_SECRET_KEY=<secret-from-vps-env>
```

Output: `mobile/build/app/outputs/flutter-apk/app-release.apk` (universal build, ~154MB)

**Important:** Do NOT use CI workflow for local/manual deployments — the GH Actions build produces split-per-ABI artifacts unsuitable for in-app update distribution.

**Secret retrieval:**
```bash
ssh root@64.204.130.181 "grep INGEST_SECRET_KEY /opt/teen-prod/services/app-monitor-service/.env"
# Returns: INGEST_SECRET_KEY=f4172a2b9d5ee350c471632a3b82c688
```

### Step 3: Generate Superadmin JWT

On the VPS, generate a temporary JWT with superadmin role:

```bash
ssh root@64.204.130.181 "
node -e \"
const jwt = require('/opt/teen-prod/services/admin-service/node_modules/jsonwebtoken');
const token = jwt.sign({ id: 'deploy', role: 'superadmin' }, 
  'admin-jwt-secret-teen-74d3322c2a045a74c9733fd8936340ed', 
  { expiresIn: '10m' });
console.log(token);
\"
"
```

### Step 4: Upload via Admin API

```bash
TOKEN="<jwt-from-step-3>"
curl -X POST http://127.0.0.1:3008/api/admin/app/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "apk=@mobile/build/app/outputs/flutter-apk/app-release.apk;type=application/vnd.android.package-archive" \
  -F "version_name=1.2.5" \
  -F "version_code=18" \
  -F "release_notes=Bug fixes and improvements" \
  -F "force_update=false"
```

**Response on success:**
```json
{
  "success": true,
  "version_name": "1.2.5",
  "version_code": 18,
  "download_url": "https://game.myonlinejoker.com/downloads/app-release.apk"
}
```

### Step 5: Verify Live

Check all three layers:

```bash
# 1. Version API
curl https://game.myonlinejoker.com/api/app/version
# Should return new version_code

# 2. Download headers (must show no-cache)
curl -I https://game.myonlinejoker.com/downloads/app-release.apk
# Should show: Cache-Control: no-cache, must-revalidate

# 3. Byte integrity
curl https://game.myonlinejoker.com/downloads/app-release.apk | md5sum
# Should match local build's md5sum
```

### Step 6: Test On Device

1. Install the old APK version on a test device
2. Open app → Profile → About Us
3. Verify "You're up to date" is shown
4. Tap "Check for Updates" (or restart the app)
5. Update prompt should appear with new version and release notes
6. Tap "Update Now" to download and install
7. After install, About Us should show new version_code

## Cache Behavior

### Mobile Client
- Requests include `Cache-Control: no-cache` header
- Appends `?v=<version_code>` query string to download URL as cache-busting
- If download fails partway through, shows retry prompt

### Nginx Server
- APK route sends `Cache-Control: no-cache, must-revalidate`
- Query string (`?v=X`) does NOT change the served file (nginx alias strips it)
- Intermediary caches **must revalidate** with ETag/Last-Modified on every request
- If a stale copy was cached before the fix, it would still be re-served from that cache until the max-age expires (nginx's `expires max` was set before fix, so 10-year TTL could have been cached)

## Version Code Gotchas

### Android Versioncode Rules
- **Forward-only:** once released as versionCode N, you can NEVER release N-1 again to Play Store
- Device comparison: `update_available = serverCode > localCode`
- Stray builds outside tracked pipeline can lock devices permanently (e.g., local `flutter build apk --build-number=2016` installed on one device)

### Detection
If a user reports "up to date" when an obvious new version is available:
1. Check app's About Us page for their literal installed `versionCode` (e.g., "v1.2.4 (2016)")
2. If the number is suspiciously high (like 2016), it's a stray build — you must bump next release past it
3. Do NOT try to push a lower versionCode; it will never reach that device

## Rollback (If Needed)

If a buggy APK is live and you need to pull it:

1. Insert a new row in `app_versions` with a stale `version_code` and updated `release_notes`
2. Set `force_update=true` if the issue is critical
3. Devices will NOT downgrade themselves, but new installs get the stale version
4. For a true rollback, you must rebuild an old commit with the old versionCode bumped up

**Example: rollback from v1.2.5+18 to v1.2.4+17**
- Git checkout the v1.2.4 commit
- Bump pubspec.yaml to v1.2.4+19 (can't reuse 18)
- Rebuild and re-upload with new code 19
- Devices will see 19 > 18 and can downgrade

## Admin Panel Upload Alternative

If you prefer a UI instead of curl:

1. Navigate to admin panel → App Update Manager
2. Upload APK file
3. Enter version_name, version_code, release_notes
4. Toggle "Force Update" if critical
5. Click "Upload & Publish"

Uses the same `/api/admin/app/upload` endpoint internally.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "You're up to date" but old version installed | versionCode on device is stray high number (e.g., 2016) | Bump next release to versionCode ≥ 2100 |
| Update prompt never appears on launch | UpdateService.checkAndPrompt() not called in home_page.dart | Verify WidgetsBinding callback in initState |
| Download fails partway through | Network timeout or server send_timeout too short | Nginx send_timeout is 9000s, should be fine for 154MB on mobile |
| APK is stale (old code, old build time) | Upstream cache served a 10-year-cacheable copy before nginx fix | Wait for cache to expire or purge manually, then rebuild |
| "Forbidden" on upload | JWT expired or missing superadmin role | Regenerate JWT, check `role: 'superadmin'` in payload |
| Repeated update popup even after installing APK | Uploaded APK file was compiled with a lower `versionCode` in `pubspec.yaml` than the `version_code` registered in `app_versions` table | Always bump `version: x.y.z+CODE` in `pubspec.yaml` *before* compiling release APK, so installed app's `PackageInfo.buildNumber` equals or exceeds server `version_code`. |

## Related Incidents

- **2026-07-18:** Three APKs (1.2.1/1.2.2/1.2.3) built locally without MONITOR_SECRET_KEY, silently failed telemetry ingestion
- **2026-07-21:** nginx `/downloads/` route silently shadowed by HestiaCP regex block with 10-year cache; fixed via `location ^~` and reconciled live config with git
- **2026-07-21:** Device found stuck on stray versionCode 2016 (one-off local build), permanently blocked from updates; fixed by jumping to versionCode 2100
- **2026-08-08:** Repeated update popup loop after APK install — caused when Admin Panel version_code (e.g. 4212) exceeds the versionCode embedded inside the compiled APK binary (e.g. 4211). Resolved by ensuring `pubspec.yaml` buildNumber matches or exceeds the DB `version_code` before generating release APKs.
