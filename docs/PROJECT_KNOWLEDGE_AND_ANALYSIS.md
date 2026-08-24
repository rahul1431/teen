# MyOnlineJoker (Teen Platform) — Comprehensive Project Memory & Codebase Analysis

## 1. Executive Summary & Monorepo Overview

**MyOnlineJoker** (monorepo package name: `teen-platform-root`) is a real-time multiplayer gaming, casino, and sports betting platform. It is structured as an npm workspace monorepo supporting real-money card games, casual board games, crash/multiplier games, matka, lottery, and sports betting.

### Monorepo Structure

```
teen/
├── services/                Backend Microservices & Game Engines (Node.js / Go / Python)
│   ├── core-api-service/    Core REST API (Auth, Users, Leaderboards, Support, Betting, SEO) - Port 3001
│   ├── wallet-service/      Isolated Money-of-Record Ledger - Port 3003
│   ├── game-gateway/        Real-Time WebSocket Hub & Room/Matchmaker - Port 3004
│   ├── admin-service/       Admin REST API + RBAC + Audit Logging - Port 3008
│   ├── app-monitor-service/ Mobile App Analytics & Event Ingestion - Port 3015
│   ├── churn-service/       Nightly User Churn Cron Job - Port 3018
│   ├── churn-ml-service/    FastAPI Python Machine Learning Retention Models - Port 3020
│   ├── bot-learning-service/Nightly AI/Bot Profile Builder - Port 3025
│   └── game-engines/        Dedicated Server-Authoritative Game Engines
│       ├── teen-patti/      High-Performance Go Game Engine - Port 3010
│       ├── aviator/         Node.js Crash Multiplier Engine - Port 3005
│       └── ludo/            Node.js Ludo Engine & Board Rules - Port 3011
├── admin-panel/             React + Ant Design Pro Web Admin Dashboard
├── mobile/                  Flutter Mobile Client App (Android / iOS)
├── games/                   Registry (`registry.json`) - Single Source of Truth for Game Catalog
├── resources/               Version-controlled Static Resources (Game Configs, Email Templates)
├── uploads/                 Runtime User Uploads (Avatars, KYC Docs - Gitignored)
├── infra/                   Docker, Nginx Proxy Configs, DB Migrations, PM2 Ecosystem, Deploy Scripts
└── scripts/                 Automation & VPS Sync Scripts (`deploy-full-vps.js`, `upload-admin-dist.js`)
```

---

## 2. Infrastructure, VPS Connection & Deployment Mechanics

### Live VPS Topology
- **Server IP**: `64.204.130.181`
- **Live Directory Path**: `/opt/teen-prod/`
- **Process Management**: PM2 (19 total managed processes across services and game engines)
- **Web Proxy & Control Panel**: HestiaCP + Nginx (`/home/admin/conf/web/game.myonlinejoker.com/`)
- **Database**: PostgreSQL 16 (Running in Docker container `teen_postgres`)
- **In-Memory Cache & Pub/Sub**: Redis (Running in Docker container `teen_redis`)

### PM2 Process Port Layout

| Service / Engine | PM2 Process Name | Port | Directory Path | Purpose |
|---|---|---|---|---|
| **Core API** | `teen-core-api` | `3001` | `services/core-api-service` | Auth, Users, Leaderboard, Support, Betting |
| **Wallet Service** | `teen-wallet` | `3003` | `services/wallet-service` | Double-entry ledger, deposits, withdrawals |
| **Game Gateway** | `teen-gateway` | `3004` | `services/game-gateway` | WebSocket lobby, matchmaking, room distribution |
| **Aviator Engine** | `teen-aviator` | `3005` | `services/game-engines/aviator` | Crash game loop & RNG engine |
| **Admin Service** | `teen-admin-svc` | `3008` | `services/admin-service` | Admin panel REST endpoints & RBAC |
| **Teen Patti Go Engine**| `teen-tp-engine` | `3010` | `services/game-engines/teen-patti` | High-throughput Go card hand evaluation |
| **Ludo Engine** | `teen-ludo` | `3011` | `services/game-engines/ludo` | Authoritative Ludo board rules & bot AI |
| **App Monitor** | `teen-app-monitor`| `3015` | `services/app-monitor-service` | Analytics & app logs ingestion |
| **Churn Service** | `teen-churn` | `3018` | `services/churn-service` | Daily user retention & churn triggers |
| **Churn ML Service** | `teen-churn-ml` | `3020` | `services/churn-ml-service` | Python FastAPI churn predictive models |
| **Bot Learning** | `teen-bot-learning`| `3025` | `services/bot-learning-service` | AI bot profile optimization cron |

### Deployment Pipelines & Scripts
1. **VPS Direct Code Sync (`node scripts/deploy-full-vps.js`)**:
   - Compresses local workspace code and transfers it directly over SSH to `/opt/teen-prod/` on the VPS.
   - Executes `infra/deploy/go.sh` which invokes `infra/deploy/deploy-all-services.sh`.
   - Rebuilds Node/Go/Python services, runs DB migrations, and restarts PM2 processes without full deletion (`pm2 restart <name> --update-env`).
2. **Admin Panel Asset Deploy (`node scripts/upload-admin-dist.js`)**:
   - Builds `admin-panel` static assets (`npm run build`) and uploads the resulting `dist/` bundle directly into the HestiaCP Nginx webroot at `/home/admin/web/game.myonlinejoker.com/public_html/admin/`.
3. **VPS Python Runner (`python vps_run_deploy_v2.py`)**:
   - SSH pipeline script to execute remote git pull, dependency installations, migrations, and service reloads.

### In-App Force Update Version Code Rule
- **Critical Requirement**: When generating a release APK (`flutter build apk --release`), the build number `version: x.y.z+BUILD` in `mobile/pubspec.yaml` **MUST** strictly match or exceed the `version_code` registered in the `app_versions` database table / Admin Panel.
- **Why**: `PackageInfo.fromPlatform().buildNumber` checks the installed build against `version_code`. If `version_code` on the server is higher than the compiled APK's internal `buildNumber`, users experience an infinite force-update loop after installing the file.

---

## 3. Financial Wallet & Ledger Architecture

The financial layer (`services/wallet-service`) is the platform's money-of-record. No other service modifies balances directly. Communication occurs over HTTP authenticated via an `x-internal-key` header.

### Three-Balance Wallet Architecture
Every user wallet maintains three distinct balances enforced by PostgreSQL `CHECK (>= 0)` constraints:
1. **`real_balance`**: Withdrawable funds derived from cash deposits, winnings, and direct admin manual credits.
2. **`bonus_balance`**: Non-withdrawable promotional funds (daily login rewards, promo code bonuses, referral incentives). Can be used for game stakes based on configured bonus burn rules.
3. **`locked_balance`**: Money reserved during an active game hand/round or held during a pending withdrawal request. Isolated from spendable funds.

### Ledger Primitives & Idempotency
All balance mutations use atomic database transactions with row-level locks (`SELECT ... FOR UPDATE`) and `wallet_transactions` entries:
- **`credit`**: Adds funds to `real_balance` or `bonus_balance` (e.g., deposit approval, game winnings, bonus rewards).
- **`debit`**: Deducts funds from `real_balance` or `bonus_balance` (e.g., sports/matka stakes). Throws `Insufficient balance` error if funds are inadequate.
- **`lockForGame`**: Transfers funds from `real_balance` → `locked_balance` when joining a game or placing a round bet.
- **`unlockFunds`**: Refunds funds from `locked_balance` → `real_balance` (e.g., cancelled game, idle room reaping, rejected withdrawal).
- **`consumeLockedFunds`**: Permanently burns `locked_balance` funds upon round settlement (e.g., losing hand) or withdrawal payout execution.

Every ledger operation requires a unique `idempotency_key`. The `wallet_transactions` table enforces `idempotency_key UNIQUE NOT NULL` with `ON CONFLICT DO NOTHING`, guaranteeing that retried network requests will never execute duplicate debit/credit transactions.

---

## 4. Complete Game Catalog & Mechanics

### A. Teen Patti (Go Engine — Port 3010)
- **Architecture**: Implemented in Go for microsecond hand evaluation and concurrency.
- **Hand Ranking (Highest to Lowest)**:
  1. **Trail / Trio (3 of a kind)**: A-A-A highest, 2-2-2 lowest.
  2. **Pure Sequence (Straight Flush)**: A-2-3 or A-K-Q same suit.
  3. **Sequence (Straight)**: Consecutive cards of mixed suits.
  4. **Color (Flush)**: 3 cards of the same suit.
  5. **Pair**: 2 cards of equal rank.
  6. **High Card**: Highest card value.
- **Betting Rules**:
  - **Blind vs. Seen**: Seen players must bet double the current minimum Chaal stake compared to Blind players.
  - **Side-Show / Show**: Players can request side-shows with adjacent players.
  - **Tie-Breakers**: Defender wins in tie-breakers; Blind beats Seen.
- **Rake Fee**: Default 5% house rake deducted from the total pot prior to winner credit.
- **Bot Fill Integration**: Dynamic bot injection maintains active table sizes (e.g., min table size of 4).

### B. Aviator (Node Engine — Port 3005)
- **Architecture**: Server-authoritative crash game running on a high-frequency event loop over WebSockets (`/ws/aviator`).
- **RNG & Multiplier Formula**:
  - Crash multiplier calculated using a house-edge weighted distribution: $M = \frac{0.97}{1 - r}$, where $r \in [0, 1)$ is a uniform random float.
  - **Instant Crash (1.00x)** occurs in 3% of rounds to guarantee a 3% house edge.
- **Cashout Validation**: Client triggers cashout via WebSocket; server verifies active bet status and locks current multiplier at the exact server timestamp to prevent network spoofing.

### C. Ludo (Node Engine — Port 3011)
- **Architecture**: Authoritative board game state engine enforcing turn timing, token movement, and bot play.
- **Board Mechanics**:
  - 8 Safe Cells on the board (4 home start cells + 4 star cells: `{0, 8, 13, 21, 26, 34, 39, 47}`).
  - Rolling a `6` grants an extra turn. Rolling three consecutive `6`s forfeits the turn.
  - Capturing an opponent token or bringing a token into the home square awards an extra turn.
- **Settlement**: Winner takes total table pool minus 5% house rake.

### D. Matka (Core API — Port 3001)
- **Betting Variations**: Single Digit, Single Panna, Double Panna, Triple Panna, Jodi.
- **Session Types**: Open Session and Close Session.
- **Settlement Logic**: Results declared by submitting 3-digit Panna (e.g., `139` -> sum `13` -> digit `3`). Jodi formed by combining Open and Close single digits. Automatic payouts calculated and credited to winning wallets.

### E. Lottery (Core API — Port 3001)
- **Mechanics**: Ticket-based draws with set entry prices and maximum ticket quotas.
- **Draw Execution**: Automated or admin-triggered random winning ticket selection.
- **Cancellation**: If a draw is cancelled, all purchased ticket stakes are automatically refunded to users' `real_balance`.

### F. Cricket & Sports Betting (Core API — Port 3001)
- **Markets**: Match Winner, Over/Under, Session/Fancy bets.
- **Settlement & Voiding**: Admin or automated feed settles markets upon match completion. Abandoned/rain-affected matches trigger market voiding with 100% stake refunds.

---

## 5. Real-Time WebSocket Architecture

- **Primary Gateway Endpoint**: `/ws` (Port 3004) for Matchmaking, Lobbies, Ludo, Teen Patti, and In-Game Chat.
- **Aviator Endpoint**: `/ws/aviator` (Port 3005) for high-speed crash multiplier updates.
- **Authentication**: JWT token passed via connection query parameter (`wss://domain/ws?token=JWT_TOKEN`).
- **State Sanitization**: Server automatically strips hidden opponent cards before broadcasting `game:state_update` events to prevent client-side memory inspection.

---

## 6. Code Analysis & Quality Audit

### Key Architectural Strengths
1. **Isolated Financial Ledger**: The separation of `wallet-service` ensures transaction integrity, balance safety (`CHECK (>= 0)` constraints), and idempotency protection against double-spends.
2. **High-Performance Go Game Engine**: Moving Teen Patti hand evaluation and state to a Go microservice (`services/game-engines/teen-patti`) enables high concurrency and low latency.
3. **Microservices Granularity**: Clear isolation between public REST APIs (`core-api-service`), real-time gateways, ML services, and background analytics.

### Technical Debt & Maintenance Findings
1. **Legacy Deploy Scripts**: `infra/deploy/` contains multiple legacy deployment scripts (`deploy-hestia.sh`, `deploy-services.sh`). The canonical live path is `infra/deploy/go.sh` → `infra/deploy/deploy-all-services.sh` targeting `/opt/teen-prod`.
2. **Global Zod Validation Error Handling**: Certain internal microservice routes lack standardized global Zod validation formatters, causing unhandled 500 errors when malformed JSON bodies are passed instead of structured 400 bad request responses.
3. **Manual Deposit Verification Workflow**: UPI deposits rely on manual admin UTR match verification in the Admin Panel before calling the ledger credit API.

---

## 7. Operational Runbooks Quick Reference

### Manual UPI Deposit Verification
1. Obtain 12-digit UTR reference number from user screenshot.
2. Confirm payment receipt in bank merchant ledger.
3. Admin Panel → User Management → Transactions → Approve Deposit.
4. System executes `WalletService.credit` and sends FCM push notification.

### Force Update Deployment Steps
1. Bump `version: x.y.z+BUILD` in `mobile/pubspec.yaml` (e.g. `1.0.4+4215`).
2. Build release binary: `flutter build apk --release`.
3. Upload APK binary in Admin Panel under App Versions with `version_code = 4215`.
4. Verify version parity using `/downloads/app-release.apk`.
