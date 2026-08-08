# AI Studio Coding Agent Project Instructions

## Critical Rules & Domain Knowledge

### 1. In-App Force Update Version Code Rule
- **Issue:** If an APK update is uploaded in the Admin Panel with a `version_code` (e.g. `4213`), but the uploaded `.apk` file was compiled with a lower `versionCode` in `pubspec.yaml` (e.g. `4211` or `2108`), users will install the APK and STILL get prompted to update in a continuous loop because `PackageInfo.fromPlatform().buildNumber` (installed build number) remains lower than the server's registered `version_code` (4213).
- **Rule:** ALWAYS bump `version: x.y.z+BUILD` in `mobile/pubspec.yaml` (where `BUILD` strictly matches or exceeds the `version_code` registered in `app_versions`) **BEFORE** building the release APK binary (`flutter build apk --release`).
- **Verifying Version Parity:** Before uploading any APK in the Admin Panel or serving it via `/downloads/app-release.apk`, confirm that the compiled binary's internal Flutter asset `version.json` / `buildNumber` matches the `version_code` set on the admin dashboard.
- **Reference:** See `docs/in-app-update-deployment.md`.

### 2. VPS Deployment & Direct Sync
- **Deployment:** When deploying codebase updates (including backend services, lead manager, contact sync, gallery sync, admin panel, etc.) to the production VPS (`64.204.130.181`), run `node scripts/deploy-full-vps.js`. This script tars the entire workspace code and transfers it directly over SSH to `/opt/teen-prod/` on the VPS, executing `infra/deploy/go.sh` to update all 19 PM2 services instantly.
- **Admin Panel Assets:** Run `node scripts/upload-admin-dist.js` after `npm run build` to upload the static admin panel build to HestiaCP nginx at `/home/admin/web/game.myonlinejoker.com/public_html/admin/`.
