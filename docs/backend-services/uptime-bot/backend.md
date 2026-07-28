# Uptime Bot — Backend (check logic)

The entire service is `runHealthCheck()` plus four check functions and a write function, all in `dist/index.js` (compiled from the single `src/index.ts`). No routing, no framework, no queueing — a plain `setInterval` loop started from `start()`.

## What "up" means, per target

- **PostgreSQL** (`testPostgreSQL`) — a fresh `new Pool({ connectionString: DATABASE_URL, idleTimeoutMillis: 5000 })` is created for the cycle; "up" is simply `SELECT 1` resolving without throwing. Latency = wall-clock time for that query. Any thrown error (auth failure, connection refused, timeout) is caught, logged via `logger.error('PostgreSQL check failed', err)`, and reported as `{ up: false, latency: 0 }`. No explicit statement/connection timeout is set on the `Pool` beyond `idleTimeoutMillis: 5000` (which only affects how long an idle client lingers before the pool recycles it, not how long `SELECT 1` is allowed to hang) — a genuinely wedged Postgres connection could block this check well past the 30s cycle interval, since there is no `query_timeout`/`statement_timeout` configured.
- **Redis** (`testRedis`) — fresh `ioredis` client with `lazyConnect: true`; `runHealthCheck` explicitly calls `.connect()` if `redis.status === 'wait'`, then the check itself is a `PING`. Same pattern: no explicit command timeout beyond ioredis's own defaults, any thrown error reported as `{ up: false, latency: 0 }`.
- **Public WebSocket handshakes** (`testWebSocketHandshake`) — this is not a plain HTTP GET. It builds a real WS upgrade request by hand: `https.request()` with `Connection: Upgrade`, `Upgrade: websocket`, a random `Sec-WebSocket-Key` (`crypto.randomBytes(16).toString('base64')`), and `Sec-WebSocket-Version: 13`. "Up" is `res.statusCode === 101` on the `upgrade` event. If the server responds without upgrading (a plain HTTP `response` event instead of `upgrade`) it's treated as down and the response socket is destroyed. Hard 5-second timeout (`setTimeout` firing `resolve({ up: false, latency: 0 })`, and a matching `timeout: 5000` passed to `https.request` plus a `req.on('timeout', ...)` handler that destroys the request) — no retry on failure within the same cycle; a fresh attempt only happens on the next 30s tick.
  - Checked against `wss://game.myonlinejoker.com/ws` (game-gateway, correct — Nginx's `/ws` location does proxy to `gateway_backend` on `127.0.0.1:3004`, `infra/nginx/game.myonlinejoker.com.conf:3,79-83`) and `wss://game.myonlinejoker.com/ws/aviator` (also correct — Nginx's `aviator_backend` upstream proxies to the real Aviator engine on `127.0.0.1:3005`; an earlier documentation pass incorrectly concluded this was misrouted to `monitoring-service`, based on a stale port assumption rather than the verified live config — fixed 2026-07-28, see `docs/games/aviator/overview.md`).
- **Internal TCP ports** (`testTcpPort`) — a raw `net.Socket` connect to `127.0.0.1:<port>`; "up" is the `connect` callback firing at all (no application-level probe — a TCP handshake succeeding is treated as the target process being healthy, not just "something is listening on this port"). 3-second timeout, no retry. The port table (`src/index.ts:160-172`) was corrected 2026-07-28 to match the platform's actual, current port assignments (verified against live `ss -tlnp` output on the VPS, not just committed config files):

| label in code | port checked |
|---|---|
| `core-api` | 3001 |
| `wallet` | 3003 |
| `gateway` | 3004 |
| `aviator` | 3005 |
| `risk` | 3006 |
| `admin-svc` | 3008 |
| `tp-engine` | 3010 |
| `ludo-engine` | 3011 |
| `churn` | 3013 |
| `bot-learning` | 3014 |
| `app-monitor` | 3015 |
| `monitoring` | 3017 |
| `churn-ml` | 3020 |

Previously this table had ten entries: `notification`/`leaderboard` were dead duplicates of `core-api` (both merged into `core-api-service`), `betting` was a dead check for a service that no longer exists standalone (also merged into `core-api-service`), `admin-svc` pointed at 3000 (nothing listens there — real port is 3008), and `aviator` was believed to be 3005 with a note claiming that was actually `monitoring-service`'s port — that note was itself wrong; 3005 is genuinely correct for Aviator. `wallet`, `risk`, `churn`, `churn-ml`, and `monitoring` were entirely unchecked before this fix.

## Timeout/retry/backoff, summarized

No retries or backoff anywhere. Every check gets exactly one attempt per 30-second cycle with a hard per-check timeout (5s for WS handshakes, 3s for TCP connects, unbounded/library-default for Postgres and Redis); a failure just means that cycle's JSON reports `up: false` and the next cycle tries again fresh. There is no concept of "flapping" detection, consecutive-failure thresholds, or exponential backoff — this is a stateless poll-and-report loop, not a stateful monitor.

## HTTP routes exposed by this service

None. `uptime-bot` binds no port and runs no HTTP/WebSocket server of its own — it is a pure outbound-connections process. There is nothing to `curl` on this service directly; its only observable output is the JSON file it writes (see below) and process-level `SIGTERM` handling (`process.on('SIGTERM', ...)` exits cleanly with code 0; an unhandled failure in `start()` itself exits with code 1, which would trigger PM2's restart policy if it were running under PM2).

## Storage: JSON file, not a database

Despite connecting to Postgres as one of its checks, **the check results are never written to Postgres, Redis, or any other database** — `db` and `redis` in `runHealthCheck()` exist solely to be pinged, then are torn down (`db.end()`, `redis.quit()`) in a `finally` block every single cycle. The only persistence is `writeStatusFile()`, which:
- Ensures the parent directory of `UPTIME_STATUS_FILE` exists (`fs.mkdirSync(dir, { recursive: true })` if missing).
- `fs.writeFileSync(OUTPUT_FILE, JSON.stringify(status, null, 2))` — a full synchronous overwrite of the previous file's contents.

There is no append, no rotation, no history file, no timestamped snapshots. `UptimeStatus.timestamp` and `.checked_at` are set to the same `new Date().toISOString()` value at construction time (both fields exist but are always identical — likely a leftover from an earlier version of the shape) and are the only way a consumer could tell how fresh the file is; nothing in this service or its consumers (see `admin.md`) currently alerts on staleness if the process stops running and the file simply stops updating.
