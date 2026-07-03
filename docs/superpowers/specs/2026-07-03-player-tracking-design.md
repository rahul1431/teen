# Player Tracking Dashboard — Design

**Date:** 2026-07-03
**Status:** Approved (pending spec review)
**Author:** Rahul + Claude

## Goal

Add an admin-panel view that lets operators see, per active player, their
**Device Name · User (name / number) · Live Location · IP Address · Game**,
plus a live map and per-user drill-down, for security, fraud-awareness, geo-compliance,
and responsible-gaming monitoring on the real-money gaming platform.

This is operator-side monitoring of the platform's own users. Because it exposes personal
data (phone numbers, IP, location), it is designed to be consent-aware (GPS) and
access-controlled (role-gated).

## Non-goals (explicitly out of scope for this iteration)

- VPN/proxy, emulator, or rooted-device detection (fraud signals — not selected).
- Multi-account / shared-device correlation (fraud signals — not selected).
- Wallet balance, bet totals, deposit/withdrawal context (financial signals — not selected).

These can be added later on the same foundation.

## Existing foundation (reused, not replaced)

The platform already has a complete telemetry pipeline:

- **Mobile:** `mobile/lib/core/monitor/monitor_service.dart` batches events and sends
  `session_id, user_id, device_id, app_version, platform, os_version, events[]` to the
  monitor service every 10s. Navigator observer sets `currentScreen`; game/ux/ws events flow.
- **Ingest service:** `services/app-monitor-service/` (`index.ts`, `monitor-ingestor.ts`)
  upserts `app_sessions` and bulk-inserts `app_events`; exposes read endpoints.
- **DB:** `infra/db/migrations/017_app_monitor.sql` — `app_sessions`, `app_events`.
  `users` table (`infra/db/migrations/001_initial.sql`) has `id, phone, username, email`.
- **Admin proxy:** `services/admin-service/src/monitor-routes.ts` proxies monitor endpoints
  behind `authenticate`.
- **Admin UI:** `admin-panel/src/components/AI/AppMonitorTab.tsx`, route `app-monitor`
  in `admin-panel/src/main.tsx`.

Gap analysis vs. the request:

| Field                | Today                                   | Work needed                                  |
|----------------------|-----------------------------------------|----------------------------------------------|
| Device Name          | only `platform` + `os_version`          | add `device_info_plus`, send model/mfr       |
| User name / number   | only `user_id`                          | join `app_sessions.user_id` → `users`        |
| Live Location        | not captured                            | IP-geo (all) + GPS opt-in (granted users)    |
| IP Address           | not captured                            | capture server-side from request header      |
| Game                 | `game_event` + screen already tracked   | roll latest game onto session for live query |

## Decisions (from brainstorming)

- **Location:** Both — IP-city for everyone (baseline), plus precise GPS for users who opt in.
- **Scope:** Full dashboard + live map + per-user drill-down.
- **Extra signals:** App/engagement (version adoption, session duration, screens-per-session, time-in-game).
- **Live Players table primary columns (in order):** Device Name · User (name/number) · Live Location · IP Address · Game.
  Secondary details (current screen, session duration, last-seen) live in the drill-down drawer.
- **Access control:** The Player Tracking view is gated behind a `requireRole` check (senior admins only),
  because it exposes phone numbers and live location — more sensitive than the existing open monitor tab.

## Architecture

Five units, each independently testable:

### 1. Mobile capture enrichment — `mobile/`

- **Dependency:** add `device_info_plus`. In `MonitorService.init()`, read device model,
  manufacturer, and brand (Android: `AndroidDeviceInfo.model/manufacturer/brand`;
  iOS: `IosDeviceInfo.utsname.machine/name`). Store on the service and include in the flush payload
  as `device_model`, `manufacturer`.
- **GPS opt-in:** add `geolocator`. New `LocationConsentService`:
  - On first eligible moment (post-login), show a consent dialog explaining why location is requested.
  - If granted, request permission; on success, sample coarse location periodically (e.g. every 60s while
    foregrounded) and enqueue a `location` event `{lat, lon, accuracy_m}`.
  - If denied or dismissed, persist that choice in secure storage and never re-prompt automatically.
  - GPS is strictly additive; the app fully functions without it.
- `MonitorService` must continue to never crash the app (all capture wrapped in try/catch).

### 2. Database — `infra/db/migrations/028_player_tracking.sql`

- `ALTER TABLE app_sessions ADD COLUMN` (all nullable):
  `device_model VARCHAR(120)`, `manufacturer VARCHAR(80)`, `ip_address INET`,
  `geo_city VARCHAR(120)`, `geo_region VARCHAR(120)`, `geo_country VARCHAR(80)`,
  `geo_lat DOUBLE PRECISION`, `geo_lon DOUBLE PRECISION`,
  `last_screen VARCHAR(100)`, `last_game VARCHAR(60)`.
- New table `app_device_locations` (GPS ping history for map + drill-down):
  `id`, `session_id`, `user_id`, `lat`, `lon`, `accuracy_m`, `created_at`, indexed on
  `(user_id, created_at)` and `(created_at)`.
- Extend `app_events.event_type` CHECK to include `'location'`.
- Idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), wrapped in a transaction.

### 3. Ingest service — `services/app-monitor-service/`

- **IP capture:** in the `/api/monitor/events` handler, resolve client IP from
  `x-forwarded-for` (first hop) falling back to `req.socket.remoteAddress`. Pass to the ingestor.
- **Geo lookup:** offline **MaxMind GeoLite2-City** DB via the `maxmind` npm package
  (no per-request external call, no cost). Loaded once at startup; graceful no-op if the DB file
  is absent (dev). Resolves city/region/country/lat/lon from the IP.
- **Ingestor changes:** persist `device_model`, `manufacturer`, `ip_address`, geo fields on the
  session upsert; roll the latest `screen` → `last_screen` and latest game action → `last_game`;
  insert `location` events into `app_device_locations`.
- **New read endpoints:**
  - `GET /api/monitor/live-players` — active sessions (last_seen < 35s) LEFT JOIN `users`,
    returning `device_model, user_id, username, phone, geo_city, geo_region, geo_lat, geo_lon,
    ip_address, last_game, last_screen, session_started_at, last_seen_at`. Uses latest GPS from
    `app_device_locations` when present, else session geo. Excludes bot users (`users.is_bot = false`).
  - `GET /api/monitor/player/:userId` — drill-down: recent sessions, screen timeline, game activity,
    device history, location history.
  - `GET /api/monitor/geo-distribution` — aggregated points/counts for the map.
  - `GET /api/monitor/engagement?hours=` — version adoption, session-duration distribution,
    avg screens-per-session, time-in-game.

### 4. Admin proxy — `services/admin-service/src/monitor-routes.ts`

- Add passthrough routes for the four new endpoints, mirroring the existing proxy pattern.
- **Gate the tracking endpoints behind `requireRole`** (senior-admin role) rather than plain
  `authenticate`, unlike the existing open monitor routes.

### 5. Admin UI — `admin-panel/`

- New page `admin-panel/src/pages/PlayerTracking.tsx`; add sidebar nav + `player-tracking` route in
  `main.tsx`; role-gated so only permitted admins see the nav item.
- Contents:
  - **Stat row:** live players, players by platform, avg session duration.
  - **Live Players table** — primary columns in order:
    `Device Name | User (name / number) | Live Location | IP Address | Game`.
    Row click opens the drill-down drawer.
  - **Live map** — `react-leaflet` + OpenStreetMap tiles (admin panel is a normal Vite app, external
    tiles allowed), one marker per active player (GPS if available, else IP-city centroid).
  - **Per-user drill-down drawer:** session history, screen timeline, game activity, device history,
    location history.
  - **Engagement charts:** version adoption, session-duration distribution, screens-per-session, time-in-game
    (reuse the existing SVG-chart pattern from `AppMonitorTab` / `Dashboard`).
- Auto-refresh on the existing ~30s cadence via `adminApi`, using `Promise.allSettled` like `AppMonitorTab`.

## Data flow

```
Mobile app (device model, screen, game, opt-in GPS)
  → POST /api/monitor/events (+ client IP from header)
    → app-monitor-service: GeoLite2 lookup, upsert session (device/geo/last_screen/last_game),
      insert location pings
      → Postgres (app_sessions, app_events, app_device_locations, users)
        → GET /api/monitor/live-players|player/:id|geo-distribution|engagement
          → admin-service proxy (requireRole)
            → admin-panel Player Tracking page (table + map + drawer + charts)
```

## Error handling

- Mobile capture and GPS are best-effort and must never crash or block the app.
- GeoLite2 absence, malformed IP, or lookup failure → geo fields null, ingest still succeeds.
- Admin endpoints return the existing `{success, data}` envelope; UI degrades gracefully per-widget
  (`Promise.allSettled`) as `AppMonitorTab` already does.

## Privacy / compliance notes

- GPS only after explicit in-app consent + OS permission; choice persisted; disclosed in the privacy policy.
- IP-city geolocation and device data are collected for security/fraud/geo-compliance — standard for
  real-money gaming and disclosable under India's DPDP Act.
- The view is role-gated; phone numbers and precise location are not exposed to every admin.

## Testing

- **Ingestor:** unit tests for IP extraction, GeoLite2 lookup (mocked reader), session enrichment,
  `last_game`/`last_screen` roll-up, and `location` event insertion.
- **Endpoints:** integration tests for `live-players` (join correctness, bot exclusion, active filter),
  `player/:userId`, `geo-distribution`, `engagement`.
- **Mobile:** widget/unit test for `LocationConsentService` grant/deny/persist paths; verify device model
  populates the payload.
- **UI:** render Player Tracking with fixture data; verify column order and drawer open.

## Provisioning

- MaxMind GeoLite2-City `.mmdb` must be provisioned on the server (free account) and its path set via env
  (e.g. `GEOLITE2_CITY_PATH`); ecosystem/deploy config updated. Documented in the plan.
