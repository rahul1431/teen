# Progress & Resume Checkpoint

> Living status doc. Read this first when resuming. Last updated: 2026-06-20 (session 2).
> Branch: `claude/confident-archimedes-e2dd1k` · PR: #1 (draft) · Base: `main`
> Latest APK commit: `9480aff` · Admin preview: https://rahul1431.github.io/teen/

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

## 🎨 Teen Patti UI — reference-match TODO (await user OK)
Reference: Behance "Teen Patti Game UI/UX" (gallery 185793255) — screenshots
shared by user. Still to match:
1. Action buttons → **Pack · Side Show · Chaal** with +/- bet stepper + pot coin
2. **Status pills** on seats (Chaal/Pack/Blind) + red **"D"** dealer button
3. **Gift badge** on each avatar; **green glow** ring on active player
4. **Card backs** (blue patterned) for opponents
5. **Top bar** gold-circle icons (exit/info/chat/add-friend); optional hostess
6. **Lobby** redesign (menu cards: Join/Create Private, Play Variation,
   Premium Table; bottom nav; coin balance; Spin & Win wheel)

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
