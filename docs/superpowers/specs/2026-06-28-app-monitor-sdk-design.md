# App Monitor SDK — Sub-project 1 Design Spec
**Date:** 2026-06-28
**Platform:** MyOnlineJoker (game.myonlinejoker.com)
**Branch:** claude/confident-archimedes-e2dd1k
**Status:** Approved — ready for implementation planning

---

## Overview

The Flutter player app currently has zero observability — no crash reporting, no API monitoring, no screen analytics. This spec covers **Sub-project 1**: embedding a lightweight monitoring SDK into the existing Flutter app and building a backend ingestion service that receives, stores, and exposes the data.

Sub-projects 2 (real-time admin dashboard) and 3 (AI report generator) depend on this and will be specced separately once real data is flowing.

---

## Goals

- Capture every API call the app makes (endpoint, latency, status, error)
- Capture every screen navigation (screen name, time spent)
- Capture WebSocket connection events (connect/disconnect/error/reconnect)
- Capture Flutter crashes and unhandled errors (message + truncated stack trace)
- Capture app lifecycle (session start/end, foreground/background)
- Store all events in a queryable backend with zero impact on app performance
- Expose aggregated data to the admin panel via the existing admin-service proxy pattern

---

## Architecture

```
Flutter App (mobile/)
  ├── MonitorService          — singleton: session, queue, 10s flush timer
  ├── MonitorInterceptor      — Dio interceptor: API call timing + errors
  ├── MonitorNavigatorObserver — GoRouter observer: screen views + duration
  ├── SocketMonitorWrapper    — hooks SocketService ValueNotifiers: WS events
  └── main.dart (3 additions) — FlutterError.onError, PlatformDispatcher.onError, MonitorService.init()

app-monitor-service (Node.js/Fastify, port 3015)
  ├── POST /api/monitor/events      — ingest batch from Flutter (no auth, device-rate-limited)
  ├── GET  /health
  ├── GET  /api/monitor/stats       — active sessions, error rate, API health summary
  ├── GET  /api/monitor/errors      — grouped errors (type + screen + count + affected users)
  ├── GET  /api/monitor/api-health  — per-endpoint latency P50/P95 + error rate
  ├── GET  /api/monitor/ws-health   — WS connect/disconnect/error counts (last 24h)
  ├── GET  /api/monitor/sessions    — paginated sessions (active + recent)
  └── GET  /api/monitor/screen-funnel — screen visit counts + avg time on screen

admin-service
  └── Proxy routes /api/admin/monitor/* → app-monitor-service (auth required)

PostgreSQL
  ├── app_sessions  — one row per app open
  └── app_events    — all captured events

Redis
  └── Real-time counters (active sessions, error rate, API latency rolling averages)
```

---

## Flutter SDK

### MonitorService (`lib/core/monitor/monitor_service.dart`)

Singleton initialised in `main.dart` before `runApp()`.

**Responsibilities:**
- Generates a `session_id` (UUID v4) on each cold start
- Reads `user_id` from the existing auth BLoC (nullable — works for logged-out users)
- Collects `device_id` from `flutter_secure_storage` (generated once, persisted)
- Collects `app_version` from `package_info_plus` (already available via pubspec)
- Collects `platform` (`Platform.isAndroid ? 'android' : 'ios'`) and `os_version`
- Holds an in-memory `List<Map<String, dynamic>> _queue`
- Starts a `Timer.periodic(10s)` that calls `_flush()`
- `_flush()`: if queue is empty, skip. Copy queue, clear it, POST to `$monitorUrl/api/monitor/events` using a separate plain Dio instance (not the app's intercepted one — avoids recursive loops). On failure, re-enqueue (up to 200 events max to cap memory).
- `enqueue(Map event)`: adds timestamp + session context to event, pushes to queue
- Silently swallows all errors — monitoring must never crash the app

**Batch payload:**
```json
{
  "session_id": "uuid",
  "user_id": "uuid|null",
  "device_id": "string",
  "app_version": "1.0.0",
  "platform": "android",
  "os_version": "14",
  "events": [
    { "event_type": "screen_view", "screen": "HomePage", "duration_ms": 4200, "ts": "ISO8601" },
    { "event_type": "api_call", "endpoint": "/api/wallet/balance", "method": "GET", "status_code": 200, "duration_ms": 134, "ts": "ISO8601" },
    { "event_type": "error", "error_message": "...", "screen": "TeenPattiGamePage", "ts": "ISO8601" }
  ]
}
```

### MonitorInterceptor (`lib/core/monitor/monitor_interceptor.dart`)

`InterceptorsWrapper` added to the existing `ApiClient`'s Dio instance.

- `onRequest`: record `startTime = DateTime.now()` in `RequestOptions.extra`
- `onResponse`: compute `duration_ms`, enqueue `api_call` event with endpoint (path only, no query params with PII), method, status_code, duration_ms
- `onError`: enqueue `api_call` event with status_code (or 0 for network errors), duration_ms, error_message (first 200 chars)
- Never logs request or response bodies

### MonitorNavigatorObserver (`lib/core/monitor/monitor_navigator_observer.dart`)

`NavigatorObserver` added to the `GoRouter` observers list.

- Tracks `_currentScreen` and `_screenStart`
- `didPush` / `didReplace`: enqueue `screen_view` for the outgoing screen with `duration_ms = now - _screenStart`, set new `_currentScreen` and `_screenStart`
- Screen name = `settings.name ?? settings.uri.path`

### SocketMonitorWrapper (`lib/core/monitor/socket_monitor_wrapper.dart`)

Hooks into the **existing** `SocketService` ValueNotifiers — no changes to SocketService itself.

In `SocketService`'s constructor (or when MonitorService initialises), attach listeners:
- `_status.addListener(...)`: when status changes to `connected`, enqueue `ws_event {ws_status: 'connected'}`. When `disconnected` or `error`, enqueue with ws_status + error message from `_lastError`
- Track reconnect attempts: increment `_reconnectCount` on each disconnect, reset on connect. Enqueue `ws_event {ws_status: 'reconnect', attempt: N}` on reconnect

### main.dart additions

```dart
// 1. Override Flutter framework errors
FlutterError.onError = (details) {
  MonitorService.instance.enqueue({
    'event_type': 'error',
    'error_message': details.exceptionAsString().substring(0, 500),
    'screen': MonitorService.instance.currentScreen,
    'properties': {'stack': details.stack.toString().substring(0, 1000)},
  });
  FlutterError.presentError(details); // still show in debug
};

// 2. Override platform/isolate errors
PlatformDispatcher.instance.onError = (error, stack) {
  MonitorService.instance.enqueue({
    'event_type': 'error',
    'error_message': error.toString().substring(0, 500),
    'properties': {'stack': stack.toString().substring(0, 1000)},
  });
  return true;
};

// 3. Init MonitorService
await MonitorService.instance.init();
```

**No new packages needed** — uses `dio`, `flutter_secure_storage`, `package_info_plus` (add this one — 12KB, no permissions). Plain `dart:io` for platform detection.

---

## Backend: app-monitor-service

### Stack
Identical to `churn-service` and `bot-learning-service`: Node.js 20, TypeScript 5, Fastify 4, pg 8, ioredis 5, pino 8, dotenv 16. Port **3015**.

### Ingest Endpoint

`POST /api/monitor/events`

- **No JWT auth** — Flutter app has no admin token. Rate-limited by `device_id`: max 1 batch per 8 seconds per device (Redis key `monitor:ratelimit:{device_id}` with 8s TTL, SET NX).
- Validates: `events.length <= 100`, required fields present, `event_type` in allowlist
- Upserts `app_sessions` (INSERT ... ON CONFLICT DO UPDATE SET last_seen_at)
- If any event has `event_type = 'lifecycle'` and `properties.state = 'terminated'|'background'`, sets `ended_at`
- Bulk inserts `app_events` in a single parameterised query
- After insert: updates Redis counters (INCR active sessions with 35s expiry, INCR error counter if error events present)
- Returns `{ success: true }` — no data echoed back

### Query Endpoints (called by admin-service proxy)

```
GET /api/monitor/stats
  → {
      active_sessions: number,           -- from Redis monitor:active_sessions
      errors_last_5min: number,          -- from Redis sliding window
      api_error_rate_pct: number,        -- api_call errors / total last 1h
      avg_api_latency_ms: number,        -- avg duration_ms last 1h
      ws_disconnect_last_1h: number,     -- ws_event disconnects last 1h
      sessions_today: number             -- app_sessions started today
    }

GET /api/monitor/errors?hours=24&limit=50
  → grouped by (error_message, screen), ordered by count desc
    [{ error_message, screen, count, affected_users, first_seen, last_seen }]

GET /api/monitor/api-health?hours=24
  → per endpoint: [{ endpoint, method, total_calls, error_count, error_rate_pct, avg_ms, p95_ms }]
    p95 computed as PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)

GET /api/monitor/ws-health?hours=24
  → { connected: N, disconnected: N, errors: N, reconnects: N, avg_reconnects_per_session: F }

GET /api/monitor/sessions?limit=20&offset=0&active=true
  → [{ session_id, user_id, platform, app_version, started_at, ended_at, last_seen_at, event_count }]

GET /api/monitor/screen-funnel?hours=24
  → [{ screen, visit_count, avg_duration_ms, unique_users }] ordered by visit_count desc
```

### Redis Keys

| Key | Purpose | TTL |
|---|---|---|
| `monitor:active_sessions` | Count of sessions seen in last 35s | 35s (refreshed on each batch) |
| `monitor:errors:5min` | Error event count in sliding 5min window | 5min |
| `monitor:ratelimit:{device_id}` | Ingest rate limiter | 8s |

---

## Database Schema

Migration: `infra/db/migrations/017_app_monitor.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS app_sessions (
  id            VARCHAR(36) PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id     VARCHAR(100),
  app_version   VARCHAR(20),
  platform      VARCHAR(10) CHECK (platform IN ('android', 'ios')),
  os_version    VARCHAR(20),
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    VARCHAR(36) REFERENCES app_sessions(id) ON DELETE CASCADE,
  user_id       UUID,
  event_type    VARCHAR(30) NOT NULL
                CHECK (event_type IN ('screen_view','api_call','ws_event','error','lifecycle')),
  screen        VARCHAR(100),
  endpoint      VARCHAR(200),
  method        VARCHAR(10),
  status_code   INT,
  duration_ms   INT,
  error_message TEXT,
  ws_status     VARCHAR(30),
  properties    JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_session   ON app_events(session_id);
CREATE INDEX IF NOT EXISTS idx_app_events_type_time ON app_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_error     ON app_events(created_at)
  WHERE event_type = 'error';
CREATE INDEX IF NOT EXISTS idx_app_events_api       ON app_events(endpoint, created_at)
  WHERE event_type = 'api_call';
CREATE INDEX IF NOT EXISTS idx_app_sessions_user    ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_active  ON app_sessions(last_seen_at);

COMMIT;
```

---

## Admin-Service Integration

**New file:** `services/admin-service/src/monitor-routes.ts`

Proxy routes following the exact `churn-routes.ts` pattern:
- `GET /api/admin/monitor/stats` — auth required
- `GET /api/admin/monitor/errors` — auth required
- `GET /api/admin/monitor/api-health` — auth required
- `GET /api/admin/monitor/ws-health` — auth required
- `GET /api/admin/monitor/sessions` — auth required
- `GET /api/admin/monitor/screen-funnel` — auth required

**`services/admin-service/src/index.ts`:** import + register `registerMonitorRoutes` inside `start()`.

**`services/admin-service/.env.example`:** add `APP_MONITOR_SERVICE_URL=http://localhost:3015`

**`ecosystem.config.js`:** add `teen-app-monitor` entry (port 3015, `cwd: ./services/app-monitor-service`).

---

## What Is NOT in This Spec

- Admin panel UI (Sub-project 2)
- AI report generation (Sub-project 3)
- Response body logging (PII risk)
- Query string logging (PII risk — tokens, phone numbers)
- Replay / session recording
- Alerting / PagerDuty integration

---

## Success Criteria

- Every API call the Flutter app makes appears in `app_events` within 15 seconds
- Every screen navigation is tracked with time-on-screen
- Every Flutter error/crash is captured with a truncated stack trace
- WebSocket disconnect events are recorded
- The ingest endpoint handles 50 concurrent Flutter devices without latency spike
- Admin-service proxy routes return data within 500ms
