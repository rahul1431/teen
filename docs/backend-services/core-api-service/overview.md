# core-api-service — Overview

Merged auth + users/profile + leaderboard + notifications + support + betting (cricket/lottery/matka) — five originally-independent microservices (`auth-service`, `user-service`, `leaderboard-service`, `notification-service`/`betting-service`) consolidated into one Fastify process. `archive_microservices/{betting-service,leaderboard-service,user-service}` hold the pre-merge standalone code for reference; they are not deployed and not on the PM2 process list. The merge is real (one `package.json`, one process, one port) but incomplete in places — `services/admin-service/.env` used to point `NOTIFICATION_SERVICE_URL`/`BETTING_SERVICE_URL` at the old standalone services' dead ports instead of this service's port 3001 (fixed 2026-07-28), and `services/core-api-service/src/plugins/users.ts` still carries an unauthenticated duplicate of routes that were properly re-secured in `admin-service` (`docs/Bugs/duplicate-unauthenticated-bank-details-routes.md`) — both are leftover seams from the consolidation.

## Tech stack

Fastify 4 + TypeScript, run via `tsx watch` in dev / `tsc` → `node dist/index.js` in prod (`services/core-api-service/package.json`). `pg` (`Pool`, raw SQL, no ORM/query builder), `ioredis`, `@fastify/jwt`, `bcryptjs` (cost 12), `zod` for request validation, `@fastify/multipart` for avatar/KYC uploads, `firebase-admin` for push, `@fastify/rate-limit` (200 req/min for the whole process, not per-route), `@fastify/helmet` (CSP disabled), `@fastify/cors` (`origin: true` — reflects any origin).

## Process structure (`src/index.ts`)

One Fastify app, two Postgres pools, one Redis client, six plugins registered in order:

- **`db` pool** (max 15, 3s connect timeout) — backs auth/users/leaderboard/notifications/support. Timeout is deliberately short: "don't let slow bets block auth" per the in-source comment.
- **`bettingDb` pool** (max 20, 8s connect timeout) — dedicated pool for `bettingPlugin` only, so heavy settlement queries (cricket fantasy leaderboard ranking, matka session settlement, lottery draw payout loops — multi-row `UPDATE`s inside long transactions) can't starve connections needed for login/session checks.
- **`redis`** — single `ioredis` client, shared by auth (OTP + session tokens) and leaderboard (dead Redis sorted-set writes, see `backend.md`). `enableOfflineQueue: true` + auto-reconnect (`retryStrategy` backoff up to 5s) so a Redis blip doesn't crash the process, only queues/delays commands.
- **`app.decorate('authenticate', ...)`** — the shared JWT-verification guard (`onRequest: [app.authenticate]`) every plugin except the internal-key-gated routes uses.

Plugin registration order in `src/index.ts`: `authPlugin(db, redis)` → `usersPlugin(db)` → `leaderboardPlugin(db, redis)` → `notificationsPlugin(db)` → `supportPlugin(db)` → `bettingPlugin(bettingDb)`. `GET /health` reports `{ status, service: 'core-api', services: ['auth','users','leaderboard','notifications','betting','support'] }` — process liveness only, no DB/Redis connectivity check.

## File structure

```
services/core-api-service/src/
├── index.ts                — Fastify bootstrap, pool/Redis setup, plugin registration, /health
├── types.d.ts               — augments FastifyInstance with `authenticate`
├── plugins/
│   ├── auth.ts                — phone+OTP register/login/refresh/logout/reset-password (see docs/app/auth/backend.md)
│   ├── users.ts                — profile, avatar, KYC submission, bank details, daily-login-bonus, referral stats, home banners, transaction history, + a dead unauthenticated bank-details admin duplicate
│   ├── leaderboard.ts           — GET /leaderboard/:gameType (live Postgres aggregate) + a dead POST /internal/leaderboard/update (see docs/app/leaderboard/backend.md)
│   ├── notifications.ts          — player notification inbox + admin-triggered send/broadcast via Firebase Admin SDK (see docs/app/notifications/backend.md)
│   ├── support.ts                 — player support ticket CRUD, scoped to the caller (see docs/app/support/backend.md)
│   └── betting.ts                  — matka/lottery/cricket player betting routes + `/internal/*` admin-service-facing settlement routes (no existing feature doc — fully covered in backend.md here)
└── helpers/
    ├── otp.ts                       — Redis-backed OTP generation/verification, MSG91 or dev-mode/master-OTP delivery (see docs/app/auth/backend.md)
    ├── wallet-client.ts               — debitStake()/creditPrize(), thin fetch wrappers calling wallet-service's /internal/wallet/{debit,credit}
    ├── matka.ts                        — Matka multiplier table, panna validation/classification, settleMatkaSession() (open/close draw settlement + payout)
    ├── lottery.ts                       — settleLottery() (per-ticket-number winner marking + payout)
    └── cricket.ts                        — settleCricketMarket()/settleFantasyLeague()/settleCricketSession() (match-winner, fantasy-league-rank, and session-runs settlement)
```

## Deployment

PM2 process name **`teen-core-api`** (`ecosystem.config.js:24`), `cwd: services/core-api-service`, `env_file` loaded from `services/core-api-service/.env`, explicit `PORT: 3001` in the PM2 `env` block (overrides whatever `PORT` the `.env` itself sets). Required env vars: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN` (default `15m`), `JWT_REFRESH_EXPIRES_IN` (default `30d`), `INTERNAL_SERVICE_KEY` (shared with every other service for `x-internal-key` auth), `OTP_PROVIDER`/`MASTER_OTP`/`MSG91_*` (auth), `REFERRAL_BONUS_AMOUNT`, `AVATAR_UPLOAD_DIR`/`KYC_UPLOAD_DIR`/`APP_URL` (users), `WALLET_SERVICE_URL` (users' daily-bonus credit + betting's `wallet-client.ts`), `FIREBASE_SERVICE_ACCOUNT_JSON` (notifications — falls back to console-log dev mode if unset).

## Place in the system

Public ingress: Nginx (`infra/nginx/{game.myonlinejoker.com,hestia-proxy}.conf`) rewrites `/api/{auth,users,leaderboard,notifications,support}/*` → `/{auth,users,leaderboard,notifications,support}/*` and `/api/betting/*` → `/*` (the `betting/` segment is stripped entirely, since the routes underneath are registered as bare `/matka/*`, `/lottery/*`, `/cricket/*`), all proxied to `127.0.0.1:3001`. `/api/wallet/*` and `/api/admin/*` are **not** routed here — those go to `wallet-service` (3003) and `admin-service` (3008) respectively; the admin panel never calls this service directly (see `admin.md`, `frontend.md`). Outbound, this service calls `wallet-service`'s `/internal/wallet/{debit,credit}` (via `helpers/wallet-client.ts` for betting, and a direct `fetch` in `users.ts`'s daily-bonus claim route) and Firebase Cloud Messaging for push. `admin-service` calls back into this service's `/internal/*` routes for notifications (send/broadcast) and betting administration (declare/create/settle/sync) — though, per `admin.md`, two of those call paths are currently misconfigured to hit dead ports instead of this service.
