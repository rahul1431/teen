# Ludo Tiered Hard-Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new admin-selectable `tiered_hard_wins` bot-coordination strategy for Ludo, where a 1-real-player + 3-bot room seated with one easy/medium/hard-tagged bot each always designates the hard-tagged bot as winner (no election), steered via maxed-out existing dice-bias/skill mechanics, falling back cleanly to today's behavior whenever a full tier set isn't available.

**Architecture:** Extends the existing Ludo bot-coordination system (`services/game-gateway/src/botCoordination/`) with a new strategy value threaded through the existing `BotTrainingConfig` → `MatchmakingService.startGame` → `ElectionAlgorithm` pipeline. No new services, tables, or engines — purely new branches in already-tested code paths.

**Tech Stack:** TypeScript, Fastify (admin-service), Postgres, Redis, Vitest (unit tests), React/antd (admin panel).

## Global Constraints

- Per the approved design spec (`docs/superpowers/specs/2026-07-26-ludo-tiered-hard-wins-design.md`): no outcome override — real dice/moves still play out; win rate realistically lands ~60-70%, not literally 100%.
- No changes to Teen Patti/Aviator coordination, Bot Playstyle ML, or the personalized-difficulty predictor.
- `strategy` selection itself is the on/off switch — no separate enable flag for this feature.
- Two independent copies of `BotTrainingConfigRepository` exist (`services/game-gateway/src/repositories/` and `services/admin-service/src/repositories/`) and must be kept in sync by hand — this is an existing, established pattern in this codebase, not something to refactor away as part of this plan.

---

### Task 1: Extend `BotTrainingConfig` type + validation (game-gateway)

**Files:**
- Modify: `services/game-gateway/src/repositories/botTrainingConfigRepository.ts`
- Test: `services/game-gateway/src/repositories/botTrainingConfigRepository.test.ts` (new)

**Interfaces:**
- Produces: `BotTrainingConfig.strategy` gains `'tiered_hard_wins'`; new field `BotTrainingConfig.fallbackStrategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first'`, default `'lifetime_winrate'`. Later tasks (3, 5) read `config.strategy === 'tiered_hard_wins'` and `config.fallbackStrategy`.

- [ ] **Step 1: Write the failing test**

```typescript
// services/game-gateway/src/repositories/botTrainingConfigRepository.test.ts
import { describe, it, expect } from 'vitest'
import { BotTrainingConfigRepository } from './botTrainingConfigRepository'

class MockRedis {
  private store = new Map<string, string>()
  async get(key: string) { return this.store.get(key) ?? null }
  async setex(key: string, _ttl: number, value: string) { this.store.set(key, value) }
  async del(key: string) { this.store.delete(key) }
}

class MockDb {
  async query(_sql: string, _params: any[] = []) { return { rows: [] } }
}

describe('BotTrainingConfigRepository - tiered_hard_wins', () => {
  it('default config includes fallbackStrategy = lifetime_winrate', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig()
    expect(config.fallbackStrategy).toBe('lifetime_winrate')
  })

  it('accepts tiered_hard_wins as a valid strategy', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig()
    await expect(
      repo.updateConfig({ ...config, strategy: 'tiered_hard_wins', fallbackStrategy: 'rotation' })
    ).resolves.not.toThrow()
  })

  it('rejects an invalid fallbackStrategy value', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig()
    await expect(
      repo.updateConfig({ ...config, fallbackStrategy: 'not_a_real_strategy' as any })
    ).rejects.toThrow('fallbackStrategy must be one of')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/game-gateway && npx vitest run src/repositories/botTrainingConfigRepository.test.ts`
Expected: FAIL — first test fails because `fallbackStrategy` is `undefined`; third test fails because `updateConfig` doesn't throw yet.

- [ ] **Step 3: Write minimal implementation**

In `services/game-gateway/src/repositories/botTrainingConfigRepository.ts`:

```typescript
export interface BotTrainingConfig {
  enabled: boolean
  strategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first' | 'tiered_hard_wins'
  fallbackStrategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first' // used only when strategy is 'tiered_hard_wins' and no hard-tagged bot is among the seated bots
  targetWinRate: number // 0.5 - 1.0
  aggressiveness: number // 0.0 - 1.0
  winnerBotSkill: 'casual' | 'skilled' | 'expert'
  winnerBotBoldness: number // 0.0 - 1.0
  adaptiveBoldness: boolean // auto-tune winnerBotBoldness from recent coordination success rate
  winnerBotDiceBias: number // 0.0 - 1.0; skews the winner bot's OWN dice rolls toward high faces (0 = fair). Simulation showed this plateaus around 0.3-0.5 (~60% win rate) -- the three-consecutive-sixes forfeit rule caps further gains from higher bias.
}
```

Update `DEFAULT_CONFIG`:

```typescript
const DEFAULT_CONFIG: BotTrainingConfig = {
  enabled: false,
  strategy: 'lifetime_winrate',
  fallbackStrategy: 'lifetime_winrate',
  targetWinRate: 0.95,
  aggressiveness: 0.4,
  winnerBotSkill: 'casual',
  winnerBotBoldness: 0.5,
  adaptiveBoldness: false,
  winnerBotDiceBias: 0,
}
```

Add validation in `updateConfig`, right after the existing `winnerBotSkill` check:

```typescript
    if (!['lifetime_winrate', 'vs_rp_winrate', 'rotation', 'weakest_first'].includes(config.fallbackStrategy)) {
      throw new Error('fallbackStrategy must be one of lifetime_winrate, vs_rp_winrate, rotation, weakest_first')
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/game-gateway && npx vitest run src/repositories/botTrainingConfigRepository.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add services/game-gateway/src/repositories/botTrainingConfigRepository.ts services/game-gateway/src/repositories/botTrainingConfigRepository.test.ts
git commit -m "feat(ludo): add tiered_hard_wins strategy + fallbackStrategy to bot-training config (game-gateway)"
```

---

### Task 2: Mirror the same change in admin-service's copy

**Files:**
- Modify: `services/admin-service/src/repositories/botTrainingConfigRepository.ts`
- Test: `services/admin-service/src/repositories/botTrainingConfigRepository.test.ts` (new)

**Interfaces:**
- Produces: identical `BotTrainingConfig` shape as Task 1, for the admin-service's own copy (consumed by `services/admin-service/src/routes/index.ts`'s GET/PATCH `/api/admin/ludo/bot-training/config`, which the admin panel calls).

- [ ] **Step 1: Write the failing test**

```typescript
// services/admin-service/src/repositories/botTrainingConfigRepository.test.ts
import { describe, it, expect } from 'vitest'
import { BotTrainingConfigRepository } from './botTrainingConfigRepository'

class MockRedis {
  private store = new Map<string, string>()
  async get(key: string) { return this.store.get(key) ?? null }
  async setex(key: string, _ttl: number, value: string) { this.store.set(key, value) }
  async del(key: string) { this.store.delete(key) }
}

class MockDb {
  async query(_sql: string, _params: any[] = []) { return { rows: [] } }
}

describe('BotTrainingConfigRepository - tiered_hard_wins (admin-service)', () => {
  it('default config includes fallbackStrategy = lifetime_winrate', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig()
    expect(config.fallbackStrategy).toBe('lifetime_winrate')
  })

  it('accepts tiered_hard_wins as a valid strategy', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig()
    await expect(
      repo.updateConfig({ ...config, strategy: 'tiered_hard_wins', fallbackStrategy: 'weakest_first' })
    ).resolves.not.toThrow()
  })

  it('rejects an invalid fallbackStrategy value', async () => {
    const repo = new BotTrainingConfigRepository(new MockRedis() as any, new MockDb() as any)
    const config = await repo.getConfig()
    await expect(
      repo.updateConfig({ ...config, fallbackStrategy: 'bogus' as any })
    ).rejects.toThrow('fallbackStrategy must be one of')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/admin-service && npx vitest run src/repositories/botTrainingConfigRepository.test.ts`
Expected: FAIL (same reasons as Task 1)

- [ ] **Step 3: Write minimal implementation**

Apply the identical edits from Task 1's Step 3 to `services/admin-service/src/repositories/botTrainingConfigRepository.ts` (same interface, same `DEFAULT_CONFIG` addition, same validation line placed after the existing `winnerBotSkill` check).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/admin-service && npx vitest run src/repositories/botTrainingConfigRepository.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/repositories/botTrainingConfigRepository.ts services/admin-service/src/repositories/botTrainingConfigRepository.test.ts
git commit -m "feat(admin): mirror tiered_hard_wins strategy + fallbackStrategy in admin-service's bot-training config"
```

---

### Task 3: Add `electHardTierWinner` to `ElectionAlgorithm`

**Files:**
- Modify: `services/game-gateway/src/botCoordination/electionAlgorithm.ts`
- Modify (add tests, do not renumber existing ones): `services/game-gateway/src/tests/botCoordination.test.ts`

**Interfaces:**
- Consumes: `Map<string, string>` of botId → resolved difficulty tier (the same shape `MatchmakingService.resolveBotDifficulties` already produces — `Map<string, string>`, values `'easy' | 'medium' | 'hard'`).
- Produces: `electHardTierWinner(botDifficulties: Map<string, string>): string | null` — Task 5 calls this and falls back to `electWinnerBot(..., config.fallbackStrategy, ...)` when it returns `null`.

- [ ] **Step 1: Write the failing test**

Add this new `describe` block to `services/game-gateway/src/tests/botCoordination.test.ts`, placed after the closing `})` of the existing `describe('BotCoordination - ElectionAlgorithm', ...)` block (i.e. right before `describe('BotCoordination - BotStatsLoader', ...)`) — do not renumber the existing `Test 1`-`Test 4` blocks:

```typescript
describe('BotCoordination - ElectionAlgorithm.electHardTierWinner', () => {
  let algorithm: ElectionAlgorithm

  beforeEach(() => {
    algorithm = new ElectionAlgorithm()
  })

  it('should return the bot tagged hard', () => {
    const difficulties = new Map([
      ['bot-1', 'easy'],
      ['bot-2', 'medium'],
      ['bot-3', 'hard'],
    ])
    expect(algorithm.electHardTierWinner(difficulties)).toBe('bot-3')
  })

  it('should return null when no bot is tagged hard', () => {
    const difficulties = new Map([
      ['bot-1', 'easy'],
      ['bot-2', 'medium'],
    ])
    expect(algorithm.electHardTierWinner(difficulties)).toBeNull()
  })

  it('should return the first hard-tagged bot when more than one exists', () => {
    const difficulties = new Map([
      ['bot-1', 'hard'],
      ['bot-2', 'hard'],
    ])
    expect(algorithm.electHardTierWinner(difficulties)).toBe('bot-1')
  })

  it('should return null for an empty map', () => {
    expect(algorithm.electHardTierWinner(new Map())).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/game-gateway && npx vitest run src/tests/botCoordination.test.ts`
Expected: FAIL — `electHardTierWinner` doesn't exist on `ElectionAlgorithm` (TypeScript compile error surfaced as a test failure).

- [ ] **Step 3: Write minimal implementation**

In `services/game-gateway/src/botCoordination/electionAlgorithm.ts`, add this method inside the `ElectionAlgorithm` class, after `electionByWeakestFirst` and before `isCoordinationSuccess`:

```typescript
  /**
   * Tiered Hard-Wins: the first bot among the seated bots' resolved
   * difficulties that's tagged 'hard', or null if none exists — callers
   * fall back to their own configured fallback strategy in that case.
   */
  electHardTierWinner(botDifficulties: Map<string, string>): string | null {
    for (const [botId, tier] of botDifficulties) {
      if (tier === 'hard') return botId
    }
    return null
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/game-gateway && npx vitest run src/tests/botCoordination.test.ts`
Expected: PASS (all existing tests + 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add services/game-gateway/src/botCoordination/electionAlgorithm.ts services/game-gateway/src/tests/botCoordination.test.ts
git commit -m "feat(ludo): add ElectionAlgorithm.electHardTierWinner for tiered_hard_wins strategy"
```

---

### Task 4: Tier-diverse bot selection in `MatchmakingService`

**Files:**
- Modify: `services/game-gateway/src/matchmaking.ts`
- Test: `services/game-gateway/src/matchmaking.tieredHardWins.test.ts` (new — manual script, same pattern as the existing `matchmaking.botDifficulty.test.ts`)

**Interfaces:**
- Consumes: `this.db.query` (existing `Pool`/mock), `MatchmakingEntry` type (already exported from this file).
- Produces: `private async getTierDiverseBots(gameType: string, stake: number): Promise<MatchmakingEntry[] | null>` — returns `[easyBot, mediumBot, hardBot]` (in that order) when all three exist, else `null`. Task 5's `botFillRoom` edit calls this.

- [ ] **Step 1: Write the failing test**

```typescript
// services/game-gateway/src/matchmaking.tieredHardWins.test.ts
// Run: npx tsx src/matchmaking.tieredHardWins.test.ts
import { MatchmakingService } from './matchmaking'

let testsPassed = 0
let testsFailed = 0

function assert(label: string, condition: boolean, details?: string) {
  if (condition) {
    testsPassed++
    console.log(`✓ ${label}`)
  } else {
    testsFailed++
    console.error(`✗ ${label}${details ? ` — ${details}` : ''}`)
  }
}

class MockPool {
  public queries: Array<{ sql: string; params: any[] }> = []
  private queryMap: Map<string, { rows: any[] }> = new Map()

  query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    this.queries.push({ sql, params })
    const key = sql + JSON.stringify(params)
    return Promise.resolve(this.queryMap.get(key) ?? { rows: [] })
  }

  setQueryResult(sql: string, params: any[], rows: any[]) {
    this.queryMap.set(sql + JSON.stringify(params), { rows })
  }

  connect() {
    return Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => {} })
  }
}

class MockRedisCache {
  private cache = new Map<string, string>()
  async get() { return null }
  async setex() {}
}

const mockHub = { sendToUser: () => {} } as any

const TIER_QUERY = `SELECT u.id, u.username
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND u.bot_difficulty = $1
         AND u.preferred_game_type = $2 AND w.real_balance >= $3
       ORDER BY RANDOM() LIMIT 1`

async function run() {
  const pool = new MockPool()
  const mockRedis = new MockRedisCache() as any
  const service = new MatchmakingService(mockRedis, pool as any, mockHub)

  pool.setQueryResult(TIER_QUERY, ['easy', 'ludo', 10], [{ id: 'bot-easy', username: 'EasyBot' }])
  pool.setQueryResult(TIER_QUERY, ['medium', 'ludo', 10], [{ id: 'bot-medium', username: 'MediumBot' }])
  pool.setQueryResult(TIER_QUERY, ['hard', 'ludo', 10], [{ id: 'bot-hard', username: 'HardBot' }])

  const bots = await (service as any).getTierDiverseBots('ludo', 10)
  assert('returns exactly one bot per tier when all three exist', bots?.length === 3)
  assert('easy tier resolved correctly', bots?.[0]?.userId === 'bot-easy')
  assert('medium tier resolved correctly', bots?.[1]?.userId === 'bot-medium')
  assert('hard tier resolved correctly', bots?.[2]?.userId === 'bot-hard')

  const pool2 = new MockPool()
  const service2 = new MatchmakingService(mockRedis, pool2 as any, mockHub)
  pool2.setQueryResult(TIER_QUERY, ['easy', 'ludo', 10], [{ id: 'bot-easy', username: 'EasyBot' }])
  pool2.setQueryResult(TIER_QUERY, ['medium', 'ludo', 10], [{ id: 'bot-medium', username: 'MediumBot' }])
  // No hard-tier row seeded -> query returns { rows: [] } -> should yield null
  const incomplete = await (service2 as any).getTierDiverseBots('ludo', 10)
  assert('returns null when any tier is missing', incomplete === null)

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} tiered hard-wins bot-selection tests passed.`)
}

run()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/game-gateway && npx tsx src/matchmaking.tieredHardWins.test.ts`
Expected: FAIL — `getTierDiverseBots` doesn't exist yet (TypeError: `(service as any).getTierDiverseBots is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `services/game-gateway/src/matchmaking.ts`, add this method immediately after `getBots` (the method ending at line 428, just before the `resolveBotDifficulties` comment):

```typescript
  // Ludo-only, tiered_hard_wins strategy: fetches one bot per difficulty
  // tier (easy, medium, hard). Returns null if any tier has no free bot —
  // the caller (botFillRoom) falls back to the plain getBots selection.
  private async getTierDiverseBots(gameType: string, stake: number): Promise<MatchmakingEntry[] | null> {
    const tiers: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard']
    const picked: MatchmakingEntry[] = []
    for (const tier of tiers) {
      const res = await this.db.query(
        `SELECT u.id, u.username
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND u.bot_difficulty = $1
         AND u.preferred_game_type = $2 AND w.real_balance >= $3
       ORDER BY RANDOM() LIMIT 1`,
        [tier, gameType, stake]
      )
      if (res.rows.length === 0) return null
      picked.push({ userId: res.rows[0].id, username: res.rows[0].username })
    }
    return picked
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/game-gateway && npx tsx src/matchmaking.tieredHardWins.test.ts`
Expected: `All 5 tiered hard-wins bot-selection tests passed.`

- [ ] **Step 5: Commit**

```bash
git add services/game-gateway/src/matchmaking.ts services/game-gateway/src/matchmaking.tieredHardWins.test.ts
git commit -m "feat(ludo): add getTierDiverseBots for tiered_hard_wins bot selection"
```

---

### Task 5: Wire tier-diverse selection into `botFillRoom` and winner designation into `startGame`

**Files:**
- Modify: `services/game-gateway/src/matchmaking.ts`

**Interfaces:**
- Consumes: `getTierDiverseBots` (Task 4), `electHardTierWinner` (Task 3), `config.strategy`/`config.fallbackStrategy` (Tasks 1-2).
- Produces: no new exported interface — this task wires existing pieces together inside two already-private methods.

This task has no isolated automated-test seam of its own (`startGame` is a large private method with no existing test harness — consistent with today's codebase, where only its sub-pieces are unit tested). Coverage comes from Tasks 3-4's unit tests plus the manual verification in Step 3 below.

- [ ] **Step 1: Wire `getTierDiverseBots` into `botFillRoom`**

In `services/game-gateway/src/matchmaking.ts`, replace this line (currently line 344):

```typescript
    const bots = await this.getBots(gameType, botsNeeded, stake)
```

with:

```typescript
    let bots: MatchmakingEntry[]
    if (gameType === 'ludo' && botsNeeded === 3) {
      const botTrainingCfg = await this.botTrainingConfig.getConfig()
      bots = botTrainingCfg.enabled && botTrainingCfg.strategy === 'tiered_hard_wins'
        ? (await this.getTierDiverseBots(gameType, stake)) ?? (await this.getBots(gameType, botsNeeded, stake))
        : await this.getBots(gameType, botsNeeded, stake)
    } else {
      bots = await this.getBots(gameType, botsNeeded, stake)
    }
```

- [ ] **Step 2: Wire winner designation + bias override into `startGame`'s coordination block**

In the same file, replace the coordination block inside `startGame` (currently lines 663-721, the `if (config.enabled && botCount === 3) { ... }` block):

```typescript
    if (config.enabled && botCount === 3) {
      // This is a 3-bot + 1-RP game; apply coordination
      const botPlayers = gatewayPlayers.filter(p => p.isBot)

      try {
        // Load stats for all bots in this game
        const botsWithStats: BotWithStats[] = await Promise.all(
          botPlayers.map(async (bot) => ({
            botId: bot.userId,
            stats: await this.botStatsLoader.loadBotStats(bot.userId),
          }))
        )

        // Tiered Hard-Wins: designate whichever seated bot is tagged 'hard',
        // skipping election entirely. Falls back to config.fallbackStrategy's
        // normal election whenever no hard-tagged bot is among the three
        // (tier-diverse selection couldn't find a full set, or a race changed
        // tags between selection and seating).
        let winnerBotId: string
        let strategyUsed: string
        if (config.strategy === 'tiered_hard_wins') {
          const hardTierBotId = this.electionAlgorithm.electHardTierWinner(botDifficulties)
          if (hardTierBotId) {
            winnerBotId = hardTierBotId
            strategyUsed = 'tiered_hard_wins'
          } else {
            winnerBotId = this.electionAlgorithm.electWinnerBot(botsWithStats, config.fallbackStrategy, gameType)
            strategyUsed = config.fallbackStrategy
          }
        } else {
          winnerBotId = this.electionAlgorithm.electWinnerBot(botsWithStats, config.strategy, gameType)
          strategyUsed = config.strategy
        }

        // Store coordination metadata in Redis
        const botTrainingMetadata = {
          winnerBotId,
          strategy: strategyUsed,
          targetWinRate: config.targetWinRate,
          aggressiveness: config.aggressiveness,
          botIds: botPlayers.map(b => b.userId),
          rpId: gatewayPlayers.find(p => !p.isBot)?.userId,
        }

        await this.redis.setex(
          `room:${roomId}:botTraining`,
          86400, // 24 hour expiry
          JSON.stringify(botTrainingMetadata)
        )

        // Ludo's own engine keeps its own state (separate from gatewayPlayers)
        // and needs the winner's seat index to bias per-turn token choices.
        if (gameType === 'ludo') {
          const winnerIdx = gatewayPlayers.findIndex(p => p.userId === winnerBotId)
          if (winnerIdx !== -1) {
            // tiered_hard_wins always applies its own maxed-out bias, independent
            // of the shared sliders (those still apply, unaffected, to every
            // other strategy's games).
            const usingTieredHardWins = strategyUsed === 'tiered_hard_wins'
            const boldness = usingTieredHardWins
              ? 1.0
              : config.adaptiveBoldness
                ? await computeEffectiveBoldness(this.db, config.winnerBotBoldness, config.targetWinRate)
                : config.winnerBotBoldness
            botCoordinationForEngine = {
              winnerBotIdx: winnerIdx,
              aggressiveness: config.aggressiveness,
              winnerSkill: usingTieredHardWins ? 'expert' : config.winnerBotSkill,
              boldness,
              diceBias: usingTieredHardWins ? 1.0 : config.winnerBotDiceBias,
            }
          }
        }

        console.log(`[BotCoordination] Game ${roomId}: ${winnerBotId} elected to win (strategy: ${strategyUsed})`)
      } catch (error) {
        console.error(`[BotCoordination] Failed to initialize coordination for game ${roomId}:`, error)
        // Coordination failed gracefully; game proceeds without it
      }
    }
```

- [ ] **Step 3: Build check + manual verification**

Run: `cd services/game-gateway && npx tsc --noEmit -p .`
Expected: no errors.

Then re-run every existing/added game-gateway test to confirm nothing regressed:

```bash
cd services/game-gateway
npx vitest run src/tests/botCoordination.test.ts
npx vitest run src/repositories/botTrainingConfigRepository.test.ts
npx tsx src/matchmaking.botDifficulty.test.ts
npx tsx src/matchmaking.tieredHardWins.test.ts
```
Expected: all pass.

Manual smoke test (same pattern used to verify sub-project #2 per the original training-pipeline spec): with the dev/staging DB, tag three bot accounts `easy`/`medium`/`hard` via `UPDATE users SET bot_difficulty = '<tier>' WHERE id = '<bot-id>'`, set the Ludo bot-training config's `strategy` to `tiered_hard_wins` via the admin API, queue one real player for Ludo, and confirm in `bot_learning_sessions` that `strategy_used = 'tiered_hard_wins'` and `winner_bot_id` matches the hard-tagged bot's id.

- [ ] **Step 4: Commit**

```bash
git add services/game-gateway/src/matchmaking.ts
git commit -m "feat(ludo): wire tiered_hard_wins bot selection and winner designation into matchmaking"
```

---

### Task 6: Admin panel — expose the new strategy

**Files:**
- Modify: `admin-panel/src/components/BotTrainingConfigPanel.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/admin/ludo/bot-training/config` (Task 2's admin-service repository, already returns/accepts the new fields once deployed).
- Produces: no new interface — this is the terminal UI layer.

- [ ] **Step 1: Update the local type and strategy options**

In `admin-panel/src/components/BotTrainingConfigPanel.tsx`, update the interface and options list:

```typescript
interface BotTrainingConfig {
  enabled: boolean
  strategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first' | 'tiered_hard_wins'
  fallbackStrategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first'
  targetWinRate: number
  aggressiveness: number
  winnerBotSkill: 'casual' | 'skilled' | 'expert'
  winnerBotBoldness: number
  adaptiveBoldness: boolean
  winnerBotDiceBias: number
  effectiveBoldness?: number // read-only, returned by GET only
}

const STRATEGY_OPTIONS = [
  { label: 'Highest Lifetime Win Rate', value: 'lifetime_winrate' },
  { label: 'Highest Win Rate vs RP', value: 'vs_rp_winrate' },
  { label: 'Rotation', value: 'rotation' },
  { label: 'Weakest Bot First', value: 'weakest_first' },
  { label: 'Tiered Hard-Wins (hard-tier bot always wins)', value: 'tiered_hard_wins' },
]

const FALLBACK_STRATEGY_OPTIONS = [
  { label: 'Highest Lifetime Win Rate', value: 'lifetime_winrate' },
  { label: 'Highest Win Rate vs RP', value: 'vs_rp_winrate' },
  { label: 'Rotation', value: 'rotation' },
  { label: 'Weakest Bot First', value: 'weakest_first' },
]
```

- [ ] **Step 2: Add the fallback-strategy field and explanatory help text**

Add this `Form.Item` immediately after the existing `strategy` `Form.Item` (after its closing `</Form.Item>`, before the `targetWinRate` one):

```typescript
        <Form.Item
          name="strategy"
          label="Election Strategy"
          help="Tiered Hard-Wins requires one easy-, one medium-, and one hard-tagged bot to be seated together (set per-bot via a bot's Difficulty Override) — falls back to the strategy below whenever a full set isn't available for a room. Uses its own maxed-out bias, independent of the sliders further down; real win rate realistically lands ~60-70%, not literally guaranteed."
          rules={[{ required: true }]}
        >
          <Select options={STRATEGY_OPTIONS} />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.strategy !== cur.strategy}>
          {({ getFieldValue }) => {
            if (getFieldValue('strategy') !== 'tiered_hard_wins') return null
            return (
              <Form.Item
                name="fallbackStrategy"
                label="Fallback Strategy"
                help="Used only when a room can't be seated with one easy/medium/hard bot each"
                rules={[{ required: true }]}
              >
                <Select options={FALLBACK_STRATEGY_OPTIONS} />
              </Form.Item>
            )
          }}
        </Form.Item>
```

Remove the now-duplicated original `strategy` `Form.Item` (the plain one without `help`) that currently sits at lines 93-99.

- [ ] **Step 3: Type-check**

Run: `cd admin-panel && npx tsc --noEmit -p .`
Expected: no errors.

Per this session's standing preference, skip Chrome-based visual verification — the user checks visually on the live VPS.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/components/BotTrainingConfigPanel.tsx
git commit -m "feat(admin): expose tiered_hard_wins strategy + fallback in Bot Training config UI"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (new strategy value) → Tasks 1-2. §2 (tier-diverse selection) → Task 4, wired in Task 5 Step 1. §3 (winner designation, honest logging) → Task 5 Step 2. §4 (dedicated max bias) → Task 5 Step 2. §5 (logging via existing `strategy_used`) → Task 5 Step 2 (`strategyUsed` variable). Admin config UI → Task 6. Testing section of the spec → covered by Tasks 1-4's unit tests plus Task 5's manual verification.
- **Placeholder scan:** none found — every step has literal code/commands.
- **Type consistency:** `BotTrainingConfig.strategy`/`fallbackStrategy` identical across Tasks 1, 2, 6. `getTierDiverseBots(gameType: string, stake: number): Promise<MatchmakingEntry[] | null>` used identically in Task 4's test and Task 5's wiring. `electHardTierWinner(botDifficulties: Map<string, string>): string | null` used identically in Task 3's test and Task 5's wiring.
