# MyOnlineJoker Platform - Changelog

## Current Version: Phase 3 - Bot Learning (Phase 1 + 2 + 3 complete)

**Release Date**: June 28, 2026  
**Status**: Development - In Testing

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Services Built](#services-built)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Game Engines](#game-engines)
6. [Admin Panel](#admin-panel)
7. [Mobile App](#mobile-app)
8. [WebSocket & Real-time](#websocket--real-time)
9. [Deployment](#deployment)

---

## Architecture Overview

### Microservices Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT LAYER                      │
│  ┌──────────────┐          ┌──────────────────┐     │
│  │  Flutter App │          │   Admin Panel    │     │
│  │  (Mobile)    │          │   (Web - React)  │     │
│  └──────────────┘          └──────────────────┘     │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│                  API GATEWAY                         │
│  ┌──────────────────────────────────────────────┐  │
│  │ Game Gateway (Node.js)                       │  │
│  │ - WebSocket: Real-time game sync             │  │
│  │ - Internal APIs: Fraud scoring, room mgmt    │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│                  MICROSERVICES LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Auth Service │  │ Wallet       │  │ Notification│       │
│  │ (Auth, JWT)  │  │ Service      │  │ Service     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Admin Service│  │ Leaderboard  │  │ Betting      │       │
│  │ (RBAC)       │  │ Service      │  │ Service      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Monitoring   │  │ Risk Service │  │ Analytics    │       │
│  │ Service      │  │ (Fraud)      │  │ Service      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└──────────────────────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│                 GAME ENGINES LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Teen Patti   │  │ Ludo         │  │ Aviator      │       │
│  │ (Go)         │  │ (Node.js)    │  │ (Node.js)    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└──────────────────────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────────────────┐
│              DATA & CACHING LAYER                            │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │  PostgreSQL Database │  │  Redis Cache         │         │
│  │  (Persistent Data)   │  │  (Real-time Events)  │         │
│  └──────────────────────┘  └──────────────────────┘         │
└──────────────────────────────────────────────────────────────┘
```

---

## Services Built

### 1. Auth Service
- **Type**: Authentication & Authorization
- **Port**: 3001
- **Features**:
  - JWT token generation
  - User registration & login
  - Session management
  - Device fingerprinting

### 2. Wallet Service
- **Type**: Financial Management
- **Port**: 3002
- **Features**:
  - Double-entry ledger system
  - Deposits & withdrawals
  - Real/bonus balance separation
  - Transaction history

### 3. Game Gateway
- **Type**: API Gateway & WebSocket Hub
- **Port**: 3004
- **Features**:
  - Real-time WebSocket connections
  - Game room management
  - Internal service orchestration
  - Fraud score integration (blocks/slow-lanes)

### 4. Admin Service
- **Type**: Admin Panel Backend
- **Port**: 3008
- **Features**:
  - RBAC (readonly, support, finance, superadmin)
  - 2FA/TOTP authentication
  - User management
  - Financial approvals
  - **NEW (Phase 1)**: Fraud detection endpoints
  - **NEW (Phase 1)**: ML configuration endpoints

### 5. Monitoring Service
- **Type**: Event Streaming & Monitoring
- **Port**: 3005
- **Features**:
  - WebSocket event listener from game-gateway
  - Redis Streams publisher (events:all)
  - PostgreSQL persistence
  - Real-time metrics aggregation
  - SSE endpoint for event streaming

### 6. Risk Service ⭐ NEW (Phase 1)
- **Type**: Fraud Detection Engine
- **Port**: 3006
- **Features**:
  - Redis Streams consumer (events:all)
  - Real-time fraud analysis
  - 4-rule detection engine:
    - Co-location detection
    - Win-rate anomalies
    - Velocity checks
    - Referral chain detection
  - Weighted scoring (30/35/20/15%)
  - Action thresholds (allow/slow_lane/block)
  - PostgreSQL logging
  - Redis alerting
  - Manual flag/unflag endpoints

### 7. Leaderboard Service
- **Type**: Rankings & Stats
- **Port**: 3003
- **Features**:
  - Real-time leaderboards
  - Player statistics
  - Historical rankings

### 8. Notification Service
- **Type**: User Communications
- **Port**: 3007
- **Features**:
  - Push notifications
  - In-game alerts
  - Email notifications

### 9. Betting Service
- **Type**: Bet Management
- **Features**:
  - Matka betting
  - Lottery tickets
  - Sports betting
  - Bet slip generation

---

## Database Schema

### Core Tables

#### users
```sql
- id (UUID, PK)
- phone (VARCHAR, unique)
- username (VARCHAR, unique)
- password_hash (bcrypt)
- status (active/suspended/banned)
- is_bot (boolean)
- referral_code (VARCHAR)
- created_at, updated_at
```

#### wallets
```sql
- id (UUID, PK)
- user_id (FK → users)
- real_balance (DECIMAL)
- bonus_balance (DECIMAL)
- locked_in_games (DECIMAL)
- updated_at
```

#### wallet_transactions
```sql
- id (UUID, PK)
- user_id (FK → users)
- amount (DECIMAL)
- type (deposit/withdrawal/bet_placed/bet_won/rake_paid)
- reference (game_id, payment_order_id)
- created_at
```

#### game_results
```sql
- id (UUID, PK)
- room_id (FK → game_rooms)
- game_type (teen_patti/ludo/aviator)
- winner_id, loser_id (FK → users)
- winning_amount, pot_amount (DECIMAL)
- duration (seconds)
- created_at
```

#### game_participants
```sql
- id (UUID, PK)
- room_id (FK → game_rooms)
- user_id (FK → users)
- final_position (1-6)
- profit_loss (DECIMAL)
- joined_at, left_at
```

### Monitoring Tables (Phase 1)

#### game_events
```sql
- id (UUID, PK)
- event_type (joinMatchmaking/gameAction/roomJoined/gameResult)
- game_type (teen_patti/ludo/aviator)
- user_id (FK → users)
- room_id (UUID)
- amount (DECIMAL)
- raw_data (JSONB)
- created_at (indexed for TTL: 30 days)
```

### Fraud Detection Tables (Phase 1) ⭐

#### fraud_events
```sql
- id (UUID, PK)
- user_id (VARCHAR)
- game_type (teen_patti/ludo/aviator)
- rule_triggered (co_location/win_rate_anomaly/velocity/referral_chain)
- fraud_score (0-1, NUMERIC(3,2))
- confidence (0-1, NUMERIC(3,2))
- evidence (TEXT)
- action (allow/slow_lane/block)
- resolved (boolean)
- resolved_at (TIMESTAMP)
- resolved_by (FK → admin_users)
- resolution_notes (TEXT)
- created_at, updated_at (indexed)
```

#### device_fingerprints
```sql
- id (UUID, PK)
- user_id (FK → users)
- fingerprint (VARCHAR, indexed)
- device_info (JSONB)
- last_seen (TIMESTAMP)
- created_at, updated_at
```

#### user_fraud_flags
```sql
- id (UUID, PK)
- user_id (FK → users)
- is_flagged (boolean)
- reason (TEXT)
- flagged_by (FK → admin_users)
- expires_at (TIMESTAMP)
- created_at, updated_at
```

#### fraud_config_history
```sql
- id (UUID, PK)
- config (JSONB)
- changed_by (FK → admin_users)
- change_reason (TEXT)
- created_at
```

#### referrals
```sql
- id (UUID, PK)
- referee_id (FK → users)
- referrer_id (FK → users)
- referral_code (VARCHAR)
- bonus_awarded (DECIMAL)
- created_at
```

### Admin & RBAC Tables

#### admin_users
```sql
- id (UUID, PK)
- username (VARCHAR, unique)
- password_hash (bcrypt)
- role (readonly/support/finance/superadmin)
- totp_secret (TOTP 2FA)
- totp_enabled (boolean)
- is_active (boolean)
- last_login_at (TIMESTAMP)
- created_at
```

#### admin_audit_log
```sql
- id (UUID, PK)
- admin_id (FK → admin_users)
- action (user_suspended/withdrawal_approved/config_changed)
- resource_id (user_id/order_id)
- details (JSONB)
- created_at
```

---

## API Endpoints

### Admin Service - Fraud Detection (Phase 1) ⭐

```
GET  /api/admin/fraud-alerts
     Query: ?limit=50&action=block|slow_lane|allow
     Returns: Recent fraud alerts with evidence

GET  /api/admin/fraud-stats
     Query: ?hours=24
     Returns: Aggregated fraud metrics (total, blocks, avg_score, unique_users)

GET  /api/admin/user/:userId/fraud-history
     Query: ?limit=50
     Returns: All fraud events for a user

POST /api/admin/user/:userId/fraud-flag
     Body: { isFlagged: boolean, reason: string }
     Action: Manually flag/unflag user (7-day expiry if flagged)

PATCH /api/admin/fraud-alerts/:alertId/resolve
     Body: { resolved: boolean, notes?: string }
     Action: Resolve/reopen fraud alert with audit trail
```

### Risk Service - Fraud Detection (Phase 1) ⭐

```
GET  /api/risk/alerts
     Query: ?limit=50&action=block|slow_lane
     Returns: Recent fraud alerts

GET  /api/risk/user/:userId/history
     Query: ?limit=50
     Returns: User fraud history

GET  /api/risk/stats
     Query: ?hours=24
     Returns: Fraud statistics

POST /api/risk/user/:userId/flag
     Body: { isFlagged: boolean, reason: string }
     Action: Manual flagging (admin only)

GET  /health
     Returns: Service health status
```

### Admin Service - ML Configuration (Phase 1) ⭐

```
POST /api/admin/ml/query
     Body: { query: string }
     Returns: { answer: string, confidence: 0-1, executionTime: ms }
     Examples:
     - "analyze churn for stake=100 users"
     - "fraud alert: show evidence for player X"
     - "explain bot decision for player_id=xyz"

POST /api/admin/ml/config
     Body: {
       fraudDetection: {
         coLocationThreshold: 3,
         winRateAnomalyThreshold: 95,
         velocityLimitHours: 1,
         referralChainDepth: 2,
         enabled: true
       },
       churnPrediction: { ... },
       botSettings: { ... },
       rtpOptimizer: { ... }
     }
     Action: Update ML config, publish to ml:config:change

GET  /api/admin/ml/metrics
     Returns: Real-time ML metrics (models, jobs, predictions, system health)
     Refresh: 5 seconds
```

---

## Game Engines

### 1. Teen Patti (Go)
- **Location**: `/services/game-engines/teen-patti/`
- **Features**:
  - 2-6 player games
  - Blind system with antes
  - Show/fold mechanics
  - Side pots
  - Bot players with difficulty settings
  - Real-time WebSocket sync
  - Hand strength evaluation
  - Rake collection (configurable %)

### 2. Ludo (Node.js)
- **Location**: `/services/game-engines/ludo/`
- **Features**:
  - 2-4 player games
  - Turn-based mechanics
  - Dice roll simulation
  - Piece movement rules
  - Win condition evaluation
  - Bot players
  - Real-time synchronization

### 3. Aviator (Node.js)
- **Location**: `/services/game-engines/aviator/`
- **Features**:
  - Crash game mechanics
  - Real-time multiplier growth
  - Auto-cashout support
  - House edge management
  - Winning calculation
  - Bot crash prediction

---

## Admin Panel

### Pages Built

#### Dashboard
- Real-time player count
- Active games count
- GGR (Gross Gaming Revenue) today
- Key metrics: active users, avg session, churn

#### Users Management
- Search/filter users
- View user profile & stats
- Suspend/ban users
- View wallet balance
- Manual wallet adjustments

#### Financial Management
- Withdrawal requests (pending/approved/rejected)
- Approve/reject with UTR
- Payment method management
- QR code management for deposits

#### Betting Management
- Matka market creation/editing
- Lottery draws management
- Draw result declaration
- Bet settlement

#### Bot Management
- Create/delete bot players
- Configure bot difficulty
- Monitor bot performance
- Adjust bot behavior

#### AI Control Center ⭐ NEW (Phase 1)

**Tab 1: AI Prompt Console**
- Natural language query interface
- Chat-like interaction
- Example queries: churn, fraud, bot, revenue
- LocalStorage history persistence
- Real-time responses with confidence scores

**Tab 2: ML Configuration Panel**
- Fraud Detection config:
  - Co-location threshold (2-10)
  - Win-rate threshold (70-99%)
  - Velocity hours (1-24)
  - Referral depth (1-5)
- Churn Prediction config:
  - Feature weights
  - Retrain frequency
- Bot Settings:
  - Max win rate (30-70%)
  - Difficulty level
  - Decision tree depth
  - Aggression level (1-10)
- RTP Optimizer:
  - Min/max rake %
  - Test duration
  - Confidence threshold
- Live save/load with validation

**Tab 3: Workflow Dashboard**
- Training Progress (left):
  - Model status & accuracy
  - Last retrain timestamp
- Active Jobs (center):
  - Progress bars with counts
  - Latency metrics
- System Health (right):
  - CPU%, Memory%
  - P50/P95 latency
  - Model inference speed
- Real-time Feeds (bottom):
  - Churn risk alerts
  - Fraud detection alerts
  - Bot decision stream
- Auto-refresh: 5 seconds

### Components

```
src/pages/
├── AIControlCenter.tsx (155 lines)
│   ├── Tab 1: AIPromptConsole
│   ├── Tab 2: MLConfigPanel
│   └── Tab 3: WorkflowDashboard
└── src/components/AI/
    ├── AIPromptConsole.tsx (189 lines)
    ├── MLConfigPanel.tsx (350 lines)
    ├── WorkflowDashboard.tsx (290 lines)
    └── index.ts
```

---

## Mobile App

### Flutter App Structure

```
lib/
├── main.dart
├── config/
│   ├── routes.dart
│   └── theme.dart
├── features/
│   ├── auth/
│   │   ├── pages/
│   │   └── widgets/
│   ├── games/
│   │   ├── teen_patti/
│   │   │   ├── game_page.dart (⭐ FIXED: white screen/flashing)
│   │   │   ├── widgets/
│   │   │   └── engine/
│   │   ├── ludo/
│   │   └── aviator/
│   ├── wallet/
│   ├── leaderboard/
│   └── profile/
├── services/
│   ├── api/
│   ├── websocket/
│   └── auth/
└── utils/
```

### Teen Patti Game (Fixed - Phase 0)

**Issues Fixed**:
- ✅ White screen on landscape entry
- ✅ Flashing during orientation transition
- **Solution**: Landscape latch gate with loading screen

**Current Features**:
- Real-time WebSocket sync
- Blind betting system
- Hand strength display
- Rake collection
- Bot players with difficulty
- Sound effects
- Vibration feedback

---

## WebSocket & Real-time

### Game Gateway WebSocket Events

```
Client → Server:
  - joinMatchmaking
  - leaveMatchmaking
  - gameAction (fold/check/bet/raise/call)
  - gameResult (disconnect)

Server → Client:
  - playerJoined
  - roomJoined
  - gameState (pot, active players, current turn)
  - gameAction (other player's actions)
  - gameResult (winner, amounts)
  - fraudAlert (slow_lane/block)
```

### Monitoring Service Event Stream

```
Redis Streams: events:all
  - Source: Game Gateway WebSocket
  - Format: { event_type, game_type, user_id, room_id, amount, timestamp }
  - TTL: 30 days (archival)
  - Consumers: Monitoring Service, Risk Service, Analytics Service
```

### Real-time Data Flow

```
Game Action
    ↓
Game Gateway (WebSocket)
    ↓
Monitoring Service (Redis Streams)
    ↓
┌─────────────────┬──────────────────┐
↓                 ↓                  ↓
Risk Service   Analytics Service   [Admin Dashboards]
(Fraud)        (Metrics)
    ↓                ↓
Fraud Alerts    Real-time Stats
    ↓                ↓
Admin Panel ← ← ← ← ← ← ← ← ←
```

---

## Deployment

### Production Stack

- **OS**: Linux (Ubuntu 22.04)
- **Runtime**: Node.js 18+ (Services), Go 1.20+ (Game Engines)
- **Database**: PostgreSQL 14+
- **Cache**: Redis 7+
- **Process Manager**: PM2
- **Load Balancer**: Nginx
- **VPS**: 64.204.130.181 (4GB RAM, 2 CPU cores)

### Deployment Checklist

- [x] Database migrations applied
- [x] All services built and running
- [x] Admin panel accessible at game.myonlinejoker.com/admin
- [x] SSL/TLS configured (nginx)
- [x] Environment variables configured
- [x] Phase 1: Fraud Detection ✅
  - [x] Risk Service deployed
  - [x] Fraud detection tested
  - [x] Admin alerts integrated
- [x] Phase 2: Churn Prediction ✅
  - [x] Churn Service deployed
  - [x] Hourly scoring cycle
  - [x] Admin Churn tab integrated
- [x] Phase 3: Bot Learning ✅
  - [x] Bot Learning Service deployed
  - [x] Nightly profile rebuild
  - [x] Admin Bot Learning section integrated
- [ ] Phase 4: Advanced Features (pending)

### Services Status

| Service | Port | Status | Last Deploy |
|---------|------|--------|-------------|
| Auth Service | 3001 | ✅ Live | June 26 |
| Wallet Service | 3002 | ✅ Live | June 26 |
| Leaderboard Service | 3003 | ✅ Live | June 26 |
| Game Gateway | 3004 | ✅ Live | June 26 |
| Monitoring Service | 3005 | ✅ Live | June 27 |
| Risk Service (Fraud) | 3006 | ⏳ Pending | - |
| Notification Service | 3007 | ✅ Live | June 26 |
| Admin Service | 3008 | ✅ Live | June 28 |
| Betting Service | - | ✅ Live | June 26 |
| Churn Service | 3013 | ⏳ Pending | - |
| Bot Learning Service | 3014 | ⏳ Pending | - |

---

## Recent Commits

```
e2613cb - feat: Implement Fraud Detection Rules Engine (Phase 1)
8bbb3be - feat: Add AI Control Center to Admin Panel with ML configuration UI
8604dbb - Phase 1: Add Monitoring Service (WebSocket → Redis Streams → PostgreSQL)
6dbcaa5 - fix(teen-patti): eliminate all setState calls causing full-tree rebuilds
da9ca3c - fix(teen-patti): stop duplicate game push and full-tree rebuilds
cb44cf9 - Update pubspec.lock and GeneratedPluginRegistrant after flutter pub get
```

---

## Quick Links

- **Repository**: https://github.com/rahul1431/teen
- **Admin Panel**: game.myonlinejoker.com/admin
- **Mobile App**: Available on Play Store (Android) / App Store (iOS)
- **API Documentation**: See individual service README.md files
- **Database Migrations**: `/infra/db/migrations/`

---

## Support & Contact

For issues or deployment help, refer to:
- Service README files in each `/services/*/`
- Database schema documentation in migrations
- Admin panel tooltips and help text
- GitHub issues: https://github.com/rahul1431/teen/issues

---

**Last Updated**: June 28, 2026  
**Version**: Phase 1 (Development)  
**Next Review**: July 1, 2026
