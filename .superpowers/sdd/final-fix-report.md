# Final Code Review — Fix Report (Phase 2 + 3)

**Date:** 2026-06-28  
**Branch:** claude/confident-archimedes-e2dd1k

---

## Status: DONE

All critical and important findings addressed. All four TypeScript builds pass with zero errors or warnings.

---

## Changes by finding

### C1 — Re-engage validation + cooldown (churn-scorer.ts)
- Added `SELECT id FROM user_churn_scores WHERE user_id = $1` guard at top of `reEngageUser`; throws `'User not in churn risk list'` if no row.
- For external (API) calls (detected by absence of the `cfg` parameter — see I7), adds `redis.get` cooldown check throwing `'Action cooldown active'` if the key exists.
- After external call succeeds, sets `churn:action_sent:{userId}` with `EX = action_cooldown_days * 86400`.

### C2 — Safe SQL INTERVAL interpolation (churn-scorer.ts + profile-builder.ts)
- `churn-scorer.ts` `runScoringCycle`: `grace_period_days` wrapped with `parseInt(String(...), 10)` before interpolation.
- `profile-builder.ts` `rebuildForGame`: `history_lookback_days` wrapped with `parseInt(String(...), 10)` before interpolation.
- Both `updateConfig()` methods now validate all numeric keys with `parseInt`; throw `Error` if the value parses to `NaN`.

### I1 — NX atomic lock in scoreAndActOnUser (churn-scorer.ts)
- Replaced the `redis.get` + `redis.setex` pair (which had a TOCTOU window between startup scan and cron) with a single `redis.set(lockKey, '1', 'EX', cooldownSeconds, 'NX')`.
- Returns immediately if `acquired` is `null` (key already existed).
- Removed the separate `setex` after `reEngageUser` — lock is now set atomically before the call.

### I2 — cron_interval_minutes wired up (churn-scorer.ts + index.ts)
- Added `cron_interval_minutes: number` to `ChurnConfig` interface.
- Added `cron_interval_minutes` to `getConfig()` return with default `'60'`.
- `index.ts`: removed `as any` cast; `getConfig().catch()` now returns a full `ChurnConfig` literal so TypeScript is satisfied without a cast.

### I3 — botDifficulty written to room state (matchmaking.ts)
- Added `botDifficulty: 'medium'` to `fallbackState` so the field is always present in Redis.
- In `scheduleBotTurn`, `botDifficulty` is now cast `as 'easy' | 'medium' | 'hard'` ensuring it reaches `getBotProfile` as the correct union type.

### I4 — Sub-action tracking after partial failure (churn-scorer.ts)
- Replaced the single `let actionTaken = ''` accumulator with per-action DB updates inside `reEngageUser`.
- After bonus credit succeeds: `UPDATE … SET action_taken = 'bonus_credited'`.
- After notification succeeds: `UPDATE … SET action_taken = 'bonus+notification' | 'notification'` based on whether bonus also landed.

### I5 — Bot turn retry + game settlement on engine error (matchmaking.ts)
- Hoisted `action` and `amount` out of the `try` block so the catch can reference them.
- Extracted engine call + broadcast into a `doAction()` closure (avoids duplication in retry path).
- On first failure: waits 2 s, tries `doAction()` again.
- On second failure: logs error and calls `handleGameEnd(roomId, { winner_id: null, prize: 0 }, realPlayers, state)` to settle/refund players.

### I6 — Dead else-if branch removed (churn-scorer.ts)
- Removed:
  ```typescript
  } else if (depositsPrior14 > 0 && depositsLast14 === 0) {
    frequencyScore = 30
  }
  ```
  The preceding branch (`depositsLast14 < depositsPrior14`) already covers this case (0 < N).

### I7 — Extra getConfig() round-trip eliminated (churn-scorer.ts)
- Added optional `cfg?: ChurnConfig` parameter to `reEngageUser`.
- When `cfg` is provided (internal call from `scoreAndActOnUser`), the method skips `getConfig()` and skips the cooldown check (caller already acquired the NX lock).
- `scoreAndActOnUser` now passes `cfg` when calling `reEngageUser`.

### I8 — getStreamActionData simplified (profile-builder.ts)
- Removed the `XREVRANGE` call and the dead loop body (which never aggregated anything).
- Method now immediately returns `{}` with a comment: `// Phase 4: enrich profiles from Redis stream events`.

---

## Build results

| Service | Command | Result |
|---|---|---|
| churn-service | `npx tsc --noEmit` | ✅ 0 errors |
| bot-learning-service | `npx tsc --noEmit` | ✅ 0 errors |
| game-gateway | `npm run build` | ✅ 0 errors |
| admin-service | `npm run build` | ✅ 0 errors |

---

## Concerns

None. All changes are additive safety guards or dead-code removals. No schema migrations required — the `cron_interval_minutes` config key is read from the existing `churn_config` table with a safe default of `'60'`.
