# In-App Update — Backend

Lives in `services/admin-service/src/index.ts` (not `core-api-service`), under the "App Version / In-App Update" section (~line 2480).

- **`GET /api/app/version`** — public, no auth. Returns the highest `version_code` row from `app_versions` (`version_name, version_code, download_url, release_notes, force_update`). If the table is empty, falls back to a hardcoded `{ version_code: 0, version_name: '1.0.0', force_update: false, download_url: APK_PUBLIC_URL }`.
- **`POST /api/admin/app/upload`** (auth required) — accepts a multipart APK upload, saves it to `APK_DIR` (default `/opt/teen/downloads`) under the **fixed filename** `app-release.apk`, and upserts an `app_versions` row keyed by `version_code` (`ON CONFLICT (version_code) DO UPDATE`). `download_url` is always set to `APK_PUBLIC_URL` (a fixed env-configured constant), never a per-version path.
- **`GET /api/admin/app/versions`** (auth required) — lists the 20 most recent `app_versions` rows, used by the admin panel's version-history table.

Every upload used to write to the same on-disk filename and the same fixed public URL, so every row in `app_versions` — no matter its `version_code` — effectively pointed at whatever the *latest* uploaded APK was. Fixed 2026-07-28: each upload now writes to a version-specific filename and stores that file's own URL. The client's `?v=<code>` query-string cache-buster (see `mobile.md`) is a separate, still-relevant mechanism — it defeats caching, it doesn't affect which physical file the URL resolves to.
