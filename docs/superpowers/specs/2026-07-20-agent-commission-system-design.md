# Agent / Sub-Agent Commission System — Design

## Purpose

Add a persistent "Agent" role to the platform: agents recruit players (and other agents), and earn ongoing commission on the platform's net win from the players in their network — distinct from the existing one-time "refer a friend" player bonus, which stays as-is.

## Commission model

- **Basis**: % of net house win (players' net losses) from an agent's referred players. Computed from the existing `wallet_transactions` ledger — `SUM(game_debit) − SUM(game_credit)` per player per day — not from any individual game's bet tables. This means **no changes to any game engine**, including currently-locked games (Teen Patti, Aviator, Ludo, Lottery).
- **Hierarchy**: multi-level, capped at 3 levels (Master Agent → Sub-Agent → Player). No deeper nesting.
- **Cascade**: override model. A sub-agent earns their own configured rate on their direct players. Their upline (recruiting agent) earns the *difference* between the upline's rate and the sub-agent's rate, applied to the sub-agent's own direct-player pool. Admin must not be able to set an upline's rate lower than a downline's (this would produce a negative override) — enforced at assignment time in the UI/API, not just floored at runtime.
- **Settlement**: daily, automatic. A nightly job (runs shortly after midnight, processes the previous day) computes each agent's commission and credits it directly to their wallet as a new `'commission'` transaction type.
- **Negative days**: if an agent's player pool collectively wins money in a day (house net loss), that agent's commission for the day is floored at zero. No carry-forward, no debt — the agent simply earns nothing that day, never owes anything back.

## Agent identity & onboarding

- Agents are **not** promoted player accounts — they are a wholly separate identity, created only by admin (admin-approved onboarding, no self-serve signup). An agent doesn't need to be a registered player themselves.
- Agents log into the same admin-panel application as staff, but under a new restricted `agent` role/JWT that only exposes their own network — never other agents' data or general admin functionality.

## Referral integration

- Extends the **existing** referral system rather than duplicating it. The `/join?ref=<code>` resolver, which currently only checks player `referral_code`s, is extended to also check `agents.referral_code`.
- A signup is attributed to either an agent (recurring commission tracking) or a referring player (existing one-time bonus) — never both, based on which code was actually used.

## Data model

**New tables:**

```
agents
  id                uuid pk
  username           text unique
  password_hash      text
  display_name       text
  phone              text
  status             enum('active','suspended')
  parent_agent_id    uuid nullable, fk -> agents.id  (null = top-level Master Agent)
  commission_rate    numeric(5,2)   -- percent
  referral_code      text unique
  created_by         uuid  -- admin user id
  created_at         timestamptz

agent_commission_ledger
  id                 uuid pk
  agent_id           uuid fk -> agents.id
  date               date
  direct_commission  numeric
  override_commission numeric
  total_commission   numeric
  wallet_txn_id      uuid fk -> wallet_transactions.id, nullable
  status             enum('settled','voided')
  created_at         timestamptz
```

**Existing tables extended:**

- `users`: add nullable `agent_id` (fk -> agents.id), set once at signup.
- `wallet_transactions.TxnType`: add `'commission'` to the existing enum (`deposit | withdrawal | game_credit | game_debit | bonus | referral | manual_credit | manual_debit`).

**Hierarchy constraint**: creating a new agent with a `parent_agent_id` is rejected if that parent already has a non-null `parent_agent_id` itself (i.e. would create a 4th level).

## Components

- **Agent module inside `admin-service`** (not a new microservice — reuses existing admin auth/role infrastructure and the `requireRole` pattern already in use): agent CRUD, agent auth, hierarchy validation, daily settlement job.
- **Daily settlement job**: for each agent with direct players, `direct_commission = rate × max(0, Σ net_house_win)` over yesterday's `wallet_transactions` for their direct players. For each agent with sub-agents, override is computed per downline: `max(0, upline_rate − downline_rate) × downline's own direct-player pool net win`, summed across all downlines, also floored at zero. Total credited to agent's wallet as one `'commission'` transaction; a ledger row is written for audit.
- **Admin-panel "Agents" module** (full admin/superadmin access): create/edit/suspend agents, assign parent + rate with the rate-sanity check, view the full hierarchy tree, view any agent's player list and ledger history, void a specific day's ledger entry for an agent (fraud/error correction — reverses the wallet credit via `manual_debit`, marks the ledger row `voided`, never deletes it).
- **Agent-panel** (same admin-panel app, restricted `agent` role): own referral link/code, direct player list (read-only — joined date, last active, contribution), sub-agents if any with their aggregated override contribution, daily commission history and running total.

## Data flow

1. Player signs up via `/join?ref=<agent_code>` → resolver matches an agent code → sets `users.agent_id`.
2. Player plays normally; no game-engine changes. Wallet ledger accrues as it already does.
3. Nightly job aggregates the previous day's `wallet_transactions` per player, rolls up to `agent_id`, walks up the (at most 2-hop) hierarchy applying the override model, credits wallets, writes ledger rows.
4. Agent logs into the admin-panel under their role and sees the settlement reflected in their history and running total.

## Edge cases / guardrails

- **Self-referral fraud**: block an agent's own linked accounts (matched via existing Player Tracking device-fingerprint data) from counting toward that agent's commission.
- **Admin reversal**: a specific day's ledger row can be voided by admin after the fact; the reversal is an explicit `manual_debit`, not a silent delete — full audit trail preserved.
- **Suspended agent**: their existing players are unaffected and keep playing; the settlement job simply skips commission accrual for a suspended agent going forward. Their upline's override continues to be computed from that agent's downline activity as normal (the suspension doesn't freeze the branch below them).
- **Rate sanity**: admin UI blocks setting a commission rate above a configured max, and blocks assigning an upline rate lower than any of its existing downlines' rates.

## Testing

- Unit tests for the settlement calculation as a pure function (given transactions + hierarchy → expected ledger entries), covering the flooring/no-carry-forward rule and the override calculation across 1, 2, and 3-level hierarchies. This is the highest-risk logic (real money) and gets the most coverage.
- Integration test for the `/join?ref=` resolver correctly distinguishing agent codes from player codes and never double-attributing a signup.
- Manual admin-panel walkthrough for agent CRUD and hierarchy-depth enforcement (reject 4th-level creation).

## Explicitly out of scope (deferred)

- Push/SMS notifications to agents on new signups or settlement.
- Admin leaderboard of top agents.
- KYC requirement for agent accounts.
- Any direct fund-management capability for agents (deposits/withdrawals/limit changes on player accounts) — agents are read-only regarding player accounts.
