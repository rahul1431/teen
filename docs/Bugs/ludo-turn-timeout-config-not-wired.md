# Ludo's seeded `turn_timeout_seconds` config field is never read — the real AFK timeout is a hardcoded constant

**Severity:** Low-Medium
**Found:** 2026-07-28, games documentation pass (ludo)
**Files:** `infra/db/migrations/008_enable_ludo.sql` (seeds `special_rules.turn_timeout_seconds = 20`), `services/game-gateway/src/matchmaking.ts` (`LUDO_TURN_TIMEOUT_MS = 30000`, hardcoded)

## What's wrong

The Ludo-enabling migration seeds a `game_configs.special_rules.turn_timeout_seconds` value of 20 seconds, which looks purpose-built to let the AFK timeout be configured per-deployment or per-admin-edit. A repo-wide grep for `turn_timeout_seconds`/`turnTimeoutSeconds` finds only that migration's write — no code anywhere reads it. The actual timeout used at runtime is the hardcoded `LUDO_TURN_TIMEOUT_MS = 30000` constant in `matchmaking.ts`, which doesn't even match the seeded value (30s vs. the seeded 20s).

## Impact

Anyone tuning Ludo's economics or fairness parameters via the database (or via an admin UI that might someday expose `special_rules`) would reasonably expect changing this field to affect the AFK timeout — it does nothing. There is currently no operational lever to adjust the AFK window without a code change and redeploy.

## Fix

Either have the gateway read `game_configs.special_rules.turn_timeout_seconds` for Ludo and use it in place of the hardcoded constant, or remove the unused field from the migration/seed data to avoid the false impression that it's configurable.
