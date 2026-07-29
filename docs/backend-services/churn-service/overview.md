# Churn Service — Overview

`services/churn-service` is a small Node/TypeScript/Fastify microservice (`teen-churn` in `ecosystem.config.js`, port `3013`) that runs a periodic churn-scoring cron and exposes a thin admin-facing HTTP API over the results. It is the operational half of churn handling: it decides *who* is at risk and *acts* on that (persist a score, credit a bonus, send a notification). The actual risk-probability computation is delegated to the separate Python service `services/churn-ml-service` (FastAPI + scikit-learn `RandomForestClassifier`, port `3020`) — see `docs/backend-services/churn-ml-service/` for that side. This document only covers the Node service.

## Tech stack
Fastify 4, `pg` (raw SQL, no ORM), `ioredis` (cooldown locks only, no caching layer), `node-cron`, `axios` (outbound calls to `churn-ml-service`, `wallet-service`, and the notification endpoint on `core-api-service`), `pino` for logging. No test suite (`package.json` has no `test` script).

## File structure
The entire service is two source files:
- `services/churn-service/src/index.ts` (149 lines) — Fastify bootstrap, cron scheduling, and all five HTTP routes. Thin: every route handler just calls into `ChurnScorer`.
- `services/churn-service/src/churn-scorer.ts` (291 lines) — `ChurnScorer` class: config read/write, the scoring cycle, ML delegation + heuristic fallback, re-engagement (bonus credit + notification), and stats aggregation. This is where all the actual logic lives.

No migrations directory of its own — its two tables (`user_churn_scores`, `churn_config`) are defined in `infra/db/migrations/015_churn.sql`, shared with the rest of the platform's Postgres schema.

## What it does
1. On startup, and then on an hourly `node-cron` schedule (see `docs/backend-services/churn-service/backend.md` for the exact cron expression derivation), it pulls every eligible player (`status = 'active'`, `is_bot = false`, account older than the configured grace period, at least one completed deposit) and scores each one for churn risk.
2. For each user it first tries `churn-ml-service`'s `/predict` endpoint (a trained `RandomForestClassifier` over deposit-recency/frequency/games-played/profit features); if that call fails or times out (2s timeout), it falls back to an inline heuristic (weighted deposit-inactivity + deposit-frequency-drop scoring) computed from the same query's aggregates.
3. Persists the resulting `score`/`risk_level` to `user_churn_scores` (upsert keyed on `user_id`).
4. For `medium`/`high` risk users (respecting a Redis-backed cooldown), auto-triggers re-engagement: `medium` gets a notification only, `high` gets a bonus credit + notification.
5. Exposes a small read/write API (`/api/churn/*`) that `admin-service`'s `churn-routes.ts` proxies to, which in turn backs the "Churn Intelligence" tab of the admin panel's AI Control Center.

## Deployment
PM2 process name `teen-churn` (`ecosystem.config.js:136-146`), `cwd` = `services/churn-service`, runs `dist/index.js` (built via `npm run build` → `tsc`), single fork instance, `max_memory_restart: '150M'`. Its `.env` is loaded via PM2's `env_file` mechanism (see root `CLAUDE.md` for the general PM2/`.env` caveat — `pm2 restart --update-env` does not pick up `.env` changes).

`.env` / `.env.example` variables (`services/churn-service/.env.example`, `services/churn-service/.env`):
- `PORT` (default `3013`)
- `DATABASE_URL` — shared platform Postgres
- `REDIS_URL` — used only for the per-user re-engagement cooldown lock, not caching
- `NOTIFICATION_SERVICE_URL` — actually the base URL of **`core-api-service`** (`.env` points at `http://localhost:3001`, core-api-service's port). There is no standalone "notification-service" process in this codebase — `core-api-service` hosts `POST /internal/notifications/send` via `notificationsPlugin` (`services/core-api-service/src/plugins/notifications.ts`).
- `WALLET_SERVICE_URL` — `wallet-service` base URL
- `INTERNAL_SERVICE_KEY` — used as the `x-internal-key` header on `reEngageUser`'s two downstream calls (fixed 2026-07-29; previously read nowhere in this service's source, so both calls went out unauthenticated and were rejected — see `docs/backend-services/churn-service/backend.md`). Present in both `.env` and `.env.example` now.

Notably, the `churn-ml-service` base URL is **not** an env var at all — `churn-scorer.ts:123` hardcodes `http://127.0.0.1:3020/predict`. This only works because both processes run on the same VPS; there is no `CHURN_ML_SERVICE_URL` config knob the way `NOTIFICATION_SERVICE_URL`/`WALLET_SERVICE_URL` are, so pointing this service at a churn-ml-service on a different host requires a code change, not a config change.

## Relationship to `churn-ml-service` and `admin-service`
- **`churn-ml-service` (Python/FastAPI, port 3020)**: pure prediction — `POST /predict` returns `{ user_id, churn_risk, risk_level, features }` computed from a `RandomForestClassifier` trained on deposit/game features pulled straight from Postgres (`services/churn-ml-service/main.py:29-65`), auto-training itself on first call if `model.pkl` doesn't exist yet (`main.py:110-112`). It has no cron, no config store, no re-engagement logic, and no auth check on any endpoint (`/predict`, `/train`, `/health` are all unauthenticated — reachable by anything that can reach `127.0.0.1:3020`, including this service's unauthenticated call). It is a stateless scoring oracle that `churn-service` calls once per eligible user per cycle.
- **`churn-service` (this service)**: owns the operational loop — eligibility querying, the config that drives both the heuristic fallback *and* the re-engagement thresholds, the persisted score history, the Redis cooldown, and the side effects (wallet credit, notification). It treats `churn-ml-service` as an optional accelerator: if the ML call fails for any reason, scoring still happens via the heuristic branch (`churn-scorer.ts:134-167`), so the platform never loses churn scoring entirely if the Python service is down — only the fidelity degrades.
- **`admin-service`**: does not talk to Postgres for churn data at all. `services/admin-service/src/churn-routes.ts` is a pure HTTP pass-through proxy: every one of its five routes calls the corresponding `churn-service` endpoint via `axios` using `CHURN_SERVICE_URL` (default `http://localhost:3013`, `services/admin-service/.env.example:10`) and forwards the response/error verbatim. See `docs/backend-services/churn-service/admin.md` for the route-by-route mapping and RBAC, and `docs/backend-services/admin-service/` for admin-service's own docs (not duplicated here).
