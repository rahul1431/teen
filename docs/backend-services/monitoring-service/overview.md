# Monitoring Service — Overview

`services/monitoring-service` is a real-time **gameplay event ingestion and streaming pipeline** — despite the generic name, it does not monitor server/infra health (CPU, memory, process uptime of other services) and it does not ingest anything from the Flutter app-monitor SDK. That is a different, separately-documented service (`services/app-monitor-service`, see `docs/backend-services/app-monitor-service/` — do not conflate the two). This service's entire job is: receive a live stream of *business/gameplay* events (matchmaking joins, room joins, in-game actions, results, chat) pushed from `game-gateway`, normalize them, fan them out to Redis for real-time consumers, and batch-persist them to Postgres for after-the-fact analytics and anomaly queries.

It is the upstream data source for `risk-service`'s fraud-detection pipeline (see `docs/backend-services/monitoring-service/backend.md`) — `risk-service` reads the `events:all` Redis Stream this service publishes to and scores every event for fraud signals. There is no admin-panel page that talks to this service directly; see `docs/backend-services/monitoring-service/admin.md`.

## Tech stack

Fastify 4 (`fastify` 4.28.1) for the handful of HTTP routes, but the actual event ingestion channel is a raw `ws` (8.16.0) `WebSocketServer` manually attached to Fastify's underlying `http.Server` via an `upgrade` event handler (`src/index.ts:219-227`) — Fastify's own WebSocket plugin ecosystem is not used. `ioredis` (5.4.1) fills three distinct roles: Redis Streams (durable fan-out via `XADD`), Pub/Sub (live SSE fan-out), and a plain key-value cache (60s TTL on aggregated metrics). `pg` (8.12.0) `Pool` with hand-written SQL, no ORM/query builder. `pino` (8.17.2) for structured logging. `dotenv` for env loading. No `node-cron` — the only periodic work is a 1-second `setInterval` in `EventProcessor` that flushes buffered events to Postgres (`src/event-processor.ts:29-31`); there is no cron-scheduled job anywhere in this service, unlike most of the other Fastify services on this platform. No test suite (`package.json` has no `test` script).

## File structure

The whole service is two source files plus bootstrap config:
- `services/monitoring-service/src/index.ts` (248 lines) — Fastify bootstrap, in-memory `eventCounts` metrics, the `ws` `WebSocketServer` and its `upgrade` handler, all five HTTP routes, and graceful shutdown (`SIGTERM`).
- `services/monitoring-service/src/event-processor.ts` (255 lines) — the `EventProcessor` class: raw-event normalization (`normalizeEvent`), batched Postgres inserts (`persistEvent`/`flushEvents`), Redis-cached aggregation (`getAggregatedMetrics`), and an anomaly-detection query (`detectAnomalies`) that exists but is never called from any route (dead code — see backend.md).
- `services/monitoring-service/README.md` — a design document from the service's original "Phase 1" build; several of its claims (a `POST /events` HTTP ingestion endpoint, a `game_events_minute_metrics` materialized view, a 30-day retention job) describe intended-but-never-built or since-removed functionality — see `docs/backend-services/monitoring-service/backend.md` for exactly which parts are stale, and `docs/Bugs/game-events-table-has-no-retention-cleanup.md` for the retention gap specifically.
- `services/monitoring-service/dist/` — committed build output (`tsc` output, `.js`/`.d.ts`/`.map` files); not the source of truth.
- No dedicated migrations directory — its one table, `game_events`, is defined by `infra/db/migrations/012_game_events_monitoring.sql` (broken — MySQL-style inline `INDEX` syntax that Postgres rejects, so it never actually created the table) and superseded by `infra/db/migrations/027_game_events_fixed.sql` (the migration that actually runs; drops the materialized view and `GRANT`s from 012 since nothing used them).

## What it actually monitors

Purely game/business activity, sourced from one place: `game-gateway`'s `monitor-emitter.ts` (`services/game-gateway/src/monitor-emitter.ts`), which fires WebSocket messages for six event types as they happen inside matchmaking and gameplay: `join_matchmaking`, `leave_matchmaking`, `room_joined`, `game_action`, `game_result`, `room_chat`. These cover all three games (Teen Patti, Ludo, Aviator) since `game-gateway`'s realtime broadcast infrastructure is shared across all of them (see root `CLAUDE.md`). There is no ingestion path for server CPU/memory/process-health metrics, no ingestion from the mobile app directly, and no ingestion from `app-monitor-service` — this service and `app-monitor-service` are two independent, non-overlapping pipelines that happen to share the word "monitor" in their names.

## Deployment

PM2 process name `teen-monitoring` (`ecosystem.config.js:109-120`, comment: "Monitoring: WebSocket receiver from game-gateway + metrics"), `cwd = services/monitoring-service`, runs `dist/index.js` (built via `npm run build` → `tsc`), single fork instance, `max_memory_restart: '150M'`. `.env` is loaded via PM2's `env_file` mechanism (see root `CLAUDE.md` for the `pm2 restart --update-env` caveat).

`.env` (`services/monitoring-service/.env`, mirrored by `.env.example`):
- `PORT` — `3005` in the committed `.env` (the code's fallback default in `src/index.ts:230` is `3017`, which only applies if `.env` is missing — it isn't, so `3005` is what's actually live).
- `NODE_ENV`, `LOG_LEVEL`
- `DATABASE_URL` — shared platform Postgres (`postgresql://teen:teen_secret_2024@localhost:5432/teen_db`)
- `REDIS_URL` — shared platform Redis, password-protected (`redis://:teen_redis_2024@localhost:6379`)
- `WEBSOCKET_SOURCE_URL` — set to `ws://localhost:3004/ws` (game-gateway's address) but **never read anywhere in the TypeScript source**. This service is a WebSocket *server* (it receives inbound connections from `game-gateway`'s `monitor-emitter.ts`), not a client that dials out to a "source" URL, so this variable is dead config left over from an earlier design — see `docs/backend-services/monitoring-service/backend.md`.

`game-gateway` is the one that actually points at this service, via `MONITORING_WS_URL` (`services/game-gateway/src/monitor-emitter.ts:10`, defaulting to `ws://127.0.0.1:3017/ws` if unset — the production VPS's `.env` doesn't override it, so it runs on this default). This service's real port is **3017**, not 3005 — that was a documentation error from an earlier pass (it read this service's committed `.env.example`, which at the time collided with the Aviator engine's port; both `.env.example` files and the local dev `.env`s were corrected 2026-07-28 to match the already-correct production values, see `docs/games/aviator/overview.md`).

## Place in the system

```
game-gateway (monitor-emitter.ts, fire-and-forget WS client)
        |  ws://127.0.0.1:3005/ws  { type, data }
        v
monitoring-service (this service)
    |                          |                        |
    v                          v                        v
Redis Streams              Redis Pub/Sub            Postgres game_events
(events:<game_type>,       (pubsub:events:<type>,   (batched INSERT,
 events:all -- durable,     pubsub:events:all --     flushed every 1s
 for XREAD consumers)       for this service's own   or 100-event batch)
    |                       SSE endpoint)
    v
risk-service (XREAD events:all -> FraudDetector.analyzeGameEvent
              -> fraud_events table + fraud:alerts pubsub channel)
```
Nothing in `admin-panel` or `admin-service` calls this service directly (confirmed by repo-wide search — see `docs/backend-services/monitoring-service/admin.md`); its only confirmed downstream consumer is `risk-service`.
