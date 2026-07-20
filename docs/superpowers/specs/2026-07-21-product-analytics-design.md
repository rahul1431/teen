# Product Analytics (Custom, No PostHog) — Design

## Purpose

Close a set of concrete product-analytics gaps — deposit funnel drop-off, onboarding funnel, retention/cohort comparison, safe feature-flag rollout, and A/B testing — without adopting PostHog. PostHog was evaluated and rejected: self-hosting its stack (ClickHouse + Kafka/plugin-server + its own Postgres/Redis) on the production VPS (3 CPUs, ~1.8GB free RAM, already running ~17 PM2 processes including all game engines and wallet-service) carries a real risk of an OOM event taking down a real-money service. This design instead reuses existing infrastructure (the shared Postgres, existing Node services, existing admin-panel) the same way every other custom system on this platform (App Monitor, Player Tracking, the Agent commission system) was built — no new processes, no new containers, no new third-party dependency.

## Scope

**In scope:**
- Deposit/withdrawal funnel drop-off tracking
- Onboarding funnel (signup → first deposit → first bet)
- Retention/cohort comparison (e.g. agent-referred vs. direct signups)
- Feature flags with percentage rollout and an explicit user allowlist
- A/B testing (built on top of feature flags + event tracking)
- Admin-panel usage analytics (lower priority, same event mechanism)

**Explicitly out of scope:**
- **Session replay.** Reconstructing a full UI session recording is a substantial project even for PostHog itself (mobile replay is hard even for them) and disproportionate to build custom. If ever genuinely needed later, bring in a narrow tool just for that — do not build it here.
- Anything that duplicates Player Tracking (fraud/device-fingerprint/location), App Monitor (server/process health), or AI Control Center (fraud rules, churn ML) — those solve different problems and are not being replaced or touched by this work.

## Two gaps need zero new instrumentation

The onboarding funnel and retention/cohort views are computable entirely from existing data:
- `users.created_at` (signup)
- First `wallet_transactions` row of type `deposit` per user (first deposit)
- First bet/game-session row per user, per game (first bet) — read from each game's existing history tables
- `users.agent_id` (for agent-referred vs. direct cohort splits)

These are pure SQL aggregation queries against tables that already exist. No mobile-app changes, no new tables, no event tracking needed for these two views.

## Data model

**New tables** (migration, next number after the Agent system's `082_agent_commission_system.sql`):

```sql
product_events
  id            uuid pk default gen_random_uuid()
  user_id       uuid nullable fk -> users.id      -- nullable: pre-auth events (app opened before login)
  event_name    text not null                     -- 'deposit_screen_opened', 'deposit_completed', 'game_started', etc.
  properties    jsonb                             -- {game: 'teen_patti', amount: 500, variant: 'b', ...}
  source        text not null check (source in ('mobile', 'admin_panel'))
  created_at    timestamptz not null default now()
  -- indexes: (event_name, created_at), (user_id), (created_at) for time-window queries

feature_flags
  id                uuid pk default gen_random_uuid()
  key               text unique not null           -- 'agent_referral_banner'
  description       text
  enabled           boolean not null default false  -- master on/off switch
  rollout_percent   int not null default 0 check (rollout_percent between 0 and 100)
  enabled_user_ids  uuid[]                          -- explicit allowlist, always on regardless of rollout_percent
  variants          jsonb nullable                  -- A/B: [{"key":"a","weight":50},{"key":"b","weight":50}]; null = simple on/off flag
  created_by        uuid fk -> admin_users.id
  created_at        timestamptz not null default now()
  updated_at        timestamptz not null default now()
```

## Flag evaluation (pure function)

A deterministic, side-effect-free function — same TDD pattern used for the Agent commission system's hierarchy/settlement logic:

```
evaluateFlag(flag, userId) → { enabled: boolean, variant?: string }
```

- If `!flag.enabled` → `{ enabled: false }`.
- Else if `userId` is in `flag.enabled_user_ids` → `{ enabled: true }` (plus a deterministically-assigned variant if `flag.variants` is set), regardless of `rollout_percent`.
- Else: `hash(userId + flag.key) % 100 < flag.rollout_percent` decides on/off. If `flag.variants` is set and the flag is on, a second deterministic hash buckets the user into a variant according to the configured weights.
- **Determinism is required**: the same user must always get the same on/off/variant result for a given flag configuration — no flip-flopping between app opens. This rules out `Math.random()`; a stable hash of `userId + flagKey` is required.

## Components

- **Migration**: `product_events`, `feature_flags` tables as above.
- **`core-api-service`** (player-facing — what the mobile app already talks to):
  - `POST /events` — log a product event (authenticated via the existing player JWT; `user_id` derived from the token, not client-supplied)
  - `GET /flags` — evaluate all flags for the current player once; the mobile app fetches this at launch and caches it, rather than a network call per screen/check
- **`admin-service`** (staff-only, matches the existing admin auth/role convention):
  - `GET /api/admin/analytics/funnels/deposit` — deposit funnel stage counts + conversion rates over a date range
  - `GET /api/admin/analytics/funnels/onboarding` — signup → deposit → bet funnel, computed from existing tables (no `product_events` involved)
  - `GET /api/admin/analytics/retention` — cohort retention (e.g. agent-referred vs. direct), computed from existing tables
  - `GET/POST/PATCH /api/admin/analytics/flags` — feature flag CRUD, `requireRole('superadmin')`
  - `GET /api/admin/analytics/ab-results/:flagKey` — per-variant conversion comparison for a flag with `variants` set
  - `POST /api/admin/analytics/events` — admin-panel usage tracking (same `product_events` table, `source='admin_panel'`)
- **`admin-panel`**: new "Analytics" page, tabs — Deposit Funnel, Onboarding Funnel, Retention Cohorts, Feature Flags (CRUD + rollout-percent slider), A/B Test Results.
- **Mobile (Flutter)**: a small `ProductAnalytics` service — `track(event, properties)` fire-and-forget POST, `isEnabled(flagKey)` cached lookup (flags fetched once at launch, not re-fetched per check).

Both `core-api-service` and `admin-service` write to / read from the same `product_events` and `feature_flags` tables directly via their own DB pools — consistent with the existing pattern in this codebase where services already query each other's tables directly (e.g. `admin-service` reads `wallet_transactions` without going through `wallet-service`'s API) rather than proxying through an internal HTTP call.

## Testing

- Pure-function unit tests for `evaluateFlag`: rollout-percentage boundaries (0%, 100%, mid-range), allowlist override regardless of rollout_percent, variant weight distribution, and determinism (same input always produces the same output across repeated calls).
- Funnel/retention SQL queries verified manually against real data (same approach used for the Agent settlement job, given no live test DB is available in the development sandbox) — each query's output spot-checked against a hand-computed expected value from a small real data sample before trusting the dashboard.

## Explicitly out of scope (deferred)

- Session replay (see above).
- Any mobile SDK/client-library abstraction beyond the minimal `ProductAnalytics` service described — no attempt to build a general-purpose analytics SDK.
- Automatic event capture (e.g. auto-tracking every screen view/click) — only explicit, deliberately-placed `track()` calls at the specific funnel points identified in this design. Instrumentation quality is only as good as what's deliberately added; this is a conscious choice to keep event volume and engineering effort bounded to the gaps actually identified.
