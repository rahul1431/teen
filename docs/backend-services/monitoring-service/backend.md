# Monitoring Service — Backend

All logic lives in `services/monitoring-service/src/index.ts` and `services/monitoring-service/src/event-processor.ts`. No authentication of any kind is applied to any route or to the WebSocket ingestion endpoint — every route is reachable by anything that can reach this service's port (3017, `.env.example`/production; not 3005 — a prior documentation pass mixed this service's port up with the Aviator engine's, fixed 2026-07-28, see `docs/games/aviator/overview.md`), and the `/ws` upgrade handler accepts any connection unconditionally (see "WebSocket ingestion" below). In practice this is only reached by `game-gateway` over loopback and is not exposed through either committed Nginx config (`infra/nginx/game.myonlinejoker.com.conf`, `infra/nginx/hestia-proxy.conf` route `/ws` to `gateway_backend` on 3004 and `/ws/aviator` to the real Aviator engine on 3005 — neither routes to this service's own `/ws` path), so the missing auth is mitigated by network topology, not by anything in the code.

## WebSocket ingestion (`src/index.ts:219-227`, `44-97`)

Fastify's underlying `http.Server` gets a manual `upgrade` listener:
```ts
fastify.server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wsServer.handleUpgrade(request, socket, head, (ws) => wsServer.emit('connection', ws, request))
  } else {
    socket.destroy();
  }
});
```
Any upgrade request whose path is exactly `/ws` is accepted — no token check, despite `README.md`'s documented protocol (`ws://localhost:3005/ws?token=jwt_access_token`) implying JWT auth. Any other path (including `/ws/aviator`) is destroyed.

On `connection`, each client is added to an in-memory `connectedClients: Set<WebSocket>` (exposed via `connectedWebSocketClients` in `/metrics/status`). On `message`, the raw buffer is JSON-parsed and passed to `handleIncomingEvent()`:
1. `processor.normalizeEvent(event)` — maps the incoming `{ type, data }` shape to a `NormalizedEvent` (see table below).
2. `redis.xadd('events:<game_type>', '*', 'data', JSON.stringify(normalized))` **and** `redis.xadd('events:all', '*', 'data', ...)` — every event lands in two streams: a per-game-type stream and the global `events:all` stream.
3. `redis.publish('pubsub:events:<game_type>', ...)` and `redis.publish('pubsub:events:all', ...)` — same fan-out via Pub/Sub, consumed by this service's own `GET /events/stream` SSE route.
4. `processor.persistEvent(normalized)` — fire-and-forget (`.catch(err => logger.error(...))`), buffers the event for batched Postgres insert (see below). A persistence failure does not affect the Redis Streams/Pub/Sub path — those two already succeeded by this point.
5. `eventCounts[normalized.event_type]++` — increments the in-memory counter if the type is one of the seven known keys (`joinMatchmaking`, `leaveMatchmaking`, `roomJoined`, `gameAction`, `gameResult`, `roomChat`, `error`); unrecognized event types silently don't increment anything.

If any step throws, the whole handler's `catch` increments `eventCounts.error` and logs — a malformed event never crashes the connection.

### Event normalization (`EventProcessor.normalizeEvent`, `event-processor.ts:71-147`)

| Incoming `event.type` | Normalized `event_type` | Fields populated from `event.data` |
|---|---|---|
| `join_matchmaking` | `joinMatchmaking` | `game_type`, `user_id`, `amount` (from `stake`) |
| `leave_matchmaking` | `leaveMatchmaking` | `game_type`, `user_id` |
| `room_joined` | `roomJoined` | `game_type`, `room_id`, `user_id`, `player_count` (`data.players?.length ?? 0`), `amount` (from `stake`) |
| `game_action` | `gameAction` | `game_type`, `room_id`, `user_id`, `action`, `amount` |
| `game_result` | `gameResult` | `game_type`, `room_id`, `user_id` (from `winner_id`), `amount` (from `prize_amount`) |
| `room_chat` | `roomChat` | `game_type`, `room_id`, `user_id` |
| anything else | `event.type \|\| 'unknown'` | none — only `raw_data: event` is kept |

`timestamp` is always set server-side to `new Date().toISOString()` at normalization time (the client-supplied timestamp, if any, is discarded), and `raw_data` always retains the original `event.data` (or full `event` for the unknown-type fallback) for forensic replay.

Real producer: `services/game-gateway/src/monitor-emitter.ts`'s `MonitorEmitter` class. It is deliberately best-effort — gameplay must never block on monitoring being down: events queue in a bounded in-memory array (`MAX_QUEUE = 500`, oldest dropped) while the WS connection is down, and it reconnects with capped exponential backoff (starts 1s, doubles, caps at 30s) forever. `game-gateway` calls `monitorEmitter.emit(...)` from `src/index.ts` (matchmaking join/leave, room chat, game actions) and `src/matchmaking.ts` (room joined, game result).

## Batched Postgres persistence (`EventProcessor`, `event-processor.ts:17-66,149-154`)

`persistEvent()` pushes onto an in-memory `eventBuffer` array and immediately flushes if the buffer has reached `BATCH_SIZE = 100`. Independently, a `setInterval` fires `flushEvents()` every `FLUSH_INTERVAL_MS = 1000` regardless of buffer size. `flushEvents()` splices the entire current buffer out (synchronous, so no race with concurrent pushes — Node is single-threaded and there's no `await` between the length check and the splice), builds one multi-row `INSERT INTO game_events (event_type, game_type, room_id, user_id, action, amount, player_count, raw_data, created_at) VALUES (...), (...), ... ON CONFLICT DO NOTHING`, and executes it as a single query. `id` is never supplied in the insert (the column default `gen_random_uuid()` always fires), so `ON CONFLICT DO NOTHING` can never actually trigger — there is no natural conflict target on this table, making that clause a no-op.

This means up to 99 events (or up to ~1 second of traffic, whichever is smaller) can be sitting only in memory at any moment. A process crash or unclean restart between flushes loses that buffered slice permanently — it never reached Postgres, though it did already reach Redis Streams/Pub/Sub (steps 2-3 above happen synchronously before buffering), so downstream fraud detection (which reads from `events:all`, not from Postgres) is unaffected by this specific gap; only the `game_events` historical/analytics table loses those rows.

## HTTP routes (`src/index.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET /health` | Pings Redis (`redis.ping()`) and Postgres (`SELECT NOW()`); `200 { success: true, data: { redis: 'connected', postgres: 'connected', timestamp } }` on success, `503 { success: false, error: 'Service health check failed' }` if either throws. |
| `GET /metrics/status` | Returns `{ uptime: process.uptime(), connectedWebSocketClients: connectedClients.size, eventCounts, timestamp }`. `eventCounts` is the in-memory counter object described above — resets to all-zero on every process restart, not backed by Postgres/Redis. |
| `GET /metrics/events?game_type=<type>&interval=minute\|hour\|day` | Calls `EventProcessor.getAggregatedMetrics(gameType, interval)` (below). `game_type` defaults to `'all'`, `interval` defaults to `'hour'`. On error, `{ success: false, error: 'Failed to fetch metrics' }` (200 status — Fastify's default, the handler doesn't set an error status code). |
| `GET /events/stream?game_type=<type>` | Server-Sent Events. Writes raw HTTP response headers (`text/event-stream`, `no-cache`, `keep-alive`), opens a **new dedicated Redis connection** (`new Redis(REDIS_URL)`) per SSE client, subscribes to `pubsub:events:<game_type>` (default `all`), and pipes every published message straight through as `data: <message>\n\n`. Disconnects the Redis subscriber when the HTTP connection closes (`request.raw.on('close', ...)`). One extra Redis connection is opened per concurrent SSE client — no pooling or connection cap, so a large number of simultaneous SSE viewers directly multiplies Redis connections. |
| `GET /events/recent?game_type=<type>&limit=<n>` | Reads from the Redis Stream directly: `redis.xrevrange('events:<game_type>', '+', '-', 'COUNT', limit)` (`limit` clamped to `Math.min(parseInt(...) \|\| 100, 1000)`, default `game_type` `'all'`), parses each entry's `data` field back to JSON, and reverses the result so it comes back oldest-first. Source is the Redis Stream (2-day retention per the stream's implicit lifetime — see caveat below), not Postgres, so this only ever returns recent data regardless of how far back `game_events` in Postgres goes. |

There is no `POST /events` HTTP ingestion route despite `README.md`'s "Integration with Game Gateway" section documenting one (`await fetch('http://localhost:3005/events', { method: 'POST', ... })`) — the actual (and only) ingestion path is the WebSocket connection described above. The README section describing an HTTP fallback was never implemented; `game-gateway` only ever used the WS path (`monitor-emitter.ts`).

**Redis Stream expiry**: the README claims events "auto-expire after 2 days," but no `XTRIM`/`MAXLEN`/`MINID` call or expiry configuration appears anywhere in this service's source — Redis Streams don't expire by TTL on their own (`XADD` with no `MAXLEN`/`MINID` clause grows the stream indefinitely, same class of issue as the missing Postgres retention described below). This should be verified against the Redis server's own configuration (e.g. a maxmemory eviction policy) rather than assumed from the README text, since nothing in this service enforces it programmatically.

## `EventProcessor.getAggregatedMetrics()` (`event-processor.ts:159-223`)

Cache-through: checks `redis.get('metrics:<gameType>:<interval>')` first; on a miss, runs
```sql
SELECT game_type, event_type, COUNT(*) as count,
       AVG(CAST(amount AS DECIMAL)) as avg_amount,
       MAX(CAST(amount AS DECIMAL)) as max_amount,
       COUNT(DISTINCT user_id) as unique_players,
       COUNT(DISTINCT room_id) as active_rooms
FROM game_events
WHERE created_at > NOW() - INTERVAL '<1 minute|1 hour|1 day>' [AND game_type = $1]
GROUP BY game_type, event_type
ORDER BY count DESC;
```
against Postgres directly (the `interval` literal is string-interpolated but only ever one of three hardcoded values, not user input, so it isn't an injection vector; `game_type`, when present, is parameterized), builds a summary (`totalEvents` = sum of all rows' `count`; `totalPlayers`/`activeRooms`/`averageStake` are taken from **only the first row** of the grouped result set, `result.rows[0]`, not aggregated across all game/event-type groups — a query returning multiple `game_type`/`event_type` combinations will report a `summary` that reflects whichever group happened to sort first by `count DESC`, not the true totals across the window), then caches the whole response object in Redis for 60 seconds (`SETEX`). The README's claim of a `game_events_minute_metrics` materialized view is stale — that view was dropped by migration `027_game_events_fixed.sql` and this method has always queried the base table directly, not any view.

## `EventProcessor.detectAnomalies()` (`event-processor.ts:228-254`) — dead code

Runs a per-`game_type` query for users with either more than 50 `gameAction` events in the last hour or a single bet over ₹5000 in the last hour — described in `README.md`'s "PostgreSQL Queries" section as a manual `psql` example, and clearly intended as a fraud-detection primitive (the method name and doc comment both say "for fraud detection"). It is defined on `EventProcessor` but **never called from any route, cron, or other code path in this service** — there is no `/anomalies` HTTP route and no scheduled invocation. The equivalent, actually-wired fraud detection lives entirely in `risk-service`'s `FraudDetector.analyzeGameEvent()`, which runs its own independent rules (co-location, win-rate, velocity, referral-chain) against every event read off the `events:all` Redis Stream — see `docs/backend-services/monitoring-service/overview.md`'s pipeline diagram. `detectAnomalies()` is redundant with that pipeline and unreachable in the current build.

## Database

- **Table**: `game_events` (`infra/db/migrations/027_game_events_fixed.sql`) — `id UUID PK`, `event_type VARCHAR(50) NOT NULL`, `game_type VARCHAR(50)`, `room_id UUID`, `user_id UUID REFERENCES users(id) ON DELETE SET NULL`, `action VARCHAR(100)`, `amount DECIMAL(15,2)`, `player_count INT`, `raw_data JSONB`, `created_at TIMESTAMPTZ DEFAULT NOW()`. Indexes: `(game_type, created_at)`, `(user_id, created_at)`, `(room_id, created_at)`, `(event_type)`, `(created_at)`.
- **Written by**: only this service (`EventProcessor.flushEvents`), insert-only, no updates/deletes anywhere in the codebase.
- **Read by**: only this service (`getAggregatedMetrics`, `detectAnomalies`) — no other service queries `game_events`. `risk-service` gets its data from the Redis Stream, not this table.
- **No retention/cleanup job exists** despite the README documenting one — see `docs/Bugs/game-events-table-has-no-retention-cleanup.md`. The table grows without bound.

## Redis keys/channels used

| Key/channel pattern | Purpose | TTL/lifetime |
|---|---|---|
| `events:<game_type>`, `events:all` | Streams (`XADD`), read by `GET /events/recent` (`XREVRANGE`) and by `risk-service` (`XREAD` on `events:all` only) | No programmatic expiry set by this service (see caveat above) |
| `pubsub:events:<game_type>`, `pubsub:events:all` | Pub/Sub channels, consumed only by this service's own `GET /events/stream` SSE handler | Transient (Pub/Sub, not persisted) |
| `metrics:<gameType>:<interval>` | Cached `getAggregatedMetrics()` response | 60s (`SETEX`) |

## Alerting

This service raises no alerts itself — it has no notion of thresholds or paging. The only alerting mechanism downstream of its data is `risk-service` publishing to the `fraud:alerts` Redis Pub/Sub channel after its own independent analysis of the `events:all` stream this service produces.
