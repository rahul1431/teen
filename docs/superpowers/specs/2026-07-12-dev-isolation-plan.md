# Dev Environment Isolation — Detailed Plan (execution pending approval)

Date: 2026-07-12
Goal: make `dev.myonlinejoker.com` a real sandbox that uses `teen_db_dev` + dev Redis + dev ports,
so testing never touches production money data. NO changes executed yet — this is the runbook.

## Current state (verified 2026-07-12)

- One VPS, one `/opt/teen`, one PM2 daemon. Dev PM2 procs (ids 0–13) currently run against **prod
  `teen_db`** because their per-service `.env.dev` files don't exist and the running config falls back
  to prod `.env`.
- **Dev Redis already exists**: `teen_redis_dev` on port **6380** (prod Redis on 6379). Good — reuse it.
- **`teen_db_dev` exists** but is ~5 tables behind `teen_db` (76 vs 81) and has stale/no data.
- **`ecosystem.config.dev.js` is broken**: it sets `DATABASE_URL: 'teen_db_dev'` (a bare string, not a
  `postgresql://…` URL) and `REDIS_PORT: 6380` inline. Services expect a full `DATABASE_URL`
  connection string (prod uses `postgresql://teen:<pw>@localhost:5432/teen_db`). These inline values
  must be replaced by real values sourced from `.env.dev`.
- **nginx `dev.myonlinejoker.com`**: `/api/admin` → `127.0.0.1:3001` (PROD core-api!); no `/ws` block /
  Upgrade headers; `dev_game_backend` upstream lists 3200–3204 but only 3201/3204 are alive (gateways
  2/3 are on 3221/3222).
- **wallet-dev currently on 3003** = the PROD wallet port → prod `teen-wallet` is in a crash loop
  (P1-5). Moving dev wallet to 3203 (as the dev config already intends) frees prod 3003.

## Dev port map (from ecosystem.config.dev.js) — target

| Service | Dev port | Prod port |
|---|---|---|
| core-api | 3201 | 3001 |
| wallet | 3203 | 3003 |
| gateway / 2 / 3 | 3204 / 3221 / 3222 | 3004 / 3021 / 3022 |
| aviator | 3205 | 3005 |
| ludo | 3211 | 3011 |
| tp-engine | 3210 | 3010 |
| admin-svc | 3208 | 3008 |
| monitoring | 3217 | 3017 |
| risk | 3206 | 3006 |
| churn / churn-ml | 3213 / 3220 | 3013 / 3020 |
| app-monitor | 3215 | 3015 |

## Stages (each verified before the next; dev-only processes touched)

### Stage 0 — Prep (no service impact)
1. Fix `ecosystem.config.dev.js`: remove the bare-string `DATABASE_URL: 'teen_db_dev'` / `REDIS_PORT`
   inline values; let each app get `DATABASE_URL`/`REDIS_URL` from its `.env.dev` (env_file) only.
   Commit.
2. Generate per-service `.env.dev` for all 14 services (base off each service's prod `.env`, swapping):
   - `DATABASE_URL=postgresql://teen:<pw>@localhost:5432/teen_db_dev`
   - `REDIS_URL=redis://:<pw>@localhost:6380` (or the dev redis auth)
   - `PORT=<dev port>` and `NODE_ENV=development`
   - keep all other keys (JWT secrets, service URLs → point service URLs at dev ports).
   `infra/deploy/create-env-files.sh` is the pattern to extend. Secrets stay on the VPS.

### Stage 1 — Dev database
3. Sync `teen_db_dev` schema to `teen_db` (apply the ~5 missing tables; run migrations against
   `teen_db_dev`; record in a per-db `schema_migrations`). Decide data policy: empty + seed a few test
   users/wallets (recommended) vs. sanitized copy of prod. Take a `teen_db` backup first.

### Stage 2 — Restart dev stack under the dev config
4. `pm2 delete` the current dev procs (ids 0–13) and start from the fixed `ecosystem.config.dev.js`
   (`pm2 start ecosystem.config.dev.js`), verify each connects to `teen_db_dev` (`pm2 env <id> | grep
   DATABASE_URL`, hit `/health`). This also moves wallet-dev to 3203, **freeing 3003 for prod wallet**
   (then `pm2 restart teen-wallet` prod → P1-5 fixed). `pm2 save`.

### Stage 3 — nginx dev vhost
5. Point `dev.myonlinejoker.com` `/api/admin` (and `/api`) to the **dev** core-api `3201` (not prod
   3001). Add a `/ws` location with `proxy_pass_header Upgrade` + `proxy_set_header Upgrade/Connection`
   → dev gateway `3204` (see [[nginx-ws-upgrade-pitfall]]). Fix `dev_game_backend` upstream to
   `3204/3221/3222`. `nginx -t` then reload. Keep a config backup.

### Stage 4 — Verify isolation
6. Log into `dev.myonlinejoker.com/admin`, perform a write, confirm it lands in `teen_db_dev` and NOT
   `teen_db`. Confirm a dev WebSocket game connects (no "connection lost"). Confirm prod unaffected
   (prod wallet online, prod games fine).

## Risks / notes
- Restarting dev procs is low prod-risk IF dev truly stops sharing prod DB first; but they currently
  DO share it, so during the cutover verify no prod service depends on a dev port.
- The prod wallet fix (3003) is coupled to Stage 2 — sequence it so prod wallet restart happens right
  after wallet-dev vacates 3003.
- tp-engine dev: its `.env.dev` should carry `DATABASE_URL` for `teen_db_dev`; see the false-alarm note
  in [[tp-engine-env-pitfall]] (hardcoded fallback points at prod `teen_db`, so a MISSING dev URL would
  silently use PROD — this makes the `.env.dev` mandatory for the dev engine).
- Admin panel: the live docroot is `public_html/admin` for prod; the dev vhost has its own docroot —
  see [[admin-panel-real-docroot]]. Ensure dev serves its own build.

Related: [[dev-prod-not-isolated]].
