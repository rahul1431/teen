# Cricket's "Import Series" admin modal is wired to two internal routes that don't exist anywhere in core-api-service

**Severity:** Medium (independent of the now-fixed `admin-service` betting/notification dead-port config, see below)
**Found:** 2026-07-28, games documentation pass (cricket)
**Files:** `admin-panel/src/pages/games/Cricket.tsx:916-958` (Import Series modal), `services/admin-service/src/index.ts:1580-1588` (proxies to `/internal/cricket/sync-series` and `/internal/cricket/import-series-matches`)

## What's wrong

`games/Cricket.tsx` — the live, routed admin page (not the orphaned `BettingManagement.tsx` duplicate) — has a fully-built "Import Series" modal calling `POST /betting/cricket/sync-series` and `POST /betting/cricket/import-series-matches` through `admin-service`, which in turn proxies to `/internal/cricket/sync-series` and `/internal/cricket/import-series-matches` on `core-api-service`. Neither of those two internal routes exists anywhere in `services/core-api-service/src` (confirmed by repo-wide grep). This is a distinct failure from `admin-service`'s `BETTING_URL`/`NOTIFICATION_URL` previously pointing at a dead port (fixed 2026-07-28) — even with that fixed and the proxy reaching `core-api-service` correctly, these two specific routes still don't exist there.

## Impact

"Search Series" and "Import Matches" in the live Cricket admin page always fail — the routes they target were simply never implemented server-side, independent of the (now-fixed) proxy URL misconfiguration.

## Fix

Implement `/internal/cricket/sync-series` and `/internal/cricket/import-series-matches` in `core-api-service`'s betting plugin (mirroring the existing single-match sync/import routes), or remove the Import Series modal from `Cricket.tsx` if series-based bulk import isn't currently planned.
