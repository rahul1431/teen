# PM2 Ecosystem — Process Management Layer

This document covers the *process management* layer only: what PM2 is asked to run, how, and with what safety nets — not the internals of any individual service (see `docs/backend-services/*/` for that) or any individual game's behavior (see `docs/games/*/`). Source of truth: `ecosystem.config.js` (root, 189 lines), `docker-compose.yml` (root, 61 lines), `infra/config/*`, `infra/scripts/pm2-alert.sh`, `infra/local-dev/`.

## Why PM2, not Docker/Kubernetes

CLAUDE.md states this directly: "Production runs on a single VPS via PM2 (`ecosystem.config.js`), not Docker/Kubernetes — `docker-compose.yml` exists but is not the deploy path." The repo backs this up structurally rather than just by assertion: there is no `Dockerfile` anywhere in the tree for any of the 13 application services (`find . -iname "Dockerfile*"` outside `node_modules` returns nothing), so there is no image to run under Kubernetes/Compose even if someone wanted to — `docker-compose.yml` only ever defines the two stateful backing stores (Postgres, Redis; see below), never the application tier. PM2 fills the role a container orchestrator would otherwise: process supervision (auto-restart on crash), memory-based restart limits, log capture, and `pm2 startup systemd` for boot-time resurrection. For a single-VPS deployment with no need for cross-host scheduling, this is a reasonable, low-ceremony choice — but it also means every safety property a real orchestrator gives you for free (rolling restarts, readiness gates, resource cgroups, network policy) is either reimplemented ad hoc in shell scripts under `infra/deploy/` or simply absent.

## The process list

`ecosystem.config.js` defines exactly **13 apps** in its `apps` array (lines 20–189). Every single one uses `exec_mode: 'fork'` and `instances: 1` — there is no cluster-mode process in this file at all.

| PM2 name | Port | Script | Mem limit | Env mechanism |
|---|---|---|---|---|
| `teen-core-api` | 3001 | `dist/index.js` | 350M | `env_file` |
| `teen-wallet` | (from `.env`) | `dist/index.js` | 200M | `env_file` |
| `teen-gateway` | (from `.env`) | `dist/index.js` | 300M | `env_file` |
| `teen-aviator` | (from `.env`) | `dist/index.js` | 200M | `env_file` |
| `teen-ludo` | (from `.env`) | `dist/index.js` | 200M | `env_file` |
| `teen-tp-engine` | 3010 | `./teen-patti-engine` (Go binary, `interpreter: 'none'`) | 200M | `LOAD_ENV()` (custom) |
| `teen-admin-svc` | (from `.env`) | `dist/index.js` | 250M | `env_file` |
| `teen-monitoring` | (from `.env`) | `dist/index.js` | 150M | `env_file` |
| `teen-risk` | (from `.env`) | `dist/index.js` | 150M | `env_file` |
| `teen-churn` | (from `.env`) | `dist/index.js` | 150M | `env_file` |
| `teen-churn-ml` | 3020 (hardcoded in `args`) | `venv/bin/uvicorn` (`interpreter: 'none'`) | **none set** | `process.env` passthrough (no `env_file`) |
| `teen-app-monitor` | 3015 (hardcoded in `env`) | `dist/index.js` | 150M | `env_file` + inline `env` overrides |
| `teen-bot-learning` | (from `.env`) | `dist/index.js` | 150M | `env_file` |

Every Node app also gets `NODE_OPTIONS: '--max-old-space-size=120'` via the shared `NODE_OPTS` constant (`ecosystem.config.js:18`). This caps the V8 heap at 120MB, but that is a *different* ceiling than `max_memory_restart` (200M–350M): `max-old-space-size` bounds only the JS heap, while `max_memory_restart` is PM2's RSS-based kill switch and includes native/Buffer/off-heap memory. The two are complementary, not redundant — a process can be well under its 120MB heap cap and still get killed by PM2 for exceeding, say, 200MB RSS from native Buffers or a large number of open sockets. `teen-tp-engine`, being a Go binary, gets neither `NODE_OPTS` nor `env_file` — see below.

Per CLAUDE.md, `services/game-engines/rummy` is `"planned"` in `games/registry.json` and has no PM2 entry (correctly absent, since nothing exists to run). Two more directories under `services/` — `ab-experiment-service` and `model-server` — are also absent from `ecosystem.config.js`, and correctly so: both contain only a leftover `.pytest_cache/` directory (`services/ab-experiment-service/.pytest_cache/`, `services/model-server/.pytest_cache/`) with zero tracked files (`git ls-files services/model-server` and `git ls-files services/ab-experiment-service` both return nothing) — there is no source to build or run for either. CLAUDE.md documents `ab-experiment-service`'s stub status explicitly but doesn't mention `model-server` at all; it's the same situation.

`uptime-bot`, which CLAUDE.md lists among the "Node/TypeScript services" with its own `npm run dev`/`build`/`start` workflow, **is** present here: `services/uptime-bot/` is fully tracked (`src/index.ts`, `package.json`, `package-lock.json`, `tsconfig.json`) and `ecosystem.config.js` has a `teen-uptime-bot` block (`cwd: ${BASE}/uptime-bot`, `script: 'dist/index.js'`, `env_file`, `max_memory_restart: '100M'`), confirmed running live on the VPS. (An earlier documentation pass on a different branch, `claude/confident-archimedes-e2dd1k`, found this source untracked there — that finding doesn't apply on `feature/admin-responsive`.)

### Fork mode everywhere — and specifically why cluster mode would be unsafe for this platform

Two comments in `ecosystem.config.js` are direct evidence of a **past incident**, not just current preference:
- `teen-gateway`'s block is prefaced `// ── Game Gateway: WebSocket hub — 1 instance (was cluster max=3) ──` (`ecosystem.config.js:48`).
- `infra/config/vps-apply-optimizations.sh:25` carries the same history forward: `# gateway now runs 1 instance; bot-learning is disabled`.

This is verifiably the correct call, not just caution: `game-gateway` is a Socket.IO hub (CLAUDE.md: "Socket.IO/WebSocket hub for matchmaking, room state, and realtime broadcast... shared broadcast infrastructure used by all games"), and a grep of `services/game-gateway/src/*.ts` and its `package.json` for any Socket.IO cross-instance adapter (`@socket.io/redis-adapter`, `createAdapter`, sticky-session config) turns up nothing. Without a shared adapter, each PM2 cluster worker would hold its own independent in-memory Socket.IO room registry — a broadcast triggered by an event handled on worker A would simply never reach a client whose WebSocket happens to be pinned to worker B. Running this service under `exec_mode: 'cluster'` with `instances: 3` (its former configuration, per the comment) would silently drop broadcasts for roughly two-thirds of connected clients depending on load-balancer assignment — consistent with why it was walked back to `instances: 1`. The same reasoning generalizes to every other app in this file: `teen-wallet` (comment: "critical financial service, keep isolated"), `teen-tp-engine` (per `docs/backend-services/teen-patti-engine/overview.md`, holds no in-memory per-room state and reads/writes Redis on every request — see that doc for why multi-instance would still be dangerous there for a different reason, the missing Redis lock on the read-modify-write), and `teen-admin-svc` (comment: "keep separate — 2300+ lines with multipart KYC upload") are all fork/1 for reasons specific to each service's state model, not a blanket policy. There is currently no service in this file for which cluster mode would be safe to enable without first adding cross-instance state coordination.

## `LOAD_ENV()` — the Go binary's dotenv workaround

Already documented in full in `docs/backend-services/teen-patti-engine/overview.md` ("Deployment" section) — this section only confirms that documentation against the current `ecosystem.config.js` source and doesn't re-derive it. Verified current source (`ecosystem.config.js:1–17`):

```js
const BASE = '/opt/teen/services'
const ENV_FILE = (svc) => `${BASE}/${svc}/.env`

const LOAD_ENV = (svc) => {
  const out = {}
  try {
    for (const line of fs.readFileSync(ENV_FILE(svc), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !m[1].startsWith('#')) out[m[1]] = m[2]
    }
  } catch (_) { /* no .env — fall back to defaults baked into the binary */ }
  return out
}
```

`teen-tp-engine`'s app entry (`ecosystem.config.js:84–94`) is the only consumer: `env: { PORT: '3010', ...LOAD_ENV('game-engines/teen-patti') }`. As the existing doc lays out, the operational gotcha is that `LOAD_ENV()` executes exactly once, at the moment Node evaluates `ecosystem.config.js` itself (i.e., at `pm2 start`/`pm2 reload ecosystem.config.js`) — so `pm2 restart teen-tp-engine --update-env` does **not** pick up a `.env` edit; it only re-applies whatever static `env` object PM2 already has cached from the last full reload. A full `pm2 reload ecosystem.config.js` (or delete+start) is required. This document adds one thing not already covered there: `LOAD_ENV()`'s regex-based line parser (`/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/`) has no quoting/escaping support — a value containing an `=` sign (e.g. a base64 secret or a DSN with query params) would have everything after the first `=` captured correctly by the non-greedy `(.*?)` only because the regex is anchored at end-of-line, but there is no handling for quoted values (`KEY="a b"` keeps the literal quote characters) or line continuations, unlike a real dotenv parser (`dotenv` npm package, which every Node service here uses indirectly via `env_file`). This is a latent parsing gap specific to the Go engine's env loading, not a bug that's manifested yet as far as this pass found.

## The second exception: `teen-churn-ml`'s env loading

Every Node app in `ecosystem.config.js` uses `env_file: ENV_FILE(svc)`, and the Go engine uses `LOAD_ENV()`. `teen-churn-ml` (`ecosystem.config.js:149–161`) is a third, different pattern:

```js
{
  name: 'teen-churn-ml',
  cwd: `${BASE}/churn-ml-service`,
  script: 'venv/bin/uvicorn',
  args: 'main:app --host 127.0.0.1 --port 3020',
  instances: 1,
  exec_mode: 'fork',
  watch: false,
  interpreter: 'none',
  env: {
    DATABASE_URL: process.env.DATABASE_URL
  }
},
```

This has no `env_file` at all — `DATABASE_URL` is read from whatever shell environment was active when PM2 itself evaluated `ecosystem.config.js`, not from a committed `services/churn-ml-service/.env`. This exact mechanism, its silent-fallback failure mode (`main.py`'s hardcoded DSN fallback when `DATABASE_URL` is unset), and its downstream effect on `churn-service`'s ML-vs-heuristic scoring fallback are already fully documented in `docs/Bugs/churn-ml-database-url-env-inheritance.md` — not repeated here.

**New in this pass**: this block is also the only one of the 13 apps with **no `max_memory_restart` set at all**. Every other app (Node or Go) has an explicit ceiling (150M–350M); `teen-churn-ml` has none, so PM2 will never restart this process for excessive memory use no matter how large its RSS grows. A FastAPI process doing pandas/scikit-learn-style feature computation (per `docs/backend-services/churn-ml-service/*` for what `get_user_features`/`predict` actually load into memory) is exactly the kind of workload that can balloon memory under a bad batch or a memory leak in a long-lived worker, and on a single VPS running 13 other PM2 processes plus Postgres and Redis in Docker, an unbounded process has more blast radius (OOM pressure on everything else) than on a dedicated host. See `docs/Bugs/churn-ml-service-no-memory-restart-limit.md` (new — bug list at the end of this document).

## `docker-compose.yml` — role, drift, and how it's (not) part of the current deploy

`docker-compose.yml` (61 lines) defines exactly two services: `postgres` (`postgres:16-alpine`, container name `teen_postgres`) and `redis` (`redis:7-alpine`, container name `teen_redis`). It does **not** define, and never has defined, any application-tier service — there is no `core-api`, `wallet`, `gateway`, etc. block in it, and no Dockerfile exists anywhere in the repo to build one from. So the "does it list the same set of services as `ecosystem.config.js`" comparison doesn't really apply in the way it would for a normal docker-compose-vs-orchestrator drift check — the file was only ever scoped to the two stateful backing stores, with PM2 always intended to run the other 13 processes as bare OS processes. That said, there is real drift, and real inconsistency, in how the two files' worlds connect:

**Credentials match the code's hardcoded fallbacks — for better and worse.** `docker-compose.yml`'s `POSTGRES_PASSWORD: teen_secret_2024` and Redis's `--requirepass teen_redis_2024` are not placeholders unique to this file — they are the exact same literal strings baked into `services/game-engines/teen-patti/main.go`'s hardcoded fallback DSN (documented in `docs/backend-services/teen-patti-engine/overview.md`: `postgresql://teen:teen_secret_2024@localhost:5432/teen_db`, `redis://:teen_redis_2024@localhost:6379`) and into four different services' committed `.env.example` files verbatim (`services/admin-service/.env.example:3-4`, `services/core-api-service/.env.example:5-6`, `services/game-gateway/.env.example:3-4`, `services/wallet-service/.env.example:3-4`). Three other services' `.env.example` files use a different, more obviously-placeholder password (`postgresql://teen:password@localhost:5432/teen_db` — `app-monitor-service`, `bot-learning-service`, `churn-service`), and `risk-service/.env.example:8` diverges further still (`postgresql://user:password@localhost:5432/teen_app` — different user *and* different database name, `teen_app` instead of `teen_db`). None of this is necessarily wrong (every `.env.example` is explicitly documented elsewhere as example-only, overridden by the real `.env` on the VPS), but the fact that `teen_secret_2024`/`teen_redis_2024` appears identically in a checked-into-git compose file, a checked-into-git Go source fallback, and four checked-into-git `.env.example` files is worth flagging together: if the real production password was ever set to something other than this literal string, four service directories' onboarding examples and one binary's silent fallback are all quietly wrong; if it wasn't ever changed, this is the real production database password, committed in plaintext in five different files. See the new finding at the end of this document.

**Host port publishing.** `docker-compose.yml:24-25` and `:48-49` publish `"5432:5432"` and `"6379:6379"` with no bind address, which under Docker's default publishing behavior means both ports are bound on `0.0.0.0` — every interface, not just loopback. `infra/deploy/bootstrap-vps.sh:36-38` sets up `ufw allow 22/tcp`, `ufw allow 80/tcp`, `ufw allow 443/tcp` and enables the firewall, with no rule for 5432 or 6379 — which looks protective, but Docker's default iptables integration inserts its own DNAT/ACCEPT rules for published container ports directly into the `nat`/`FORWARD` chains, ahead of where ufw's own rules apply; this is a widely-documented Docker-vs-ufw interaction (published container ports are frequently reachable from the public internet despite a restrictive ufw allow-list, unless the operator explicitly adds rules to Docker's `DOCKER-USER` iptables chain). No such mitigation file exists anywhere in this repo (`infra/` has no `ufw-docker`-style script or `DOCKER-USER` rule). This isn't something this documentation pass can confirm against the live VPS's actual iptables state, but the ingredients for the risk — host-wide port publishing, a firewall allow-list that doesn't account for Docker's iptables behavior, and (per above) a plausible-real password committed in plaintext — are all verifiably present in the repo. See the new finding at the end of this document.

**Not part of the current deploy pipeline, but not vestigial either — used once, at bootstrap.** `docker compose up -d` is invoked by exactly three deploy scripts: `infra/deploy/bootstrap-vps.sh:45` (as a documented next-step instruction, not an automated call), `infra/deploy/deploy-hestia.sh:43`, and `infra/deploy/deploy-services.sh:82`. All three of these are superseded scripts — per CLAUDE.md, the actual current one-shot deploy entrypoint is `infra/deploy/go.sh`, which (confirmed by reading it) does nothing but install an SSH key and then run `infra/deploy/deploy-tip-gifts-botfill.sh`. That script never calls `docker compose up`; it only runs `docker exec -i teen_postgres psql ...` (`deploy-tip-gifts-botfill.sh:32-38`), which assumes the `teen_postgres` container is already running. Since `docker-compose.yml`'s services are both declared `restart: unless-stopped`, this assumption holds in practice once the containers have been started a single time (at VPS bootstrap, or whenever `deploy-services.sh`/`deploy-hestia.sh` was last run) — Docker's own restart policy keeps them alive across VPS reboots without any PM2 or cron involvement. So the accurate characterization is: `docker-compose.yml` is not stale or unused in the sense of "nothing reads it" — it is the actual definition of the Postgres/Redis containers this platform runs against — but it is not invoked by the *current* deploy automation (`go.sh`), only by three now-secondary scripts, one of which (`deploy-services.sh`) still has its own drift problem worth noting: its `SERVICES` array (`deploy-services.sh:6`) lists `auth-service user-service ... betting-service leaderboard-service notification-service`, the five pre-consolidation services CLAUDE.md says were merged into `core-api-service` — directories that no longer exist (the script's own `if [ -d ... ]` guard means these are silently skipped, not fatal, but the array itself is stale).

**Version/tuning drift**: nothing in `ecosystem.config.js`, any `.env.example`, or any doc in this repo specifies a required Postgres or Redis version to cross-check `postgres:16-alpine`/`redis:7-alpine` against, so no version drift can be demonstrated either way from the repo alone. The compose file's Postgres tuning flags (`shared_buffers=512MB`, `effective_cache_size=1536MB`, `max_connections=150`, etc.) and Redis's (`maxmemory 512mb`, `maxmemory-policy allkeys-lru`, `appendonly yes`) are internally consistent with the "single VPS, everything on one box" model described in CLAUDE.md and are not visibly re-specified or overridden anywhere else.

## OS-level tuning (`infra/config/`)

- **`infra/config/limits.conf`** (9 lines) sets `*`/`root` `soft`/`hard nofile 65535` — a standard, sane bump for a box running ~13 always-on processes plus Postgres/Redis, several of which (the gateway, the game engines) hold long-lived WebSocket connections; the default distro limit (usually 1024) would be exhausted quickly under "1000+ CCU" (the file's own comment target).
- **`infra/config/sysctl.conf`** (28 lines) raises `net.core.somaxconn` to 8192, `tcp_max_syn_backlog` to 2048, enables `tcp_tw_reuse`, shortens `tcp_fin_timeout` to 15s, widens the ephemeral port range to `1024-65535`, raises socket read/write buffer ceilings to 16MB, and tunes TCP keepalive (`300s`/`30s`/`5` probes) for long-lived WebSocket connections. These are all standard, reasonable values for the stated workload (WebSocket-heavy, high concurrent-connection count) — nothing here looks miscalibrated or dangerous.
- **Neither file is applied automatically by any deploy script or CI workflow.** A repo-wide search (`infra/deploy/*.sh`, `.github/workflows/*.yml`) for references to `limits.conf`, `sysctl.conf`, or `vps-apply-optimizations.sh` turns up nothing outside `infra/config/vps-apply-optimizations.sh` itself — none of `go.sh`, `deploy-tip-gifts-botfill.sh`, `deploy-services.sh`, `deploy-hestia.sh`, `bootstrap-vps.sh`, or any GitHub Actions workflow (`deploy-backend.yml`, `deploy-admin-pages.yml`, `build-apk.yml`) invokes it. It is a standalone script an operator must remember to `sudo bash` manually; a fresh VPS provisioned via `bootstrap-vps.sh` + `deploy-services.sh` alone (the two scripts that *are* wired to automation/documented as the setup path) would **not** get these OS tunings unless someone separately ran this third script.
- **`vps-apply-optimizations.sh` does more than its name suggests, and part of what it does is actively destructive against the current `ecosystem.config.js`.** Steps `[1]`–`[2]` apply the sysctl/limits files as advertised. Step `[3]` builds and starts only `teen-core-api`. Step `[4]` runs `pm2 reload ecosystem.config.js` followed by (`vps-apply-optimizations.sh:26`):
  ```bash
  # gateway now runs 1 instance; bot-learning is disabled
  pm2 delete teen-auth teen-user teen-leaderboard teen-notify teen-betting teen-bot-learning 2>/dev/null || true
  ```
  The first five names (`teen-auth`, `teen-user`, `teen-leaderboard`, `teen-notify`, `teen-betting`) are the pre-consolidation processes that no longer exist under this name in the current `ecosystem.config.js` (they were merged into `teen-core-api`) — deleting them is a harmless no-op today, silently swallowed by `2>/dev/null || true` if they aren't running. `teen-bot-learning`, however, **is** a real, currently-active app in this same `ecosystem.config.js` (lines 177-187, "nightly bot-profile rebuild from real player data"). Running this script today would `pm2 delete` the live bot-learning process, and the very next line is `pm2 save` (`:27`) — persisting the deletion into PM2's dump file, so bot-learning would **not** come back on the next `pm2 resurrect` or systemd boot either. See the new finding at the end of this document.

## `infra/scripts/pm2-alert.sh`

A standalone Bash script, intended to run every 5 minutes via cron (per its own header comment, not via systemd timer). Mechanism: `pm2 jlist` is piped through an inline Python one-liner that filters for any process whose `pm2_env.status` is not `online`/`launching`; if the resulting list is non-empty, it's hashed (`md5sum`) and compared against a state file (`/tmp/pm2-alert-state`) so the same *set* of down processes only triggers one alert, not one every 5-minute run (state resets once everything recovers, so a new outage — even a repeat of the same processes — re-alerts). Alerting is via a raw Telegram Bot API `curl -X POST .../sendMessage` call (`send_telegram()`, lines 17-27); if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` aren't set in the environment, it degrades to an `echo` (log-only), never erroring.

Cross-reference: `docs/backend-services/app-monitor-service/backend.md` already notes that `app-monitor-service`'s own internal remediation/alerting logic (`checkAppErrors`, `raise()`, its own `sendTelegram()`) is a **separate, independent** mechanism from this script — "the two mechanisms don't share state or suppress each other" — despite using the same environment variable names. This script watches PM2 process liveness specifically (`pm2 jlist` status); the app-monitor path watches application-level error rates and API health. They are complementary, not overlapping, but an operator debugging "why did/didn't I get a Telegram alert" needs to know both exist.

**Not wired into any automation.** Like `vps-apply-optimizations.sh`, nothing in `infra/deploy/*.sh` or `.github/workflows/*.yml` installs this into crontab — its own header comment (`pm2-alert.sh:9-11`) documents the crontab line an operator is expected to add manually (`*/5 * * * * /opt/teen/infra/scripts/pm2-alert.sh >> /var/log/pm2-alert.log 2>&1`). This matches the pattern of `infra/scripts/nginx-protect.sh` (a sibling script, also cron-driven, also manually installed per its own header) — self-installing cron scripts appear to be this repo's established convention for VPS-side background jobs rather than an oversight specific to `pm2-alert.sh`. There is nothing in the repo (no crontab file, no Ansible/Terraform-equivalent state) that can confirm whether this cron line was ever actually installed on the production VPS — from the repo alone, this can only be described as "designed to be manually wired up," not confirmed live or confirmed absent.

## `infra/local-dev/` — an orphaned dependency tree, not a committed one

`infra/local-dev/` contains exactly one thing: a `node_modules/` directory holding `eventemitter3`, `follow-redirects`, `requires-port`, and `http-proxy` (`http-proxy`'s own three direct dependencies, per its `package.json`) plus a `.package-lock.json` (note the leading dot — an npm-internal lockfile artifact, not the standard `package-lock.json`) whose `name` field is literally `"local-dev"`. There is no `package.json`, no source `.js`/`.ts` file, and no README anywhere in this directory — nothing that explains what this was for.

Checking `.gitignore` first, as the task brief for this pass required: `.gitignore:2-3` ignores `node_modules/` and `**/node_modules/` globally, and `git check-ignore -v infra/local-dev/node_modules/http-proxy/package.json` confirms the match (`.gitignore:3:**/node_modules/`). `git status --porcelain --ignored infra/local-dev` reports it as `!! infra/local-dev/` (ignored, untracked), and `git ls-files infra/local-dev/` returns nothing — **this directory has never been committed to this repository at all**, on any branch reachable from here (`git log --follow -- infra/local-dev/` returns no history). This resolves the hypothesis the task brief raised ("if `node_modules` is supposed to be ignored, ask why it's actually tracked here") the other way: it isn't tracked, so there's no repo hygiene bug to fix in version control — this is purely local workstation state, left over on whatever machine most recently had this working tree checked out.

What it evidences, though, is still worth recording: someone ran `npm install http-proxy` inside `infra/local-dev/` at some point — `http-proxy` is a small Node reverse-proxy library commonly used to front multiple local dev servers (e.g. the 13 different PM2-managed ports in this project) behind one address during local development, which would line up with a plausible unbuilt tool for running this multi-service platform locally without needing 13 separate `npm run dev` terminals pointed at 13 different ports. Whatever script was meant to consume these packages (a `local-proxy.js` or similar) was either never written or never saved before the work was abandoned. Since it's untracked and gitignored, no code change is needed to "fix" this — it's a note for whoever finds this directory on a shared workstation, not a filed bug.

## Summary of findings from this pass

Three new issues surfaced by reading `ecosystem.config.js`, `docker-compose.yml`, and `infra/config`/`infra/scripts` against each other and against the currently-active deploy path:

1. `docs/Bugs/vps-optimizations-script-deletes-active-bot-learning-service.md` (new)
2. `docs/Bugs/churn-ml-service-no-memory-restart-limit.md` (new)
3. `docs/Bugs/docker-compose-db-redis-exposed-with-hardcoded-credentials.md` (new)

See the final report for full write-ups. Everything else in this pass either confirms/cross-references already-filed bugs (`churn-ml-database-url-env-inheritance`) or is a documentation-only observation (`infra/local-dev/`'s untracked, gitignored `node_modules/`; the manual-cron convention shared by `pm2-alert.sh` and `nginx-protect.sh`; `deploy-services.sh`'s stale pre-consolidation `SERVICES` array, which is out of scope for this document and belongs to the deploy-pipeline pass).
