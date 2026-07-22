# Ludo Move-by-Move Training Pipeline — Design Spec

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

Sub-project #3 of the bot-management initiative, built on top of #1 (bot pool separation) and #2 (per-bot difficulty override). Ludo's bot decision logic (`chooseBotToken` in `services/game-engines/ludo/src/rules.ts`) is entirely deterministic and static:

- **medium/hard**: always takes an available capturing move if one exists, no exceptions.
- **hard**: additionally always avoids leaving a token exposed (within an opponent's 1-6 cell striking distance) when a non-exposed alternative exists, no exceptions.
- **easy**: 80% pure random move, ignoring capture/safety entirely (by design — easy exists to let new players win).

None of this reflects real player behavior. Separately, `bot-learning-service`'s `ProfileBuilder` already loops over `GAME_TYPES = ['teen_patti', 'ludo', 'aviator']` generically and computes a `bot_profiles` row for Ludo (win-rate target, fold/call/raise-shaped fields, aggression score) from real player win/loss outcomes — but this is disconnected: Ludo has no fold/call/raise decisions, so these fields are meaningless for it, and nothing in the Ludo engine consumes them for move choice (only `avg_decision_delay_ms`/turn-timing was wired in sub-project #2's predecessor state, for pacing, not decision content).

## Goal

Make Ludo's medium/hard bot move choice reflect real player tendencies: whether real players at a given skill tier actually take available captures, and whether they actually avoid exposing tokens when a safer alternative exists — replacing the current all-or-nothing deterministic rules with probabilities learned from real gameplay, while falling back to today's exact deterministic behavior whenever no trained data exists yet (new deployment, insufficient sample size).

## Non-Goals

- `easy` difficulty is unchanged — pure random, by design, per confirmed decision.
- No per-action-stream enrichment beyond what's described here (matching Teen Patti's own current training depth — win/loss-outcome-tier-bucketed, not a full RL system).
- No changes to Teen Patti's or Aviator's training.
- No changes to the bot pool separation (#1) or per-bot difficulty override (#2) mechanisms — this sub-project adds a new signal (`capture_probability`, `safe_play_probability`) alongside the existing `bot_difficulty`, using the same difficulty-tier concept already established.

## Design

### 1. Extract reusable decision-point helpers (`rules.ts`)

Extract the two inline blocks inside `chooseBotToken` into standalone pure functions, used by both the bot's own decision AND the new real-player logging (so "what counts as a capture / an exposed move" is defined exactly once):

```typescript
/** The first movable token that would capture an opponent this turn, or -1. */
export function findCapturingMove(state: LudoState, playerIdx: number, dice: number, movable: number[]): number

/** Of the movable tokens, which would NOT leave the token exposed (within an opponent's 1-6 cell striking distance) after this move. */
export function findSafeMoves(state: LudoState, playerIdx: number, dice: number, movable: number[]): number[]
```

`chooseBotToken` is rewritten to call these instead of inlining the logic — behaviorally identical to today when called without trained probabilities (see Design section 5).

### 2. Log real players' actual decisions

New table, populated from the Ludo engine's `/action` handler (`move_token` case) for real players only (`!state.players[idx].is_bot`), using the extracted helpers to compute what was *available* vs what was *chosen*, before calling `applyMove`:

```sql
CREATE TABLE ludo_move_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               TEXT NOT NULL,
  user_id               UUID NOT NULL REFERENCES users(id),
  dice                  INTEGER NOT NULL,
  capture_available     BOOLEAN NOT NULL,
  capture_taken         BOOLEAN NOT NULL,
  safe_move_available   BOOLEAN NOT NULL,
  chose_safe_move       BOOLEAN NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ludo_move_decisions_user_created ON ludo_move_decisions(user_id, created_at);
CREATE INDEX idx_ludo_move_decisions_created ON ludo_move_decisions(created_at);
```

`capture_available`/`safe_move_available` are `false` when there was nothing to choose between (e.g. only one movable token, or all movable tokens are equally exposed) — those rows don't count for/against the rate either way. This logging happens inside the engine's existing `/action` handler and DB write; failures must not block the player's move (log-and-continue, same resilience pattern as elsewhere in this codebase — e.g. `bot-profile.ts`'s Redis/HTTP fallback chain).

### 3. Extend `bot_profiles` with the two new trained fields

```sql
ALTER TABLE bot_profiles ADD COLUMN capture_probability NUMERIC(5,4);
ALTER TABLE bot_profiles ADD COLUMN safe_play_probability NUMERIC(5,4);
```

Nullable, populated only for `game_type = 'ludo'` rows — `NULL` for Teen Patti/Aviator (meaningless there), and `NULL` for Ludo until enough real-player data exists (see below).

The versioned-table creation in `ProfileBuilder.createProfileVersionTable` (`bot_profiles_v{N}`) gains the same two columns, so profile rollback/versioning (already built) covers this data too without special-casing.

### 4. Aggregate into the profile builder

`ProfileBuilder.buildProfiles('ludo', ...)` (already runs today, computing the currently-unused fold/call/raise-shaped fields) additionally, only for `gameType === 'ludo'`, per skill tier (reusing the exact same percentile-bucketed player groups already computed from win-rate for that tier):

```sql
SELECT
  COALESCE(SUM(capture_taken::int)::float / NULLIF(SUM(capture_available::int), 0), NULL) AS capture_rate,
  COALESCE(SUM(chose_safe_move::int)::float / NULLIF(SUM(safe_move_available::int), 0), NULL) AS safe_play_rate
FROM ludo_move_decisions
WHERE user_id = ANY($1) AND created_at > NOW() - INTERVAL '{stream_lookback_days} days'
```

(`$1` = the tier's player-id list, already available in `buildProfiles`'s existing per-tier loop.) Same `min_sample_size` gate as the rest of the profile: if the underlying decision count is below threshold, `capture_probability`/`safe_play_probability` stay `NULL` for that tier rather than writing a low-confidence value — `chooseBotToken` treats `NULL` as "no trained data, use today's deterministic rule" (see below).

### 5. Wire into `chooseBotToken`

`chooseBotToken`'s signature gains two optional parameters (or a single optional options object) carrying the resolved profile values:

```typescript
export function chooseBotToken(
  state: LudoState,
  playerIdx: number,
  dice: number,
  difficulty: BotDifficulty = 'medium',
  trainedProfile?: { capture_probability?: number | null; safe_play_probability?: number | null },
): number
```

Behavior:
- **easy**: unchanged — 80% random, ignores `trainedProfile` entirely (per confirmed decision).
- **medium/hard, capture decision**: if `findCapturingMove(...)` returns a capture and `trainedProfile?.capture_probability` is a number, take that capturing move only with that probability (`Math.random() < capture_probability`) instead of unconditionally. If `trainedProfile.capture_probability` is `null`/`undefined`, behave exactly as today (always take it) — this is the fallback that guarantees zero behavior change before training data exists.
- **hard, safety decision**: if `findSafeMoves(...)` yields a non-empty proper subset of movable tokens and `trainedProfile?.safe_play_probability` is a number, prefer the safe subset only with that probability; otherwise (including `null`) behave exactly as today (hard always prefers safety).
- **medium**: safety logic is unaffected either way (medium never consulted `findSafeMoves` before, and doesn't gain a `safe_play_probability` behavior — that's `hard`-only, unchanged scope).

### 6. Resolving and passing the trained profile

Mirrors sub-project #2's `bot_difficulty` plumbing exactly: `game-gateway`'s `startGame` fetches Ludo's profile (via the existing `getBotProfile(redis, 'ludo', difficulty)` — already generically supported, previously just unused for Ludo) once per room per difficulty tier present among seated bots, and attaches `capture_probability`/`safe_play_probability` onto each bot's entry in the `/start` payload's `players` array, alongside the existing `bot_difficulty` field. `LudoPlayer`/`createInitialState` gain the two optional fields the same way `bot_difficulty` was added in #2. The engine's bot-turn handler passes them through to `chooseBotToken`.

### 7. Testing

- `rules.ts`: unit tests for `findCapturingMove`/`findSafeMoves` (extracted, so directly testable) and for `chooseBotToken`'s three behaviors — deterministic fallback when `trainedProfile` is absent/null (regression guard: must match today's exact existing test expectations), probabilistic behavior when a probability is supplied (statistical assertion over many trials, e.g. "with `capture_probability: 0`, a capture is never taken across 200 trials"; "with `capture_probability: 1`, always taken"), and confirm `easy` ignores `trainedProfile` entirely.
- `bot-learning-service`: extend `profile-builder`'s existing test coverage (if any exists — confirm at implementation time) with the new aggregation query's rate-calculation math (e.g. 7 captures taken out of 10 available → `0.7`), and the `NULL`-below-sample-size-threshold behavior.
- `game-gateway`: extend the existing `matchmaking.botDifficulty.test.ts`-style `MockPool` test to confirm the trained profile fields are correctly attached per bot.
- Manual: same synthetic direct-engine smoke test used to verify #2 (`/start` + `/bot-turn` against the running engine), extended to pass explicit `capture_probability`/`safe_play_probability` values and confirm the returned decision respects them across repeated calls.

## Risks / Open Questions

- Real-player move logging adds one DB write per real-player Ludo move (`move_token` actions only, not every roll) — negligible volume for a normal Ludo session (a handful of moves per game), but confirmed non-blocking (log-and-continue) so a logging failure never affects an actual player's move.
- Until enough real-player data accumulates for a given difficulty tier, behavior is provably identical to today (the `null`-fallback path) — there is no "cold start" regression risk, only a delay before the trained behavior activates.
- `min_sample_size`/`stream_lookback_days` config already exists per `bot_learning_config` (used generically across game types) — no new config surface needed, reusing what sub-project #1/#2's investigation already found in `profile-builder.ts`.
