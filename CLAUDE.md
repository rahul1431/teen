# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`teen` (product name **MyOnlineJoker**) is a real-money multiplayer gaming platform: Teen Patti, Aviator, Ludo, plus lottery/cricket/matka betting — built as independent Node.js/Go/Python microservices, a React admin panel, and a Flutter mobile app. There is no root `package.json`/monorepo tool (no npm workspaces, Turborepo, Nx, or Lerna) — every service under `services/` and `admin-panel/` is built and run independently with its own `package.json`.

Production runs on a single VPS via PM2 (`ecosystem.config.js`), not Docker/Kubernetes — `docker-compose.yml` exists but is not the deploy path.

## Before starting non-trivial work

Query ruflo's persisted project memory (`mcp__claude-flow__memory_search`, namespace `teen-project`) before re-deriving architecture, deploy procedure, or recent feature history from scratch — it holds curated, verified-current notes (service topology, the VPS deploy gotchas, in-flight feature status like the cricket automation pipeline's current on/off state) that `docs/*.md` snapshots don't always reflect. **`docs/` MD files are point-in-time snapshots, not live** — confirmed stale at least once already (`docs/games/cricket/*.md` missed several already-merged commits). Verify a docs claim against actual source before trusting it as current; don't assume `docs/Bugs/*.md` entries are still open without checking. If ruflo's memory doesn't answer a question, that's a signal to add an entry once you've done the work of finding out, not just to skip it.

## Commands

There is no single root build/test command — run these per service, from that service's directory.

**Node/TypeScript services** (`admin-service`, `app-monitor-service`, `bot-learning-service`, `churn-service`, `core-api-service`, `game-gateway`, `monitoring-service`, `risk-service`, `wallet-service`, `game-engines/aviator`, `game-engines/ludo`, `uptime-bot`):
```
npm install
npm run dev      # tsx/ts-node watch mode
npm run build    # tsc -> dist/
npm start        # node dist/index.js
```
Only `app-monitor-service` has a test script (`npm test` → `vitest run`). The rest have no automated test suite — verify manually or by reading the code.

**Teen Patti engine** (Go, `services/game-engines/teen-patti`):
```
go build -o teen-patti-engine .
go test ./...                          # run all tests
go test -run TestEvaluateHand ./...    # run a single test
```
Card-evaluation logic (hand ranking, tiebreakers, DDA card swapping, Muflis, joker wild) is the tested surface — see `main_test.go`.

**Churn ML service** (Python/FastAPI, `services/churn-ml-service`):
```
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 3020
```

**Admin panel** (React + Vite + Ant Design Pro, `admin-panel`):
```
npm install
npm run dev       # vite
npm run build     # tsc && vite build
npm run preview
```

**Mobile app** (Flutter, `mobile`):
```
flutter pub get
flutter run
flutter test
flutter build apk --release --split-per-abi --dart-define=MONITOR_SECRET_KEY=<key>
```
`MONITOR_SECRET_KEY` must be passed at build time via `--dart-define` — builds that omit it (e.g. ad hoc local builds outside CI) silently ship without app-telemetry auth. Bump `version_code` in `pubspec.yaml` on every release or already-updated devices won't see the new build.

**Database migrations** (Postgres, run on the VPS):
```
bash infra/db/migrate.sh
```
Idempotent — tracks applied files in a `schema_migrations` table, applies only new ones from `infra/db/migrations/*.sql` in order.

**Deploy** (VPS, PM2): `infra/deploy/deploy-services.sh` builds every Node service, the Go engine, and the admin panel, then copies the admin panel's `dist/` into the live Nginx webroot (`/home/admin/web/game.myonlinejoker.com/public_html/admin/` — **not** `admin-panel/dist` served directly). `infra/deploy/go.sh` is the current one-shot entrypoint used by the `deploy-backend.yml` GitHub Action (`git pull && bash infra/deploy/go.sh`), which installs the workstation SSH key and runs `deploy-tip-gifts-botfill.sh`.

## Architecture

### Service topology
Each folder under `services/` is a separately-deployed PM2 process (see `ecosystem.config.js` for the authoritative list of what's actually running):

- **`core-api-service`** — merged auth + users + leaderboard + notifications + betting (cricket/lottery/matka). Originally five services; consolidated into one (`archive_microservices/` holds the old standalone `betting-service`, `leaderboard-service`, `user-service` for reference — not deployed).
- **`wallet-service`** — double-entry ledger; kept as its own isolated process because it's the financial critical path.
- **`game-gateway`** — Socket.IO/WebSocket hub for matchmaking, room state, and realtime broadcast. `src/realtime.ts` is shared broadcast infrastructure used by **all** games — bugs here affect Teen Patti, Ludo, and Aviator simultaneously, not just one game. `src/watchdog.ts` implements the idle-room reaper (auto-refund/cancel after 15 min abandoned, 5 min sweep interval).
- **`game-engines/teen-patti`** (Go) — hand evaluation, game loop, deals over its own WS/RPC to the gateway.
- **`game-engines/aviator`**, **`game-engines/ludo`** (Node/TS) — one process per game engine.
- **`admin-service`** — admin REST API, RBAC, audit log, KYC image proxy, ML/churn/bot-learning/monitor route groups (`ml-routes.ts`, `churn-routes.ts`, `bot-learning-routes.ts`, `monitor-routes.ts`).
- **`monitoring-service`**, **`risk-service`**, **`churn-service`**, **`churn-ml-service`** (Python/FastAPI), **`bot-learning-service`**, **`app-monitor-service`**, **`uptime-bot`** — supporting/ML/observability services, mostly Fastify + Postgres + Redis + `node-cron` for scheduled jobs, ingesting from the game-gateway and Flutter app-monitor SDK.
- **`ab-experiment-service`** — currently a stub (no source committed, just a leftover `.pytest_cache`); not deployed.

Inter-service calls (e.g. `core-api-service` → `wallet-service`, `game-gateway` → `wallet-service`) are authenticated with a shared `INTERNAL_SERVICE_KEY` header, checked independently by each callee — a missing/misconfigured key on either side fails closed (looks like a generic 403/500, not an obvious auth error). Each service also needs its own `.env` (PM2's `env_file`); the Go engine can't read dotenv itself, so `ecosystem.config.js` parses `services/game-engines/teen-patti/.env` and injects it via PM2's `env` object at process start — `pm2 restart --update-env` does not re-read `.env` files, only `.env` changes plus a full reload do.

### Games registry
`games/registry.json` is the single source of truth for which games exist, their engine path, config path, player counts, and bot support (`services/game-engines/rummy` is listed as `"planned"` — not implemented). Each game has a corresponding default-tunables JSON in `resources/game-configs/`.

### Frontend/client split
- **`admin-panel`** — React 18 + Vite + Ant Design Pro. One page per domain area under `src/pages/` (Finance, RiskCenter, PlayerTracking, AIControlCenter, GameConfig, KYC, Bots, etc.) — a flat page-per-feature structure rather than nested routing modules.
- **`mobile`** — Flutter, `flutter_bloc` for state, `go_router` for navigation, `dio` for HTTP. `lib/features/*` mirrors the admin panel's domain split (auth, games, wallet, missions, referral, support...); `lib/core/*` holds cross-cutting concerns (socket, network, storage, analytics, the in-app update flow, app-monitor SDK).

### Storage layout (see `STRUCTURE.md` for the full rationale)
Three top-level buckets with different lifecycles:
- `resources/` — committed, reviewed static assets (game configs, email templates, card metadata).
- `uploads/` — gitignored runtime user content (avatars, KYC docs — KYC is blocked from public Nginx and proxied through the admin service instead, banners, per-game assets).
- `games/` — the registry above.

### Infra
`infra/deploy/*.sh` are named after the feature branch that introduced them (e.g. `deploy-tip-gifts-botfill.sh`, `deploy-gateway-friends-matchmaking.sh`) rather than being generic — check which script is actually current before assuming one is the canonical deploy path; `go.sh` currently points at `deploy-tip-gifts-botfill.sh`. `infra/nginx/` holds the live Nginx configs (WebSocket `/ws` locations need `proxy_pass_header Upgrade` explicitly or all games disconnect). `infra/db/migrations/*.sql` are sequentially numbered and must stay in order.
