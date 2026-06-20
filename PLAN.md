# 3-Day Multiplayer Gaming Platform — Execution Plan

## Scope for 3-Day Launch

| Item | Decision |
|---|---|
| **Games** | Teen Patti (multiplayer) + Aviator (solo crash) |
| **Backend** | Node.js + Go + PostgreSQL + Redis + Socket.IO |
| **Admin Panel** | React + Ant Design Pro (web) |
| **Mobile** | Flutter → APK via GitHub Actions |
| **Deployment** | Backend + Admin Panel → VPS (Ubuntu) via SSH/SFTP |
| **Flutter** | GitHub repo → GitHub Actions → APK artifacts |

> All other games (Rummy, Ludo, Matka, Lottery) are **Phase 2** (Week 2+).  
> Payments are **stubbed** on Day 1 (manual top-up) and wired on Day 2 once Razorpay is ready.

---

## Claude Session Strategy

> **Claude has a 5-hour session limit and weekly usage limits.**  
> Each day = 1 focused session. Work is scoped so each session is self-contained and ends with a deployable checkpoint. If a session hits the limit mid-task, every task ends with a git commit so the next session can resume cleanly.

| Session | Day | Focus | Ends With |
|---|---|---|---|
| **Session 1** | Day 1 | Infrastructure + Auth + Wallet + DB | VPS running, APIs reachable |
| **Session 2** | Day 2 | Games + Admin Panel | Teen Patti + Aviator live, Admin accessible |
| **Session 3** | Day 3 | Flutter App + Testing + APK | APK downloadable, platform live end-to-end |

---

## Pre-Session Checklist (You do this — before Session 1 starts)

These are manual tasks that require your accounts and cannot be done by Claude:

- [ ] **VPS access**: Confirm SSH works — `ssh user@YOUR_VPS_IP`
- [ ] **VPS specs**: Minimum 4 vCPU, 8 GB RAM, 50 GB SSD (Ubuntu 22.04)
- [ ] **Domain/IP**: Note the public IP or domain pointing to VPS
- [ ] **Create Razorpay account**: razorpay.com → get Test API Key + Secret
- [ ] **Create Firebase project**: console.firebase.google.com → enable FCM → download `google-services.json` and `GoogleService-Info.plist`
- [ ] **GitHub repo**: Confirm `rahul1431/teen` exists and you have push access
- [ ] **Provide Claude**: VPS IP, SSH username, and any env vars needed

---

## Day 1 — Session 1 (5 hours max)

### Goal: VPS ready, database up, Auth + Wallet APIs live

### Hour 0–0.5 | VPS Bootstrap
Claude SSHs into VPS and runs setup:
```
- Install: Docker, Docker Compose, Node.js 20, Go 1.22, Git, Nginx, Certbot
- Open ports: 22 (SSH), 80 (HTTP), 443 (HTTPS), 3000-3010 (services), 5432 (PG internal)
- Create deploy user with SSH key
- Create /opt/teen/ directory structure
```

### Hour 0.5–1.5 | Database + Infrastructure
```
- Deploy via Docker Compose on VPS:
    PostgreSQL 16 (port 5432, internal only)
    Redis 7 (port 6379, internal only)
- Run DB migrations:
    users, wallets, wallet_transactions, game_rooms, game_participants tables
- Seed: admin user account, 20 bot user accounts
- Verify: psql connection, redis-cli ping
```

### Hour 1.5–3 | Auth Service + User Service
```
Files created:
  services/auth-service/   (Node.js + Fastify)
    - POST /auth/register   (phone + password)
    - POST /auth/send-otp   (MSG91 or console log if not wired)
    - POST /auth/verify-otp
    - POST /auth/login
    - POST /auth/refresh
    - JWT + Refresh token (Redis session store)

  services/user-service/   (Node.js + Fastify)
    - GET  /users/me
    - PUT  /users/me        (update username, avatar)
    - GET  /users/:id/profile

Deploy both to VPS via SSH, run with PM2, expose via Nginx reverse proxy.
Test: curl from local machine hits VPS endpoints.
```

### Hour 3–4.5 | Wallet Service
```
Files created:
  services/wallet-service/   (Node.js + Fastify)
    - GET  /wallet/balance
    - POST /wallet/deposit/manual    (admin only — manual top-up for now)
    - POST /wallet/withdraw/request
    - GET  /wallet/transactions
    - Internal: /wallet/debit, /wallet/credit (called by game services)

  Critical implementation:
    - PostgreSQL row-level lock on wallet update (SELECT FOR UPDATE)
    - Idempotency key on every transaction
    - Separate real_balance and bonus_balance columns
    - locked_balance: deducted when joining game, released on result

Deploy to VPS. Test balance debit/credit via curl.
```

### Hour 4.5–5 | Commit + Checkpoint
```
- Git commit all services with working state
- Push to branch: claude/confident-archimedes-e2dd1k
- Document .env.example for all services
- Create /opt/teen/RUNNING.md on VPS listing all live endpoints
```

### Day 1 End State
- [ ] VPS reachable at `http://YOUR_VPS_IP`
- [ ] `POST /auth/register` returns JWT
- [ ] `GET /wallet/balance` returns `{ real: 0, bonus: 0 }`
- [ ] PostgreSQL + Redis running in Docker

---

## Day 1 — Your Manual Tasks (Evening, while Claude rests)

- [ ] Sign up at Razorpay → go to Settings → API Keys → copy **Key ID** and **Key Secret** (Test mode)
- [ ] Firebase → Project Settings → Cloud Messaging → copy **Server Key**
- [ ] Firebase → download `google-services.json` (Android) — keep it ready
- [ ] Tell Claude tomorrow: VPS IP, Razorpay Key ID, Razorpay Key Secret, Firebase Server Key

---

## Day 2 — Session 2 (5 hours max)

### Goal: Teen Patti live with bots, Aviator live, Admin Panel accessible

### Hour 0–0.5 | Razorpay + FCM Wire-Up
```
- Add Razorpay credentials to wallet-service .env
- Implement:
    POST /wallet/deposit/create-order  → Razorpay order
    POST /wallet/deposit/verify        → verify signature, credit wallet
- Add FCM server key to notification-service
- Implement:
    POST /notifications/send           (internal, called by other services)
    GET  /notifications/me             (user's notification list)
```

### Hour 0.5–2 | Teen Patti Engine (Go) + Game Gateway
```
services/game-engines/teen-patti/   (Go, gRPC server)
  - Deck: 52-card Fisher-Yates shuffle (CSPRNG)
  - State machine: waiting → dealing → betting → showdown → result
  - Hand ranking: Trail > Pure Sequence > Sequence > Color > Pair > High Card
  - Move validation: call / raise / fold / show (blind/seen rules)
  - Winner determination + pot split logic

services/game-gateway/   (Node.js + Socket.IO)
  - Socket.IO server with Redis adapter (multi-pod ready)
  - JWT auth middleware on every event
  - Matchmaking queue: Redis sorted set, poll every 500ms
  - Bot fill: if <2 real players after 10s, fill with bots
  - Reconnection: 30s grace window, state replay via sequence_num
  - Events implemented:
      join_matchmaking, leave_matchmaking
      game:action (call/raise/fold/show)
      room:chat
      → game:state_update, game:your_turn, game:result, wallet:updated

Deploy both. Bot engine (Python) connects as socket client using bot user accounts.
Test: two terminals join matchmaking → game starts → play 1 round end-to-end.
```

### Hour 2–3 | Aviator Engine
```
services/game-engines/aviator/   (Node.js — simpler, single-player)
  - Provably fair crash multiplier: HMAC-SHA256(server_seed + round_id)
  - Round lifecycle: betting phase (5s) → flying phase → crash
  - Player can cash out any time during flying phase
  - Socket events:
      aviator:place_bet     → locks balance
      aviator:cashout       → credits balance at current multiplier
      → aviator:multiplier_tick (every 100ms, broadcast to all)
      → aviator:crashed     (round over, multiplier revealed)
      → aviator:round_start (new round begins, 5s betting window)
  - Multiple players bet on same round simultaneously (shared multiplier curve)
  - Round history: last 20 crash points stored in Redis

Deploy and test: place a bet, watch multiplier climb, cash out, verify wallet credited.
```

### Hour 3–5 | Admin Panel
```
admin-panel/   (React + TypeScript + Ant Design Pro)

  Pages built:
  1. Login page (admin JWT auth)
  2. Dashboard
       - Live stats: active users, active rooms, total wallet balance in system
       - Today's revenue (rake collected)
       - New registrations today
  3. User Management
       - Table: search by phone/username, filter by status
       - Actions: view profile, suspend, ban, manual wallet top-up
  4. Game Rooms (live monitor)
       - List all active rooms with player count, pot size, game type
       - Room detail: see each player (real vs bot flag for admin)
  5. Wallet / Transactions
       - All transactions table with filters
       - Pending withdrawal requests: approve / reject
  6. Bot Configuration
       - Toggle bot fill per game type
       - Set max bot ratio (0-100%)
       - Set bot difficulty (Easy / Medium / Hard)
  7. Notifications
       - Send push notification to all users or single user

Build and deploy to VPS at /opt/teen/admin-panel/ via Nginx on port 8080.
```

### Day 2 End State
- [ ] Teen Patti: 2 real users can play a full round against bots
- [ ] Aviator: user can place bet, watch multiplier, cash out
- [ ] Admin Panel: accessible at `http://YOUR_VPS_IP:8080`
- [ ] Razorpay deposit flow works in test mode
- [ ] All services committed to git

---

## Day 3 — Session 3 (5 hours max)

### Goal: Flutter app complete, APK built via GitHub Actions, full end-to-end test, go live

### Hour 0–2 | Flutter App
```
mobile/   (Flutter — Bloc + GoRouter)

Screens built:
  1. Splash + Onboarding (2 slides)
  2. Auth: Phone entry → OTP → Register username
  3. Home / Lobby
       - Balance chip (real + bonus)
       - Two game cards: Teen Patti, Aviator
       - Bottom nav: Home / Wallet / Leaderboard / Profile
  4. Teen Patti Lobby
       - Stake selector (₹10 / ₹50 / ₹100 / ₹500)
       - Join queue button → shows waiting screen → auto-enter game
  5. Teen Patti Game Screen
       - Table with 6 seats (CustomPainter or card widgets)
       - Your cards (face-up), other players (face-down until show)
       - Action bar: Call / Raise / Fold / Show (disabled when not your turn)
       - Turn timer ring around active player
       - Win/loss overlay with amount
  6. Aviator Screen
       - Crash curve (CustomPainter + ticker animation)
       - Bet amount input + Place Bet button (during betting phase)
       - Cash Out button (during flying phase, shows live multiplier)
       - Round history strip (last 10 crash points, color coded)
       - Live bets panel (all current bets in the round)
  7. Wallet Screen
       - Balance display (real vs bonus)
       - Add Money: amount input → Razorpay checkout
       - Withdraw: amount input → submit request
       - Transaction history list
  8. Leaderboard Screen
       - Daily / Weekly toggle
       - Teen Patti and Aviator tabs
  9. Profile Screen
       - Avatar, username, stats (games played, biggest win)
       - Referral code + share button
       - Settings: notification toggle, logout
  10. Push Notification handler (foreground + background via FCM)
```

### Hour 2–2.5 | GitHub Actions — APK Build Pipeline
```
.github/workflows/build-apk.yml

Triggers: push to main branch
Steps:
  1. Checkout code
  2. Setup Flutter (stable channel)
  3. flutter pub get
  4. Copy google-services.json from GitHub Secret
  5. flutter build apk --release
  6. Upload APK as GitHub Actions artifact (downloadable for 30 days)
  7. (Optional) Upload to Firebase App Distribution for tester emails

Secrets to add in GitHub repo settings:
  GOOGLE_SERVICES_JSON   (base64 encoded content of google-services.json)
  API_BASE_URL           (your VPS IP/domain)
  SOCKET_URL             (your VPS IP/domain)
```

### Hour 2.5–3.5 | Leaderboard + Referral (Backend)
```
services/leaderboard-service/
  - Redis Sorted Sets: leaderboard:daily:teen_patti, leaderboard:daily:aviator
  - Updated on every game result event
  - GET /leaderboard/:game_type?period=daily|weekly

Referral system (added to user-service):
  - Referral code generated on registration (6 char alphanumeric)
  - POST /referral/apply  → links referee to referrer
  - On referee's first deposit: credit ₹50 bonus to referrer (configurable in admin)
```

### Hour 3.5–4.5 | End-to-End Testing
```
Test checklist (run manually + automated):

AUTH:
  [ ] Register with phone number
  [ ] OTP verify (check logs/SMS)
  [ ] Login returns valid JWT
  [ ] Refresh token works

WALLET:
  [ ] Check balance (0 on new account)
  [ ] Razorpay test deposit (use test card 4111 1111 1111 1111)
  [ ] Balance reflects after deposit
  [ ] Withdrawal request appears in admin panel

TEEN PATTI:
  [ ] Open app on 2 devices (or 1 device + bot)
  [ ] Join same stake table
  [ ] Game starts within 10 seconds (bot fills if needed)
  [ ] Cards dealt, turn timer works
  [ ] Call / Raise / Fold actions work
  [ ] Game completes, winner receives pot minus rake
  [ ] Wallet balance updated on both devices
  [ ] Push notification received on game result

AVIATOR:
  [ ] Place a bet during betting phase (5s window)
  [ ] Multiplier animates from 1.00x upward
  [ ] Cash out at 2x → wallet credited correctly
  [ ] Crash event shows crash point
  [ ] New round starts automatically

ADMIN PANEL:
  [ ] Login as admin
  [ ] See both test users in User Management
  [ ] Approve withdrawal request
  [ ] Send test push notification to one user
  [ ] View live game room
```

### Hour 4.5–5 | Production Checklist + Go Live
```
[ ] Set all .env files to production values (not test keys)
[ ] Nginx config: set up domain or IP-based routing
[ ] SSL certificate: certbot --nginx (if domain is ready) or skip for IP
[ ] PM2 ecosystem file: all services restart on reboot (pm2 startup)
[ ] Push all code to GitHub (main branch)
[ ] Trigger GitHub Actions APK build → download APK artifact
[ ] Share APK link with testers
[ ] Confirm admin panel accessible
[ ] Confirm at least 1 full game played end-to-end on production VPS
```

### Day 3 End State
- [ ] Flutter APK downloadable from GitHub Actions artifacts
- [ ] Backend live on VPS, all services running via PM2
- [ ] Admin panel accessible on VPS
- [ ] Full Teen Patti game playable on APK
- [ ] Aviator playable on APK
- [ ] Real deposit flow works (Razorpay test → switch to live keys when ready)

---

## VPS Directory Structure

```
/opt/teen/
├── services/
│   ├── auth-service/       ← PM2 process: teen-auth (port 3001)
│   ├── user-service/       ← PM2 process: teen-user (port 3002)
│   ├── wallet-service/     ← PM2 process: teen-wallet (port 3003)
│   ├── game-gateway/       ← PM2 process: teen-gateway (port 3004)
│   ├── game-engines/
│   │   ├── teen-patti/     ← systemd or PM2: teen-patti-engine (port 50051 gRPC)
│   │   └── aviator/        ← PM2 process: teen-aviator (port 3005)
│   ├── leaderboard-service/ ← PM2 process: teen-leaderboard (port 3006)
│   └── notification-service/ ← PM2 process: teen-notify (port 3007)
├── admin-panel/            ← Nginx static files (port 8080)
├── docker-compose.yml      ← PostgreSQL + Redis only
├── nginx/
│   └── teen.conf           ← Reverse proxy config
└── RUNNING.md              ← All endpoints, process names, restart commands
```

## Nginx Routing

```nginx
# All API traffic → /api/auth → auth-service:3001
# All API traffic → /api/user → user-service:3002
# All API traffic → /api/wallet → wallet-service:3003
# All API traffic → /api/leaderboard → leaderboard-service:3006
# WebSocket traffic → /socket.io → game-gateway:3004
# WebSocket traffic → /aviator → aviator-engine:3005
# Admin Panel → port 8080 → static React build
```

---

## GitHub Repo Structure

```
rahul1431/teen  (branch: claude/confident-archimedes-e2dd1k)
├── services/           ← All backend microservices
├── admin-panel/        ← React admin panel
├── mobile/             ← Flutter app
├── docker-compose.yml  ← Local dev (Postgres + Redis)
├── .github/
│   └── workflows/
│       ├── build-apk.yml       ← Builds APK on push to main
│       └── deploy-backend.yml  ← SSH deploy to VPS on push to main (Day 2+)
└── PLAN.md             ← This file
```

---

## Environment Variables Reference

### Auth Service
```env
PORT=3001
JWT_SECRET=change_this_in_prod
JWT_REFRESH_SECRET=change_this_in_prod
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://teen:password@localhost:5432/teen_db
OTP_PROVIDER=msg91   # or 'console' for dev
MSG91_AUTH_KEY=your_key
```

### Wallet Service
```env
PORT=3003
DATABASE_URL=postgresql://teen:password@localhost:5432/teen_db
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=xxxxx
PLATFORM_RAKE_PERCENT=5
AUTH_SERVICE_URL=http://localhost:3001
```

### Game Gateway
```env
PORT=3004
REDIS_URL=redis://localhost:6379
TEEN_PATTI_ENGINE_URL=localhost:50051
WALLET_SERVICE_URL=http://localhost:3003
AUTH_SERVICE_URL=http://localhost:3001
BOT_FILL_ENABLED=true
BOT_FILL_DELAY_SECONDS=10
MAX_BOT_RATIO=0.6
```

### Notification Service
```env
PORT=3007
FIREBASE_SERVER_KEY=your_fcm_server_key
REDIS_URL=redis://localhost:6379
```

### Flutter App
```env
# In lib/core/constants/app_config.dart
API_BASE_URL=http://YOUR_VPS_IP
SOCKET_URL=http://YOUR_VPS_IP
RAZORPAY_KEY_ID=rzp_test_xxxxx
```

---

## Admin Panel — Feature Modules (Requested)

These modules are managed entirely from the Admin Panel. Each lists what it
includes, the backend it needs, and the target phase.

### 1) User Management  — *Phase: Day 2 (core) → Week 2 (advanced)*
Full control over every player account.
- Search / filter by phone, username, status, KYC state, balance range
- Profile drawer: game history, wallet ledger, devices, login history, referrals
- Actions: suspend, ban, unban, force-logout, reset password/PIN
- Wallet ops: manual credit / debit with reason + audit trail
- KYC review: view PAN/Aadhaar docs (`uploads/kyc/`), approve / reject
- Flags: mark VIP, mark suspicious (feeds anti-cheat), tag/segment users
- Bulk actions: export CSV, bulk notify, bulk bonus
- **Backend:** `admin-service` `/api/admin/users/*` (most endpoints exist; add devices, login-history, KYC review)

### 2) API Management  — *Phase: Week 2*
Govern the platform's own API surface and third-party keys.
- **API keys / tokens:** issue, rotate, revoke keys for partner/affiliate access; per-key scopes & rate limits
- **Third-party credentials vault:** Razorpay, MSG91/SMS, Firebase, KYC provider — store, rotate, test-connection (encrypted at rest)
- **Rate-limit & throttle config:** per-route limits editable from the panel
- **Webhook manager:** register/inspect inbound (Razorpay) + outbound webhooks, retry failed deliveries
- **API health & logs:** live status of each microservice, latency, error rate; request log viewer
- **Backend:** new `admin-service` routes `/api/admin/api-keys/*`, `/api/admin/integrations/*`; new `api_keys` + `integration_credentials` tables

### 3) In-App Update  — *Phase: Week 2*
Force or recommend app updates without an app-store round-trip.
- Admin sets: latest version, min-supported version, APK URL / store link, changelog, force-vs-optional flag
- Mobile checks a `/app/version` endpoint on launch; shows **"Update required"** (blocking) or **"Update available"** (dismissable) dialog
- Staged rollout % and per-platform (Android/iOS) control
- Maintenance-mode toggle (shows a friendly "be right back" screen app-wide)
- **Backend:** `/app/config` + `/app/version` endpoints; `app_versions` table; **Flutter:** version-gate on splash, in-app update dialog

### 4) Payment Management — Accounts Section  — *Phase: Day 2 → Week 2*
The finance/accounting cockpit.
- **Deposits:** all gateway orders, status, reconciliation vs Razorpay settlement reports
- **Withdrawals:** approval queue, KYC gate, payout batch, rejection reasons, payout-gateway status
- **Ledger / Accounts:** double-entry view, per-user statements, platform P&L, rake/commission report, GST/TDS report (India)
- **Reconciliation:** auto-match gateway settlements to internal transactions; flag mismatches
- **Refunds & adjustments:** issue refunds, manual adjustments with reason + audit
- **Dashboards:** daily/weekly/monthly revenue, deposit success rate, withdrawal SLA, top depositors
- **Exports:** CSV/Excel for accountant; date-range financial statements
- **Backend:** extends `wallet-service` + `admin-service` `/api/admin/finance/*` (queue exists; add reconciliation, refunds, statements, tax reports)

---

## Suggested Additional Admin / Platform Features

Pick any you want folded into the plan (asked via follow-up):
- **RBAC & Admin Users** — roles (superadmin, finance, support, risk, game-manager), per-role permissions, immutable audit log, 2FA for admins
- **Promotions & Bonus Engine** — deposit-match, cashback, first-game bonus, coupon codes, wagering requirements, scheduled campaigns
- **Referral / Affiliate Console** — multi-tier referrals, affiliate payouts, attribution dashboard
- **Support / Helpdesk** — in-app ticket queue, live chat, canned replies, SLA tracking
- **CMS / Content** — banners, popups, T&C/privacy pages, FAQ, what's-new — all editable live
- **Anti-Cheat / Risk Center** — flagged-user queue, collusion graph, win-rate anomalies, device-fingerprint linking, auto-suspend rules
- **Reports & Analytics** — retention cohorts (D1/D7/D30), DAU/MAU, ARPU, funnel, game-wise GGR
- **Game/Table Config** — stakes, rake, bot ratio, table limits per game (partly built)
- **Notification Center** — segmented push/SMS/email, templates, scheduling (broadcast built)
- **Responsible Gaming** — deposit/loss limits, self-exclusion, cool-off, age-gate (compliance)
- **Localization & Multi-currency** — languages, ₹/other currencies
- **Security** — admin IP allow-list, session management, audit export, secrets rotation

---

## What Happens After Day 3 (Week 2 Plan)

| Week 2 Task | Priority |
|---|---|
| Add Rummy game | High |
| Add Ludo game | High |
| KYC (PAN/Aadhaar via Digio) | High |
| Anti-cheat pattern analysis | High |
| Tournament system | Medium |
| Referral enhancements (tier 2) | Medium |
| Add Matka + Lottery | Medium |
| iOS build + App Store | Low |
| ML-enhanced bots | Low |

---

## How to Resume After a Session Limit

If Claude hits the 5-hour session limit mid-task:
1. Claude commits all in-progress work before stopping
2. In the next session, tell Claude: **"Resume from PLAN.md Day X, Hour Y"**
3. Claude reads git log and PLAN.md to understand current state
4. Work continues from exactly where it stopped

No work is lost — every task in this plan ends with a git commit checkpoint.
