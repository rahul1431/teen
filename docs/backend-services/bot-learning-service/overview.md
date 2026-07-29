# Bot Learning Service — Overview

`services/bot-learning-service` is a small Node/TypeScript Fastify service whose only job is to keep the `bot_profiles` Postgres table populated: a nightly job derives per-`(game_type, difficulty)` bot behavior parameters (fold/call/raise probabilities, decision delay, stake preference, aggression, and a "win rate target") from **real player** performance data, and exposes them over a tiny HTTP API for other services and the admin panel to read/override. `package.json`'s own description calls it exactly that: "Nightly bot profile builder from real player data."

## Tech stack

Fastify 4, `pg` (`Pool`), `ioredis`, `node-cron`, `pino`, `dotenv`. No test script (`package.json` has no `"test"` entry — this service has zero automated test coverage, unlike the Go teen-patti engine). Dev via `ts-node src/index.ts`, build via `tsc` (`tsconfig.json`: `rootDir: ./src`, `outDir: ./dist`, CommonJS, ES2020, `strict: true`).

## File structure

The entire service is two source files:
- **`src/index.ts`** (124 lines) — Fastify bootstrap, the nightly `node-cron` schedule, all seven HTTP routes, graceful shutdown.
- **`src/profile-builder.ts`** (292 lines) — the `ProfileBuilder` class: config read/write, the rebuild algorithm, profile CRUD, Redis caching. This one class is the entire "learning" logic — there is no separate model-training module, no ML library dependency, no queue/worker split.

Both files are read in full for `backend.md`; nothing else ships under `src/`.

Note: a `dist/` directory exists locally in this checkout with compiled output for far more (`audit-logger`, `drift-detector`, `slack-notifier`, `metrics-aggregator`, `adaptive-thresholds`, `anomaly-response-handler`, `profile-cache`, `streaming-evaluator`) than the two files above — but none of those `.ts` sources exist under `src/`, and `dist/` is **not** tracked by git (`git ls-files services/bot-learning-service/` only lists the two `src/*.ts` files, `.env.example`, `package.json`, `package-lock.json`, `tsconfig.json`). This is stale local build output from an earlier, much more ambitious version of this service (Kafka streaming evaluation, drift detection with Slack alerting, cohort-based adaptive thresholds) that isn't part of the committed codebase and would be overwritten by a fresh `npm run build` from current `src/`. It doesn't reflect what runs in production; documented here only so its presence in a working tree isn't mistaken for the real service surface.

## Deployment

PM2 process name **`teen-bot-learning`** (`ecosystem.config.js:178-187`): `cwd` = `services/bot-learning-service`, `script: 'dist/index.js'`, `env_file` = `services/bot-learning-service/.env` (via `ENV_FILE('bot-learning-service')`), single fork instance, `max_memory_restart: '150M'`, `watch: false`. Also listed in `infra/deploy/deploy-services.sh`'s `SERVICES` array, so a normal deploy runs `npm install && npm run build` for it like every other Node service.

`.env` (`services/bot-learning-service/.env`, mirrored by `.env.example`):
```
PORT=3014
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```
No `INTERNAL_SERVICE_KEY` is defined here — see `backend.md` for why that matters: this is the one HTTP-exposed service in the codebase found in this pass with literally no request-level auth check of any kind, not even the shared internal-key pattern CLAUDE.md documents as the norm for inter-service calls.

Listens on `0.0.0.0:$PORT` (`index.ts:108`), i.e. all interfaces, not just loopback.

## Place in the system

- **Writes to**: `bot_profiles` (the per-`game_type`/`difficulty` tier table) and `bot_learning_config` (the tunable knobs for the rebuild job itself) — both created by `infra/db/migrations/016_bot_learning.sql`, which also seeds fallback rows for all 3×3 game-type/difficulty combinations (`sample_size = 0` marks a seeded/never-rebuilt row).
- **Consumed by two different downstream paths, neither of which goes through this service's write path — only its data**:
  1. `services/game-engines/teen-patti/main.go:358-360` reads `bot_profiles.win_rate_target` **directly from Postgres**, bypassing this service's HTTP API entirely, to drive the DDA card-swap mechanism at deal time. Full mechanism: `docs/backend-services/teen-patti-engine/backend.md` ("DDA — the card-swap mechanism"). This is the single most consequential field this service writes.
  2. `services/game-gateway/src/bot-profile.ts`'s `getBotProfile()` calls this service's `GET /api/bots/profile` over HTTP (Redis-cached, 500ms timeout, hardcoded fallback on failure) to get `fold_probability`/`call_probability`/`raise_probability`/`avg_decision_delay_ms` for **Teen Patti bot turns only** — `matchmaking.ts:535` gates `scheduleBotTurn` (the only caller of `getBotProfile`) on `gameType === 'teen_patti'`. Ludo bots are explicitly documented (comment in `bot-profile.ts:18-23`) to use the Ludo engine's own `chooseBotToken()` instead; Aviator has no bot-turn call site at all — see `backend.md` and `docs/Bugs/` for why the Aviator tier of this service's own output is dead data.
- **Admin-panel path**: `services/admin-service/src/bot-learning-routes.ts` is a thin `axios` proxy (`BOT_LEARNING_SERVICE_URL`, default `http://localhost:3014`) mounted under `/api/admin/bots/*`, consumed by `admin-panel/src/components/AI/BotLearningSection.tsx` (embedded inside `MLConfigPanel.tsx`, itself one tab of `AIControlCenter.tsx`). Full trace in `admin.md`.
- **`admin-service` and `game-gateway` both talk to this service over plain HTTP with no `x-internal-key` header set on either side** — see `backend.md`'s auth section.

Cross-reference: `docs/backend-services/teen-patti-engine/backend.md` and `admin.md` (DDA mechanism, and the two admin-UI surfaces that fail to reach `win_rate_target`), `docs/Bugs/teen-patti-dda-admin-control-gap.md`, `docs/Bugs/bots-page-fake-personality-skill.md`, `docs/backend-services/admin-service/backend.md`.
