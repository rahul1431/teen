# MyOnlineJoker Platform — Unified Knowledge Base

Welcome to the MyOnlineJoker system manual. This document serves as the single source of truth for developers, operations, and customer support teams. It covers the microservices architecture, port layout, database schema, real-time protocols, game logic, and operational runbooks.

---

## 📖 Table of Contents
1. [System Architecture & Ports](#1-system-architecture--ports)
2. [Database Schema & Migrations](#2-database-schema--migrations)
3. [Real-time WebSocket Protocols](#3-real-time-websocket-protocols)
4. [Game Rules & Payout Math](#4-game-rules--payout-math)
5. [Operations & Support Runbooks](#5-operations--support-runbooks)
6. [Deployment & Infrastructure](#6-deployment--infrastructure)

---

## 1. System Architecture & Ports

MyOnlineJoker is structured as a modular microservices platform designed for horizontal scaling, fast real-time synchronization, and transaction safety.

```
                  ┌──────────────────┐
                  │   Flutter App    │
                  └────────┬─────────┘
                           │ (WebSockets & REST)
                           ▼
                  ┌──────────────────┐
                  │   Nginx Proxy    │
                  └────────┬─────────┘
                           │
      ┌────────────────────┼────────────────────┐
      ▼                    ▼                    ▼
┌───────────┐        ┌───────────┐        ┌───────────┐
│ Core API  │        │  Gateway  │        │   Admin   │
│  (3001)   │        │  (3004)   │        │  (3008)   │
└─────┬─────┘        └─────┬─────┘        └─────┬─────┘
      │                    │                    │
      └──────────┬─────────┴──────────┬─────────┘
                 ▼                    ▼
           ┌───────────┐        ┌───────────┐
           │  Wallet   │        │ Engines   │
           │  (3003)   │        │ (3010/11) │
           └───────────┘        └───────────┘
```

### Microservice Directory & Port Mappings
All services run via PM2 on the VPS. The core services are consolidated into a single Core API, while critical real-time engines and financial logic remain isolated.

| Service Name | Port | PM2 Process Name | Cwd Directory Path | Description |
|---|---|---|---|---|
| **Core API** | `3001` | `teen-core-api` | `services/core-api-service` | Auth, Users, Leaderboard, Notifications, SEO, Support, and Betting API. |
| **Wallet Service** | `3003` | `teen-wallet` | `services/wallet-service` | Isolated ledger, deposit reconciliations, withdrawal locks. |
| **Game Gateway** | `3004` | `teen-gateway` | `services/game-gateway` | Real-time WebSocket hub for matchmaking, lobby, and chat. |
| **Aviator Engine** | `3005` | `teen-aviator` | `services/game-engines/aviator` | Server-authoritative crash multiplier game loops. |
| **Admin Service** | `3008` | `teen-admin-svc` | `services/admin-service` | RBAC admin panel endpoints (user edits, finances, risk). |
| **Teen Patti Go Engine** | `3010` | `teen-tp-engine` | `services/game-engines/teen-patti` | High-performance Go game engine for hand evaluations. |
| **Ludo Engine** | `3011` | `teen-ludo` | `services/game-engines/ludo` | Authoritative Ludo board rules and bot players. |
| **Churn Service** | `3018` | `teen-churn` | `services/churn-service` | Nightly user churn calculation crons. |
| **Churn ML Service** | `3020` | `teen-churn-ml` | `services/churn-ml-service` | FastAPI Python server for ML retention models. |
| **App Monitor** | `3015` | `teen-app-monitor` | `services/app-monitor-service` | Analytical event ingestion from Flutter SDK. |
| **Bot Learning** | `3025` | `teen-bot-learning` | `services/bot-learning-service` | Nightly bot-profile rebuild cron. |

---

## 2. Database Schema & Migrations

Persistent storage uses PostgreSQL 16. Migrations are stored in [infra/db/migrations/](file:///c:/Users/Rahul/Desktop/teen/infra/db/migrations) and applied sequentially.

### Key Database Tables
- `users`: User profiles, credentials, KYC status (`pending`, `approved`, `rejected`), referral code, and device fingerprints.
- `wallets`: Financial records. Maintains three separate balances:
  - `real_balance`: Withdrawable funds.
  - `bonus_balance`: Non-withdrawable promotional funds (daily login, promo codes, referral rewards).
  - `locked_balance`: Funds reserved during an active game hand or pending withdrawal.
- `wallet_transactions`: Every credit, debit, lock, and unlock event is logged here with an `idempotency_key` to prevent double-charging.
- `payment_orders`: Track deposits (type=`deposit`, status=`pending`/`paid`/`failed`) and withdrawals (type=`withdrawal`, status=`created`/`paid`/`refunded`).
- `referrals`: Track relationships between `referrer_id` and `referee_id` with statuses (`pending`, `qualified`, `rewarded`).
- `support_kb_articles`: Support center articles sorted by categories (`deposits`, `kyc`, `game_rules`, `technical`, `general`).

---

## 3. Real-time WebSocket Protocols

Real-time matches run over raw WebSockets (replacing legacy Socket.IO to avoid Dart client crashes).

- **Matchmaking & In-Game Hub**: `/ws` (Game Gateway on port `3004`).
- **Aviator Real-time Hub**: `/ws/aviator` (Aviator Engine on port `3005`).

### Basic Socket Handshake
Clients connect over WebSocket by appending their JWT token to the query string:
`wss://game.myonlinejoker.com/ws?token=JWT_ACCESS_TOKEN`

### Real-time Event List
- `join_room` / `room:joined`: Client requests to join a lobby / Server broadcasts seats, player cards, stakes.
- `game:action`: Client triggers action (e.g. `call`, `raise`, `fold`, `show` in Teen Patti; `roll_dice`, `move_token` in Ludo).
- `game:state_update`: Server broadcasts the updated state after any action (opponents' cards are automatically stripped out by the gateway).
- `game:result`: Broadcast on game completion with the winner ID and prize.
- `room:chat`: Broadcast chat messages or emojis.

---

## 4. Game Rules & Payout Math

### A. Teen Patti (Go Engine)
- **Hand Strength (Highest to Lowest)**:
  1. **Trail / Trio**: Three cards of the same rank (A-A-A is highest, 2-2-2 is lowest).
  2. **Pure Sequence**: Three consecutive cards of the same suit (Straight Flush).
  3. **Sequence**: Three consecutive cards of different suits (Straight).
  4. **Color**: Three cards of the same suit (Flush).
  5. **Pair**: Two cards of the same rank (e.g. A-A-K).
  6. **High Card**: Highest card when no other hand is made.
- **Seen/Blind Rules**: Seen players must bet double the current minimum bet (chaal).
- **Tie-Breaker Rules**:
  - Blind player wins over a Seen player.
  - If both are Seen or both Blind, the player who did **NOT** request the show wins (defender wins).
- **Rake Calculation**: 5% default rake is deducted from the final pot before crediting the winner.

### B. Ludo (Node Engine)
- **Safe Cells**: 8 safe cells on the board (home start squares plus grey star cells: `{0, 8, 13, 21, 26, 34, 39, 47}`).
- **Roll Rules**: Rolling a `6` grants an extra turn. Three consecutive `6`s forfeits the turn.
- **Extra Turns**: Capturing an opponent token or bringing a token home grants an extra turn.
- **Pot & Payout**: Winner takes the entire pool minus a 5% rake fee.

### C. Aviator (Node Engine)
- **RNG crash curve**: Crash point is decided using a house-edge weighted formula: `0.97 / (1 - r)`, where `r` is a uniform random float `[0,1]`. Instant crashes at `1.00x` occur in 3% of rounds (decided by the house edge parameter).
- **Auto-Cashout**: Stepper validation handles cashout calculations on the client side, but final confirmation is processed on the server to prevent cheating.

---

## 5. Operations & Support Runbooks

### 📋 manual UPI Deposit Verification
When a player reports a deposit has not been credited:
1. Obtain the **12-digit UTR/Reference number** and payment screenshot from the player.
2. Search the bank ledger (UPI merchant portal) to verify receipt of funds.
3. In the Admin Panel, go to **User Management -> Players -> Transactions** or **Marketing & CMS -> CMS Management**.
4. If verified, trigger manual deposit credit from the deposits panel. This credits the user's wallet and fires the push notification:
   - *"Deposit Approved ✅: Your deposit of ₹X has been credited."*

### 🆔 KYC Review Guidelines
When review status is pending:
- Verify Aadhaar/PAN image clarity.
- **Name Match**: Name on ID card **MUST** exactly match the Bank Holder Name on the account profile.
- Reject immediately if:
  - Text is blurry/unreadable.
  - Card looks digitally modified or edges are cut off.
  - User is under 18 years of age.
- When rejecting, provide a clear, concise rejection reason in the modal (e.g., *"Aadhaar back image blurry"*). The system will notify the user:
  - *"KYC Rejected ❌: ... Please re-submit your documents."*

### 🏏 Cricket & Betting Game Settlements
- **Matka**: Open session result is declared by inputting the 3-digit Panna (e.g. `139` -> digit `3`). Close session is declared similarly. Jodi is formed by joining open and close digits.
- **Lottery**: Input winning tickets and declare draws. Ticket price is refunded automatically to all participants if a draw is cancelled.
- **Cricket**: Settle individual markets (e.g. Match Winner) or void the market (refunding all stakes) if the match is abandoned.

---

## 6. Deployment & Infrastructure

### Commands to Run Deployments
Deployments are performed via the deployment script:
```bash
python vps_run_deploy_v2.py
```
This script pulls the repository on the VPS, updates Node dependencies, builds TypeScript code, runs database migrations, and reloads PM2 services.

### PM2 Monitoring Commands (VPS Terminal)
- Check running status: `pm2 status`
- Monitor resource usage: `pm2 monit`
- View live console logs: `pm2 logs`
- Restart specific service: `pm2 restart teen-core-api`
- Persist service list: `pm2 save`
