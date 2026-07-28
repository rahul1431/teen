# Deploy Pipeline

`infra/deploy/` holds eight shell scripts plus one SSH public key file. They were written at different points in the project's history, each named after the feature branch or phase that introduced it (per root `CLAUDE.md`), and **none of them has been deleted as the topology moved on** — five of the eight scripts reference services, ports, or nginx filenames that are no longer accurate for the current `ecosystem.config.js`/`services/` layout. This doc traces the one path that is actually live, then goes through every other file and states plainly whether it's still safe to run, superseded-but-harmless, or a landmine.

## The current live path, traced end-to-end

```
.github/workflows/deploy-backend.yml  (workflow_dispatch only)
  └─ ssh: git pull + bash infra/deploy/go.sh
       └─ go.sh: install SSH key, then bash deploy-tip-gifts-botfill.sh
            └─ deploy-tip-gifts-botfill.sh: migration 029, config UPDATE,
               build game-gateway + admin-service, pm2 restart (2 processes),
               build admin-panel, copy dist/ to webroot
```

### `.github/workflows/deploy-backend.yml`

`on: workflow_dispatch` only (`:3-4`) — **this does not run automatically on push**, unlike the other two workflows below. Someone has to manually trigger it from the Actions tab (or `gh workflow run`). The job (`:16-28`) SSHes into `secrets.VPS_HOST` with a **password** (`appleboy/ssh-action@v1.0.3`, `password: ${{ secrets.VPS_PASSWORD }}`, `:19-21`) — not a key — and runs:
```
cd /opt/teen
git stash
git pull origin claude/confident-archimedes-e2dd1k
bash infra/deploy/go.sh
pm2 status
```
`git stash` before pulling (`:25`) means any uncommitted on-VPS edits (e.g. a hotfixed `.env` or an ad hoc config tweak made directly on the box) are silently stashed and left behind, not applied — a real risk if anyone has ever hand-edited a file in `/opt/teen` outside git, since the stash is never popped by this workflow or by `go.sh`.

### `infra/deploy/go.sh`

Two jobs, in order (`go.sh:1-22`):
1. **Install the workstation SSH key.** `rahul-workstation.pub` (a single `ssh-rsa ... gamezone-vps` line — no private key in the repo, just the public half) is appended into `/root/.ssh/authorized_keys` after first stripping any existing line containing the literal string `"gamezone-vps"` (`:13`, via `grep -v`). This is what CLAUDE.md means by "installs the workstation SSH key" — it's re-run on **every** `go.sh` invocation (every manual workflow dispatch), each time rewriting `/root/.ssh/authorized_keys` from scratch (`mv /tmp/ak /root/.ssh/authorized_keys`, `:15`) after filtering out the old `gamezone-vps` entry and re-appending the current committed key. It's idempotent for this one key specifically, but note it operates on `/root/.ssh/authorized_keys` as **root**, and any other keys with `gamezone-vps` in their comment (not just this exact key) would also be stripped by the same `grep -v` line.
2. **Run the release deploy**: `bash "$REPO/infra/deploy/deploy-tip-gifts-botfill.sh"` (`:21`). This is the "whatever `go.sh` currently points to" that CLAUDE.md flags as needing verification — as of this pass, it points at `deploy-tip-gifts-botfill.sh`, not any of the other candidates in the directory.

### `infra/deploy/deploy-tip-gifts-botfill.sh` — the actual release script

Step by step (`:24-67`):
1. `git fetch`/`checkout`/`pull` the `claude/confident-archimedes-e2dd1k` branch explicitly (`:26-29`) — hardcoded branch name, not "whatever branch is currently checked out."
2. Apply migration `029_tip_dealer_drop_gifts.sql` directly via `docker exec -i teen_postgres psql ... < 029_tip_dealer_drop_gifts.sql`, swallowing any error with `|| echo "(029 may already be applied)"` (`:31-34`). This bypasses `infra/db/migrate.sh`'s tracking table entirely (see `docs/infra/db-migrations.md`) — it never inserts a `schema_migrations` row for `029`, so a later run of `migrate.sh` would still consider `029` unapplied and attempt it again (harmless only because this script's own `|| echo` already tolerates the re-run, but the two migration mechanisms are not reconciled with each other).
3. A raw `UPDATE game_configs SET bot_fill_table_size = 4, bot_fill_enabled = true WHERE game_type = 'teen_patti'` (`:37-38`) — a manual data fix baked into a deploy script rather than a migration file, so it will silently re-apply (harmlessly, since it's idempotent by construction) on every future run of this same script, forever, even though the intent was clearly one-time.
4. **Builds exactly two services**: `services/game-gateway` and `services/admin-service` (`npm install` + `npm run build` each, `:40-48`).
5. **Restarts exactly two PM2 processes**: `pm2 restart teen-gateway teen-admin-svc --update-env` (`:51`).
6. Builds `admin-panel` and copies `dist/.` into `/home/admin/web/game.myonlinejoker.com/public_html/admin/` (`:53-57`) — confirms the webroot path CLAUDE.md documents.
7. A health check that's really just a status/log dump (`pm2 status` + `pm2 logs teen-gateway --lines 10 --nostream`, `:60-62`) — nothing asserts on the output; the script exits 0 regardless of what those logs show.

**This script never touches**: `core-api-service`, `wallet-service`, the Aviator/Ludo/Teen-Patti engines, `monitoring-service`, `risk-service`, `churn-service`, `churn-ml-service`, `app-monitor-service`, or `bot-learning-service` — nine of `ecosystem.config.js`'s thirteen PM2 apps. See "New findings" below — this is the central drift in the current deploy pipeline, not a hypothetical.

### `infra/deploy/rahul-workstation.pub`

A single public key line (`ssh-rsa AAAAB3... gamezone-vps`). No corresponding private key is in the repo (expected — it's the public half only). It exists solely so `go.sh` can install it into `/root/.ssh/authorized_keys` on every run (above). There is no script that ever *removes* an old workstation key if it's rotated — rotation would mean editing this file in place and relying on the next `go.sh` run's `grep -v "gamezone-vps"` to replace the old line, which only works because the comment string stays `gamezone-vps` across rotations.

## Every other script in `infra/deploy/`

### `deploy-services.sh` — full-fleet rebuild, functionally correct today but **not** what CI calls

Builds every current Node service by name (`core-api-service`, `wallet-service`, `game-gateway`, `admin-service`, `monitoring-service`, `risk-service`, `churn-service`, `bot-learning-service`, `app-monitor-service` — `:6`) plus the Aviator/Ludo/Teen-Patti engines and the Churn-ML venv, then the admin panel, then Nginx, then DB, then **`pm2 delete all` followed by `pm2 start ecosystem.config.js`** (`:95-96`).

- The `SERVICES` array (`:6`) still lists four names that don't exist anywhere under `services/` anymore — `auth-service`, `user-service`, `betting-service`, `leaderboard-service`, `notification-service` (confirmed: `services/` has no such directories; they live only in `archive_microservices/` per root `CLAUDE.md`, except `auth-service`, which isn't archived under that name at all). This is harmless *only* because of the explicit guard at `:10` (`if [ -d "$BASE/services/$svc" ]`) — each stale entry just prints "Skipping $svc (directory does not exist)" and moves on. Net effect: the script still correctly builds every service that's actually deployed today; the stale names are cosmetic noise, not a functional bug.
- **`pm2 delete all` (`:95`) is a real landmine if this script is run against a live production VPS out of habit.** Unlike the current live path's targeted `pm2 restart teen-gateway teen-admin-svc`, this line tears down **all thirteen** PM2 processes before restarting them from `ecosystem.config.js` — every game, the wallet, everything — causing a brief full-platform outage rather than a scoped restart of what actually changed. It reads like "the deploy script" a new operator would reach for by default; it is not the one CI uses, and it is considerably more disruptive.
- Its Nginx logic correctly detects HestiaCP (`if [ -d "$HESTIA_NGINX_DIR" ]`, `:66`) and writes to `nginx.conf_api` **and** `nginx.ssl.conf_api` (`:68-69`) — this is the *correct* current filename convention: `infra/scripts/nginx-protect.sh:3,17` (a cron job) restores exactly these two filenames every 30 minutes if they drift, and `infra/nginx/hestia-proxy.conf:2-3`'s own header comment names the same two paths. So despite the stale `SERVICES` array, this script's Nginx step is accurate and current — see `docs/infra/nginx.md` for the full Nginx picture.
- Its DB-migration loop (`:87-91`) applies every file in `infra/db/migrations/*.sql` unconditionally with a bare `|| echo "(may already be applied)"` fallback — it does **not** use `infra/db/migrate.sh`'s `schema_migrations` tracking table at all (see `docs/infra/db-migrations.md`), so re-running this script re-attempts every migration from `001` onward every time, relying entirely on each `.sql` file being safely re-runnable rather than any tracked state.
- Bottom line: this is a legitimate, still-working "deploy everything from scratch/re-sync everything" script — but it is **not** wired into any CI workflow, and running it against the live box causes real (if brief) downtime across every service, not just the two the current release actually changed.

### `deploy-hestia.sh` — superseded, effectively dead, fails fast rather than corrupting state

`SERVICES=(auth-service user-service wallet-service game-gateway leaderboard-service notification-service admin-service)` (`:10`) — **the pre-merge five-service split**, with no `core-api-service` entry anywhere, confirming this predates the consolidation into `core-api-service`. Critically, unlike `deploy-services.sh`, there is **no directory-existence guard** — the loop (`:11-16`) does a bare `cd "$BASE/services/$svc"` for every name in the array. Since the script has `set -e` (`:5`) and `auth-service` is the first entry and does not exist under `services/` today, `cd` fails immediately, the script aborts on its very first loop iteration, and nothing after that point (including its own `pm2 delete all` at `:51`) ever executes. So this script is dead in the sense that it cannot complete a single run today, but it's a *safe* kind of dead — it fails loudly and immediately rather than partially applying a broken deploy.

It also writes Nginx's Hestia custom config to `nginx.conf_proxy` (`:36`) — a filename that matches **neither** the current convention (`nginx.conf_api`/`nginx.ssl.conf_api`, confirmed by `nginx-protect.sh` and `hestia-proxy.conf`'s own header) nor anything Hestia's panel-generated vhost template is shown anywhere in this repo to include. Even hypothetically patched to skip the missing `services/auth-service` directory, this script's Nginx step would still write to a file that isn't part of the protected/active set — a second, independent reason it should stay retired rather than resurrected.

### `deploy-session6.sh` — historical, single-purpose, still individually runnable

"Phase 8" (per its own header comment, `:3`) — ships Aviator admin-configurable economics and `special_rules` JSONB merge. Builds `game-engines/aviator` and `admin-service`, plus a workaround install of `dotenv` into both (`npm install dotenv --no-audit --no-fund`, `:32,38` — comment notes it's "imported via `dotenv/config` but not in `package.json`", implying a real missing-dependency bug in those two services' `package.json` files at the time this was written; worth re-checking whether that's still true today since it's patched around here rather than fixed at the source). Builds the admin panel with an explicit `--base=/admin/` Vite flag (`:45`) that none of the other deploy scripts pass — worth noting if admin-panel routing ever breaks after using a *different* deploy script to rebuild it. Restarts only `teen-aviator` and `teen-admin-svc` (`:48`).

Its Nginx step is comment-only, not automated: `"paste that block into: .../nginx.ssl.conf_proxy"` (`:52-55`) — the **same wrong filename** (`nginx.ssl.conf_proxy`) as `deploy-hestia.sh`, not the current `nginx.ssl.conf_api`. If anyone ever followed this comment literally today, the pasted block would land in a file Hestia doesn't serve from and `nginx-protect.sh` doesn't protect, so it would silently do nothing.

This script is safe to run in isolation (it only touches Aviator + admin-service + admin panel, same shape as the current live path) but is superseded — everything it built has long since been folded into later commits/releases, and its Nginx instructions are stale.

### `deploy-gateway-friends-matchmaking.sh` — historical, narrow, technically still correct

Builds and restarts only `game-gateway` (`:28-34`) for the private-friends-tables/matchmaking feature. No stale service names, no Nginx changes, no DB migration step. Still accurate and harmless to run today (it would just rebuild and restart the gateway from whatever's currently checked out) — but redundant, since the current live path (`deploy-tip-gifts-botfill.sh`) already rebuilds and restarts `game-gateway` as part of every release.

### `bootstrap-vps.sh` — one-time fresh-VPS setup, mostly idempotent but not what production actually needed

Installs Node 20, Go 1.22.5, Docker/Compose, Nginx+Certbot, PM2 globally, creates `/opt/teen`, opens the firewall (`ufw allow 22/80/443`, `:36-38`). Most individual steps are safe to re-run (NodeSource setup script, `apt-get install` calls, `ufw allow` on an already-allowed port, PM2 global install) — the one step that isn't purely idempotent is the unconditional `apt-get update && apt-get upgrade -y` at the very top (`:5`), which on an already-running production box could pull in kernel/OpenSSL/etc. updates and restart system daemons unexpectedly if re-run casually.

More importantly: **this script never installs HestiaCP**, yet every later deploy script (`deploy-services.sh`, `deploy-hestia.sh`) branches on `[ -d "$HESTIA_NGINX_DIR" ]`/`$NGINX_CONF_DIR`, and the currently-protected live Nginx config path (`/home/admin/conf/web/game.myonlinejoker.com/`, per `nginx-protect.sh:10`) is a HestiaCP layout. Whatever installed HestiaCP on the current production box, it wasn't this script — `bootstrap-vps.sh` documents a vanilla-Ubuntu-plus-plain-Nginx setup that doesn't match the Hestia-managed reality the other scripts (and `nginx-protect.sh`) clearly assume. Anyone re-running `bootstrap-vps.sh` against a fresh box expecting it to reproduce today's production environment would still need to separately install and configure HestiaCP by hand afterward.

### `create-env-files.sh` — one-time env bootstrap, generates shared secrets but for a stale service list (see new finding below)

Generates one `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `INTERNAL_SERVICE_KEY` via `openssl rand -hex 32` (`:13-15`) and stamps the same three values into every service's `.env` (copied from `.env.example`, only if `.env` doesn't already exist — `:20`) so that, per its own comment (`:8-12`), no two services ever disagree on the shared secrets. It then hand-builds `.env` files for the Aviator and Ludo engines via heredoc (`:32-56`), reusing the same generated `JWT_SECRET`/`INTERNAL_SERVICE_KEY`.

It is safe to re-run against an already-provisioned box (the `[ ! -f "$ENV_DEST" ]` guard means it never overwrites an existing `.env`, so it can't silently rotate secrets underneath a running deployment) — but see the new finding below for why running it fresh today would produce a broken topology.

## The two other GitHub Actions workflows

### `.github/workflows/deploy-admin-pages.yml`

Triggers automatically on push to `claude/confident-archimedes-e2dd1k` or `main` when `admin-panel/**` changes (`:4-8`), or manually. Builds the admin panel with `ADMIN_BASE=/teen/` and `VITE_ROUTER_BASE=/teen` (`:35-37`) and publishes it to **GitHub Pages**, not the VPS — a completely separate deployment target from the production admin panel served at `/admin/` out of `/home/admin/web/game.myonlinejoker.com/public_html/admin/`. It copies `dist/index.html` to `dist/404.html` for SPA-style deep-link fallback on Pages (`:41`). This is best understood as a public preview/demo mirror of the admin panel under `/<repo>/` on GitHub's own domain — it has no bearing on what's actually running on `game.myonlinejoker.com/admin/`, and nothing here updates the VPS.

### `.github/workflows/build-apk.yml`

Triggers automatically on push to `main`/`claude/confident-archimedes-e2dd1k` touching `mobile/**`, or manually (`:4-8`). Sets up Java 17 + Flutter 3.44.3 (`:20-31`), verifies the committed `google-services.json` parses as JSON without overwriting it from a secret (`:33-42`), writes `lib/core/constants/app_config.dart` from `API_BASE_URL`/`SOCKET_URL`/`RAZORPAY_KEY_ID` secrets with production fallbacks and whitespace-trimming (`:44-69`), then runs `flutter build apk --release --split-per-abi --dart-define=MONITOR_SECRET_KEY=$MONITOR_SECRET_KEY` (`:79`, matching the build command CLAUDE.md documents) and uploads the two split APKs as a 30-day GitHub Actions artifact (`:81-88`) — arm64-v8a and armeabi-v7a only, no x86_64 build.

This workflow **only produces a downloadable Actions artifact** — it does not publish the APK anywhere a real device could reach automatically (e.g. `infra/nginx/game.myonlinejoker.com.conf:131-135`'s `/downloads/` location, which serves whatever file already sits in `/opt/teen/downloads/` on the VPS). Getting a freshly-built APK in front of end users still requires a manual download-from-Actions-then-upload-via-the-App-Update-admin-page step that no script in this repo automates (that admin-page upload previously had its own bug — every version overwriting the same file — fixed 2026-07-28, see `docs/admin-panel/app-update/overview.md`).

## Inferred chronology of the deploy scripts

Based on which services each script's build list/`SERVICES` array knows about (oldest → newest): `deploy-hestia.sh` (pre-merge five-service split, no ML/observability services) → `deploy-services.sh` (post-merge, adds `monitoring-service`/`risk-service`/`churn-service`/`bot-learning-service`/`app-monitor-service`, still carries dead pre-merge names) → `deploy-session6.sh` ("Phase 8," Aviator economics) → `deploy-gateway-friends-matchmaking.sh` → `deploy-tip-gifts-botfill.sh` (current, called by `go.sh`). Nothing in the repo enforces retiring a script once superseded — they all stay executable side by side in the same directory.

## New findings from this pass

- **`docs/Bugs/deploy-pipeline-live-path-skips-most-pm2-services.md`** — High: the only automated backend-deploy path (`deploy-backend.yml` → `go.sh` → `deploy-tip-gifts-botfill.sh`) rebuilds and restarts exactly 2 of `ecosystem.config.js`'s 13 PM2 processes (`teen-gateway`, `teen-admin-svc`) plus the admin panel; any change to `core-api-service`, `wallet-service`, the Aviator/Ludo/Teen-Patti engines, or any of the five observability/ML services requires manually running a different script (`deploy-services.sh`) that CI never calls.
- **`docs/Bugs/deploy-backend-health-check-checks-nothing.md`** — Medium: `deploy-backend.yml`'s post-deploy `curl -f http://.../health` targets a `/health` location that only exists in the non-Hestia `infra/nginx/game.myonlinejoker.com.conf` variant (a static `return 200` with no backend check at all) and is absent entirely from `infra/nginx/hestia-proxy.conf` — the config `nginx-protect.sh` actively keeps live on the current HestiaCP setup. The check either always passes without exercising any backend, or fails on every run depending on Hestia's default-vhost behavior for an unmatched path.
- **`docs/Bugs/create-env-files-excludes-core-api-from-shared-secrets.md`** — High: `create-env-files.sh`'s `SERVICES` array (`:6`) never includes `core-api-service` — the service that actually signs JWTs and validates `INTERNAL_SERVICE_KEY` today — so a fresh run of this script would generate and propagate `JWT_SECRET`/`JWT_REFRESH_SECRET`/`INTERNAL_SERVICE_KEY` into `wallet-service`, `game-gateway`, and `admin-service` but never into `core-api-service` itself, defeating the script's own stated purpose. It also never creates `services/game-engines/teen-patti/.env` (only Aviator and Ludo get hand-built heredocs), so a fresh box would silently run the Teen Patti engine on its hardcoded fallback DB/Redis credentials (see `docs/backend-services/teen-patti-engine/overview.md`) rather than the generated ones.

See `docs/infra/nginx.md` for the full Nginx picture (HestiaCP vs. plain-Nginx branch, the `/ws` vs `/ws/aviator` routes, and `nginx-protect.sh`'s drift-correction cron) and `docs/infra/db-migrations.md` for how `infra/db/migrate.sh`'s tracked migrations relate to the ad hoc `docker exec ... psql` calls scattered through these deploy scripts.
