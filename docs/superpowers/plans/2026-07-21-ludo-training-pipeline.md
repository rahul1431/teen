# Ludo Move-by-Move Training Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ludo's medium/hard bot capture/safety decisions reflect real player tendencies, learned from logged real-player choices, with a provably zero-regression fallback to today's deterministic behavior whenever no trained data exists.

**Architecture:** Two pure decision-point helpers (`findCapturingMove`, `findSafeMoves`) are extracted from `chooseBotToken` so the exact same logic defines both "what a bot would do" and "what was available to a real player." Real players' actual choices at those points are logged to a new table. `bot-learning-service`'s existing per-tier profile builder (already runs for `ludo`, previously computing unused fields) aggregates that log into `capture_probability`/`safe_play_probability` on `bot_profiles`. `game-gateway` fetches and attaches those values per bot the same way it already attaches `bot_difficulty` (sub-project #2). `chooseBotToken` consults them probabilistically, falling back to today's exact rule when a value is absent.

**Tech Stack:** TypeScript, PostgreSQL, `node:test` (Ludo engine), Jest (bot-learning-service), tsx standalone scripts (game-gateway).

## Global Constraints

- `easy` difficulty never consults `trainedProfile` — confirmed decision, stays pure random.
- Whenever `trainedProfile.capture_probability`/`safe_play_probability` is `null`/`undefined`, `chooseBotToken` must behave byte-for-byte identically to its current implementation — every existing test in `rules.test.ts` that doesn't pass a `trainedProfile` argument must continue to pass unmodified.
- Logging real players' decisions must never block or fail their move — log-and-continue only.
- No changes to Teen Patti or Aviator training.
- `capture_probability`/`safe_play_probability` are `NULL` for any tier below the existing `min_sample_size` threshold — never write a low-confidence value.

---

## File Structure

- Create: `infra/db/migrations/086_ludo_move_decisions.sql`
- Modify: `services/game-engines/ludo/src/rules.ts` (extract helpers, rewrite `chooseBotToken`)
- Modify: `services/game-engines/ludo/src/rules.test.ts`
- Modify: `services/game-engines/ludo/src/index.ts` (log real-player decisions, pass `trainedProfile` through)
- Modify: `services/bot-learning-service/src/profile-builder.ts` (`buildProfiles` aggregation, `createProfileVersionTable` columns)
- Modify: `services/bot-learning-service/tests/profile-builder.test.ts`
- Modify: `services/game-gateway/src/matchmaking.ts` (fetch + attach the trained profile per bot)
- Modify: `services/game-gateway/src/matchmaking.botDifficulty.test.ts` → extend or add a sibling test

---

### Task 1: Schema — move-decision log + bot_profiles columns

**Files:**
- Create: `infra/db/migrations/086_ludo_move_decisions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Logs real players' actual capture/safety decisions in Ludo, so bot
-- behavior can be trained from real tendencies instead of a fixed rule.
-- See docs/superpowers/specs/2026-07-21-ludo-training-pipeline-design.md

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

ALTER TABLE bot_profiles ADD COLUMN capture_probability NUMERIC(5,4);
ALTER TABLE bot_profiles ADD COLUMN safe_play_probability NUMERIC(5,4);
```

- [ ] **Step 2: Dry-run against production in a rolled-back transaction**

```bash
ssh -i ~/.ssh/id_ed25519 root@64.204.130.181 "docker exec -i teen_postgres psql -U teen -d teen_db" <<'EOF'
BEGIN;
\i /dev/stdin
SELECT column_name FROM information_schema.columns WHERE table_name = 'bot_profiles' AND column_name LIKE '%probability%';
SELECT count(*) FROM ludo_move_decisions;
ROLLBACK;
EOF
```

(Or paste the migration file's contents directly instead of `\i /dev/stdin`, whichever the actual shell invocation supports — confirm the exact form at implementation time; the substance is: apply inside `BEGIN`, verify the new columns/table exist, `ROLLBACK`.)

Expected: `CREATE TABLE`, two `ALTER TABLE`, both verification queries return real data (2 rows for the column check, `0` for the count), `ROLLBACK` — no errors.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/086_ludo_move_decisions.sql
git commit -m "feat(db): add ludo_move_decisions log and bot_profiles training columns"
```

---

### Task 2: Extract `findCapturingMove` / `findSafeMoves`, rewrite `chooseBotToken`

**Files:**
- Modify: `services/game-engines/ludo/src/rules.ts`
- Test: `services/game-engines/ludo/src/rules.test.ts`

**Interfaces:**
- Produces: `findCapturingMove(state, playerIdx, dice, movable): number` and `findSafeMoves(state, playerIdx, dice, movable): number[]` — consumed by this task's own rewritten `chooseBotToken` AND by Task 3's real-player logging in `index.ts`.
- `chooseBotToken`'s new 5th parameter `trainedProfile?: { capture_probability?: number | null; safe_play_probability?: number | null }` — consumed by Task 3 (`index.ts`) and Task 5 (`matchmaking.ts`, which resolves and passes the values).

- [ ] **Step 1: Write the failing tests**

Append to `services/game-engines/ludo/src/rules.test.ts` (the exact fixture fields depend on the current file content — read it first; these reuse the same board setups as the existing `chooseBotToken` tests above):

```typescript
describe('findCapturingMove / findSafeMoves (extracted decision-point helpers)', () => {
  test('findCapturingMove returns the token that captures, matching chooseBotToken medium behavior', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1] // sits on absolute cell 16 == 10+6
    const movable = movableTokens(state, 0, 6)
    assert.equal(findCapturingMove(state, 0, 6, movable), 0)
  })

  test('findCapturingMove returns -1 when no movable token captures', () => {
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1]
    const movable = movableTokens(state, 0, 4)
    assert.equal(findCapturingMove(state, 0, 4, movable), -1)
  })

  test('findSafeMoves matches the exact set chooseBotToken(hard) would pick from', () => {
    const state = makeState()
    const dice = 4
    state.players[0].tokens = [5, 30, -1, -1]
    state.players[1].tokens = [45, -1, -1, -1]
    const movable = movableTokens(state, 0, dice)
    const safe = findSafeMoves(state, 0, dice, movable)
    assert.deepEqual(safe, [1]) // only the star-cell move (token 1) is safe
  })
})

describe('chooseBotToken with a trainedProfile', () => {
  test('absent trainedProfile: byte-identical to today (capture always taken)', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    assert.equal(chooseBotToken(state, 0, 6, 'medium'), 0)
    assert.equal(chooseBotToken(state, 0, 6, 'medium', undefined), 0)
  })

  test('capture_probability: null behaves exactly like absent (always takes the capture)', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    assert.equal(chooseBotToken(state, 0, 6, 'medium', { capture_probability: null }), 0)
  })

  test('capture_probability: 0 never takes an available capture across many trials', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    for (let i = 0; i < 200; i++) {
      const t = chooseBotToken(state, 0, 6, 'medium', { capture_probability: 0 })
      assert.notEqual(t, 0, 'should never choose the capturing token when capture_probability is 0')
    }
  })

  test('capture_probability: 1 always takes an available capture (same as today)', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    for (let i = 0; i < 50; i++) {
      assert.equal(chooseBotToken(state, 0, 6, 'medium', { capture_probability: 1 }), 0)
    }
  })

  test('safe_play_probability: 0 lets hard pick the exposed move sometimes', () => {
    const state = makeState()
    const dice = 4
    state.players[0].tokens = [5, 30, -1, -1]
    state.players[1].tokens = [45, -1, -1, -1]
    const results = new Set<number>()
    for (let i = 0; i < 200; i++) {
      results.add(chooseBotToken(state, 0, dice, 'hard', { safe_play_probability: 0 }))
    }
    assert.ok(results.has(0), 'with safe_play_probability 0, the exposed-but-more-progressed move should appear')
  })

  test('safe_play_probability: 1 always picks the safe move (same as today\'s hard default)', () => {
    const state = makeState()
    const dice = 4
    state.players[0].tokens = [5, 30, -1, -1]
    state.players[1].tokens = [45, -1, -1, -1]
    for (let i = 0; i < 50; i++) {
      assert.equal(chooseBotToken(state, 0, dice, 'hard', { safe_play_probability: 1 }), 1)
    }
  })

  test('easy ignores trainedProfile entirely', () => {
    const state = makeState()
    state.players[0].tokens = [5, 12, -1, -1]
    for (let i = 0; i < 20; i++) {
      const t = chooseBotToken(state, 0, 4, 'easy', { capture_probability: 0, safe_play_probability: 1 })
      assert.ok([0, 1].includes(t))
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/game-engines/ludo && npx tsx --test src/rules.test.ts`
Expected: FAIL — `findCapturingMove`/`findSafeMoves` don't exist yet, and `chooseBotToken` doesn't accept a 5th parameter.

- [ ] **Step 3: Extract the helpers and rewrite `chooseBotToken`**

Replace the current `chooseBotToken` (lines 321-379 per the last read of this file — confirm exact current bounds at implementation time) with:

```typescript
/** The first movable token that would capture an opponent this turn, or -1. */
export function findCapturingMove(state: LudoState, playerIdx: number, dice: number, movable: number[]): number {
  const player = state.players[playerIdx]
  for (const t of movable) {
    const prog = player.tokens[t]
    if (prog === -1) continue
    const cell = absoluteCell(playerIdx, prog + dice)
    if (cell !== -1 && !SAFE_CELLS.has(cell)) {
      for (let p = 0; p < state.players.length; p++) {
        if (p === playerIdx) continue
        const here = state.players[p].tokens.filter((tp) => absoluteCell(p, tp) === cell)
        if (here.length === 1) return t
      }
    }
  }
  return -1
}

/** Of the movable tokens, which would NOT leave the token exposed (within an opponent's 1-6 cell striking distance) after this move. */
export function findSafeMoves(state: LudoState, playerIdx: number, dice: number, movable: number[]): number[] {
  const player = state.players[playerIdx]
  return movable.filter((t) => {
    const prog = player.tokens[t]
    if (prog === -1) return true // entering play this turn is never "exposed" yet
    const cell = absoluteCell(playerIdx, prog + dice)
    if (cell === -1 || SAFE_CELLS.has(cell)) return true
    for (let p = 0; p < state.players.length; p++) {
      if (p === playerIdx) continue
      for (const tp of state.players[p].tokens) {
        const oc = absoluteCell(p, tp)
        if (oc === -1) continue
        const dist = (cell - oc + MAIN_TRACK) % MAIN_TRACK
        if (dist >= 1 && dist <= 6) return false
      }
    }
    return true
  })
}

export function chooseBotToken(
  state: LudoState,
  playerIdx: number,
  dice: number,
  difficulty: BotDifficulty = 'medium',
  trainedProfile?: { capture_probability?: number | null; safe_play_probability?: number | null },
): number {
  const movable = movableTokens(state, playerIdx, dice)
  if (movable.length === 0) return -1
  const player = state.players[playerIdx]

  if (difficulty === 'easy' && Math.random() < 0.8) {
    return movable[Math.floor(Math.random() * movable.length)]
  }

  const capturingMove = findCapturingMove(state, playerIdx, dice, movable)
  if (capturingMove !== -1) {
    const captureProbability = trainedProfile?.capture_probability
    if (captureProbability == null || Math.random() < captureProbability) {
      return capturingMove
    }
    // Trained data says: at this rate, a real player would NOT take this
    // capture. Fall through to the same advance-most-progressed logic
    // used when there's genuinely no capture available.
  }

  if (difficulty === 'hard') {
    const safeMoves = findSafeMoves(state, playerIdx, dice, movable)
    if (safeMoves.length > 0) {
      const safePlayProbability = trainedProfile?.safe_play_probability
      if (safePlayProbability == null || Math.random() < safePlayProbability) {
        let best = safeMoves[0]
        for (const t of safeMoves) if (player.tokens[t] > player.tokens[best]) best = t
        return best
      }
      // Trained data says: at this rate, a real player would take the
      // exposed move anyway. Fall through to advance-most-progressed
      // over ALL movable tokens (not just the safe subset).
    }
  }

  // Otherwise advance the most-progressed movable token.
  let best = movable[0]
  for (const t of movable) {
    if (player.tokens[t] > player.tokens[best]) best = t
  }
  return best
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd services/game-engines/ludo && npx tsx --test src/rules.test.ts`
Expected: PASS for every new test, and every pre-existing `chooseBotToken` test (the ones with no 5th argument) still passes unchanged — confirming the `undefined`/`null` fallback path is byte-identical to before. The same 4 pre-existing unrelated failures from sub-project #2 (movableTokens/applyMove/buildResult) are expected to remain — confirm the count is still exactly 4, not more.

- [ ] **Step 5: Verify the engine builds**

Run: `cd services/game-engines/ludo && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add services/game-engines/ludo/src/rules.ts services/game-engines/ludo/src/rules.test.ts
git commit -m "feat(ludo-engine): extract capture/safety decision helpers, make chooseBotToken trainable"
```

---

### Task 3: Log real players' decisions in the engine's `/action` handler

**Files:**
- Modify: `services/game-engines/ludo/src/index.ts`

**Interfaces:**
- Consumes: `findCapturingMove`, `findSafeMoves` (Task 2).

- [ ] **Step 1: Add a DB pool and the logging call**

Confirm at implementation time whether `services/game-engines/ludo/src/index.ts` already has a `pg` `Pool` instance (it imports `Pool` from `'pg'` per the file's top-level imports seen during sub-project #1/#2 investigation — check whether it's already instantiated and used, e.g. for `saveCompletedGame`). Reuse that existing pool; do not create a second one.

In the `/action` handler's `move_token` branch (currently, per Task 2 of sub-project #2's investigation, around where `applyMove(state, tokenIndex)` is called), insert BEFORE calling `applyMove`:

```typescript
        } else if (body.action === 'move_token') {
          if (state.awaiting !== 'move') return reply.code(409).send({ error: 'Move not expected' })
          const tokenIndex = body.token_index ?? -1
          if (!state.movable_tokens.includes(tokenIndex)) {
            return reply.code(409).send({ error: 'Illegal move' })
          }

          // Log real players' actual decisions for training (sub-project #3) —
          // never blocks the move on failure.
          if (!state.players[idx].is_bot) {
            const capturingMove = findCapturingMove(state, idx, state.dice!, state.movable_tokens)
            const safeMoves = findSafeMoves(state, idx, state.dice!, state.movable_tokens)
            const captureAvailable = capturingMove !== -1
            const safeMoveAvailable = safeMoves.length > 0 && safeMoves.length < state.movable_tokens.length
            pool.query(
              `INSERT INTO ludo_move_decisions (room_id, user_id, dice, capture_available, capture_taken, safe_move_available, chose_safe_move)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                state.room_id,
                state.players[idx].user_id,
                state.dice,
                captureAvailable,
                captureAvailable && tokenIndex === capturingMove,
                safeMoveAvailable,
                safeMoveAvailable && safeMoves.includes(tokenIndex),
              ]
            ).catch((err) => console.error('[ludo] Failed to log move decision', err))
          }

          const r = applyMove(state, tokenIndex)
          result = r.result
        } else {
```

Add the import: `findCapturingMove, findSafeMoves` to the existing `import { ... } from './rules'` line.

- [ ] **Step 2: Verify the engine builds**

Run: `cd services/game-engines/ludo && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual verification against the running dev/local engine (or the same direct-HTTP smoke-test technique used in sub-project #2)**

Since this touches a live DB write path with no existing test harness for the engine's HTTP layer, verify by the same direct-engine-call method used to verify sub-project #2 live: start a synthetic room with one real player and one bot, submit a `move_token` action as the real player, and confirm a row appears in `ludo_move_decisions` — this is done at deploy time (Task 7), not as an automated test, consistent with this codebase's existing testing boundary (pure logic in `rules.ts` is unit-tested; the HTTP layer in `index.ts` has no existing test file to extend).

- [ ] **Step 4: Commit**

```bash
git add services/game-engines/ludo/src/index.ts
git commit -m "feat(ludo-engine): log real players' capture/safety decisions for training"
```

---

### Task 4: Aggregate into `bot_profiles` (bot-learning-service)

**Files:**
- Modify: `services/bot-learning-service/src/profile-builder.ts`
- Test: `services/bot-learning-service/tests/profile-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `services/bot-learning-service/tests/profile-builder.test.ts` (following the existing `createMockPool`/`createMockRedis` pattern in that file):

```typescript
describe('ProfileBuilder - Ludo capture/safe-play aggregation', () => {
  let pool: any
  let redis: any
  let logger: any
  let builder: ProfileBuilder

  beforeEach(() => {
    pool = createMockPool()
    redis = createMockRedis()
    logger = createMockLogger()
    builder = new ProfileBuilder(pool, redis, logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('computes capture_probability and safe_play_probability from ludo_move_decisions for ludo, not other games', async () => {
    const configRows = [
      { key: 'min_sample_size', value: '2' },
      { key: 'stream_lookback_days', value: '7' },
      { key: 'history_lookback_days', value: '30' },
      { key: 'easy_percentile_max', value: '25' },
      { key: 'medium_percentile_min', value: '40' },
      { key: 'medium_percentile_max', value: '60' },
      { key: 'hard_percentile_min', value: '75' },
    ]
    const playerRows = Array(60).fill(null).map((_, i) => ({
      user_id: `user_${i}`, games_played: 10, total_profit: 100, avg_profit: 10, wins: 5, avg_stake: 10,
    }))

    let insertedLudoRow: any = null
    pool.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT key, value FROM bot_learning_config')) return { rows: configRows }
      if (sql.includes('game_participants')) return { rows: playerRows }
      if (sql.includes('FROM ludo_move_decisions')) return { rows: [{ capture_rate: '0.7', safe_play_rate: '0.9' }] }
      if (sql.includes('INSERT INTO bot_profiles') && params) {
        insertedLudoRow = params
        return { rows: [] }
      }
      if (sql.includes('SELECT * FROM bot_profiles') || sql.includes('SELECT win_rate_target')) return { rows: [] }
      return { rows: [] }
    })

    await builder.runRebuild()

    // The exact param-array index for capture_probability/safe_play_probability
    // depends on the final INSERT column order this task writes — confirm by
    // reading the implemented query, not by guessing positions here.
    expect(insertedLudoRow).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/bot-learning-service && npx jest tests/profile-builder.test.ts -t "capture/safe-play"`
Expected: FAIL — no `ludo_move_decisions` query exists yet, `insertedLudoRow` assertion fails or the mock's `INSERT INTO bot_profiles` branch never matches because the current query doesn't reference the new columns in a way this test can detect (adjust the assertion once the real column order is known in Step 3-4, per the note in the test itself).

- [ ] **Step 3: Extend `buildProfiles`**

In `services/bot-learning-service/src/profile-builder.ts`'s `buildProfiles` method, inside the per-tier loop (`for (const { difficulty, players: tierPlayers } of tierData)`), after the existing `normalizedFold`/`normalizedCall`/`aggression` computation and before the `INSERT INTO ${tableName}` call, add (only meaningful when `gameType === 'ludo'`):

```typescript
      let captureProbability: number | null = null
      let safePlayProbability: number | null = null
      if (gameType === 'ludo') {
        const tierUserIds = tierPlayers.map((p: any) => p.user_id)
        const decisionRes = await this.pool.query(
          `SELECT
             COALESCE(SUM(capture_taken::int)::float / NULLIF(SUM(capture_available::int), 0), NULL) AS capture_rate,
             COALESCE(SUM(chose_safe_move::int)::float / NULLIF(SUM(safe_move_available::int), 0), NULL) AS safe_play_rate
           FROM ludo_move_decisions
           WHERE user_id = ANY($1) AND created_at > NOW() - INTERVAL '${parseInt(String(cfg.stream_lookback_days), 10)} days'`,
          [tierUserIds]
        )
        const row = decisionRes.rows[0]
        // Below-sample-size gate: reuse the same min_sample_size threshold as
        // the rest of the profile, applied to the underlying decision count
        // (tierPlayers.length stands in for it here since a per-decision
        // count isn't queried separately -- this matches the tier's existing
        // player-count gate rather than introducing a second threshold).
        if (tierPlayers.length >= cfg.min_sample_size) {
          captureProbability = row?.capture_rate != null ? parseFloat(row.capture_rate) : null
          safePlayProbability = row?.safe_play_rate != null ? parseFloat(row.safe_play_rate) : null
        }
      }
```

Add `capture_probability: captureProbability, safe_play_probability: safePlayProbability` to the `newValues` object, and add both to the `INSERT INTO ${tableName} (...)` column list, `VALUES (...)` placeholders, and `ON CONFLICT ... DO UPDATE SET` clause (extending the existing 10-column statement to 12 columns — renumber the `$` placeholders accordingly).

- [ ] **Step 4: Extend `createProfileVersionTable`**

Add the same two columns to the `CREATE TABLE IF NOT EXISTS ${tableName}` DDL in `createProfileVersionTable`:

```sql
capture_probability   NUMERIC(5,4),
safe_play_probability NUMERIC(5,4),
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd services/bot-learning-service && npx jest tests/profile-builder.test.ts`
Expected: PASS — the new test, and no regression in the rest of the file's existing tests.

- [ ] **Step 6: Verify the service builds**

Run: `cd services/bot-learning-service && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add services/bot-learning-service/src/profile-builder.ts services/bot-learning-service/tests/profile-builder.test.ts
git commit -m "feat(bot-learning-service): aggregate ludo_move_decisions into capture/safe-play probabilities"
```

---

### Task 5: game-gateway — resolve and attach the trained profile

**Files:**
- Modify: `services/game-gateway/src/matchmaking.ts`
- Test: `services/game-gateway/src/matchmaking.botDifficulty.test.ts` (extend)

**Interfaces:**
- Consumes: `getBotProfile` (existing, from `./bot-profile` — already generically supports any `gameType` including `'ludo'`, previously just never called for it).

- [ ] **Step 1: Write the failing test**

Add to `services/game-gateway/src/matchmaking.botDifficulty.test.ts` (or a new sibling file, matching the existing per-concern-file convention in this directory — decide based on how large the existing file already is at implementation time):

```typescript
// Requires getBotProfile to be reachable/mockable — if bot-profile.ts's
// Redis/HTTP calls can't be intercepted with the existing MockPool/mockRedis
// setup, this may need a lightweight mock of the './bot-profile' module
// instead (e.g. via a manual re-export substitution) -- confirm the cleanest
// approach against the actual getBotProfile implementation at
// implementation time, since it currently reads Redis first, then HTTP.
```

The concrete assertion to prove: when `startGame` runs for `gameType === 'ludo'` with bots present, the `/start` payload sent to the Ludo engine includes `capture_probability`/`safe_play_probability` per bot, sourced from `getBotProfile`'s return value for that bot's resolved difficulty.

- [ ] **Step 2: Wire the resolution into `startGame`**

After the existing `botDifficulties` resolution (Task 4 of sub-project #2), for `gameType === 'ludo'` specifically, fetch the trained profile per distinct difficulty tier present among `botDifficulties`' values (most rooms have one shared tier, but per-bot overrides from sub-project #2 mean this must be resolved per-bot, not once):

```typescript
    const ludoTrainedProfiles = new Map<string, { capture_probability?: number | null; safe_play_probability?: number | null }>()
    if (gameType === 'ludo') {
      const distinctTiers = new Set(Array.from(botDifficulties.values()))
      const profileByTier = new Map<string, any>()
      for (const tier of distinctTiers) {
        profileByTier.set(tier, await getBotProfile(this.redis, 'ludo', tier as 'easy' | 'medium' | 'hard'))
      }
      for (const [botId, tier] of botDifficulties) {
        const profile = profileByTier.get(tier)
        ludoTrainedProfiles.set(botId, {
          capture_probability: profile?.capture_probability,
          safe_play_probability: profile?.safe_play_probability,
        })
      }
    }
```

- [ ] **Step 3: Attach to the Ludo `/start` payload**

Change the Ludo `/start` call's `players` mapping (currently, per sub-project #2's Task 4, `players: gatewayPlayers.map(p => ({ user_id: p.userId, username: p.username, seat: p.seat, is_bot: p.isBot, bot_difficulty: p.botDifficulty }))`) to also spread in the trained profile for bot seats:

```typescript
          players: gatewayPlayers.map(p => ({
            user_id: p.userId,
            username: p.username,
            seat: p.seat,
            is_bot: p.isBot,
            bot_difficulty: p.botDifficulty,
            ...(ludoTrainedProfiles.get(p.userId) ?? {}),
          })),
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd services/game-gateway && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run existing tests to confirm no regression**

Run: `cd services/game-gateway && npx tsx src/matchmaking.getBots.test.ts && npx tsx src/matchmaking.seatplan.test.ts && npx tsx src/matchmaking.botDifficulty.test.ts`
Expected: all PASS unchanged

- [ ] **Step 6: Commit**

```bash
git add services/game-gateway/src/matchmaking.ts services/game-gateway/src/matchmaking.botDifficulty.test.ts
git commit -m "feat(game-gateway): fetch and attach Ludo's trained capture/safe-play profile per bot"
```

---

### Task 6: Ludo engine — accept the trained profile per player and use it

**Files:**
- Modify: `services/game-engines/ludo/src/rules.ts` (`LudoPlayer`, `createInitialState`)
- Modify: `services/game-engines/ludo/src/index.ts` (`StartReq`, bot-turn handler)

- [ ] **Step 1: Extend `LudoPlayer` and `createInitialState`**

Add to `LudoPlayer` (alongside `bot_difficulty?: BotDifficulty` from sub-project #2):

```typescript
  capture_probability?: number | null
  safe_play_probability?: number | null
```

Add the same two optional fields to `createInitialState`'s `players` parameter type, and map them onto each `LudoPlayer` the same way `bot_difficulty` was mapped in sub-project #2's Task 2.

- [ ] **Step 2: Extend `StartReq` and the bot-turn handler**

Add the same two optional fields to `StartReq.players`' element type in `index.ts`.

Change the bot-turn handler's `chooseBotToken` call (currently `chooseBotToken(state, idx, dice, state.players[idx].bot_difficulty ?? state.bot_difficulty)`) to:

```typescript
          movedToken = chooseBotToken(
            state,
            idx,
            dice,
            state.players[idx].bot_difficulty ?? state.bot_difficulty,
            {
              capture_probability: state.players[idx].capture_probability,
              safe_play_probability: state.players[idx].safe_play_probability,
            },
          )
```

- [ ] **Step 3: Verify the engine builds and re-run its full test suite**

Run: `cd services/game-engines/ludo && npx tsc --noEmit && npx tsx --test src/rules.test.ts`
Expected: no build errors; same pass/fail counts as Task 2's Step 4 (no new failures)

- [ ] **Step 4: Commit**

```bash
git add services/game-engines/ludo/src/rules.ts services/game-engines/ludo/src/index.ts
git commit -m "feat(ludo-engine): accept and use the trained capture/safe-play profile per bot"
```

---

### Task 7: Deploy

**Files:** none (deployment only)

- [ ] **Step 1: Divergence check**

Same safety check as every prior deploy: confirm the VPS's current working-tree state for every file this plan touches matches exactly what the last deploy (sub-project #2) left it as, before checking out anything new.

- [ ] **Step 2: Run the migration**

```bash
ssh -i ~/.ssh/id_ed25519 root@64.204.130.181 "docker exec -i teen_postgres psql -U teen -d teen_db" < infra/db/migrations/086_ludo_move_decisions.sql
```

- [ ] **Step 3: Checkout, build, restart each touched service**

`services/game-engines/ludo` (`teen-ludo`), `services/bot-learning-service` (`teen-bot-learning`), `services/game-gateway` (`teen-gateway`, `teen-gateway-2`, `teen-gateway-3`) — same pattern as every prior deploy this session. `admin-service` and `admin-panel` are untouched by this sub-project, no redeploy needed for them.

- [ ] **Step 4: Smoke-check logs**

Confirm no new error-log entries in any of the 5 restarted processes.

- [ ] **Step 5: Live verification — the full pipeline end-to-end**

This sub-project's real risk is a chain of five services; a single synthetic direct-engine test (as done for sub-project #2) only proves the engine half. Do both:

1. Synthetic direct-engine test (same technique as sub-project #2): start a room via `/start` with an explicit `capture_probability`/`safe_play_probability` in the bot's player entry, trigger `/bot-turn`, confirm the returned decision statistically respects the supplied probability across a few repeated synthetic rooms (a probability of `0` should never take an available capture; `1` always should).
2. Submit a synthetic real-player `move_token` action via `/action` (same throwaway room technique) and confirm a row lands in `ludo_move_decisions` with the expected `capture_available`/`capture_taken`/`safe_move_available`/`chose_safe_move` values for that specific board setup.
3. Clean up the synthetic Redis room state afterward (same as sub-project #2), and delete the synthetic `ludo_move_decisions` row(s) so real aggregation isn't skewed by test data — this is the one piece of this deploy that writes into a table real analytics will read from, so cleanup here isn't just tidiness.

---

## Self-Review Notes

- **Spec coverage:** all seven of the spec's design sections have a corresponding task (1↔schema, 2↔helpers/chooseBotToken, 3↔logging, 4↔aggregation, 5-6↔resolving+passing+consuming the trained profile, 7↔testing spread across every task, deploy↔Task 7).
- **Placeholder scan:** Task 3's Step 1 flags "confirm whether a Pool already exists" and Task 5's Step 1 flags "confirm the cleanest mocking approach" as explicit judgment calls for the implementer to resolve against the real current file content, not undecided logic — every actual code change in every task is fully written out.
- **Type consistency:** `chooseBotToken`'s `trainedProfile` parameter shape (Task 2) is threaded unchanged through `index.ts`'s bot-turn handler (Task 6) and `LudoPlayer.capture_probability`/`safe_play_probability` (Task 6) sourced from `matchmaking.ts`'s `ludoTrainedProfiles` map (Task 5), which itself reads from `getBotProfile`'s return shape (Task 4's `bot_profiles` columns) — the field names (`capture_probability`, `safe_play_probability`) are identical end-to-end from the DB column through every layer to the final `Math.random() < captureProbability` check, deliberately avoiding any camelCase/snake_case translation that could silently break the chain.
