# Progress & Resume Checkpoint

> Living status doc. Read this first when resuming. Last updated: 2026-06-22 (session 6 — mobile UI/UX redesign, Teen Patti modes, Aviator rebuild, server economics).
> Branch: `claude/confident-archimedes-e2dd1k` · PR: #1 (draft) · Base: `main`
> Latest APK commit: `8a18b69` (coreLibraryDesugaring fix) · Latest backend commit: `dc9f9a2` (Aviator economics) · Admin preview: https://rahul1431.github.io/teen/

## 🆕 Session 6 — Mobile UI/UX redesign + Teen Patti modes + Aviator rebuild

### Mobile UI/UX — full redesign ✅
All 14 screens audited and fixed. Key changes across the app:
- Eliminated all hardcoded `Color(0xFF...)` / `Colors.orange` etc. — everything uses `AppColors` constants
- Added loading/error/retry states to every async screen (Profile, Leaderboard, Wallet, Notifications)
- `ErrorRetry` shared widget (`mobile/lib/shared/widgets/error_retry.dart`) — wifi_off icon + message + Retry button
- `AppSnackBar` used for all user feedback (was silent catches or missing feedback)
- Fixed duplicate `AppTheme` class definition in `app_theme.dart`
- Added `AppColors.aviatorBlue` + `AppColors.aviatorGreen` constants (were referenced but missing)
- Leaderboard: icon tabs (replaced emoji text), medal icons for top 3, RefreshIndicator
- Notifications: uses shared `timeAgo()` (removed duplicate local helper)
- Wallet: `AppColors.cardBg` replaces hardcoded background, outlinedButtonTheme in AppTheme.dark

### Teen Patti — Mode Selection screen ✅
- New `TeenPattiModesPage` (`mobile/lib/features/games/teen_patti/modes_page.dart`):
  - 2×2 grid of mode cards: **Classic** / **AK47** / **Practice** (vs bots) / **Friends** (offline)
  - Balance chip loaded from `/api/wallet/balance` in AppBar
  - Classic/AK47 → lobby with `?variation=` param; Practice → demo table; Friends → "Coming soon"
- Route `app.dart`: `/games/teen-patti` now lands on `TeenPattiModesPage` (was direct lobby)
- Lobby passes `variation` to `join_matchmaking` socket event

### Low-Balance Gate (Teen Patti lobby) ✅
- `TeenPattiLobbyPage` now loads `_balanceValue` (numeric) alongside display string
- `_joinMatchmaking()` guards: if `_balanceValue < _selectedStake` → `_showLowBalanceDialog()`
- Dialog: gold "Add Money" button → `context.push('/wallet')`, Cancel to dismiss
- Prevents joining a table with insufficient funds (was silently deducting and failing)

### Aviator — complete single-player rebuild ✅
- Removed all Socket.IO / multiplayer dependencies from `aviator_page.dart`
- Self-contained on-device round engine:
  - `_enterBetting()` → 5 s countdown timer display → flying phase → crash → 2.5 s crash display → new round
  - `_rollCrash()`: house-edge weighted RNG (`0.97 / (1 - r)`) clamped 1.00–50.00
  - `_onFrame()` (60 fps via AnimationController): `exp(0.16 * elapsed)` multiplier curve
- Two AnimationControllers: `_ticker` (game loop), `_pulse` (glow breathing effect)
- Balance integration: `_placeBet()` locks `amount` via `/api/wallet/lock`; cashout credits via `/api/wallet/credit`; low-balance guard shows dialog
- `_AviatorPainter` CustomPainter: grid lines, exponential flight path (gradient fill + glowing stroke), animated plane at multiplier tip

### Aviator — Admin-configurable server economics ✅
Backend (server-side game engine, `services/game-engines/aviator/src/index.ts`):
- `AviatorConfig` interface: `houseEdgePercent`, `rakePercent`, `maxWin`, `minBet`, `maxBet`, `bettingTimeMs`
- `loadConfig()` reads `game_configs WHERE game_type='aviator'` + `special_rules` JSONB; called at start of every round (live config changes apply next round, no restart)
- `generateCrashPoint()` uses `houseEdgePercent` to size instant-crash band (e.g. 3% → 3% of rounds crash at 1.00×)
- Cashout payout: applies `rakePercent` commission + `maxWin` cap (0 = unlimited)
- Bet validation enforces `minBet`/`maxBet`

Admin service (`services/admin-service/src/index.ts`):
- `PATCH /game-configs/:gameType` now merges `special_rules` non-destructively (existing keys preserved)

Admin panel (`admin-panel/src/pages/GameConfig.tsx`):
- New "Aviator Economics 💰" section visible only for the aviator card
- 5 configurable fields: House Edge %, Max Win Cap, Min Bet, Max Bet, Betting Window (ms)
- Form `initialValues` spreads `special_rules` so existing values pre-populate

### Android build fixes (CI) ✅
| Issue | Fix |
|---|---|
| Maven Central 403 (AGP 7.3.0 stale artifacts) | Upgraded Flutter 3.22.0 → 3.27.4 in CI workflow |
| `compileSdk 34` too low for `androidx.activity:1.10.1` | Bumped `compileSdk`/`targetSdk` to 35 |
| AGP 8.1.0 incompatible with SDK 35 | Bumped AGP to 8.3.0 |
| Gradle 8.3 incompatible with AGP 8.3.0 | Bumped Gradle wrapper to 8.4 |
| `flutter_local_notifications` desugaring error | Added `coreLibraryDesugaringEnabled = true` + `desugar_jdk_libs:2.1.4` |

### Pending for session 6 items ⏳
- [ ] **Wire mobile Aviator to server engine** (port 3005) for real-money settlement — currently runs local on-device rounds. Admin profit controls (houseEdge/rake/maxWin) only apply to server rounds.
- [ ] VPS redeploy: `git pull` + `pm2 restart teen-aviator-engine teen-admin-svc` + rebuild admin panel
- [ ] Teen Patti rake deduction (Go engine currently credits full pot)
- [ ] APK build status: last mobile commit `8a18b69` — verify green on Actions

---

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

## 🆕 Session 5 additions (Teen Patti engine wiring + OTP)

### Teen Patti — fully wired ✅
- **Go engine** (`services/game-engines/teen-patti/main.go`, port 3010) provides:
  `POST /start` → deals 3 cards per player, stores state in Redis `tp:game:{room_id}`
  `POST /action` → processes fold/call/raise/show, advances turn, determines winner
  `GET /state` → fetch current game state
- **game-gateway matchmaking** now calls `/start` after creating a room; sends each
  player their own private cards via `room:joined` event `my_cards` field
- **game-gateway game:action** handler now forwards to `/action`; broadcasts
  `game:state_update` with cards hidden; emits `game:result` on game end
- **Bot AI**: after each state update, if it's a bot's turn, gateway schedules an
  auto-play (call 70% / fold 30%) after 1.5–3s delay
- **Winner payout**: on game end, gateway calls
  `POST /internal/wallet/credit-game-win` (new wallet alias)
- **wallet-service**: added `/internal/wallet/credit-game-win` alias
- **Mobile game_page.dart**: handles `room:joined` (private cards), `game:state_update`
  (new state + last action in chat), `game:result` (win/loss banner + haptics)

### In-app OTP (free) ✅
- **auth-service otp.ts**: `sendOtp()` returns the OTP string in dev mode
  (`OTP_PROVIDER` != `msg91`)
- **auth-service routes.ts**: `POST /auth/send-otp` includes `{ otp: "123456" }` in
  response when in dev mode
- **Mobile otp_page.dart**: auto-fills OTP field when response contains `otp`; shows
  snackbar "OTP: 123456 (auto-filled)". Zero SMS cost. Switch to production by setting
  `OTP_PROVIDER=msg91` in the VPS .env — OTP will no longer appear in responses.

### VPS commands to deploy session 5 changes
```bash
cd /opt/teen && git pull origin claude/confident-archimedes-e2dd1k

# Build + start Go engine
cd services/game-engines/teen-patti
/usr/local/go/bin/go mod tidy && /usr/local/go/bin/go build -o teen-patti-engine .
pm2 start ./teen-patti-engine --name teen-tp-engine -- --port 3010
# Add to ecosystem.config.js:
# { name: 'teen-tp-engine', script: './services/game-engines/teen-patti/teen-patti-engine', env: { PORT: 3010, DATABASE_URL: '...', REDIS_URL: 'redis://127.0.0.1:6379' } }

# Restart gateway + wallet
pm2 restart teen-gateway teen-wallet

# Add to gateway's .env:
# TEEN_PATTI_ENGINE_URL=http://127.0.0.1:3010
```

---

## 🔔 Notification Service — Plan & Status

### Current status
The notification service is **fully coded** (`services/notification-service/src/index.ts`, port 3007).
It just needs **Firebase credentials** on the VPS to send real push notifications.

### What's already built
| Feature | Status |
|---|---|
| `GET /notifications/me` — list user notifications | ✅ Built |
| `PUT /notifications/read/:id` — mark read | ✅ Built |
| `POST /internal/notifications/send` — send to one user | ✅ Built |
| `POST /internal/notifications/broadcast` — send to all active users | ✅ Built |
| DB storage (notifications table) | ✅ Migration 003 |
| FCM token registration (`PUT /auth/fcm-token`) | ✅ Built |
| Mobile: FCM setup, foreground local notifications | ✅ Built |
| Mobile: Notification center page | ✅ Built |

### Auto-trigger notifications needed (still TODO)
These need to be wired into other services by calling `/internal/notifications/send`:

| Event | Service to edit | Trigger point |
|---|---|---|
| Deposit approved | admin-service | `PATCH /api/admin/deposits/:id/approve` |
| Deposit rejected | admin-service | `PATCH /api/admin/deposits/:id/reject` |
| Withdrawal approved | admin-service | `PATCH /api/admin/withdrawals/:id/approve` |
| Withdrawal rejected | admin-service | `PATCH /api/admin/withdrawals/:id/reject` |
| Game win | game-gateway / wallet-service | After `credit-game-win` |
| Game loss | game-gateway | After `game:result` with `winner_id != user_id` |
| Bonus credited | wallet-service | After bonus/referral credit |
| KYC approved/rejected | admin-service | KYC review endpoint |

### Firebase setup (FREE — 5 min)
1. Go to https://console.firebase.google.com → New Project (free Spark plan)
2. Settings → Service Accounts → Generate New Private Key → download JSON
3. On VPS: `nano /opt/teen/services/notification-service/.env`
   Add: `FIREBASE_SERVICE_ACCOUNT_JSON='<paste entire JSON on one line>'`
4. Android: Project Settings → Add Android app → package `com.myonlinejoker.app`
   → download `google-services.json`
5. Add `GOOGLE_SERVICES_JSON` GitHub secret (base64 of the file) for APK builds
6. `pm2 restart teen-notification`

Until Firebase is configured, the service logs `[PUSH DEV] To: ... | Title: Body` instead of sending real pushes. All notifications are still stored in the DB and show in the mobile notification center.

---

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
