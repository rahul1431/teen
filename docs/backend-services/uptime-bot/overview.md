# Uptime Bot — Overview

A standalone, single-file synthetic health-check daemon — not a Fastify/Express service, not an HTTP server, not a consumer of anything from `game-gateway` or the Flutter app. It does one thing on a timer: connect to the platform's own infrastructure and processes from the outside (Postgres, Redis, two public WebSocket endpoints, ten internal TCP ports), and write the pass/fail + latency result to a single JSON file on disk. It is the third "monitor"-named service in this repo and the least related to the other two:

- `monitoring-service` ingests **gameplay events** (matchmaking, room joins, in-game actions) pushed from `game-gateway` — see `docs/backend-services/monitoring-service/overview.md`.
- `app-monitor-service` ingests **Flutter app telemetry** (sessions, client errors, API timings) pushed from the mobile app, and separately exposes PM2/Docker process health.
- `uptime-bot` (this service) does neither — it is the only one of the three that actively *dials out* to test connectivity, rather than passively receiving pushed data. Nothing calls into it; it calls out, then writes a file.

## What it checks, and how

Everything lives in one file, `dist/index.js` (compiled from `src/index.ts`, see "Source availability" below). On a `CHECK_INTERVAL_MS` timer (default 30000ms / 30s, env-overridable), `runHealthCheck()` runs four independent checks concurrently via `Promise.all`, then ten more sequentially:

1. **PostgreSQL** — `SELECT 1` against `DATABASE_URL` through a fresh `pg.Pool` created and torn down (`db.end()`) every single cycle.
2. **Redis** — `PING` against `REDIS_URL` through a fresh `ioredis` client (`lazyConnect: true`, explicitly `.connect()`'d then `.quit()`'d every cycle).
3. **Public WebSocket handshakes** — real WS upgrade handshakes (not plain HTTPS GETs) against `wss://game.myonlinejoker.com/ws` (game-gateway) and `wss://game.myonlinejoker.com/ws/aviator` (the Aviator engine).
4. **Thirteen internal TCP ports** — raw `net.Socket` connect-and-disconnect against `127.0.0.1:<port>` for every currently-running PM2 service (`core-api`, `wallet`, `gateway`, `aviator`, `risk`, `admin-svc`, `tp-engine`, `ludo-engine`, `churn`, `bot-learning`, `app-monitor`, `monitoring`, `churn-ml`) — corrected 2026-07-28 (see `backend.md`) from a stale ten-entry table with dead duplicate/merged-service checks and a wrong `admin-svc` port.

All results are assembled into one `UptimeStatus` object and written to `UPTIME_STATUS_FILE` (default `/opt/teen/uptime-status.json`) as pretty-printed JSON, **overwriting the previous file in place** — there is no history, no time series, no database persistence of results (see `backend.md`).

## Alerting

None. There is no email/Slack/webhook/push notification anywhere in this codebase — the entire "alerting" surface is: write a JSON file, and let whatever reads that file (`app-monitor-service`, see `admin.md`) decide what to do with it. If nothing polls the file, a total outage produces no notification of any kind; it just sits in the file, or the file goes stale (its own `timestamp`/`checked_at` fields are the only staleness signal, and nothing currently checks them for staleness — see `admin.md`).

## Tech stack

Plain Node/TypeScript, no web framework. Dependencies (per the `package.json` recovered from git history, see caveat below): `pg` (`Pool`), `ioredis`, `dotenv`; Node built-ins `net`, `https`, `crypto`, `fs`, `path`. `tsconfig.json` targets `ES2020`/`commonjs`, `strict: true`, output to `./dist`. No test suite, no `test` script, no HTTP server dependency (`fastify`/`express` are absent) — this is deliberately the smallest, most dependency-light service in the repo.

## File structure

```
services/uptime-bot/
  dist/index.js        # compiled output — the only code present in this checkout (240 lines)
  dist/index.js.map    # sourcemap; sourceRoot points at ../src/index.ts
  dist/index.d.ts, .d.ts.map
  .env                  # DATABASE_URL, REDIS_URL, UPTIME_STATUS_FILE, CHECK_INTERVAL_MS, LOG_LEVEL
```
No `src/`, `package.json`, `package-lock.json`, or `tsconfig.json` exist in this checkout — see "Source availability" immediately below. Everything documented here about check logic is read directly from `dist/index.js`, which was verified byte-for-byte equivalent (down to line count, comments, and variable names) to `services/uptime-bot/src/index.ts` as it exists at commit `f03f800` ("fix: wire MONITOR_SECRET_KEY into APK build + fix uptime-bot WS handshake check") — a commit that is **not an ancestor of the current branch** (`claude/confident-archimedes-e2dd1k`). The compiled artifact in this working tree is a leftover build product, not something this branch's `git log` can account for.

## Source availability

On `feature/admin-responsive`, `services/uptime-bot/` is fully tracked: `git ls-files services/uptime-bot` returns `src/index.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, and `ecosystem.config.js` has a `teen-uptime-bot` PM2 entry (`cwd: ${BASE}/uptime-bot`, `script: 'dist/index.js'`, single fork instance, `max_memory_restart: '100M'`). This service builds and runs normally on this branch — confirmed live on the VPS (`pm2 status` shows `teen-uptime-bot` online). An earlier documentation pass on a different branch (`claude/confident-archimedes-e2dd1k`) found this source untracked there; that finding doesn't apply here.

## Deployment

PM2 process name `teen-uptime-bot`, `cwd: services/uptime-bot`, `script: dist/index.js`, single fork instance, `max_memory_restart: '100M'`, env loaded via PM2's `env_file` mechanism plus an explicit `UPTIME_STATUS_FILE` override in the PM2 `env` block. `.env` fields actually read by the code: `DATABASE_URL`, `REDIS_URL`, `UPTIME_STATUS_FILE`, `CHECK_INTERVAL_MS`; `LOG_LEVEL` is present in the committed `.env` but never read by `dist/index.js` — the logger is a hardcoded two-function `console.log`/`console.error` wrapper with no level filtering.

## Place in the system

```
uptime-bot (this service, standalone process, no listening port)
    |  every CHECK_INTERVAL_MS (default 30s):
    |    - SELECT 1 -> Postgres (DATABASE_URL)
    |    - PING -> Redis (REDIS_URL)
    |    - WS handshake -> wss://game.myonlinejoker.com/ws, /ws/aviator
    |    - TCP connect -> 10 hardcoded 127.0.0.1:<port> targets
    v
writes UPTIME_STATUS_FILE (/opt/teen/uptime-status.json), full overwrite each cycle
    |
    v
app-monitor-service  GET /api/monitor/uptime  (services/app-monitor-service/src/index.ts:114-126)
    reads the file straight off disk, no caching, returns { success: true, data: null } if the file is missing
    |
    v
admin-service  GET /api/admin/monitor/uptime  (services/admin-service/src/monitor-routes.ts:25-31)
    authenticated proxy, no transformation
    |
    v
admin-panel  AppMonitorTab.tsx  (adminApi.get('/monitor/uptime'), line 175)
    renders the "Live Client-to-Server Connectivity (Uptime Bot)" card — see docs/backend-services/uptime-bot/admin.md
```
