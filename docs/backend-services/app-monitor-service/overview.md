# App Monitor Service — Overview

`services/app-monitor-service` is the ingestion + query backend for the Flutter app's own client-side telemetry SDK (`mobile/lib/core/monitor/`, singleton `MonitorService`). It receives batched app-health/behavioral events — screen views, API call timing, WebSocket lifecycle, crashes, lifecycle transitions, business-level game actions, and opt-in coarse GPS — stores them in Postgres, maintains short-lived "is this session alive right now" state in Redis, runs a self-healing PM2/alerting sweep every 2 minutes, and exposes ~18 read endpoints that back the admin panel's App Monitor tab and (for the PII-sensitive subset) the Player Tracking page.

This is **not** the same thing as `services/monitoring-service`, despite the name overlap: `monitoring-service` ingests *gameplay* events pushed from `game-gateway` (matchmaking, room joins, game actions/results) over a raw WebSocket and feeds `risk-service`'s fraud pipeline. `app-monitor-service` ingests *app-instrumentation* events pushed from the Flutter SDK over plain HTTP and feeds the admin panel's operational health view. See `docs/backend-services/monitoring-service/overview.md` for the other one — the two share no code, no database tables, and no consumers. The client-side SDK feeding this service is documented in full at `docs/app/monitoring-sdk/` (overview/backend/mobile/admin); this doc set covers the same service from the backend-services angle — routes, DB schema, deployment, RBAC — with less mobile-client detail.

## Tech stack

Fastify 4 (`fastify` 4.28.1), `pg` 8.12.0 (`Pool`, hand-written SQL, no ORM), `ioredis` 5.4.1 (rate limiting, active-session counters, alert cooldowns, remediation strike counters), `maxmind` 4.3.20 (offline GeoLite2-City IP→geo lookup), `pino` 8.17.2 for structured logging, `dotenv` for env loading. No `node-cron` — the alert engine drives itself off a plain `setInterval`. Node's own `child_process.execSync` shells out to `pm2 jlist` / `pm2 restart` / `docker ps` for the server-health and self-healing features — this is the only service in the fleet that invokes PM2/Docker CLIs from within a request handler and a background sweep.

## File structure

Five source files, no subdirectories:
- `src/index.ts` (308 lines) — Fastify bootstrap, all 18 HTTP routes, graceful shutdown (`SIGTERM`/`SIGINT`).
- `src/monitor-ingestor.ts` (521 lines) — `MonitorIngestor` class: batch ingestion (`ingestBatch`), all read/aggregation queries (`getStats`, `getErrors`, `getApiHealth`, `getWsHealth`, `getSessions`, `getScreenFunnel`, `getLivePlayers`, `getPlayerDetail`, `getGeoDistribution`, `getEngagement`), plus three exported pure helper functions (`deriveLastScreenGame`, `eventPropertiesJson`, `isValidLocationEvent`) that are the only unit-tested logic in this service.
- `src/alerts.ts` (189 lines) — `AlertEngine`: a 2-minute sweep that checks PM2 process health (auto-restart/auto-start downed critical processes, up to 3 strikes/hour before escalating) and app error-rate thresholds, raising rows into `monitor_alerts` and optionally pushing to Telegram.
- `src/geo.ts` (63 lines) — `parseClientIp` (X-Forwarded-For / socket remote address parsing, IPv4/IPv6/bracketed/port-stripping) and `GeoLookup` (thin wrapper around the `maxmind` `Reader`, degrades to all-null if the `.mmdb` file is missing).
- `src/geo.test.ts`, `src/ingestor.enrich.test.ts` — the vitest suite (see "Test coverage" below).
- `dist/` — committed `tsc` build output; not the source of truth.

## Deployment

PM2 process name **`teen-app-monitor`** (`ecosystem.config.js:164-174`, comment "App Monitor: Flutter SDK event ingest"), `cwd = services/app-monitor-service`, runs `dist/index.js` (built via `npm run build` → `tsc`), single fork instance, `max_memory_restart: '150M'`. Port is hardcoded to `3015` directly in the `ecosystem.config.js` `env` block (not sourced from `.env`), alongside `NODE_ENV: 'production'` and `GEOLITE2_CITY_PATH: '/opt/teen/geoip/GeoLite2-City.mmdb'` — this is one of the services whose PM2 `env` object is the authoritative source for these three vars, per the root `CLAUDE.md` note on `--update-env` semantics.

`.env` / `.env.example` (`services/app-monitor-service/.env`) define:
- `PORT` — `3015` (also hardcoded in `ecosystem.config.js`, so this only matters for local `npm run dev`).
- `DATABASE_URL`, `REDIS_URL` — shared platform Postgres/Redis.
- `INGEST_SECRET_KEY` — the shared secret checked against the mobile SDK's `x-monitor-key` header on `POST /api/monitor/events` (`.env.example` ships `change-me-in-production`; the committed `.env` has `dev_ingest_key_local`). This is the server-side name for what the Flutter build calls `MONITOR_SECRET_KEY` — see `docs/backend-services/app-monitor-service/frontend.md` and the root `CLAUDE.md` warning that a Flutter build missing `--dart-define=MONITOR_SECRET_KEY` silently ships with an empty key, meaning the header simply isn't sent by that build. If `INGEST_SECRET_KEY` is set server-side, such a build's telemetry is rejected outright with `401`; if `INGEST_SECRET_KEY` is *unset* server-side, the check is skipped entirely and every caller is accepted regardless of key — see `backend.md`.

Not present in `.env`/`.env.example` until fixed 2026-07-28: `INTERNAL_SERVICE_KEY` (this service now has inter-service-auth middleware on its read routes — see `backend.md`). Still not present in `.env`/`.env.example` at all: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (read by `alerts.ts` for Telegram alert delivery — currently unset, so in the live deployment alerts only ever land in `monitor_alerts`/the admin panel, never Telegram).

## Test coverage (`npm test` → `vitest run`)

This is one of only two services in the repo with a test script (the other being `app-monitor-service` itself per the root `CLAUDE.md` — every other Node/Go/Python service has no automated suite). Two files, both pure unit tests against exported functions — **no route/HTTP tests, no DB/Redis integration tests**:
- `geo.test.ts` — `parseClientIp` against nine IP-header shapes (X-Forwarded-For with multiple hops, bare IPv4, IPv4:port, `::ffff:`-mapped, bare IPv6, `::1`, bracketed IPv6:port) and `GeoLookup` with a missing `.mmdb` file (asserts `ready() === false` and an all-null `GeoResult`).
- `ingestor.enrich.test.ts` — `deriveLastScreenGame` (last `screen_view`/`game_event` wins), `isValidLocationEvent` (numeric-type guard on `lat`/`lon`), `eventPropertiesJson` (action merged into/synthesized from `properties`).

Not covered by any test: the Fastify routes in `index.ts` (auth header check, batch-size limit, rate limiting), `MonitorIngestor.ingestBatch`'s SQL (upsert logic, bulk-insert row building), any of the ten query methods' SQL, or any part of `AlertEngine` (sweep logic, remediation, cooldowns, Telegram delivery). None of this is exercised by CI beyond `tsc` compiling cleanly.

## Place in the system

```
mobile app (MonitorService, flushes every 10s)
        |  POST /api/monitor/events  (x-monitor-key: MONITOR_SECRET_KEY)
        v
Nginx  /api/monitor/  ──────────────────────────────► app_monitor_backend (127.0.0.1:3015)
                                                         |
                                                         v
                                              app-monitor-service (this service)
                                            |            |                |
                                            v            v                v
                                        Postgres      Redis           pm2/docker CLI
                                    (app_sessions,  (rate limit,      (server-health,
                                     app_events,    active-session     alert engine
                                     app_device_    counters,          self-heal)
                                     locations,     alert cooldowns)
                                     monitor_alerts,
                                     remediation_actions)
                                                         ^
                                                         |  GET /api/monitor/* (no auth on this service itself)
                                    admin-service (services/admin-service/src/monitor-routes.ts)
                                    proxies with `authenticate` (+ `requireRole('superadmin')`
                                    for the PII/location routes), exposed to admin-panel at
                                    /api/admin/monitor/*
                                                         ^
                                                         |
                                    admin-panel: AppMonitorTab.tsx (App Monitor tab / AI Control
                                    Center) and Player Tracking page — see admin.md
```

Nginx used to proxy the whole `/api/monitor/` prefix straight through to this service with no admin-service layer in front of it — fixed 2026-07-28, now restricted to the exact ingest path (`= /api/monitor/events`); see `backend.md` for the corresponding application-layer auth fix.
