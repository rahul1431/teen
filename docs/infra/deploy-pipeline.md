# Deploy Pipeline

`infra/deploy/` holds nine shell scripts plus one SSH public key file. They were written at different points in the project's history, each named after the feature branch or phase that introduced it (per root `CLAUDE.md`), and **none of them has been deleted as the topology moved on** — several of the nine scripts reference services, ports, or nginx filenames that are no longer accurate for the current `ecosystem.config.js`/`services/` layout. This doc traces the one path that is actually live, then goes through every other file and states plainly whether it's still safe to run, superseded-but-harmless, or a landmine.

## `/opt/teen` vs `/opt/teen-prod` (correction, 2026-07-29)

**Every script and this doc's earlier revision described `/opt/teen` as the live checkout. It isn't, and hasn't been for a while.** This was never caught by reading the scripts alone — it only surfaced by SSHing into the VPS and checking directly: every `ecosystem.config.js` app's `cwd` is `${BASE}/services/...` with `BASE = '/opt/teen-prod/services'` (`ecosystem.config.js:3`), and `pm2 describe <any-app>` confirms every running process's actual `script path`/`exec cwd` is under `/opt/teen-prod`. `/opt/teen` is a stale directory (last touched well before this pass) that isn't even a git checkout — `git log` inside it fails with "not a git repository." Nothing PM2 runs has been served from it for some time; deploys to `/opt/teen-prod` were happening via ad hoc manual SSH sessions that never went through any script in this directory (confirmed by `/root/.bash_history` having no `teen-prod` references at all — non-interactive `ssh host 'command'` invocations don't get recorded there).

Fixed 2026-07-29: `go.sh` and `deploy-backend.yml` now both target `/opt/teen-prod`. The other, non-live-path scripts below (`deploy-tip-gifts-botfill.sh`, `deploy-services.sh`, etc.) still say `/opt/teen` in their own headers/`BASE`/`REPO` variables — left as-is like their other staleness, since they're historical/non-canonical scripts, not the live path.

## The current live path, traced end-to-end

```
.github/workflows/deploy-backend.yml  (workflow_dispatch only)
  └─ ssh: cd /opt/teen-prod, git pull + bash infra/deploy/go.sh
       └─ go.sh: install SSH key, then bash deploy-all-services.sh
            └─ deploy-all-services.sh: build all 12 Node services + Go engine
               + churn-ml venv + admin-panel, apply pending DB migrations via
               infra/db/migrate.sh, pm2 restart every app individually
               (never pm2 delete all), pm2 save
```

### `.github/workflows/deploy-backend.yml`

`on: workflow_dispatch` only (`:3-4`) — **this does not run automatically on push**, unlike the other two workflows below. Someone has to manually trigger it from the Actions tab (or `gh workflow run`). The job (`:16-28`) SSHes into `secrets.VPS_HOST` with a **password** (`appleboy/ssh-action@v1.0.3`, `password: ${{ secrets.VPS_PASSWORD }}`, `:19-21`) — not a key — and runs:
```
cd /opt/teen-prod
git stash
git pull origin claude/confident-archimedes-e2dd1k
bash infra/deploy/go.sh
pm2 status
```
`git stash` before pulling (`:25`) means any uncommitted on-VPS edits (e.g. a hotfixed `.env` or an ad hoc config tweak made directly on the box) are silently stashed and left behind, not applied — a real risk if anyone has ever hand-edited a file in `/opt/teen-prod` outside git, since the stash is never popped by this workflow or by `go.sh`. (Confirmed live, 2026-07-29: `services/app-monitor-service/package-lock.json` and `services/core-api-service/package-lock.json` sit permanently modified on the box — harmless npm-metadata churn, but a real example of exactly this class of drift.)

### `infra/deploy/go.sh`

Two jobs, in order:
1. **Install the workstation SSH key.** `rahul-workstation.pub` (a single `ssh-rsa ... gamezone-vps` line — no private key in the repo, just the public half) is appended into `/root/.ssh/authorized_keys` after first stripping any existing line containing the literal string `"gamezone-vps"` (via `grep -v`). This is what CLAUDE.md means by "installs the workstation SSH key" — it's re-run on **every** `go.sh` invocation (every manual workflow dispatch), each time rewriting `/root/.ssh/authorized_keys` from scratch (`mv /tmp/ak /root/.ssh/authorized_keys`) after filtering out the old `gamezone-vps` entry and re-appending the current committed key. It's idempotent for this one key specifically, but note it operates on `/root/.ssh/authorized_keys` as **root**, and any other keys with `gamezone-vps` in their comment (not just this exact key) would also be stripped by the same `grep -v` line.
2. **Run the release deploy**: `bash "$REPO/infra/deploy/deploy-all-services.sh"`. This is the "whatever `go.sh` currently points to" that CLAUDE.md flags as needing verification — fixed 2026-07-29 (previously pointed at `deploy-tip-gifts-botfill.sh`, see below).

### `infra/deploy/deploy-all-services.sh` — the current release script (added 2026-07-29)

Replaces `deploy-tip-gifts-botfill.sh` as what `go.sh` calls, specifically to close `docs/Bugs/deploy-pipeline-live-path-skips-most-pm2-services.md` (now fixed — see "New findings," below, for what that bug was). Step by step:
1. Builds all 12 Node services that back a PM2 app (`core-api-service`, `wallet-service`, `game-gateway` — which backs 3 processes, `admin-service`, `monitoring-service`, `risk-service`, `churn-service`, `app-monitor-service`, `uptime-bot`, `bot-learning-service`, plus the Aviator/Ludo game engines) via a `cwd → PM2 app name(s)` associative array, so adding a new service later is a one-line change.
2. Builds the Teen Patti Go engine (`go build -o teen-patti-engine .`).
3. Installs/updates `churn-ml-service`'s Python venv (creates it only if missing, always re-runs `pip install -r requirements.txt`).
4. Builds `admin-panel` and copies `dist/.` into `/home/admin/web/game.myonlinejoker.com/public_html/admin/` — same webroot path as before.
5. Applies any pending DB migrations via `bash infra/db/migrate.sh` — the tracked, idempotent runner (see `docs/infra/db-migrations.md`), not an ad hoc `docker exec ... psql` loop like the older scripts below use.
6. **Restarts every PM2 app individually** (`pm2 restart <name> --update-env`, once per app/app-group) — deliberately never `pm2 delete all`, so a bad build in one service can't take the whole platform offline while everything else restarts. `pm2 save` at the end.

Unlike `deploy-tip-gifts-botfill.sh`, this script carries no one-off migration/config-UPDATE logic specific to any single release — it's meant to stay generic indefinitely. One-time VPS bootstrap (Node/Go/Docker/Nginx install, firewall, HestiaCP) stays entirely in `bootstrap-vps.sh`; this script never touches system packages, nginx config, or docker compose.

Every deploy now rebuilds the full fleet rather than only what changed since the last release — simpler and more reliable at the cost of a slower deploy; see "New findings" below for why that tradeoff was chosen over git-diff-based selective rebuilding.

### `infra/deploy/deploy-tip-gifts-botfill.sh` — historical, no longer called by `go.sh`

Was the live release script until 2026-07-29; retained as-is (per this doc's own "nothing gets deleted" policy above), still targets the stale `/opt/teen`. Step by step, for reference:
1. `git fetch`/`checkout`/`pull` the `claude/confident-archimedes-e2dd1k` branch explicitly — hardcoded branch name, not "whatever branch is currently checked out."
2. Apply migration `029_tip_dealer_drop_gifts.sql` directly via `docker exec -i teen_postgres psql ... < 029_tip_dealer_drop_gifts.sql`, swallowing any error with `|| echo "(029 may already be applied)"`. This bypasses `infra/db/migrate.sh`'s tracking table entirely (see `docs/infra/db-migrations.md`) — it never inserts a `schema_migrations` row for `029`, so a later run of `migrate.sh` would still consider `029` unapplied and attempt it again (harmless only because this script's own `|| echo` already tolerates the re-run, but the two migration mechanisms are not reconciled with each other).
3. A raw `UPDATE game_configs SET bot_fill_table_size = 4, bot_fill_enabled = true WHERE game_type = 'teen_patti'` — a manual data fix baked into a deploy script rather than a migration file, so it would silently re-apply (harmlessly, since it's idempotent by construction) on every future run of this same script, forever, even though the intent was clearly one-time.
4. Built exactly two services: `services/game-gateway` and `services/admin-service`.
5. Restarted exactly two PM2 processes: `pm2 restart teen-gateway teen-admin-svc --update-env`.
6. Built `admin-panel` and copied `dist/.` into the webroot.
7. A health check that's really just a status/log dump (`pm2 status` + `pm2 logs teen-gateway --lines 10 --nostream`) — nothing asserted on the output; the script exits 0 regardless of what those logs show.

Still individually runnable if ever needed (e.g. to re-verify just the gateway/admin-service/admin-panel slice), same category as `deploy-session6.sh`/`deploy-gateway-friends-matchmaking.sh` below — safe in isolation, just no longer the thing CI calls.

### `infra/deploy/rahul-workstation.pub`

A single public key line (`ssh-rsa AAAAB3... gamezone-vps`). No corresponding private key is in the repo (expected — it's the public half only). It exists solely so `go.sh` can install it into `/root/.ssh/authorized_keys` on every run (above). There is no script that ever *removes* an old workstation key if it's rotated — rotation would mean editing this file in place and relying on the next `go.sh` run's `grep -v "gamezone-vps"` to replace the old line, which only works because the comment string stays `gamezone-vps` across rotations.

## Every other script in `infra/deploy/`

### `deploy-services.sh` — full VPS re-sync (Nginx + DB + full-fleet), not a routine deploy tool

Builds every current Node service by name (`core-api-service`, `wallet-service`, `game-gateway`, `admin-service`, `monitoring-service`, `risk-service`, `churn-service`, `bot-learning-service`, `app-monitor-service`) plus the Aviator/Ludo/Teen-Patti engines and the Churn-ML venv, then the admin panel, then Nginx, then DB, then **`pm2 delete all` followed by `pm2 start ecosystem.config.js`**.

- The `SERVICES` array still lists four names that don't exist anywhere under `services/` anymore — `auth-service`, `user-service`, `betting-service`, `leaderboard-service`, `notification-service` (confirmed: `services/` has no such directories; they live only in `archive_microservices/` per root `CLAUDE.md`, except `auth-service`, which isn't archived under that name at all). This is harmless *only* because of the explicit guard (`if [ -f "$BASE/services/$svc/package.json" ]`) — each stale entry just prints "Skipping $svc" and moves on.
- **`pm2 delete all` is a real landmine if this script is run against a live production VPS out of habit.** This line tears down **every** PM2 process before restarting them from `ecosystem.config.js` — every game, the wallet, everything — causing a brief full-platform outage rather than a scoped restart. This is exactly why it's no longer the routine deploy path: `deploy-all-services.sh` (above) covers the same "rebuild every service" ground with targeted `pm2 restart <name>` calls instead, at the cost of not also re-syncing Nginx/DB-container/directory setup. Reach for `deploy-services.sh` specifically when you need *that* wider re-sync (e.g. after a fresh VPS or a Nginx config change), not for a routine code release.
- Its Nginx logic correctly detects HestiaCP (`if [ -d "$HESTIA_NGINX_DIR" ]`) and writes to `nginx.conf_api` **and** `nginx.ssl.conf_api` — this is the *correct* current filename convention: `infra/scripts/nginx-protect.sh` (a cron job) restores exactly these two filenames every 30 minutes if they drift, and `infra/nginx/hestia-proxy.conf`'s own header comment names the same two paths. So despite the stale `SERVICES` array, this script's Nginx step is accurate and current — see `docs/infra/nginx.md` for the full Nginx picture.
- Its DB-migration loop applies every file in `infra/db/migrations/*.sql` unconditionally with a bare `|| echo "(may already be applied)"` fallback — it does **not** use `infra/db/migrate.sh`'s `schema_migrations` tracking table at all (see `docs/infra/db-migrations.md`), so re-running this script re-attempts every migration from `001` onward every time, relying entirely on each `.sql` file being safely re-runnable rather than any tracked state.
- Also still targets `BASE=/opt/teen`, same staleness as `deploy-tip-gifts-botfill.sh` above — not fixed as part of this pass, since this script isn't the routine live path either way.

### `deploy-hestia.sh` — superseded, effectively dead, fails fast rather than corrupting state

`SERVICES=(auth-service user-service wallet-service game-gateway leaderboard-service notification-service admin-service)` (`:10`) — **the pre-merge five-service split**, with no `core-api-service` entry anywhere, confirming this predates the consolidation into `core-api-service`. Critically, unlike `deploy-services.sh`, there is **no directory-existence guard** — the loop (`:11-16`) does a bare `cd "$BASE/services/$svc"` for every name in the array. Since the script has `set -e` (`:5`) and `auth-service` is the first entry and does not exist under `services/` today, `cd` fails immediately, the script aborts on its very first loop iteration, and nothing after that point (including its own `pm2 delete all` at `:51`) ever executes. So this script is dead in the sense that it cannot complete a single run today, but it's a *safe* kind of dead — it fails loudly and immediately rather than partially applying a broken deploy.

It also writes Nginx's Hestia custom config to `nginx.conf_proxy` (`:36`) — a filename that matches **neither** the current convention (`nginx.conf_api`/`nginx.ssl.conf_api`, confirmed by `nginx-protect.sh` and `hestia-proxy.conf`'s own header) nor anything Hestia's panel-generated vhost template is shown anywhere in this repo to include. Even hypothetically patched to skip the missing `services/auth-service` directory, this script's Nginx step would still write to a file that isn't part of the protected/active set — a second, independent reason it should stay retired rather than resurrected.

### `deploy-session6.sh` — historical, single-purpose, still individually runnable

"Phase 8" (per its own header comment, `:3`) — ships Aviator admin-configurable economics and `special_rules` JSONB merge. Builds `game-engines/aviator` and `admin-service`, plus a workaround install of `dotenv` into both (`npm install dotenv --no-audit --no-fund`, `:32,38` — comment notes it's "imported via `dotenv/config` but not in `package.json`", implying a real missing-dependency bug in those two services' `package.json` files at the time this was written; worth re-checking whether that's still true today since it's patched around here rather than fixed at the source). Builds the admin panel with an explicit `--base=/admin/` Vite flag (`:45`) that none of the other deploy scripts pass — worth noting if admin-panel routing ever breaks after using a *different* deploy script to rebuild it. Restarts only `teen-aviator` and `teen-admin-svc` (`:48`).

Its Nginx step is comment-only, not automated: `"paste that block into: .../nginx.ssl.conf_proxy"` (`:52-55`) — the **same wrong filename** (`nginx.ssl.conf_proxy`) as `deploy-hestia.sh`, not the current `nginx.ssl.conf_api`. If anyone ever followed this comment literally today, the pasted block would land in a file Hestia doesn't serve from and `nginx-protect.sh` doesn't protect, so it would silently do nothing.

This script is safe to run in isolation (it only touches Aviator + admin-service + admin panel, same shape as the current live path) but is superseded — everything it built has long since been folded into later commits/releases, and its Nginx instructions are stale.

### `deploy-gateway-friends-matchmaking.sh` — historical, narrow, technically still correct

Builds and restarts only `game-gateway` (`:28-34`) for the private-friends-tables/matchmaking feature. No stale service names, no Nginx changes, no DB migration step. Still accurate and harmless to run today (it would just rebuild and restart the gateway from whatever's currently checked out) — but redundant, since the current live path (`deploy-all-services.sh`) already rebuilds and restarts `game-gateway` as part of every release.

### `bootstrap-vps.sh` — one-time fresh-VPS setup, mostly idempotent but not what production actually needed

Installs Node 20, Go 1.22.5, Docker/Compose, Nginx+Certbot, PM2 globally, creates `/opt/teen`, opens the firewall (`ufw allow 22/80/443`, `:36-38`). Most individual steps are safe to re-run (NodeSource setup script, `apt-get install` calls, `ufw allow` on an already-allowed port, PM2 global install) — the one step that isn't purely idempotent is the unconditional `apt-get update && apt-get upgrade -y` at the very top (`:5`), which on an already-running production box could pull in kernel/OpenSSL/etc. updates and restart system daemons unexpectedly if re-run casually.

More importantly: **this script never installs HestiaCP**, yet every later deploy script (`deploy-services.sh`, `deploy-hestia.sh`) branches on `[ -d "$HESTIA_NGINX_DIR" ]`/`$NGINX_CONF_DIR`, and the currently-protected live Nginx config path (`/home/admin/conf/web/game.myonlinejoker.com/`, per `nginx-protect.sh:10`) is a HestiaCP layout. Whatever installed HestiaCP on the current production box, it wasn't this script — `bootstrap-vps.sh` documents a vanilla-Ubuntu-plus-plain-Nginx setup that doesn't match the Hestia-managed reality the other scripts (and `nginx-protect.sh`) clearly assume. Anyone re-running `bootstrap-vps.sh` against a fresh box expecting it to reproduce today's production environment would still need to separately install and configure HestiaCP by hand afterward.

### `create-env-files.sh` — one-time env bootstrap, generates shared secrets

Generates one `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `INTERNAL_SERVICE_KEY` via `openssl rand -hex 32` and stamps the same three values into every service's `.env` (copied from `.env.example`, only if `.env` doesn't already exist) so that, per its own comment, no two services ever disagree on the shared secrets. It then hand-builds `.env` files for the Aviator, Ludo, and (added 2026-07-29) Teen Patti engines via heredoc, reusing the same generated `JWT_SECRET`/`INTERNAL_SERVICE_KEY`.

It is safe to re-run against an already-provisioned box (the `[ ! -f "$ENV_DEST" ]` guard means it never overwrites an existing `.env`, so it can't silently rotate secrets underneath a running deployment).

Fixed 2026-07-29 (was `docs/Bugs/create-env-files-excludes-core-api-from-shared-secrets.md`): `BASE` now points at `/opt/teen-prod`, and `SERVICES` was `(auth-service user-service wallet-service game-gateway betting-service leaderboard-service notification-service admin-service)` — five pre-consolidation names that don't exist under `services/` at all (silently skipped by the `[ -f "$ENV_EXAMPLE" ]` guard, so this failed quietly rather than loudly) plus three that do, and **no `core-api-service` entry anywhere** — the service that actually signs JWTs and validates `INTERNAL_SERVICE_KEY`. A fresh run would have generated and propagated the shared secrets into `wallet-service`/`game-gateway`/`admin-service` but never `core-api-service` itself, defeating the script's own stated purpose. Now `(core-api-service wallet-service game-gateway admin-service monitoring-service risk-service churn-service app-monitor-service bot-learning-service)` — the complete current list of services that both have a `.env.example` and need the shared secrets. `bot-learning-service`'s inclusion here isn't hypothetical: its missing `INTERNAL_SERVICE_KEY` was hit live on this same 2026-07-29 pass (see `docs/backend-services/bot-learning-service/backend.md`) and had to be patched into its VPS `.env` by hand before this script fix existed — a fresh VPS provisioned before this fix would have hit the identical gap. The Teen Patti engine also never got a generated `.env` at all before this fix (only Aviator and Ludo had hand-built heredocs) — a fresh box would have silently run it on the hardcoded fallback DB/Redis credentials baked into `main.go` (see `docs/backend-services/teen-patti-engine/overview.md`) rather than the generated ones.

## The two other GitHub Actions workflows

### `.github/workflows/deploy-admin-pages.yml`

Triggers automatically on push to `claude/confident-archimedes-e2dd1k` or `main` when `admin-panel/**` changes (`:4-8`), or manually. Builds the admin panel with `ADMIN_BASE=/teen/` and `VITE_ROUTER_BASE=/teen` (`:35-37`) and publishes it to **GitHub Pages**, not the VPS — a completely separate deployment target from the production admin panel served at `/admin/` out of `/home/admin/web/game.myonlinejoker.com/public_html/admin/`. It copies `dist/index.html` to `dist/404.html` for SPA-style deep-link fallback on Pages (`:41`). This is best understood as a public preview/demo mirror of the admin panel under `/<repo>/` on GitHub's own domain — it has no bearing on what's actually running on `game.myonlinejoker.com/admin/`, and nothing here updates the VPS.

### `.github/workflows/build-apk.yml`

Triggers automatically on push to `main`/`claude/confident-archimedes-e2dd1k` touching `mobile/**`, or manually (`:4-8`). Sets up Java 17 + Flutter 3.44.3 (`:20-31`), verifies the committed `google-services.json` parses as JSON without overwriting it from a secret (`:33-42`), writes `lib/core/constants/app_config.dart` from `API_BASE_URL`/`SOCKET_URL`/`RAZORPAY_KEY_ID` secrets with production fallbacks and whitespace-trimming (`:44-69`), then runs `flutter build apk --release --split-per-abi --dart-define=MONITOR_SECRET_KEY=$MONITOR_SECRET_KEY` (`:79`, matching the build command CLAUDE.md documents) and uploads the two split APKs as a 30-day GitHub Actions artifact (`:81-88`) — arm64-v8a and armeabi-v7a only, no x86_64 build.

This workflow **only produces a downloadable Actions artifact** — it does not publish the APK anywhere a real device could reach automatically (e.g. `infra/nginx/game.myonlinejoker.com.conf:131-135`'s `/downloads/` location, which serves whatever file already sits in `/opt/teen/downloads/` on the VPS). Getting a freshly-built APK in front of end users still requires a manual download-from-Actions-then-upload-via-the-App-Update-admin-page step that no script in this repo automates (that admin-page upload previously had its own bug — every version overwriting the same file — fixed 2026-07-28, see `docs/admin-panel/app-update/overview.md`).

## Inferred chronology of the deploy scripts

Based on which services each script's build list/`SERVICES` array knows about (oldest → newest): `deploy-hestia.sh` (pre-merge five-service split, no ML/observability services) → `deploy-services.sh` (post-merge, adds `monitoring-service`/`risk-service`/`churn-service`/`bot-learning-service`/`app-monitor-service`, still carries dead pre-merge names) → `deploy-session6.sh` ("Phase 8," Aviator economics) → `deploy-gateway-friends-matchmaking.sh` → `deploy-tip-gifts-botfill.sh` → `deploy-all-services.sh` (current, called by `go.sh`, added 2026-07-29). Nothing in the repo enforces retiring a script once superseded — they all stay executable side by side in the same directory.

## Findings from the 2026-07-28 pass, fixed 2026-07-29

- **`docs/Bugs/deploy-pipeline-live-path-skips-most-pm2-services.md`** (was High) — the only automated backend-deploy path rebuilt and restarted exactly 2 of `ecosystem.config.js`'s PM2 processes (`teen-gateway`, `teen-admin-svc`) plus the admin panel; any change to `core-api-service`, `wallet-service`, the Aviator/Ludo/Teen-Patti engines, or any of the five observability/ML services required manually running a different script that CI never called. Fixed by replacing what `go.sh` calls with `deploy-all-services.sh` (above), which rebuilds and individually restarts every PM2 app on every deploy.
- **`docs/Bugs/create-env-files-excludes-core-api-from-shared-secrets.md`** (was High) — fixed as detailed in the `create-env-files.sh` section above.
- While fixing the above, also found and fixed a bug neither doc had caught: `go.sh`/`deploy-backend.yml` targeted `/opt/teen`, which turned out to not be the directory anything is actually served from at all — see "`/opt/teen` vs `/opt/teen-prod`" at the top of this doc. Not filed as a separate bug since it's inseparable from the same fix.

`docs/Bugs/deploy-backend-health-check-checks-nothing.md` (Medium) remains open — unrelated to the above, still worth its own pass: `deploy-backend.yml`'s post-deploy `curl -f http://.../health` targets a `/health` location that only exists in the non-Hestia `infra/nginx/game.myonlinejoker.com.conf` variant (a static `return 200` with no backend check at all) and is absent entirely from `infra/nginx/hestia-proxy.conf` — the config `nginx-protect.sh` actively keeps live on the current HestiaCP setup. The check either always passes without exercising any backend, or fails on every run depending on Hestia's default-vhost behavior for an unmatched path. (Confirmed live, 2026-07-29: a plain `curl http://localhost/health` against the VPS returned nothing/connection-refused; verification that a deploy actually worked was done by SSHing in and checking `pm2 jlist`/build timestamps directly instead of trusting this check.)

See `docs/infra/nginx.md` for the full Nginx picture (HestiaCP vs. plain-Nginx branch, the `/ws` vs `/ws/aviator` routes, and `nginx-protect.sh`'s drift-correction cron) and `docs/infra/db-migrations.md` for how `infra/db/migrate.sh`'s tracked migrations relate to the ad hoc `docker exec ... psql` calls scattered through these deploy scripts.
