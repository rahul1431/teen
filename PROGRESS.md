# Progress & Resume Checkpoint

> Living status doc. Read this first when resuming. Last updated: 2026-06-21 (session 4 — VPS deployment).
> Branch: `claude/confident-archimedes-e2dd1k` · PR: #1 (draft) · Base: `main`
> Latest APK commit: `b28a50c` (hostess + haptics) · Admin preview: https://rahul1431.github.io/teen/

## 🚀 Session 4 — LIVE VPS deployment (game.myonlinejoker.com)

**Server:** HestiaCP on `64.204.130.181` (Ubuntu 24.04). Repo at `/opt/teen`.
SSH is from the user's own machine (port 22 blocked from Claude's sandbox).

### Live now ✅
- **PostgreSQL** in Docker (`teen_postgres`, port 5432, healthy). 18 tables.
  - Compose trimmed to Postgres only (system Redis already on :6379 → reused).
  - Migrations 001–006 applied (005 risk_status skipped: `user_status` is a CHECK
    constraint not an ENUM — non-blocking, patch later).
  - Postgres password: stored in `/opt/teen/.env` on the VPS (not committed).
- **Adminer** DB GUI at `https://game.myonlinejoker.com/adminer.php`
  (System=PostgreSQL, Server=`127.0.0.1:5432`, user `teen`, db `teen_db`).
  ⚠️ Publicly exposed — delete or password-protect when done.
- **admin-service** running via PM2 (`teen-admin-svc`, port 3008), `.env` at
  `services/admin-service/.env`. Needed `npm install dotenv` (not in deps).
- **Admin Panel** built + served at `https://game.myonlinejoker.com/admin/`
  — **login works end-to-end over HTTPS** 🎉
  - Built with `VITE_API_BASE_URL=""` + `ADMIN_BASE="/admin/"`, **no**
    `VITE_ROUTER_BASE` (routes already include `/admin`, basename doubled it).
  - Admin user: `admin` (temp pw set during deploy — CHANGE THIS) + seeded
    `superadmin`. Both role=superadmin.
- **Nginx** (HestiaCP) custom includes (survive rebuilds):
  - `nginx.conf_api` + `nginx.ssl.conf_api` → `location /api/ → 127.0.0.1:3008`
  - `nginx.conf_admin` + `nginx.ssl.conf_admin` → SPA fallback for `/admin/`
  - PHP fix: domain pool is php8.1; installed `php8.1-pgsql` for Adminer.
- **PM2** persisted (`pm2 save` + systemd startup).

### VPS secrets (in service `.env` files)
- JWT_SECRET=`e62b472a7217249ecf6e6234c78de41dd6c23d9fbe23ba33410c56042e1e4d66`
- JWT_REFRESH_SECRET=`b8ec306406260803f401b34afa9da1c44b261473cded0bb1b911261db2c5b882`
- INTERNAL_SERVICE_KEY=`f4172a2b9d5ee350c471632a3b82c688`
- POSTGRES_PASSWORD=`4f27e37a4251d17033741c22`
- DATABASE_URL=`postgresql://teen:<pw>@127.0.0.1:5432/teen_db`
- REDIS_URL=`redis://127.0.0.1:6379`

### Service port map
auth 3001 · user 3002 · wallet 3003 · gateway 3004 · aviator 3005 ·
leaderboard 3006 · notification 3007 · **admin 3008 (live)**

### Pending VPS steps ⏳
- [ ] Build + start the other 6 services (auth/user/wallet/gateway/aviator/
      leaderboard/notification) with PM2. **All import `dotenv` but none list it
      → `npm install dotenv` in each before starting.** OTP runs in console mode
      (prints to PM2 logs) when `OTP_PROVIDER` unset — good for testing.
- [ ] Split nginx `/api/` routes per service (currently all `/api/` → 3008;
      need `/api/auth`→3001, `/api/wallet`→3003, socket.io→3004, etc.)
- [ ] Point mobile APK at `https://game.myonlinejoker.com` + rebuild.
- [ ] Optional: GitHub Actions auto-deploy — add `VPS_HOST`/`VPS_USER`/
      `VPS_PASSWORD` secrets (workflow `.github/workflows/deploy-backend.yml`).
- [ ] Change admin password; secure/remove Adminer.

## 🆕 Session 3.5 additions (admin modules + mobile push)
- **Anti-Cheat / Risk Center** — `admin-panel/src/pages/RiskCenter.tsx` (5 tabs:
  Overview, Flagged Users, Device Links, Win-Rate Anomalies, Collusion Pairs) +
  6 `/api/admin/risk/*` endpoints. Migration `005_risk_status.sql`.
- **Support Helpdesk + CMS** — `admin-panel/src/pages/Support.tsx` (Tickets,
  CMS Pages, Banners) + endpoints. Migration `006_support_cms.sql` (support_tickets,
  support_messages, cms_pages, cms_banners).
- **Mobile Push Notifications** — `push_notification_service.dart` (FCM token reg,
  foreground local notifications, deep-link routing) + `notifications_page.dart`
  notification center. `PUT /auth/fcm-token` endpoint. Wired in `app.dart`.
- **Role-gate fixes** — added missing `requireRole()` on 6 finance/config/
  notification endpoints.

## ❓ How to log in to the admin panel
The Pages preview at `rahul1431.github.io/teen/` is **UI-only — login requires
a backend**. If you see "Invalid credentials" or "Backend not reachable":
- **Local dev:** start admin-service (`cd services/admin-service && npm run dev`),
  run all migrations (001-004), then in `admin-panel/.env.local` set
  `VITE_API_BASE_URL=http://localhost:3008` and `npm run dev`.
- **VPS:** deploy admin-service + add a `VITE_API_BASE_URL` GitHub secret
  pointing at the public URL, then push to redeploy Pages.
- **Seed login:** `superadmin` / `Admin@123456` (created by migration 001).
  Change it immediately on first real login.

## 🆕 Session 3 additions (admin modules)
- **User Management** (commit `c280f8e`): 6-tab user detail (Profile, Transactions, KYC, Games, Notes, Audit). Debit endpoint + KYC review with reasons.
- **Payment Management** (commit `69e7b92`): 4-tab Finance page (Withdrawals with UTR, Deposits with manual reconcile, global Ledger, Reconciliation report). Reject-withdrawal refunds the user.
- **RBAC + 2FA** (new): roles (readonly/support/finance/superadmin), per-route gates, TOTP 2FA setup/verify, Admin Users page (CRUD + role + password reset), Profile page (2FA + change password). Migration `004_admin_rbac.sql`.

---

## ✅ Done so far

### Backend (all typecheck/build clean)
- **9 services** build successfully: auth, user, wallet, game-gateway,
  teen-patti (Go), aviator, leaderboard, notification, admin
- Full DB schema + migrations (users, wallets, ledger, games, KYC, referrals,
  bonuses) + 20 seeded bot users
- Wallet: double-entry ledger, row-locks + idempotency keys
- Aviator: provably-fair (HMAC-SHA256); Teen Patti: Go engine w/ hand ranking
- Matchmaking + bot auto-fill in game-gateway

### Admin Panel (React + Ant Design Pro)
- 8 pages: Login, Dashboard, Users, GameRooms, Finance, Notifications,
  GameConfig, Layout — builds clean
- **Live UI preview:** https://rahul1431.github.io/teen/ (GitHub Pages)
  - Login creds (seed): `superadmin` / `Admin@123456`
  - ⚠️ Login needs the backend; preview is UI-only. Open `/teen/admin` to
    browse pages without logging in.

### Mobile (Flutter)
- Full app: splash, login/OTP/register, home, Teen Patti (lobby+game),
  Aviator, wallet (Razorpay), leaderboard, profile
- **APK** builds via GitHub Actions (arm64 + armeabi artifacts) — GREEN ✅
- **Teen Patti landscape table** redesigned (session 2):
  - Oval table, players around an ellipse (you at bottom), turn-timer arc,
    chip badges, fanned hole cards
  - Live chat panel + emoji reaction bar + gift tray (float/fade over seats);
    emoji/gift piggyback `room:chat` with a `type` field (gateway forwards it)
  - Theme matched to user's Behance reference: **red felt + ornate gold
    border + navy room + "TEEN PATTI" watermark**
  - **Demo preview**: "Preview Teen Patti Table (Demo)" button on login →
    `/games/teen-patti/demo` opens the table offline with mock players (no
    login/backend). Auth guard whitelists `*/demo`.
- Black-screen-on-launch bug fixed (Firebase calls guarded in main.dart)

### Infra / Structure
- `games/` (registry), `resources/` (configs, email templates, card meta),
  `uploads/` (avatars/kyc/banners — content gitignored), `STRUCTURE.md`
- Docker Compose, PM2 ecosystem, HestiaCP Nginx proxy, deploy scripts
- CI: APK build, admin-panel Pages deploy, backend deploy workflows

---

## 🐛 Bugs fixed this session
1. Missing `tsconfig.json` in leaderboard + notification services (build/start would fail)
2. `auth-service` `app.authenticate` type error → declaration merging
3. `aviator` `app.jwt` type error → import `@fastify/jwt`
4. `admin-panel` `import.meta.env` untyped → `vite-env.d.ts`
5. Added `.gitignore`; removed stray compiled JS; `noEmit` in admin tsconfig
6. **Flutter Android v1 embedding** → full v2 Gradle scaffold added
7. **APK CI**: skip `google-services.json` when secret unset
8. **Mobile black screen** → guarded all Firebase calls in `main.dart` (build #4)

---

## ⏳ In progress / pending
- [ ] **Awaiting user review** of Teen Patti table (via Demo button) before
      applying further reference-matching refinements (see list below)
- [ ] APK build for `9480aff` (demo preview) — confirm green, share link
- [ ] **You:** add GitHub secrets for real builds — `GOOGLE_SERVICES_JSON`,
      `API_BASE_URL`, `SOCKET_URL`, `RAZORPAY_KEY_ID`, `VPS_*`
- [ ] **You:** VPS deploy — clone to `/opt/teen`, run deploy scripts
- [ ] **You:** SSL — `v-add-web-domain <user> game.myonlinejoker.com` then LetsEncrypt
- [ ] Change admin password after first real login

## 🎨 Teen Patti UI — reference-match (session 3 — DONE ✅)
Reference: Behance "Teen Patti Game UI/UX" (gallery 185793255). All 6
shipped as separate commits:
1. ✅ Pack · Side Show · Chaal action buttons + −/+ bet stepper + coin chip
2. ✅ Seat status pills (Chaal/Pack/Blind) + red dealer 'D' badge
3. ✅ Gold gift-badge on opponent avatars + green-glow active turn ring
4. ✅ Fanned blue card-backs over opponent seats (40% opacity when folded)
5. ✅ Top bar gold-circle icons (exit / info / chat / invite / settings);
      duplicate chat removed from right edge
6. ✅ Home → 2x2 menu-card grid (Teen Patti / Aviator / Premium / Variations)
      + decorative rotating Spin & Win wheel; Lobby → AppBar balance chip,
      Quick Match hero button, gold-trimmed red pill stakes

Demo path (`/games/teen-patti/demo`) exercises every visual. Backend
untouched. Targeted gifting (recipient-aware) is future scope.

---

## 📋 Planned next (see PLAN.md "Admin Panel — Feature Modules")
Approved modules to build (Week 2 unless noted):
1. User Management (Day 2 core)
2. API Management
3. In-App Update
4. Payment Management / Accounts (Day 2 core)
5. RBAC & Admin Users + 2FA
6. Promotions & Bonus Engine
7. Anti-Cheat / Risk Center
8. Support Helpdesk + CMS

Also queued: **Teen Patti landscape UI** (chat + emoji + gifts).

---

## 🔗 Quick links
- PR: https://github.com/rahul1431/teen/pull/1
- Actions: https://github.com/rahul1431/teen/actions
- Admin preview: https://rahul1431.github.io/teen/
- Pages setting: repo Settings → Pages → Source = GitHub Actions (enabled ✅)

## ▶️ How to resume
Tell Claude: **"Resume from PROGRESS.md"** — it will read this + git log and
continue. Every task ends with a commit, so nothing is lost.
