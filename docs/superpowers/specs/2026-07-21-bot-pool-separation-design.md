# Bot Pool Separation — Design Spec

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

`services/game-gateway/src/matchmaking.ts` fills game rooms with bot accounts drawn from a single global pool: `SELECT u.id, u.username FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.is_bot = true AND u.status = 'active' AND w.real_balance >= $1 ORDER BY RANDOM() LIMIT $2`. This pool is shared across every game type — the same bot identity can be seated in a Teen Patti table one moment and a Ludo table the next.

Investigation of production data (`teen_db`, 2026-07-21) found 30 total bot accounts:
- 8 have only ever played Teen Patti
- 10 have played **both** Teen Patti and Ludo (each skewed 2–4x more toward Teen Patti participation)
- 0 have ever played Ludo exclusively
- 12 have never played anything

This is sub-project #1 of a larger bot-management initiative (bot pool separation → bot management UI → Ludo training pipeline → PnL dashboard), scoped narrowly here to just the pool separation itself. This is the foundation the later UI work depends on.

Only Teen Patti and Ludo actually use this bot-fill mechanism today — `game_configs.bot_fill_enabled` is `false` for Aviator and Matka (single-player games, no seated bots), so despite `getBots()` being generic/shared code, it has zero practical effect on those game types right now.

## Goal

Give Teen Patti and Ludo each a dedicated, non-overlapping pool of bot accounts, so a bot seated in one game's tables never appears in the other's, while keeping both games' live bot-fill fully operational (no regression — this is real-money matchmaking on two locked, production game systems).

## Non-Goals

- No changes to bot decision-making logic (`chooseBotToken`, `pickBotAction`, et. al.) — that's sub-project #3.
- No new bot-management admin UI — that's sub-project #2, built on top of this.
- No changes to Aviator/Matka, since they don't use this mechanism today.
- No changes to bot creation flow beyond ensuring new bots get tagged (the flow itself isn't being redesigned here).

## Design

### 1. Schema

Add one nullable column to `users`:

```sql
ALTER TABLE users ADD COLUMN preferred_game_type VARCHAR(30);
CREATE INDEX idx_users_bot_game_type ON users(is_bot, preferred_game_type) WHERE is_bot = true;
```

- `NULL` for every real (non-bot) player, forever — this column is only meaningful when `is_bot = true`.
- No `CHECK` constraint tying it to a fixed game-type list — future games shouldn't require a migration to add a valid value here, and the value is only ever compared for equality against whatever `gameType` string `getBots()` receives.

### 2. Backfill (one-time data migration, same migration file)

The 30 existing bots, split evenly 15/15 to keep both games' bot-fill healthy despite Ludo having zero exclusive history:

**Teen Patti (15):** the 8 Teen-Patti-only bots (Seema_Bot, Anjali_Bot, Arun_Bot, Kavita_Bot, Amit_Bot, Deepak_Bot, Shyam_Bot, Kiran_Bot) + the 5 "both" bots with the lowest Ludo participation share (Shiva, Saritha, Bhaskar, Rakesh, Rathod) + 2 never-played bots (Sunita_Bot, Neha_Bot).

**Ludo (15):** the 5 "both" bots with the highest Ludo participation share (Pawar, Manisha, Anjali, nithin, Mohan) + the remaining 10 never-played bots (Raju_Bot, Meera_Bot, Pooja_Bot, Priya_Bot, Nisha_Bot, Vikram_Bot, Arjun_Bot, Rahul_Bot, Rohan_Bot, Suresh_Bot).

Assignment is by `username` (stable, human-readable, verified unique in the current data) rather than hardcoded UUIDs, so the migration reads correctly without a prior UUID lookup step — each `UPDATE` targets a `username IN (...)` list.

After backfill, assert no bot is left with a `NULL` `preferred_game_type` (migration fails loudly if the assertion doesn't hold, rather than silently leaving an untagged bot that would vanish from both pools once enforcement lands).

### 3. Enforcement

`services/game-gateway/src/matchmaking.ts`'s `getBots()` (currently line 401-413) adds a `preferred_game_type` filter:

```sql
SELECT u.id, u.username
FROM users u
JOIN wallets w ON w.user_id = u.id
WHERE u.is_bot = true AND u.status = 'active' AND u.preferred_game_type = $1 AND w.real_balance >= $2
ORDER BY RANDOM() LIMIT $3
```

(`$1` = `gameType`, shifting the existing `$1`/`$2` stake/count params to `$2`/`$3`.)

No fallback to the old ungated behavior — a bot with `NULL` `preferred_game_type` simply won't be selected by any game after this ships, which is the intended failure mode (forces every bot to be explicitly tagged, catching any gap in the backfill or bot-creation flow immediately via reduced/zero bot-fill rather than silent cross-game leakage).

### 4. Bot creation flow

Whatever currently creates a bot account (admin panel's Bots.tsx page and/or a bot-seeding script — to be identified during implementation) must be updated to require/set `preferred_game_type` on creation. This spec doesn't yet know the exact creation code path; the implementation plan's first task investigates and documents it before writing the change.

### 5. Testing

This is real-money matchmaking logic on two locked, live systems, so this gets real automated tests, not just manual spot-checks:

- `getBots('teen_patti', ...)` never returns a bot with `preferred_game_type = 'ludo'`, and vice versa — a direct DB-level integration test against a seeded test database.
- Migration correctness: after running the backfill, a query asserting zero bots have `NULL` `preferred_game_type` passes.
- Existing matchmaking tests (if any exist covering `getBots`/room-fill) continue to pass unmodified except for the new filter param.

### 6. Rollout

This is a schema + backend logic change deployed the same way prior backend fixes in this codebase have been (migration run against prod DB, service restart) — not the surgical frontend-dist-copy process used for the admin panel. Deployment mechanics are detailed in the implementation plan, not this spec.

## Risks / Open Questions

- The bot-creation code path is not yet identified — the implementation plan's Task 1 must locate it before the creation-flow change can be written concretely.
- If actual concurrent bot-fill demand exceeds what a 15-bot pool can support during peak load (multiple simultaneous tables draining available bots faster than `autoRefillBots` tops up wallet balances), either game could see degraded bot-fill after this ships. This is a real risk versus the current shared-pool baseline where either game could draw from all 30. Mitigation: monitor bot-fill success rate post-deploy; the 15/15 split is a starting allocation, not a permanent constraint — `preferred_game_type` can be rebalanced later (that's exactly what sub-project #2's reassignment UI is for).
