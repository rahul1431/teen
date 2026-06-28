# Phase 2 & Phase 3 Design Spec
**Date:** 2026-06-28  
**Platform:** MyOnlineJoker (game.myonlinejoker.com)  
**Branch:** claude/confident-archimedes-e2dd1k  
**Status:** Approved — ready for implementation planning

---

## Overview

This spec covers two sequential AI/ML phases that build on the Phase 1 Fraud Detection infrastructure already live:

| Phase | Name | New Service | Port | Core Mechanic |
|---|---|---|---|---|
| 2 | Churn Prediction | `churn-service` | 3013 | Hourly cron scores deposit inactivity → auto-bonus + notification |
| 3 | Bot Learning | `bot-learning-service` | 3014 | Nightly cron profiles real player quartiles → difficulty-tier bot parameters |

Both follow the same pattern as the existing `risk-service`: dedicated Node.js/Fastify microservice, PostgreSQL for persistence, Redis for fast lookups, admin-service proxies admin endpoints, AI Control Center in admin panel surfaces the data.

---

## Phase 2 — Churn Prediction

### Definition
A user is **churned** when they stop depositing (revenue churn). Engagement activity (logins, games played) is not a churn signal — only deposit inactivity counts.

### Data Flow

```
[Hourly Cron]
    ↓
SELECT wallet_transactions WHERE type='deposit' GROUP BY user_id
    ↓
Compute churn score (0–100) per user
    ↓
Upsert → user_churn_scores table
    ↓
[Threshold check]
    ├── score 30–59 (Low): flag in admin panel only
    ├── score 60–79 (Medium): POST → notification-service (push notification)
    └── score 80–100 (High): POST → notification-service + POST → wallet-service (bonus credit)
```

### Churn Score Formula

```
score = deposit_inactivity_score + frequency_drop_score

deposit_inactivity_score (0–70):
  - 0 days since deposit  → 0 pts
  - 3 days                → 30 pts  (Low threshold)
  - 7 days                → 60 pts  (Medium threshold)
  - 14+ days              → 70 pts  (High threshold)
  - Linear interpolation between breakpoints

frequency_drop_score (0–30):
  - Compare deposits_last_14_days vs deposits_prior_14_days
  - 0% drop  → 0 pts
  - 50% drop → 15 pts
  - 100% drop (stopped completely) → 30 pts

Exclusions:
  - Accounts created < 3 days ago (grace period)
  - Users with status = suspended | banned
  - Users who have never deposited (no baseline)
```

### Risk Tiers & Auto-Actions

| Tier | Score Range | Default Trigger | Auto-Action |
|---|---|---|---|
| Low | 30–59 | 3 days no deposit | Flag in admin panel only |
| Medium | 60–79 | 7 days no deposit | Push notification: "We miss you! Come back and play" |
| High | 80–100 | 14 days no deposit | Push notification + ₹50 bonus credited to bonus_balance |

All thresholds and bonus amounts are stored in `churn_config` and editable by admin without redeployment. Defaults above are seeded on first run.

**Cooldown:** Once an auto-action is triggered for a user, no further auto-action fires for 7 days (prevents spam). Stored as `action_taken_at` in `user_churn_scores`.

### Database Schema

```sql
-- Upserted hourly, one row per user (latest score)
CREATE TABLE user_churn_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  score             NUMERIC(5,2) NOT NULL DEFAULT 0,
  risk_level        VARCHAR(10) CHECK (risk_level IN ('none','low','medium','high')),
  days_since_deposit NUMERIC(10,2),
  last_deposit_at   TIMESTAMPTZ,
  action_taken      VARCHAR(50),   -- 'notification' | 'bonus+notification' | null
  action_taken_at   TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Admin-configurable thresholds and bonus amounts
CREATE TABLE churn_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID REFERENCES admin_users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults
INSERT INTO churn_config (key, value) VALUES
  ('low_threshold_days', '3'),
  ('medium_threshold_days', '7'),
  ('high_threshold_days', '14'),
  ('high_bonus_amount', '50'),
  ('action_cooldown_days', '7'),
  ('grace_period_days', '3'),
  ('cron_interval_minutes', '60');
```

### Churn Service Endpoints

```
GET  /api/churn/users
     Query: ?risk_level=high|medium|low&limit=50&offset=0
     Returns: paginated at-risk users with scores and last deposit info

GET  /api/churn/stats
     Returns: { total_at_risk, by_level: { low, medium, high }, bonuses_sent_today, notifications_sent_today }

POST /api/churn/re-engage/:userId
     Body: { send_bonus: bool, send_notification: bool }
     Action: manual admin-triggered re-engagement (ignores cooldown)
     Auth: admin only

GET  /api/churn/config
     Returns: all churn_config key-value pairs

PATCH /api/churn/config
     Body: { key: value, ... }
     Action: update one or more config values with audit trail
     Auth: superadmin only

GET  /health
```

### Admin Panel — "Churn" Tab in AI Control Center

A 4th tab added to the existing `AIControlCenter.tsx` page:

**Left panel — Stats bar:**
- Total at-risk users (Low / Medium / High counts)
- Bonuses sent today | Notifications sent today

**Center — At-risk users table:**
- Columns: Username, Phone, Risk Level (color-coded chip), Score, Days Since Deposit, Last Deposit, Action Taken, Re-Engage button
- Filterable by risk level
- "Re-Engage" button per row → calls `/api/churn/re-engage/:userId`

**Right panel — Config:**
- Editable fields: Low/Medium/High threshold days, High bonus amount (₹), Cooldown days
- Save button → PATCH `/api/churn/config`

---

## Phase 3 — Bot Learning

### Definition
Bots currently use hardcoded probabilities (call 70%, fold 30%, delay 1.5–3s). Phase 3 replaces these with profiles derived from real player behavioral data, segmented into Easy / Medium / Hard difficulty tiers.

### Data Sources

| Source | Data Used | How Accessed |
|---|---|---|
| `game_results` table | Win/loss outcomes, pot amounts | PostgreSQL query |
| `game_participants` table | Profit/loss per player per game | PostgreSQL query |
| `wallet_transactions` table | Stake preferences (avg bet size) | PostgreSQL query |
| Redis Stream `events:all` (last 7 days) | Action sequences, decision timing, fold/raise frequency | XREVRANGE with 7-day cutoff |

### Nightly Rebuild Flow

```
[Nightly Cron at 2 AM]
    ↓
For each game_type in [teen_patti, ludo, aviator]:
    ↓
    1. Fetch all non-bot players with ≥ min_sample_size games in last 30 days
    ↓
    2. Rank players by profit/loss (percentile)
    ↓
    3. Aggregate behavioral stats per quartile group:
       - Bottom 25%  → Easy tier profile
       - 40th–60th   → Medium tier profile
       - Top 25%     → Hard tier profile
    ↓
    4. Enrich with Redis stream data (action timing, raise/fold/call ratios)
    ↓
    5. Upsert bot_profiles table (3 rows per game_type)
    ↓
    6. Publish bot:profiles:rebuilt to Redis (game-gateway cache invalidation)
```

If `sample_size < min_sample_size` (default: 10 real players), the rebuild is skipped for that game/tier and the previous profile is retained. This prevents bad profiles from sparse data on a new platform.

### Bot Profile Metrics

```
win_rate_target         float   — target win % for this tier
fold_probability        float   — P(fold) on any decision
call_probability        float   — P(call)
raise_probability       float   — P(raise)   [fold+call+raise = 1.0]
avg_decision_delay_ms   int     — median human-like pause in ms
avg_stake_preference    float   — avg stake level in ₹
aggression_score        float   — raise/(call+fold) ratio, 0–10 scale
sample_size             int     — real players this profile was built from
```

### Database Schema

```sql
-- One row per (game_type, difficulty), upserted nightly
CREATE TABLE bot_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type             VARCHAR(30) NOT NULL,
  difficulty            VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  win_rate_target       NUMERIC(5,2),
  fold_probability      NUMERIC(4,3),
  call_probability      NUMERIC(4,3),
  raise_probability     NUMERIC(4,3),
  avg_decision_delay_ms INTEGER,
  avg_stake_preference  NUMERIC(10,2),
  aggression_score      NUMERIC(4,2),
  sample_size           INTEGER DEFAULT 0,
  last_rebuilt_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_type, difficulty)
);

-- Admin-configurable rebuild parameters
CREATE TABLE bot_learning_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID REFERENCES admin_users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults
INSERT INTO bot_learning_config (key, value) VALUES
  ('rebuild_hour', '2'),
  ('stream_lookback_days', '7'),
  ('history_lookback_days', '30'),
  ('min_sample_size', '10'),
  ('easy_percentile_max', '25'),
  ('medium_percentile_min', '40'),
  ('medium_percentile_max', '60'),
  ('hard_percentile_min', '75');
```

### Fallback Profiles (Seeded on First Run)

When the platform is new and real player data is insufficient, these hardcoded defaults are seeded into `bot_profiles` so bots work immediately. Nightly rebuild will overwrite them as real data accumulates.

| Difficulty | fold | call | raise | delay_ms | aggression |
|---|---|---|---|---|---|
| Easy | 0.45 | 0.45 | 0.10 | 2800 | 1.8 |
| Medium | 0.30 | 0.47 | 0.23 | 2000 | 3.5 |
| Hard | 0.18 | 0.42 | 0.40 | 1400 | 6.2 |

### Bot Learning Service Endpoints

```
GET  /api/bots/profile?game_type=teen_patti&difficulty=medium
     Used by game-gateway on bot spawn. Returns single profile.
     Falls back to hardcoded defaults if no profile found.

GET  /api/bots/profiles
     Returns all profiles (all game types, all tiers) — for admin panel.

POST /api/bots/rebuild
     Trigger manual nightly rebuild immediately (admin only).
     Returns: { status: 'started', game_types: [...] }

GET  /api/bots/config
     Returns all bot_learning_config key-value pairs.

PATCH /api/bots/config
     Body: { key: value, ... }
     Update config with audit trail. Superadmin only.

PATCH /api/bots/profiles/:gameType/:difficulty
     Body: { fold_probability, call_probability, ... }
     Admin manual override of any profile field post-rebuild.

GET  /health
```

### Game Gateway Change

**Current (hardcoded):**
```ts
// bot auto-play: call 70% / fold 30%, delay 1.5–3s
const action = Math.random() < 0.7 ? 'call' : 'fold'
const delay = 1500 + Math.random() * 1500
```

**After Phase 3 (profile-driven):**
```ts
const profile = await getBotProfile(gameType, botDifficulty) // cached in Redis
const rand = Math.random()
const action = rand < profile.fold_probability ? 'fold'
             : rand < profile.fold_probability + profile.call_probability ? 'call'
             : 'raise'
const delay = profile.avg_decision_delay_ms * (0.7 + Math.random() * 0.6) // ±30% jitter
```

Bot difficulty is set per-room when created. Default is `medium` unless admin configures otherwise via the existing Bot Configuration page.

### Admin Panel — AI Control Center ML Config Extension

The existing **ML Config tab** (`MLConfigPanel.tsx`) gets a new "Bot Learning" section below the existing Fraud Detection / Churn / RTP sections:

- **Profile cards** — 3 cards per game type (Easy / Medium / Hard), showing current probabilities and last rebuilt timestamp + sample size
- **"Rebuild Now" button** — triggers POST `/api/bots/rebuild`
- **Per-field sliders** — admin can nudge any probability post-rebuild (PATCH `/api/bots/profiles/:gameType/:difficulty`)
- **Config panel** — editable rebuild hour, lookback days, min sample size

---

## Service Port Map (Updated)

| Service | Port | Status |
|---|---|---|
| auth-service | 3001 | Live |
| wallet-service | 3002 | Live |
| leaderboard-service | 3003 | Live |
| game-gateway | 3004 | Live |
| aviator engine | 3005 | Live |
| risk-service (Phase 1) | 3006 | Built |
| notification-service | 3007 | Live |
| admin-service | 3008 | Live |
| teen-patti engine | 3010 | Live |
| ludo engine | 3011 | Live |
| betting-service | 3012 | Live |
| **churn-service (Phase 2)** | **3013** | **New** |
| **bot-learning-service (Phase 3)** | **3014** | **New** |

---

## Implementation Order

1. **Phase 2 first:**
   - Migration: `user_churn_scores`, `churn_config` tables
   - `churn-service` with hourly cron + endpoints
   - Admin-service: proxy churn endpoints
   - Admin panel: Churn tab in AI Control Center

2. **Phase 3 second:**
   - Migration: `bot_profiles`, `bot_learning_config` tables + seed fallback profiles
   - `bot-learning-service` with nightly cron + endpoints
   - Game-gateway: replace hardcoded bot probabilities with profile fetch
   - Admin panel: Bot Learning section in ML Config tab

3. **PM2 ecosystem:** Add both new services
4. **Nginx:** Add proxy routes for ports 3013 and 3014
5. **CHANGELOG.md:** Update to reflect Phase 2 + Phase 3 complete

---

## Success Criteria

**Phase 2:**
- [ ] Hourly cron runs and scores all eligible users
- [ ] High-risk users automatically receive a bonus + push notification (respects cooldown)
- [ ] Admin can view at-risk segment and manually re-engage any user
- [ ] Admin can change thresholds without redeployment

**Phase 3:**
- [ ] Nightly rebuild produces profiles for all 3 tiers × all game types
- [ ] Game gateway uses profile probabilities for bot decisions (not hardcoded values)
- [ ] Fallback to hardcoded defaults when service is unreachable
- [ ] Admin can view current profiles, trigger manual rebuild, and override individual fields
