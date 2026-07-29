# App Update — Overview

Manual in-app-update manager: upload a new APK (raw `XMLHttpRequest` with an upload-progress bar, superadmin-only), set version name/code, release notes, and whether the update is forced (blocks app use until updated) or optional. The mobile app checks `GET /api/app/version` (public, unauthenticated) on launch and compares against its own build.

Distinct from the GitHub Actions `build-apk.yml` workflow (`docs/../CLAUDE.md`) — that pipeline builds and signs release APKs and uploads them as CI artifacts; this page is a separate, manual "publish whatever APK file I have to the live update-check endpoint" mechanism. There's no connection between the two — an admin has to manually download the CI-built APK and re-upload it here.

Every uploaded APK used to overwrite the same file on disk, with every version-history row sharing one fixed download URL — fixed 2026-07-28: each upload now writes to `app-release-{version_code}.apk` with its own `download_url`. Rows created before the fix still share the old shared URL (their original files were already overwritten and can't be recovered).
