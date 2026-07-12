# Deployment Runbook — remaining live-prod steps

Date: 2026-07-12
Context: dev == prod (shared VPS 64.204.130.181, shared DB teen_db). Every live step below touches production.

## Done this session (safe / reversible)

- **P0-2 RCE, P0-3 rollback gate, P0-4 login seed creds, P1-4 build errors** — code fixed,
  committed (`091c851`), pushed to `feature/admin-responsive`. NOT yet on the VPS (VPS is at `1e9c3fb`).
- **P0-5 tp-engine** — investigated: FALSE ALARM. Go engine's hardcoded fallback
  `postgresql://teen:teen_secret_2024@localhost:5432/teen_db` equals the working core-api connection
  (DB superuser is `teen`); engine up 8h+, saves land. Added explicit DATABASE_URL/REDIS_URL to
  `services/game-engines/teen-patti/.env` on the VPS (no restart) so a future restart can't rely on
  the hardcoded fallback. No functional change.

## Blocked on decision

### D1 — admin-panel deploy (ships P0-4) also ships the mock Dev Admin Panel to prod
The served prod dist is built from `1e9c3fb`, which predates the Dev Admin Panel + EnvironmentSwitcher.
Rebuilding from current HEAD to remove the login seed-cred hint would also push those unfinished
features (mock deploy UI that fakes progress and never calls the backend; role-gated to DevAdmin/superadmin).
Options:
  a. Ship current build (seed-cred fix + the mock Dev Admin Panel UI). Low functional risk (mock is
     harmless + role-gated), but puts an unfinished feature on prod.
  b. Ship a minimal build: `1e9c3fb` + only the Login.tsx seed-cred removal (cherry-pick), leaving the
     deploy feature off prod until it's finished.
  Recommended: **b** — smallest prod surface. Also rotate the `Admin@123456` superadmin password (the
  on-screen hint is cosmetic; the live credential is the real exposure — must be changed by you).

## Plan-only (high blast radius — do not execute without go-ahead + a maintenance window)

### Dev isolation (the headline fix)
Point every `*-dev` PM2 process at `teen_db_dev` + dedicated ports via per-service `.env.dev` files
(`ecosystem.config.dev.js` already expects them); repoint nginx `dev.myonlinejoker.com` `/api/admin`
away from prod 3001 to the dev core-api (3201); add the missing `/ws` block + Upgrade headers to the
dev vhost; fix the `dev_game_backend` upstream (dead 3200/3202/3203, missing 3221/3222). Requires
seeding/migrating teen_db_dev and a dev-services restart. Big, staged, verify each service.

### Prod stability
- **P1-5** teen-wallet crash loop: dev wallet owns port 3003 → will resolve once dev isolation gives
  dev its own ports; interim = move wallet-dev to a dev port.
- **P1-6** teen-admin-svc crash loop: launched without ADMIN_JWT_SECRET. Needs the secret provided via
  its env/pm2 (you supply the value — I won't fabricate a JWT secret). NOTE: admin-svc being down is why
  the deploy-route RCE is not currently reachable on prod; starting it activates that feature, so deploy
  the RCE-fixed admin-service build (from HEAD) at the same time.
- **P1-7** teen-bot-learning-dev crash loop (3,230 restarts): Kafka container `teen_kafka_1` is
  "Created" but never started → `docker start teen_kafka_1` (verify zookeeper linkage first).

### Public site root (P1-2)
`myonlinejoker.com` → `game.myonlinejoker.com/` returns API JSON 404 instead of a player web app.
Need to confirm whether a player web frontend is meant to be served at the apex (vs mobile-only) before
changing nginx. Investigate, then route the apex to the frontend build or a proper landing.

### Mobile (P1-11/P1-12) — before any store release
Debug-signed release APK + `usesCleartextTraffic=true`. Requires a real release keystore (you hold it)
and manifest/gradle changes. Plan separately.

## Commands reference (for the approved steps)
- Backup before dist swap: `cp -r /opt/teen/admin-panel/dist /opt/teen/admin-panel/dist.bak-$(date)`
- Deploy admin-panel: build locally → `scp -r dist/* root@vps:/opt/teen/admin-panel/dist/` → hard-refresh.
- Rollback: restore `dist.bak-*`.
