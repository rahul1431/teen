# App Monitor Service — Backend

All routes in `services/app-monitor-service/src/index.ts`; ingestion/query logic in `src/monitor-ingestor.ts`; alerting in `src/alerts.ts`; IP/geo handling in `src/geo.ts`.

## Auth model

A global `onRequest` hook (added 2026-07-28) now checks `x-internal-key` against `INTERNAL_SERVICE_KEY` on every route except `POST /api/monitor/events` and `GET /health`. Before this fix, every other route — including the ones returning live GPS coordinates and phone numbers — had no auth check of any kind inside this service; access control was applied one hop upstream in `admin-service`'s proxy (see `admin.md`), but this service was also reachable directly, bypassing that proxy entirely, because Nginx forwarded `/api/monitor/` straight to it. Nginx's public location for this service is now restricted to the exact ingest path only (`= /api/monitor/events`), so direct reachability from the internet is closed as well as the application-layer gap.

### Ingest auth (`x-monitor-key`)

```ts
// index.ts:83-90
const expectedKey = process.env.INGEST_SECRET_KEY
if (expectedKey) {
  const providedKey = req.headers['x-monitor-key']
  if (providedKey !== expectedKey) {
    return reply.code(401).send({ success: false, error: 'Unauthorized' })
  }
}
```
If `INGEST_SECRET_KEY` is unset in the environment, the check is skipped entirely — anyone can post events with no key at all ("dev only" per the inline comment, but nothing in code enforces that it's actually unset only in dev; it's whatever the deployed `.env` says). When set (both `.env` and `.env.example` ship a value — `dev_ingest_key_local` / `change-me-in-production` respectively), the client must send the exact same string in the `x-monitor-key` header. The mobile SDK sources this from a **differently-named** build-time constant, `MONITOR_SECRET_KEY` (via `--dart-define`) — see `frontend.md`. The two names refer to the same shared secret by convention only; there is no code linking them, so a typo/mismatch between the server's `INGEST_SECRET_KEY` and the value baked into a mobile build at `--dart-define=MONITOR_SECRET_KEY=...` fails closed (every ingest call 401s) with no obvious error surfaced anywhere client-side (the mobile SDK swallows all flush failures — see `frontend.md`).

## Routes (`src/index.ts`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/monitor/events` | `x-monitor-key` (if `INGEST_SECRET_KEY` set) | Batch event ingestion — see below. |
| `GET` | `/api/monitor/alerts?limit=` | none | `monitor_alerts` rows, newest first, `limit` clamped to `[1,200]` default 50. |
| `GET` | `/api/monitor/remediations?limit=` | none | `remediation_actions` rows, newest first, same clamp. |
| `POST` | `/api/monitor/alerts/:id/ack` | none | Sets `acknowledged = TRUE` on one alert row. |
| `GET` | `/health` | none | Pings Postgres (`SELECT 1`) and Redis (`PING`). |
| `GET` | `/api/monitor/stats` | none | `MonitorIngestor.getStats()` — see below. |
| `GET` | `/api/monitor/uptime` | none | Reads `/opt/teen/uptime-status.json` (written by `uptime-bot`) if present, else `data: null`. |
| `GET` | `/api/monitor/errors?hours=&limit=` | none | Grouped client error reports. |
| `GET` | `/api/monitor/api-health?hours=` | none | Per-endpoint call volume/error-rate/latency. |
| `GET` | `/api/monitor/ws-health?hours=` | none | Aggregate WS connect/disconnect/error/reconnect counts. |
| `GET` | `/api/monitor/sessions?limit=&offset=&active=` | none | Session list, optionally filtered to active-only. |
| `GET` | `/api/monitor/screen-funnel?hours=` | none | Per-screen visit count/avg duration/unique users. |
| `GET` | `/api/monitor/server-health` | none | Live `pm2 jlist` process table + `os` module RAM/load + `docker ps` container states. |
| `GET` | `/api/monitor/live-players` | none | **PII**: currently-active sessions with username, phone, device, IP, city/region, lat/lon, last screen/game. |
| `GET` | `/api/monitor/player/:userId` | none | **PII**: one player's recent sessions, screen timeline, game activity, device list, GPS history (up to 100 points). |
| `GET` | `/api/monitor/geo-distribution` | none | **PII-adjacent**: aggregated player counts per lat/lon cluster (rounded to 2 decimals) for the map. |
| `GET` | `/api/monitor/engagement?hours=` | none | Version distribution, session-duration histogram, screens/session, players-per-game. |

`admin-service`'s proxy (`monitor-routes.ts`) applies `authenticate` to all of these and `requireRole('superadmin')` specifically to `live-players`, `player/:userId`, `geo-distribution`, and `engagement` — but that RBAC exists entirely in `admin-service`, not here, and nothing stops a direct call to `https://game.myonlinejoker.com/api/monitor/live-players`.

## Ingestion (`POST /api/monitor/events`, `index.ts:74-102` → `MonitorIngestor.ingestBatch`, `monitor-ingestor.ts:122-191`)

Request body validation, in order:
1. `session_id`, `device_id` present and `events` an array — else `400`.
2. `events.length <= 100` — else `400 "Batch too large: max 100 events"`. This is the hard cap that `docs/Bugs/monitor-events-batch-size-mismatch.md` documents the client exceeding (client-side queue caps at 200, no chunking).
3. `x-monitor-key` check (above).
4. IP resolved via `parseClientIp(req.headers, req.socket.remoteAddress)` (`geo.ts`) and geo-enriched via `GeoLookup.lookup(ip)` (MaxMind GeoLite2-City; returns all-`null` if the `.mmdb` file at `GEOLITE2_CITY_PATH` is missing).

Inside `ingestBatch`:
- **Rate limit**: `SET monitor:ratelimit:<device_id> 1 EX 8 NX` — if the key already exists (i.e. this device posted within the last 8 seconds), throws an error with `statusCode: 429`, caught in the route handler and returned as `429 "Rate limit exceeded"`. The mobile SDK flushes every 10s under normal operation, so this only bites on rapid retries (e.g. a failed-flush re-enqueue immediately followed by the next scheduled flush landing within 8s).
- **Session upsert**: one `INSERT ... ON CONFLICT (id) DO UPDATE` into `app_sessions`, keyed on `session_id`. On conflict, `last_seen_at = NOW()` and `ended_at = NULL` unconditionally; every other column (`user_id`, `device_model`, `manufacturer`, `ip_address`, `geo_*`, `last_screen`, `last_game`) uses `COALESCE(EXCLUDED.x, app_sessions.x)` so a later batch with a null field never overwrites a previously-known value.
- **Session end detection**: if any event in the batch is `lifecycle` with `properties.state` of `'terminated'` or `'background'`, sets `ended_at = NOW()` (only if not already set).
- **Location events** (`event_type === 'location'` with numeric `lat`/`lon`, validated by `isValidLocationEvent`) are bulk-inserted into `app_device_locations` in one multi-row `INSERT`, separately from everything else.
- **Everything else** is filtered to `ALLOWED_EVENT_TYPES = {screen_view, api_call, ws_event, error, lifecycle, game_event, location}` (location already handled above, so this filter effectively drops any event whose `event_type` isn't one of the other six) and bulk-inserted into `app_events`. **Any event with an `event_type` outside this set is silently dropped — never inserted, no error, no log line** — see `docs/Bugs/monitor-ws-message-event-type-not-persisted.md` for a concrete case (the mobile SDK's `wsMessage()` helper, which is actually called in production code, emits `event_type: 'ws_message'`, which is not in this set).
- `properties` is stored via `eventPropertiesJson()`: if the event has an `action` field, it's merged into (or becomes) the JSON `properties` blob as `{"...existing, "action": "..."}`; this is how `game_event`'s `action` field (e.g. `tp_join_room`) ends up queryable via `properties->>'action'` in `getPlayerDetail`.
- **Redis counters** (`_updateRedisCounters`, fire-and-forget, failures only logged): refreshes `monitor:session:<device_id>` with `EX 35` (drives the `active_sessions` count in `getStats`), and adds one entry per `error`-type event to a `monitor:errors:5min` sorted set (score = timestamp), pruning entries older than 5 minutes on every call.

The DB-level `app_events_event_type_check` CHECK constraint (`infra/db/migrations/028_player_tracking.sql:29-31`) independently enforces the same seven-value allowlist as `ALLOWED_EVENT_TYPES` in code — the two must be kept in sync by hand; there's no shared source of truth between the SQL constraint and the TypeScript `Set`.

## Query endpoints — DB tables read

- `getStats()` — Redis (`monitor:session:*` key count for `active_sessions`, `monitor:errors:5min` zcount) + one `app_events` aggregate query (API error rate, avg latency, WS disconnects, all over the last 1 hour) + one `app_sessions` count (`sessions_today`, last 24h).
- `getErrors/getApiHealth/getWsHealth/getScreenFunnel` — all single aggregate queries against `app_events`, windowed by an `hours` param that is parsed with `parseInt(...) || <default>` and then **string-interpolated directly into the SQL** as `INTERVAL '${safeHours} hours'` (not parameterized) — safe only because `safeHours` is always the result of `parseInt`, which can't produce a string containing SQL syntax; a non-numeric or empty query param falls back to the default via the `|| default` rather than passing through.
- `getSessions` — `app_sessions` LEFT JOIN `app_events` (for `event_count`), `activeOnly` adds `AND s.last_seen_at > NOW() - INTERVAL '35 seconds'`.
- `getLivePlayers` — `app_sessions` JOIN `users` (username, phone) + `LATERAL` subquery on `app_device_locations` for the most recent GPS fix (falls back to `app_sessions.geo_lat/geo_lon` from IP geolocation if no GPS ping exists), filtered to `last_seen_at > NOW() - INTERVAL '35 seconds'` and excluding bots (`is_bot IS NULL OR is_bot = false`).
- `getPlayerDetail(userId)` — five parallel queries: `app_sessions` (20 most recent), `app_events` screen views (50) and game events (50), distinct devices, `app_device_locations` (100 most recent GPS points).
- `getGeoDistribution` — same active-session/bot filter as `getLivePlayers`, clusters by lat/lon rounded to 2 decimal places, counts players per cluster.
- `getEngagement(hours)` — four parallel queries: sessions by app version, session-duration histogram (`width_bucket` into 6 buckets of 10 min each, 0-60min), avg screens/session, distinct players by `last_game`.

The **35-second "active" window** (`monitor:session:<device_id>` Redis TTL in `_updateRedisCounters`, and the literal `INTERVAL '35 seconds'` used identically in `getSessions`, `getLivePlayers`, and `getGeoDistribution`) is shorter than the mobile SDK's 45-second idle heartbeat interval — see `docs/Bugs/monitor-heartbeat-interval-exceeds-active-session-window.md`.

## Alert engine (`src/alerts.ts`)

`AlertEngine.start()` runs `sweep()` every `SWEEP_MS = 2 * 60 * 1000` (2 minutes):
1. **`checkProcesses()`** — `pm2 jlist`, auto-acknowledges any open `service_down`/`remediation_failed`/`remediation_exhausted` alert whose `details->>'process'` is now online; for any process in `CRITICAL_PROCESSES` (`teen-core-api`, `teen-wallet`, `teen-gateway`, `teen-tp-engine`, `teen-admin-svc`) missing entirely from the PM2 list, calls `remediate(name, 'start')`; for any listed process not `online` (excluding `teen-app-monitor` itself, which can't restart itself), calls `remediate(name, 'restart')`.
2. **`remediate(name, mode)`** — validates `name` against `/^[a-zA-Z0-9_-]+$/` before shelling out (guards against command injection via a malformed PM2 process name). Tracks strikes in Redis (`remediate:strikes:<name>`, 1-hour TTL); on strike 4+ within the hour, raises a `remediation_exhausted` critical alert instead of retrying. Otherwise runs `pm2 start ecosystem.config.js --only <name> && pm2 save` or `pm2 restart <name>` with a **deliberately minimal environment** (`PATH`, `HOME`, `PM2_HOME` only — comment explains this avoids the restarted process inheriting `teen-app-monitor`'s own `PORT=3015` and port-conflict-crash-looping), waits 8s, re-checks `pm2 jlist` for `online` status, logs the outcome to `remediation_actions`, and on failure raises a `remediation_failed` critical alert.
3. **`checkAppErrors()`** — calls `MonitorIngestor.getStats()`; if `api_error_rate_pct > 20 && errors_last_5min >= 5`, raises `api_error_rate` critical; else if `errors_last_5min >= 10`, raises `error_spike` warning.

`raise()` writes to `monitor_alerts` and calls `sendTelegram()`, gated by a 30-minute Redis cooldown (`alert:cooldown:<key>`, `NX`) per alert kind/target so a sustained outage produces one alert, not one every 2-minute sweep. `sendTelegram()` is a no-op if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` aren't set — which they currently aren't in this service's `.env`/`.env.example` (see overview.md), so in the live deployment every alert here only ever reaches `monitor_alerts` (and thus the admin panel), never Telegram. A separate, unrelated cron script (`infra/scripts/pm2-alert.sh`) also sends PM2-down Telegram alerts independently of this engine, using the same env var names but its own dedup/state-file logic — the two mechanisms don't share state or suppress each other.

## Database tables

- **`app_sessions`** (`infra/db/migrations/017_app_monitor.sql`, extended by `028_player_tracking.sql`) — one row per `session_id`, written only by `ingestBatch`'s upsert. Columns: `id` (session_id, PK), `user_id`, `device_id`, `app_version`, `platform`, `os_version`, `started_at`, `ended_at`, `last_seen_at`, plus (from `028`) `device_model`, `manufacturer`, `ip_address`, `geo_city`, `geo_region`, `geo_country`, `geo_lat`, `geo_lon`, `last_screen`, `last_game`.
- **`app_events`** (`017`, CHECK-constrained `event_type` list extended by `028`) — one row per non-location event, `session_id` FK `ON DELETE CASCADE`. No retention/cleanup job anywhere in this service — grows unbounded, same class of gap as `docs/Bugs/game-events-table-has-no-retention-cleanup.md` for `monitoring-service`'s `game_events` table (not itself filed here since it would duplicate that finding's shape; worth cross-referencing if auditing storage growth).
- **`app_device_locations`** (`028`) — one row per GPS ping, `session_id` FK `ON DELETE CASCADE`.
- **`monitor_alerts`** (`031_monitor_alerts.sql`) — written by `AlertEngine.raise()`, read by `GET /api/monitor/alerts` and updated by `POST /api/monitor/alerts/:id/ack` (and auto-acknowledged by `checkProcesses()`).
- **`remediation_actions`** (`032_remediation_actions.sql`) — written by `AlertEngine.remediate()`, read by `GET /api/monitor/remediations`.

## What the vitest suite does and doesn't cover

Covered (see overview.md for the file list): `parseClientIp`'s header/format parsing, `GeoLookup`'s missing-file fallback, and three pure helpers in `monitor-ingestor.ts` (`deriveLastScreenGame`, `isValidLocationEvent`, `eventPropertiesJson`). Not covered: everything with I/O — no route is ever invoked in a test, no SQL is ever executed against a real or mocked Postgres, no Redis rate-limit/counter/cooldown behavior is exercised, and `AlertEngine`'s entire sweep/remediation/Telegram path has zero test coverage. The 100-event batch cap, the `x-monitor-key` auth check, the 8-second rate limit, and the `ALLOWED_EVENT_TYPES` filtering that silently drops unrecognized event types are all unverified by automation.
