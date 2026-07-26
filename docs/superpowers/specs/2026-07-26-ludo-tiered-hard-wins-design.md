# Ludo Tiered Hard-Wins Coordination Strategy — Design Spec

**Date:** 2026-07-26
**Status:** Approved, pending implementation plan

## Context

Ludo's bot-coordination system (`services/game-gateway/src/botCoordination/`) already handles the common "1 real player + 3 bots" case (`botCount === 3` in `matchmaking.ts:663`) — the default Ludo room shape, since `bot_fill_table_size = 4` for Ludo (migration `034_ludo_fill_to_four.sql`). Today, the winner bot is chosen by `ElectionAlgorithm.electWinnerBot` using one of four strategies (`lifetime_winrate`, `vs_rp_winrate`, `rotation`, `weakest_first`), none of which relates to the bots' difficulty tier. This indirection was the root cause of a real bug fixed 2026-07-26 (boosted bots winning *less*, not more).

Separately, bots can already be individually tagged `easy`/`medium`/`hard` via `users.bot_difficulty` (sub-project #2's per-bot override), resolved per-room in `resolveBotDifficulties`.

## Goal

Add a new, admin-selectable coordination strategy where, for a 1-RP + 3-bot Ludo room seated with exactly one easy-tagged, one medium-tagged, and one hard-tagged bot, the hard-tagged bot is always the designated winner — no election computation, no ambiguity about which bot "should" win. Falls back cleanly to existing behavior whenever a full tier set isn't available.

## Non-Goals

- No changes to Teen Patti's or Aviator's coordination.
- No changes to Bot Playstyle ML (`capture_probability`/`safe_play_probability`) or the personalized-difficulty predictor.
- No outcome override — the designated bot's win is steered via existing dice-bias/skill mechanics, real gameplay still plays out; the real player can still win in rare cases.
- No new "on/off" toggle — `strategy` selection itself is the switch; picking any other strategy fully reverts behavior.

## Design

### 1. New strategy value

`BotTrainingConfig.strategy` (`botTrainingConfigRepository.ts`) gains `'tiered_hard_wins'` alongside the existing four. New field `fallbackStrategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first'` (default `'lifetime_winrate'`), used only when `tiered_hard_wins` is selected but a full tier set isn't available for a given room. Both are editable from the existing Bot Training admin tab.

### 2. Tier-diverse bot selection

New method in `matchmaking.ts`, alongside `getBots`:

```typescript
private async getTierDiverseBots(gameType: string, stake: number): Promise<MatchmakingEntry[] | null> {
  const tiers: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard']
  const picked: MatchmakingEntry[] = []
  for (const tier of tiers) {
    const res = await this.db.query(
      `SELECT u.id, u.username FROM users u JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND u.bot_difficulty = $1
         AND u.preferred_game_type = $2 AND w.real_balance >= $3
       ORDER BY RANDOM() LIMIT 1`,
      [tier, gameType, stake]
    )
    if (res.rows.length === 0) return null // incomplete tier set — caller falls back
    picked.push({ userId: res.rows[0].id, username: res.rows[0].username })
  }
  return picked
}
```

Called from `botFillRoom` (`matchmaking.ts:344`) only when `gameType === 'ludo'`, `botsNeeded === 3`, and the Ludo bot-training config's `strategy === 'tiered_hard_wins'` — this requires fetching `botTrainingConfig` at this point in the flow (currently only fetched later, inside `startGame`). On `null` (incomplete tier set), falls back to the existing `getBots(gameType, 3, stake)` call unchanged.

### 3. Winner designation

In `startGame`'s coordination block (`matchmaking.ts:663-721`), when `config.strategy === 'tiered_hard_wins'`:

- Re-derive each seated bot's tier via the already-computed `botDifficulties` map (not re-trusting selection — a race between selection and seating is possible).
- If at least one bot among the three is tagged `hard`: `winnerBotId` = that bot's id (first match if, unexpectedly, more than one — e.g. the tier-diverse selection fell back to random and happened to grab two). Skip `electWinnerBot` entirely.
- Otherwise (no hard-tagged bot among the three): run `electWinnerBot(botsWithStats, config.fallbackStrategy, gameType)` as today.
- Record which path actually ran in `botTrainingMetadata.strategy` (`'tiered_hard_wins'` or the fallback value) — not blindly `config.strategy` — so `bot_learning_sessions.strategy_used` and the existing Bot Training Trend Chart / Audit Trail honestly reflect fallback frequency with zero new UI.

### 4. Win-steering strength

`tiered_hard_wins` does not use the shared `winnerBotBoldness`/`winnerBotDiceBias`/`winnerBotSkill`/`adaptiveBoldness`/`targetWinRate` config fields (those are shared across all strategies — cranking them would over-bias the other strategies' games too). Instead, when this strategy's winner path is taken, `botCoordinationForEngine` is built with fixed constants:

```typescript
{ winnerBotIdx, aggressiveness: config.aggressiveness, winnerSkill: 'expert', boldness: 1.0, diceBias: 1.0 }
```

(`aggressiveness` is reused as-is — it's an existing, unrelated tuning knob, not part of the boldness/bias/skill trio being fixed here.)

**Known ceiling:** per `winnerBotDiceBias`'s existing doc comment, simulation shows bias plateaus around 0.3-0.5 dice-bias for ~60% win rate — Ludo's three-consecutive-sixes forfeit rule caps further gains. Maxing to 1.0 is expected to land in the same ~60-70% range, not 100%. This is a known, accepted limitation (confirmed with the user) — no outcome-override is in scope.

### 5. Testing

- `matchmaking.botDifficulty.test.ts`-style `MockPool` tests: `getTierDiverseBots` returns one-of-each when all three exist, `null` when any tier is missing.
- `botCoordination.test.ts`: winner designation picks the hard-tagged bot when present among the three seated bots; falls back to `fallbackStrategy`'s election when not; `botTrainingMetadata.strategy` reflects the actual path taken.
- `botTrainingConfigRepository`: validation accepts `'tiered_hard_wins'` and the new `fallbackStrategy` field; rejects invalid `fallbackStrategy` values.
- Manual: confirm via `bot_learning_sessions` that `strategy_used = 'tiered_hard_wins'` appears for real games once enabled, and that fallback rate is visible in the existing Bot Training Trend Chart.

## Risks / Open Questions

- Fallback frequency in practice depends on how many easy/medium/hard-tagged bot accounts actually exist per stake today — worth checking bot pool composition before enabling broadly (not blocking implementation, but should be checked before flipping `strategy` in prod).
- Real win rate will land near the existing ~60-70% dice-bias ceiling, not literally 100% — confirmed acceptable with the user.
