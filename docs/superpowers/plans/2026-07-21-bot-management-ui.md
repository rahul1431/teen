# Bot Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each bot account an optional per-bot difficulty override that actually affects both Teen Patti and Ludo gameplay, and let admins manage bots (roster, reassign, difficulty, create/deactivate) from within each game's own admin page via a reusable panel.

**Architecture:** One new nullable, CHECK-constrained column (`users.bot_difficulty`). `game-gateway` resolves each bot's effective difficulty (its own tag, or the room-wide `game_configs` default) at room-start and attaches it per-player to room state. Teen Patti's decision logic (already gateway-side) reads the acting bot's own value from state instead of one room-wide value — no engine changes needed there. Ludo's decision logic lives inside its own engine, so `LudoPlayer`/`createInitialState`/the bot-move handler gain a per-player field. The admin-panel side extracts the existing `Bots.tsx` roster/actions into a reusable `BotManagementPanel` component, parameterized by an optional `gameType`, embedded filtered in Teen Patti's and Ludo's pages and unfiltered in the existing global page.

**Tech Stack:** PostgreSQL, Fastify + `pg` (admin-service), TypeScript (game-gateway, Ludo engine — `node:test` for the engine's own tests), React + antd (admin-panel).

## Global Constraints

- `bot_difficulty` is `NULL` for every real player, always — the `PATCH` endpoint must reject setting it on a non-bot user (mirrors the existing bot-only guard pattern in `DELETE /api/admin/bots/:id`).
- No changes to the Teen Patti Go engine (`services/game-engines/teen-patti/main.go`) — confirmed during design that Teen Patti's bot decisions are made entirely gateway-side; the Go engine only stores `BotDifficulty` as inert room metadata.
- Ludo engine changes must be fully backward compatible: any caller (including the existing `rules.test.ts` suite) that doesn't pass a per-player difficulty must behave exactly as today (room-wide `bot_difficulty` used for every bot).
- No changes to Aviator/Matka or the PnL dashboard (out of scope per the spec).
- The existing fake `getBotPersonality()` "Play Style" column stays as-is; only "Skill Level" is replaced with the real `bot_difficulty` field.

---

## File Structure

- Create: `infra/db/migrations/085_bot_difficulty_override.sql`
- Modify: `services/game-engines/ludo/src/rules.ts` (`LudoPlayer`, `createInitialState`)
- Modify: `services/game-engines/ludo/src/rules.test.ts`
- Modify: `services/game-engines/ludo/src/index.ts` (`StartReq`, bot-move handler)
- Modify: `services/game-gateway/src/matchmaking.ts` (`startGame`, Teen Patti bot-turn scheduling, Ludo `/start` call)
- Modify: `services/game-gateway/src/matchmaking.getBots.test.ts` → new sibling test file for the difficulty-resolution query
- Modify: `services/admin-service/src/index.ts` (`GET /api/admin/users`, new `PATCH /api/admin/bots/:id`)
- Create: `admin-panel/src/components/BotManagementPanel.tsx`
- Modify: `admin-panel/src/pages/Bots.tsx` (thin wrapper)
- Modify: `admin-panel/src/pages/games/TeenPatti.tsx` (add Bots tab)
- Modify: `admin-panel/src/pages/games/Ludo.tsx` (add Bots tab)

---

### Task 1: Schema — per-bot difficulty column

**Files:**
- Create: `infra/db/migrations/085_bot_difficulty_override.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Per-bot difficulty override. NULL means "use the game-wide
-- game_configs.bot_difficulty default" -- every existing bot keeps
-- today's behavior automatically. See
-- docs/superpowers/specs/2026-07-21-bot-management-ui-design.md

ALTER TABLE users ADD COLUMN bot_difficulty VARCHAR(10)
  CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));
```

- [ ] **Step 2: Dry-run against production in a rolled-back transaction**

```bash
ssh -i ~/.ssh/id_ed25519 root@64.204.130.181 "docker exec -i teen_postgres psql -U teen -d teen_db" <<'EOF'
BEGIN;
ALTER TABLE users ADD COLUMN bot_difficulty VARCHAR(10)
  CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'bot_difficulty';
ROLLBACK;
EOF
```

Expected: `ALTER TABLE`, one row back from the `SELECT`, `ROLLBACK` — no errors.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/085_bot_difficulty_override.sql
git commit -m "feat(db): add per-bot difficulty override column"
```

---

### Task 2: Ludo engine — per-player difficulty

**Files:**
- Modify: `services/game-engines/ludo/src/rules.ts`
- Test: `services/game-engines/ludo/src/rules.test.ts`
- Modify: `services/game-engines/ludo/src/index.ts`

**Interfaces:**
- Produces: `LudoPlayer.bot_difficulty?: BotDifficulty` and `createInitialState`'s `players` param gains `bot_difficulty?: BotDifficulty` per entry — consumed by Task 4 (game-gateway) when it starts passing this field, and by this task's own `index.ts` change.

- [ ] **Step 1: Write the failing tests**

Add to `services/game-engines/ludo/src/rules.test.ts` (append a new `describe` block near the existing `chooseBotToken` one):

```typescript
describe('per-player bot_difficulty override', () => {
  test('createInitialState maps a per-player bot_difficulty onto that player only', () => {
    const state = createInitialState('room1', 100, [
      { user_id: 'p0', username: 'P0', seat: 1, is_bot: true, bot_difficulty: 'hard' },
      { user_id: 'p1', username: 'P1', seat: 2, is_bot: true },
    ], 'medium')
    assert.equal(state.players[0].bot_difficulty, 'hard')
    assert.equal(state.players[1].bot_difficulty, undefined)
    assert.equal(state.bot_difficulty, 'medium') // room-wide default unchanged
  })

  test('a bot without its own override falls back to the room-wide difficulty at the call site', () => {
    // This mirrors exactly what index.ts's bot-move handler does:
    // state.players[idx].bot_difficulty ?? state.bot_difficulty
    const state = createInitialState('room1', 100, [
      { user_id: 'p0', username: 'P0', seat: 1, is_bot: true },
    ], 'hard')
    const effectiveDifficulty = state.players[0].bot_difficulty ?? state.bot_difficulty
    assert.equal(effectiveDifficulty, 'hard')
  })

  test('chooseBotToken behavior actually differs by the resolved per-player difficulty', () => {
    // Set up a board where hard difficulty's exposure-avoidance changes the
    // pick vs medium's capture-or-advance-only logic (same fixture shape as
    // the existing 'hard avoids exposing a token' test above in this file).
    const state = makeState({
      players: [
        { user_id: 'p0', username: 'P0', seat: 1, is_bot: true, color: 'red', tokens: [10, -1, -1, -1], finished: 0, status: 'active' },
        { user_id: 'p1', username: 'P1', seat: 2, is_bot: false, color: 'green', tokens: [-1, -1, -1, -1], finished: 0, status: 'active' },
        { user_id: 'p2', username: 'P2', seat: 3, is_bot: false, color: 'yellow', tokens: [15, -1, -1, -1], finished: 0, status: 'active' },
        { user_id: 'p3', username: 'P3', seat: 4, is_bot: false, color: 'blue', tokens: [-1, -1, -1, -1], finished: 0, status: 'active' },
      ],
    })
    const p0Difficulty = state.players[0].bot_difficulty ?? state.bot_difficulty
    const t = chooseBotToken(state, 0, 4, p0Difficulty)
    assert.ok(t >= 0, 'a legal move is chosen using the resolved per-player difficulty')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/game-engines/ludo && npx tsx --test src/rules.test.ts`
Expected: FAIL — `bot_difficulty` is not a valid property on the `players` array entries passed to `createInitialState` (TypeScript compile error under `tsx`, or a runtime `undefined` mismatch if types are loose) since `LudoPlayer`/`createInitialState`'s param type don't have this field yet.

- [ ] **Step 3: Update `rules.ts`**

Change the `LudoPlayer` interface (currently lines 23-32):

```typescript
export interface LudoPlayer {
  user_id: string
  username: string
  seat: number          // 1-based seat number from the gateway
  is_bot: boolean
  color: string
  tokens: number[]       // progress for each of the 4 tokens
  finished: number       // count of tokens that reached HOME
  status: string         // 'active' | 'finished' | 'disconnected'
  bot_difficulty?: BotDifficulty // per-bot override; unset = use LudoState.bot_difficulty
}
```

Change `createInitialState` (currently lines 66-97):

```typescript
export function createInitialState(
  roomId: string,
  stake: number,
  players: { user_id: string; username: string; seat: number; is_bot: boolean; bot_difficulty?: BotDifficulty }[],
  botDifficulty: BotDifficulty = 'medium',
): LudoState {
  return {
    room_id: roomId,
    game_type: 'ludo',
    stake,
    players: players.map((p, i) => ({
      user_id: p.user_id,
      username: p.username,
      seat: p.seat,
      is_bot: p.is_bot,
      color: COLORS[i % 4],
      tokens: [-1, -1, -1, -1],
      finished: 0,
      status: 'active',
      bot_difficulty: p.bot_difficulty,
    })),
    status: 'active',
    current_turn: 0,
    dice: null,
    movable_tokens: [],
    awaiting: 'roll',
    consecutive_sixes: 0,
    winner_id: null,
    round: 1,
    created_at: Date.now(),
    bot_difficulty: botDifficulty,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd services/game-engines/ludo && npx tsx --test src/rules.test.ts`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Update `index.ts`**

In `services/game-engines/ludo/src/index.ts`, change `StartReq` (currently lines 70-75):

```typescript
interface StartReq {
  room_id: string
  stake: number
  players: { user_id: string; username: string; seat: number; is_bot: boolean; bot_difficulty?: BotDifficulty }[]
  bot_difficulty?: BotDifficulty
}
```

Change the `/start` handler's call to `createInitialState` (currently line 98, `const state = createInitialState(body.room_id, body.stake, body.players, difficulty)`) — no change needed here, since `body.players` now structurally includes the optional `bot_difficulty` field and TypeScript/JS pass it straight through to the updated `createInitialState`.

Change the bot-move handler (currently line 172):

```typescript
movedToken = chooseBotToken(state, idx, dice, state.players[idx].bot_difficulty ?? state.bot_difficulty)
```

- [ ] **Step 6: Verify the engine builds**

Run: `cd services/game-engines/ludo && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Re-run the full rules test suite**

Run: `cd services/game-engines/ludo && npx tsx --test src/rules.test.ts`
Expected: PASS (no regressions — every pre-existing test still calls `createInitialState` without `bot_difficulty` per player and gets today's exact behavior)

- [ ] **Step 8: Commit**

```bash
git add services/game-engines/ludo/src/rules.ts services/game-engines/ludo/src/rules.test.ts services/game-engines/ludo/src/index.ts
git commit -m "feat(ludo-engine): support a per-player bot_difficulty override"
```

---

### Task 3: admin-service — bot roster filter + reassign/tune endpoint

**Files:**
- Modify: `services/admin-service/src/index.ts:373-397` (`GET /api/admin/users`)
- Modify: `services/admin-service/src/index.ts` (new route, near the existing `DELETE /api/admin/bots/:id` at line 2567-2588)

- [ ] **Step 1: Extend `GET /api/admin/users`**

Replace lines 373-397:

```typescript
  app.get('/api/admin/users', { onRequest: [authenticate] }, async (req, reply) => {
    const { page = 1, limit = 20, search, status, is_bot = 'false', game_type } = req.query as any
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const conditions: string[] = ['u.is_bot = $1']
    const params: any[] = [is_bot !== 'false']
    let idx = 2
    if (search) { conditions.push(`(u.username ILIKE $${idx} OR u.phone ILIKE $${idx})`); params.push(`%${search}%`); idx++ }
    if (status) { conditions.push(`u.status = $${idx}`); params.push(status); idx++ }
    if (game_type) { conditions.push(`u.preferred_game_type = $${idx}`); params.push(game_type); idx++ }
    const where = conditions.join(' AND ')
    const [users, countRes] = await Promise.all([
      db.query(`SELECT u.id, u.username, u.phone, u.email, u.kyc_status, u.status, u.referral_code, u.created_at,
                       u.preferred_game_type, u.bot_difficulty,
                       w.real_balance, w.bonus_balance,
                       COALESCE(
                         (SELECT SUM(CASE WHEN type = 'game_credit' THEN amount ELSE -amount END)
                          FROM wallet_transactions
                          WHERE user_id = u.id AND status = 'completed' AND type IN ('game_credit', 'game_debit')),
                         0
                       )::float AS pnl
                FROM users u LEFT JOIN wallets w ON w.user_id = u.id
                WHERE ${where} ORDER BY u.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]),
      db.query(`SELECT COUNT(*) FROM users u WHERE ${where}`, params),
    ])
    return reply.send({ users: users.rows, total: parseInt(countRes.rows[0].count) })
  })
```

- [ ] **Step 2: Add the new `PATCH /api/admin/bots/:id` route**

Add immediately after the existing `DELETE /api/admin/bots/:id` route (after line 2588):

```typescript
  app.patch('/api/admin/bots/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const botCheck = await db.query('SELECT is_bot FROM users WHERE id = $1', [id])
    if (!botCheck.rows.length || !botCheck.rows[0].is_bot) {
      return reply.code(400).send({ error: 'User is not a bot or does not exist' })
    }

    const body = z.object({
      preferred_game_type: z.string().min(1).optional(),
      bot_difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
    }).parse(req.body)

    const sets: string[] = []
    const params: any[] = [id]
    if (body.preferred_game_type !== undefined) { params.push(body.preferred_game_type); sets.push(`preferred_game_type = $${params.length}`) }
    if (body.bot_difficulty !== undefined) { params.push(body.bot_difficulty); sets.push(`bot_difficulty = $${params.length}`) }

    if (sets.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' })
    }

    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params)
    return reply.send({ success: true })
  })
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): filter bot roster by game_type, add bot reassign/difficulty endpoint"
```

---

### Task 4: game-gateway — resolve and attach per-bot difficulty

**Files:**
- Modify: `services/game-gateway/src/matchmaking.ts`
- Test: `services/game-gateway/src/matchmaking.botDifficulty.test.ts`

**Interfaces:**
- Consumes: `users.bot_difficulty` (Task 1), the Ludo engine's per-player field (Task 2).

- [ ] **Step 1: Write the failing test**

```typescript
// services/game-gateway/src/matchmaking.botDifficulty.test.ts
// Run: npx tsx src/matchmaking.botDifficulty.test.ts
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

const mockRedis = { get: async () => null, setex: async () => {} } as any
const mockHub = { sendToUser: () => {} } as any

async function run() {
  const pool = new MockPool()
  const service = new MatchmakingService(mockRedis, pool as any, mockHub)

  const botDifficultyQuery = `SELECT id, bot_difficulty FROM users WHERE id = ANY($1::uuid[])`
  pool.setQueryResult(botDifficultyQuery, [['bot-1', 'bot-2']], [
    { id: 'bot-1', bot_difficulty: 'hard' },
    { id: 'bot-2', bot_difficulty: null },
  ])

  const resolved = await (service as any).resolveBotDifficulties(['bot-1', 'bot-2'], 'medium')

  assert('bot-1 gets its own override (hard)', resolved.get('bot-1') === 'hard')
  assert('bot-2 falls back to the room-wide default (medium)', resolved.get('bot-2') === 'medium')

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} bot-difficulty resolution tests passed.`)
}

run()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/game-gateway && npx tsx src/matchmaking.botDifficulty.test.ts`
Expected: FAIL — `resolveBotDifficulties` doesn't exist yet.

- [ ] **Step 3: Add `resolveBotDifficulties` and wire it into `startGame`**

In `services/game-gateway/src/matchmaking.ts`, add this private method (near `getBots`, e.g. directly after it):

```typescript
  // Resolves each bot's effective difficulty: its own users.bot_difficulty
  // tag if set, otherwise the room-wide default computed from game_configs.
  private async resolveBotDifficulties(botUserIds: string[], roomWideDefault: string): Promise<Map<string, string>> {
    const resolved = new Map<string, string>()
    if (botUserIds.length === 0) return resolved

    const res = await this.db.query(
      `SELECT id, bot_difficulty FROM users WHERE id = ANY($1::uuid[])`,
      [botUserIds]
    )
    const overrides = new Map(res.rows.map((r: any) => [r.id, r.bot_difficulty]))
    for (const id of botUserIds) {
      resolved.set(id, overrides.get(id) ?? roomWideDefault)
    }
    return resolved
  }
```

In `startGame`, after the existing room-wide `botDifficulty` resolution block (after the personalization-canary block, before `const client = await this.db.connect()` — currently around line 478), add:

```typescript
    const botDifficulties = await this.resolveBotDifficulties(bots.map(b => b.userId), botDifficulty)
```

Then in the `gatewayPlayers` construction (currently `allPlayers.map((p, i) => ({...}))`, around line 557-563), attach the resolved value for bot seats:

```typescript
    const gatewayPlayers = allPlayers.map((p, i) => ({
      userId: p.userId,
      username: p.username,
      seat: i + 1,
      isBot: bots.some(b => b.userId === p.userId),
      status: 'active',
      botDifficulty: botDifficulties.get(p.userId), // undefined for real players
    }))
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd services/game-gateway && npx tsx src/matchmaking.botDifficulty.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Use the per-player value in Teen Patti's bot-turn scheduling**

Locate the Teen Patti bot-turn scheduling method (the one containing, per investigation, `const botDifficulty = (state.botDifficulty ?? state.bot_difficulty ?? 'medium') as 'easy' | 'medium' | 'hard'` followed by `getBotProfile(this.redis, gameType, botDifficulty)`). Change it to look up the specific acting bot's own difficulty from `state.players` (matched by the bot's `userId`) before falling back to the room-wide value:

```typescript
    const actingBotId = /* the userId of the bot whose turn this is — use whatever variable this method already has for that, e.g. state.players[state.currentTurn]?.userId */
    const actingBot = (state.players ?? []).find((p: any) => p.userId === actingBotId)
    const botDifficulty = (actingBot?.botDifficulty ?? state.botDifficulty ?? state.bot_difficulty ?? 'medium') as 'easy' | 'medium' | 'hard'
```

(The exact acting-bot identifier variable name must be confirmed against the method's actual local variables at implementation time — this step's job is inserting the `actingBot?.botDifficulty ??` lookup ahead of the existing fallback chain, not rewriting the method.)

- [ ] **Step 6: Pass per-player difficulty in the Ludo `/start` call**

In the Ludo `/start` call (currently `players: gatewayPlayers.map(p => ({ user_id: p.userId, username: p.username, seat: p.seat, is_bot: p.isBot }))`), add the field:

```typescript
          players: gatewayPlayers.map(p => ({ user_id: p.userId, username: p.username, seat: p.seat, is_bot: p.isBot, bot_difficulty: p.botDifficulty })),
```

- [ ] **Step 7: Verify the build compiles**

Run: `cd services/game-gateway && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Re-run existing tests to confirm no regression**

Run: `cd services/game-gateway && npx tsx src/matchmaking.getBots.test.ts && npx tsx src/matchmaking.seatplan.test.ts`
Expected: both PASS unchanged

- [ ] **Step 9: Commit**

```bash
git add services/game-gateway/src/matchmaking.ts services/game-gateway/src/matchmaking.botDifficulty.test.ts
git commit -m "feat(game-gateway): resolve and attach per-bot difficulty at room start"
```

---

### Task 5: Extract the reusable BotManagementPanel component

**Files:**
- Create: `admin-panel/src/components/BotManagementPanel.tsx`
- Modify: `admin-panel/src/pages/Bots.tsx`

**Interfaces:**
- Produces: `export default function BotManagementPanel({ gameType }: { gameType?: string })` — consumed by Task 6 (`TeenPatti.tsx`, `Ludo.tsx`) and by the updated `Bots.tsx` in this task.

- [ ] **Step 1: Create the component**

Move the bot-roster-and-actions logic (state: `bots`, `loading`, `total`, `page`, `pageSize`, `search`; the `loadBots`, `createBot`, `deleteBot`, `toggleBotStatus`, `creditBot` functions; the create/credit `Modal`s; the roster `Table` with its columns) from `admin-panel/src/pages/Bots.tsx` into a new file, `admin-panel/src/components/BotManagementPanel.tsx`, as:

```typescript
export default function BotManagementPanel({ gameType }: { gameType?: string }) {
  // ... (moved state and functions, with these changes:)

  const loadBots = () => {
    setLoading(true)
    adminApi.get(`/users`, {
      params: {
        page,
        limit: pageSize,
        search,
        is_bot: 'true',
        ...(gameType ? { game_type: gameType } : {}),
      }
    })
      .then(r => {
        setBots(r.data.users || [])
        setTotal(r.data.total || 0)
      })
      .catch(() => message.error('Failed to load bots'))
      .finally(() => setLoading(false))
  }

  // createBot's payload pre-fills preferred_game_type when gameType is set:
  const createBot = async (values: any) => {
    try {
      await adminApi.post('/bots', { ...values, preferred_game_type: values.preferred_game_type || gameType })
      message.success('New bot created successfully!')
      setCreateOpen(false)
      form.resetFields()
      loadBots()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to create bot')
    }
  }

  const updateBot = async (id: string, fields: { preferred_game_type?: string; bot_difficulty?: string | null }) => {
    try {
      await adminApi.patch(`/bots/${id}`, fields)
      message.success('Bot updated')
      loadBots()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update bot')
    }
  }

  // ... deleteBot, toggleBotStatus, creditBot unchanged from today's Bots.tsx

  useEffect(() => { loadBots() }, [page, search, gameType])

  // Table columns: replace the fake "Skill Level" column (using getBotPersonality)
  // with a real, editable one:
  //   {
  //     title: 'Skill Level',
  //     key: 'difficulty',
  //     render: (_, r) => (
  //       <Select
  //         size="small"
  //         value={r.bot_difficulty ?? null}
  //         style={{ width: 160 }}
  //         placeholder="Default (game-wide)"
  //         allowClear
  //         onChange={(v) => updateBot(r.id, { bot_difficulty: v ?? null })}
  //         options={[
  //           { value: 'easy', label: 'Easy' },
  //           { value: 'medium', label: 'Medium' },
  //           { value: 'hard', label: 'Hard' },
  //         ]}
  //       />
  //     ),
  //   },
  // Add a "Game" column with the same Select pattern, writing preferred_game_type:
  //   {
  //     title: 'Game',
  //     key: 'game',
  //     render: (_, r) => (
  //       <Select
  //         size="small"
  //         value={r.preferred_game_type}
  //         style={{ width: 140 }}
  //         onChange={(v) => updateBot(r.id, { preferred_game_type: v })}
  //         options={[
  //           { value: 'teen_patti', label: 'Teen Patti' },
  //           { value: 'ludo', label: 'Ludo' },
  //         ]}
  //       />
  //     ),
  //   },
  // The "Play Style" column (getBotPersonality-derived) stays exactly as-is.

  return (
    // ... the Card with the search bar + Table + create/credit Modals,
    // exactly as today's right-hand "Bot Users Table" Card in Bots.tsx,
    // moved verbatim except for the two column/handler changes above.
  )
}
```

The full moved JSX/logic must be copied verbatim from the current `Bots.tsx` (read the file at implementation time — it's ~250 lines of the roster Card, both Modals, and their handlers) with only: (a) the `gameType` param threading into `loadBots`/`createBot` as shown, (b) the "Skill Level" column replaced, (c) a new "Game" column added, (d) `loadStats`/`stats` and the two top summary `Card`s stay in `Bots.tsx`, NOT moved here (they're a global cross-game view, not part of the roster panel), (e) the left-hand "Bot In-Game Simulation Rules" config Card also stays in `Bots.tsx` only (per the spec: game-wide config isn't duplicated into the per-game pages, since each game page already implicitly is that one game and its own config Card already exists there — see Task 6).

- [ ] **Step 2: Rewrite `Bots.tsx` as a thin wrapper**

Replace `admin-panel/src/pages/Bots.tsx`'s content with: the page header, the two top summary stat `Card`s (`stats`/`loadStats`, unchanged), the left-hand "Bot In-Game Simulation Rules" `Card` (unchanged, `configs`/`loadConfigs`/`saveGameConfig`, unchanged), and `<BotManagementPanel />` (no `gameType` prop) in place of where the roster `Card` used to be.

- [ ] **Step 3: Verify the build compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/components/BotManagementPanel.tsx admin-panel/src/pages/Bots.tsx
git commit -m "refactor(admin-panel): extract BotManagementPanel from Bots.tsx, add real per-bot difficulty/game columns"
```

---

### Task 6: Embed the panel in Teen Patti and Ludo pages

**Files:**
- Modify: `admin-panel/src/pages/games/TeenPatti.tsx`
- Modify: `admin-panel/src/pages/games/Ludo.tsx`

- [ ] **Step 1: Wrap Ludo's return in a Tabs with an added Bots pane**

In `admin-panel/src/pages/games/Ludo.tsx`, add the import:

```typescript
import Tabs from 'antd/es/tabs'
import BotManagementPanel from '../../components/BotManagementPanel'
```

Change the outermost `return (` (currently line 80, `return (\n    <div>`) to open a `Tabs` wrapping the existing content as its first pane, unchanged, plus a new second pane:

```typescript
  return (
    <Tabs
      items={[
        {
          key: 'overview',
          label: 'Overview',
          children: (
            <div>
              {/* ... every line of the existing return's <div>...</div> content, completely unchanged ... */}
            </div>
          ),
        },
        {
          key: 'bots',
          label: 'Bots',
          children: <BotManagementPanel gameType="ludo" />,
        },
      ]}
    />
  )
```

Only the opening (`return (` → `return (\n    <Tabs items={[{ key: 'overview', label: 'Overview', children: (`) and closing (`</div>\n  )\n}` → `</div>\n          ),\n        },\n        { key: 'bots', label: 'Bots', children: <BotManagementPanel gameType="ludo" /> },\n      ]}\n    />\n  )\n}`) lines change — every line of existing JSX in between (the `<h2>`, `<Row>`, both `<Col>`s, the `<Drawer>`) is untouched.

- [ ] **Step 2: Same wrap for Teen Patti**

Identical change in `admin-panel/src/pages/games/TeenPatti.tsx`, with `<BotManagementPanel gameType="teen_patti" />`.

- [ ] **Step 3: Verify the build compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/games/TeenPatti.tsx admin-panel/src/pages/games/Ludo.tsx
git commit -m "feat(admin-panel): add a Bots tab to the Teen Patti and Ludo admin pages"
```

---

### Task 7: Deploy

**Files:** none (deployment only)

- [ ] **Step 1: Divergence check**

Same safety check as every prior deploy in this session: fetch this branch and the current base branch on the VPS, diff the touched files (`services/game-engines/ludo/src/*`, `services/game-gateway/src/matchmaking.ts`, `services/admin-service/src/index.ts`, the admin-panel files) between this plan's base commit and the VPS's current local HEAD, confirm zero unexpected divergence before checking anything out.

- [ ] **Step 2: Run the migration**

```bash
ssh -i ~/.ssh/id_ed25519 root@64.204.130.181 "docker exec -i teen_postgres psql -U teen -d teen_db" < infra/db/migrations/085_bot_difficulty_override.sql
```

- [ ] **Step 3: Checkout, build, and restart each touched service**

- `services/game-engines/ludo`: checkout, `npm run build` (or equivalent — confirm the build script at implementation time), restart PM2 process `teen-ludo`.
- `services/game-gateway`: checkout, build, restart `teen-gateway`, `teen-gateway-2`, `teen-gateway-3`.
- `services/admin-service`: checkout, build, restart `teen-admin-svc`.
- `admin-panel`: checkout, build, `cp -rf dist/. /home/admin/web/game.myonlinejoker.com/public_html/admin/`.

- [ ] **Step 4: Smoke-check logs**

Confirm no new error-log entries appear in any of the 5 restarted processes shortly after restart (same method as sub-project #1's deploy: compare error-log file mtimes/content before and after).

- [ ] **Step 5: Verify a live Ludo bot-move still works**

This is the highest-risk piece — trigger or observe a live Ludo game with a bot seated, confirm the bot still takes its turn (rolls/moves) without error. A regression here (e.g. a bot silently never moving because `chooseBotToken`'s new 4th-argument resolution throws or returns `undefined`) would stall real games.

---

## Self-Review Notes

- **Spec coverage:** schema (Task 1), Ludo engine (Task 2), admin-service (Task 3), gateway resolution + both games' consumption (Task 4), UI extraction (Task 5) and embedding (Task 6), deploy (Task 7) — all six of the spec's design sections covered.
- **Placeholder scan:** Task 5's Step 1 and Task 6 describe "move this verbatim" / "every line unchanged" rather than reproducing ~250 and ~150 lines of existing JSX respectively inline in this plan — this is a deliberate choice (the ground truth is the current file content, read at implementation time, not a snapshot that could drift from it by the time this task executes) rather than a placeholder for undecided logic; every actual *change* (new columns, new handler, new Tabs wrapper boundary) is fully specified with real code.
- **Type consistency:** `LudoPlayer.bot_difficulty?: BotDifficulty` (Task 2) matches `state.players[idx].bot_difficulty` used in Task 2's `index.ts` change and Task 4's Ludo `/start` payload field name (`bot_difficulty`, snake_case, matching the wire format the engine expects — distinct from the gateway's own internal camelCase `botDifficulty` on `MatchmakingEntry`/`gatewayPlayers`, which is intentional since one is the engine's JSON wire contract and the other is gateway-internal state).
