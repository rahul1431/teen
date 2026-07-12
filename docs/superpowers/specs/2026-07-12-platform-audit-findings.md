# Platform Audit — Consolidated Findings (Phase 1)

Date: 2026-07-12
Scope: dev + prod envs, VPS infra, admin-panel, admin-service, web frontend, Flutter mobile.
Method: read-only. 4 parallel tracks (repo/build, VPS, live browser, mobile). Teen Patti + Aviator report-only (LOCKED).

---

## The overarching finding: dev is not isolated from prod

One VPS (`64.204.130.181`), one `/opt/teen` checkout, one PM2 daemon (root), one nginx.
Every service — including every `*-dev` PM2 process — connects to the **production database `teen_db`**.
`teen_db_dev` exists (76 tables) but has **zero** connections. The dev admin panel's `/api/admin`
proxies to the **prod** core-api on `127.0.0.1:3001`.

**Consequence:** testing on `dev.myonlinejoker.com` mutates real production money data. "Release to prod"
is today largely a no-op because dev already runs against prod data/API. This must be resolved before
any "fix on dev, then promote" workflow is meaningful.

---

## P0 — money / security

| # | Finding | Evidence |
|---|---------|----------|
| P0-1 | **Dev/prod share the production DB `teen_db`** and prod API (3001). No real isolation. | VPS: pg_stat_activity → only teen_db; per-service `.env` → teen_db; nginx dev `/api/admin`→3001 |
| P0-2 | **Root RCE via deployment API.** `branch` query param → `git rev-list main...${branch}` → `execSync("ssh root@vps \"...\"")`. Only `authenticate`, no role check → any admin. | deployment-routes.ts:163-189 → deployment.service.ts:562-564, 941-948 (verified) |
| P0-3 | **Prod rollback gated at `finance`** not DevAdmin — finance admin can git reset --hard + pm2 kill prod. | deployment-routes.ts:380-382 |
| P0-4 | **Seed credentials shown on prod login page** (`superadmin / Admin@123456`). | game.myonlinejoker.com/admin/login (live) |
| P0-5 | **Both tp-engines (prod+dev) run with no DATABASE_URL**, teen-patti `.env` empty — silent game-save-failure pitfall, live. | VPS pm2 env; services/game-engines/teen-patti/.env empty |

## P1 — broken functionality

| # | Finding | Evidence |
|---|---------|----------|
| P1-1 | **Dev admin panel down** — assets 503, login route 404. | dev.myonlinejoker.com (live) |
| P1-2 | **Public site root broken** — apex → game.myonlinejoker.com/ returns API JSON 404, not the web app. | myonlinejoker.com (live) |
| P1-3 | **Env-switcher + push-to-prod is a mock** — frontend fakes deploy/rollback with setTimeout, never calls backend; switcher changes only colors, no backend reads env header. | DevAdminPanel.tsx:254-297; types/environment.ts:25,40; grep services/ = 0 |
| P1-4 | **admin-panel fails tsc (3 errors)** → build broken. | EnvironmentSwitcher.tsx:142, DevAdminPanel.tsx:815, Layout.tsx:99 |
| P1-5 | **Prod teen-wallet crash loop (405 restarts)** — EADDRINUSE 3003, port owned by wallet-dev. | VPS pm2 |
| P1-6 | **Prod teen-admin-svc crash loop (405 restarts)** — missing ADMIN_JWT_SECRET at launch. | VPS pm2 |
| P1-7 | **teen-bot-learning-dev crash loop (3,230 restarts)** — Kafka container `teen_kafka_1` never started. | VPS pm2 / docker |
| P1-8 | **Dev nginx vhost has no `/ws` block / Upgrade headers** — WebSocket games can't handshake on dev domain. | VPS nginx -T |
| P1-9 | **updateDeploymentStatus always throws** (pg param count bug) — deploy status stuck at 'queued'. | deployment.service.ts:1088-1110 |
| P1-10 | **Deploy orchestrator runs `pm2 kill`** (kills itself, it's under PM2); execSync blocks event loop; timeout is dead code. | deployment.service.ts:849,937-963 |
| P1-11 | **Release APK signed with debug keys**, no minify/shrink. | mobile/android/app/build.gradle:55-61 |
| P1-12 | **usesCleartextTraffic=true** on a real-money app. | mobile/android/app/src/main/AndroidManifest.xml:29 |

## P2 — drift / hygiene

| # | Finding | Evidence |
|---|---------|----------|
| P2-1 | VPS 2 commits behind local HEAD; dirty working tree. | VPS git |
| P2-2 | schema_migrations stale at 025; 026-059 applied untracked; 060-063 unapplied + uncommitted. | VPS psql; repo |
| P2-3 | `dev_game_backend` nginx upstream: 3/5 backends dead; gateways 2/3 (3221/3222) missing. | VPS nginx |
| P2-4 | adminApi base-URL regression drops `/api/admin` when env var set (`||` vs `+`). | admin-panel/src/api/client.ts:41-49 |
| P2-5 | Migration 063: NOT NULL col + ON DELETE SET NULL contradiction; nullable subselect insert. | 063_*.sql:15; deployment.service.ts:1345 |
| P2-6 | Frontend/backend env facts contradict (redis ports, DB names swapped). | types/environment.ts vs deployment.service.ts:148-209 |
| P2-7 | Mixed-case 'DevAdmin' role; frontend checks nonexistent 'SuperAdmin'. | index.ts:39; DevAdminPanel.tsx:101 |
| P2-8 | WS auth token in URL query + printed to logcat. | mobile/socket_service.dart:60,104 |
| P2-9 | Biometric login stores plaintext password in secure storage. | mobile/secure_storage.dart:33-44 |
| P2-10 | No dev/prod switcher in mobile; every default + both committed APKs point at prod. | mobile/app_config.dart:3-14 |
| P2-11 | 158/312 MB APKs, no shrinkResources; native debug symbols retained. | mobile/build.gradle:59-60 |
| P2-12 | Swap usage 429 MB / 1 GB — mild memory pressure. | VPS free -m |

## P3 — cosmetic / low

- Duplicate `061_` migration filenames (no schema conflict; filename-keyed runner).
- VPS IP/root/key-path committed in admin-service/.env.example + code defaults.
- Plaintext root password in repo `vps_*.py` scripts — rotate.
- 17 new root/admin-panel *.md docs prescribe setup (migrations, .env.dev files, backend middleware) never executed.
- FK-violating safety-check logs; git-clean check would permanently block deploys on this deliberately-dirty VPS.
- mobile: unused razorpay dep + placeholder key; stale appVersion '1.0.0' constant; 427 analyzer infos / 8 warnings.

---

## Teen Patti / Aviator (report-only, LOCKED)

- tp-engine DATABASE_URL missing on both envs (P0-5) affects Teen Patti persistence — flagged, not fixed.
- No other TP/Aviator-specific code issues surfaced in this pass. Awaiting per-issue re-authorization.

---

## Proposed Phase 2 sequence (dev-first, pending user decisions)

Because dev == prod DB (P0-1), the "safe dev sandbox" the release flow assumes does not exist yet.
Recommended ordering:

1. **Decide isolation strategy** (P0-1) — this gates everything else. Options: point `*-dev` services at
   `teen_db_dev` + separate ports/env files; OR accept shared infra and drop the "dev" pretense.
2. **Security P0s** (P0-2 RCE, P0-3 rollback role, P0-4 seed creds) — code + config, low blast radius.
3. **tp-engine DATABASE_URL** (P0-5) — config only; Teen Patti locked → requires OK (persistence bug).
4. **Restore broken surfaces** (P1-1 dev panel, P1-2 public root, P1-5/6 crash loops, P1-8 dev /ws).
5. **De-risk the deployment feature** (P1-3/4/9/10) — currently a mock; either finish safely or disable.
6. **Mobile hardening** (P1-11 signing, P1-12 cleartext) — needed before any real store release.
7. P2/P3 hygiene as capacity allows.

Prod deploy only after explicit sign-off (Phase 3).
