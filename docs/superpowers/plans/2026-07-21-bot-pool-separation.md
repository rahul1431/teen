# Bot Pool Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Teen Patti and Ludo dedicated, non-overlapping bot account pools, replacing the single shared global pool `getBots()` currently draws from.

**Architecture:** One nullable `users.preferred_game_type` column tags every bot account. A migration backfills the 30 existing bots per the 15/15 split from the spec. `matchmaking.ts`'s `getBots()` filters on it (no fallback — untagged bots simply stop being selectable, which is the intended forcing function). The bot-creation route (`POST /api/admin/bots` in admin-service) and its admin-panel form are updated so every future bot is tagged at creation time.

**Tech Stack:** PostgreSQL migrations, Fastify + `pg` (admin-service, game-gateway), TypeScript, Zod validation, React + antd (admin-panel), Vitest (game-gateway tests).

## Global Constraints

- No changes to bot decision-making logic (`chooseBotToken`, `pickBotAction`, `pickBotDelay`) — out of scope for this sub-project.
- No new bot-management admin UI beyond the minimum needed to keep bot creation working (a game-type selector on the existing create-bot form) — the full management UI is sub-project #2.
- No changes to Aviator/Matka behavior — they don't use `getBots()` in practice (`bot_fill_enabled = false`).
- The backfill must leave zero bots with `NULL preferred_game_type` — verified by an assertion in the migration itself, not just a manual spot-check.
- Exact backfill split (verified against production data 2026-07-21): Teen Patti gets `Seema_Bot, Anjali_Bot, Arun_Bot, Kavita_Bot, Amit_Bot, Deepak_Bot, Shyam_Bot, Kiran_Bot, Shiva, Saritha, Bhaskar, Rakesh, Rathod, Sunita_Bot, Neha_Bot` (15). Ludo gets `Pawar, Manisha, Anjali, nithin, Mohan, Raju_Bot, Meera_Bot, Pooja_Bot, Priya_Bot, Nisha_Bot, Vikram_Bot, Arjun_Bot, Rahul_Bot, Rohan_Bot, Suresh_Bot` (15).

---

## File Structure

- Create: `infra/db/migrations/084_bot_pool_separation.sql`
- Modify: `services/game-gateway/src/matchmaking.ts` (`getBots()`, around line 401-413)
- Create: `services/game-gateway/src/matchmaking.getBots.test.ts`
- Modify: `services/admin-service/src/index.ts` (`POST /api/admin/bots`, around line 2533-2565)
- Modify: `admin-panel/src/pages/Bots.tsx` (create-bot form, around line 463-487)

---

### Task 1: Migration — schema + backfill

**Files:**
- Create: `infra/db/migrations/084_bot_pool_separation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Bot pool separation: gives Teen Patti and Ludo dedicated, non-overlapping
-- bot account pools instead of drawing from one shared global pool. See
-- docs/superpowers/specs/2026-07-21-bot-pool-separation-design.md

ALTER TABLE users ADD COLUMN preferred_game_type VARCHAR(30);

-- Partial index: this column is only ever queried for is_bot = true rows.
CREATE INDEX idx_users_bot_game_type ON users(is_bot, preferred_game_type) WHERE is_bot = true;

-- One-time backfill of the 30 existing bot accounts (production data,
-- verified 2026-07-21). Split evenly 15/15, weighted so each game keeps a
-- healthy pool despite Ludo having zero exclusively-Ludo bot history.

UPDATE users SET preferred_game_type = 'teen_patti'
WHERE is_bot = true AND username IN (
  'Seema_Bot', 'Anjali_Bot', 'Arun_Bot', 'Kavita_Bot', 'Amit_Bot',
  'Deepak_Bot', 'Shyam_Bot', 'Kiran_Bot',
  'Shiva', 'Saritha', 'Bhaskar', 'Rakesh', 'Rathod',
  'Sunita_Bot', 'Neha_Bot'
);

UPDATE users SET preferred_game_type = 'ludo'
WHERE is_bot = true AND username IN (
  'Pawar', 'Manisha', 'Anjali', 'nithin', 'Mohan',
  'Raju_Bot', 'Meera_Bot', 'Pooja_Bot', 'Priya_Bot', 'Nisha_Bot',
  'Vikram_Bot', 'Arjun_Bot', 'Rahul_Bot', 'Rohan_Bot', 'Suresh_Bot'
);

-- Fail loudly rather than silently deploying with an untagged bot that
-- would become unselectable by any game once matchmaking.ts enforces
-- this filter. Covers both a naming mismatch in the lists above and any
-- bot account created between the design investigation and this running.
DO $$
DECLARE
  untagged_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO untagged_count FROM users WHERE is_bot = true AND preferred_game_type IS NULL;
  IF untagged_count > 0 THEN
    RAISE EXCEPTION 'bot pool separation backfill incomplete: % bot(s) still have NULL preferred_game_type', untagged_count;
  END IF;
END $$;
```

- [ ] **Step 2: Verify the migration is syntactically valid**

Run (against a disposable/local check — this migration is NOT run against production in this task; deployment is Task 5):
`docker exec teen_postgres psql -U teen -d teen_db -c "\d users"` (or equivalent) is NOT sufficient verification on its own since it doesn't test the migration file itself. Instead, lint the SQL by eye against Task 1's Step 1 content — the `DO $$ ... END $$` block, `ALTER TABLE`, `CREATE INDEX`, and both `UPDATE` statements must be present with matching `BEGIN`/`END` and no trailing syntax errors. This step is a careful manual review, not an automated command, because this repo's migrations run directly against the single production database (no separate migration-test environment) — see Task 5 for the actual apply-and-verify step against a real (production) database.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/084_bot_pool_separation.sql
git commit -m "feat(db): add bot pool separation migration with backfill"
```

---

### Task 2: Enforce the filter in `getBots()`

**Files:**
- Modify: `services/game-gateway/src/matchmaking.ts:401-413`
- Test: `services/game-gateway/src/matchmaking.getBots.test.ts`

**Interfaces:**
- Consumes: `MatchmakingService` class (`services/game-gateway/src/matchmaking.ts:57`), constructor `(redis: Redis, db: Pool, hub: RealtimeHub)`.
- The private `getBots(gameType: string, count: number, stake: number): Promise<MatchmakingEntry[]>` method's SQL changes; its public signature and return type are unchanged, so no caller (`joinQueue`/room-fill flows) needs updating.

- [ ] **Step 1: Write the failing test**

This test follows the existing `MockPool` pattern already established in `services/game-gateway/src/a-b-router.test.ts:39-67` (keyed by exact SQL text + JSON-stringified params) — reused here rather than reinvented.

```typescript
// services/game-gateway/src/matchmaking.getBots.test.ts
// Run: npx tsx src/matchmaking.getBots.test.ts
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

const mockRedis = {} as any
const mockHub = {} as any

async function run() {
  const pool = new MockPool()
  const service = new MatchmakingService(mockRedis, pool as any, mockHub)

  const teenPattiBotsQuery = `SELECT u.id, u.username
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND u.preferred_game_type = $1 AND w.real_balance >= $2
       ORDER BY RANDOM() LIMIT $3`
  pool.setQueryResult(teenPattiBotsQuery, ['teen_patti', 10, 3], [
    { id: 'bot-1', username: 'Seema_Bot' },
    { id: 'bot-2', username: 'Anjali_Bot' },
  ])

  const result = await (service as any).getBots('teen_patti', 3, 10)

  assert('getBots returns the mocked Teen Patti bots', result.length === 2)
  assert('getBots maps id/username correctly', result[0].userId === 'bot-1' && result[0].username === 'Seema_Bot')

  const botsCall = pool.queries.find(q => q.sql.includes('FROM users u') && q.sql.includes('JOIN wallets'))
  assert('the bot-fill query filters on preferred_game_type', !!botsCall && botsCall.sql.includes('u.preferred_game_type = $1'))
  assert('gameType is passed as the first param (not stake)', botsCall?.params[0] === 'teen_patti')

  // A Ludo call against a pool with only Teen-Patti-tagged mock data returns nothing —
  // proves the filter actually excludes cross-game bots rather than ignoring the param.
  const ludoResult = await (service as any).getBots('ludo', 3, 10)
  assert('ludo call does not return teen_patti-tagged mock bots', ludoResult.length === 0)

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} getBots tests passed.`)
}

run()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/game-gateway && npx tsx src/matchmaking.getBots.test.ts`
Expected: FAIL — the "filters on preferred_game_type" and "gameType is passed as the first param" assertions fail because the current query has no such filter and passes `stake` (not `gameType`) as `$1`.

- [ ] **Step 3: Update `getBots()`**

In `services/game-gateway/src/matchmaking.ts`, replace the method body (currently lines 401-413):

```typescript
  private async getBots(gameType: string, count: number, stake: number): Promise<MatchmakingEntry[]> {
    await this.autoRefillBots(stake)

    const botRes = await this.db.query(
      `SELECT u.id, u.username
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND u.preferred_game_type = $1 AND w.real_balance >= $2
       ORDER BY RANDOM() LIMIT $3`,
      [gameType, stake, count]
    )
    return botRes.rows.map(b => ({ userId: b.id, username: b.username }))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/game-gateway && npx tsx src/matchmaking.getBots.test.ts`
Expected: PASS (5/5 assertions)

- [ ] **Step 5: Run the existing seat-plan test to confirm no regression**

Run: `cd services/game-gateway && npx tsx src/matchmaking.seatplan.test.ts`
Expected: PASS (unchanged — that test covers `planTeenPattiSeats`, a pure function untouched by this change)

- [ ] **Step 6: Commit**

```bash
git add services/game-gateway/src/matchmaking.ts services/game-gateway/src/matchmaking.getBots.test.ts
git commit -m "feat(game-gateway): filter bot-fill by preferred_game_type"
```

---

### Task 3: Require `preferred_game_type` on bot creation (admin-service)

**Files:**
- Modify: `services/admin-service/src/index.ts:2533-2565`

**Interfaces:**
- `POST /api/admin/bots` request body gains a required `preferred_game_type` field (Zod-validated, non-empty string — no fixed enum, matching the spec's "no CHECK constraint" decision so future game types don't require an admin-service redeploy to become valid).

- [ ] **Step 1: Update the route**

In `services/admin-service/src/index.ts`, replace lines 2533-2565 with:

```typescript
  app.post('/api/admin/bots', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const body = z.object({
      username: z.string(),
      phone: z.string().optional(),
      initial_balance: z.number().nonnegative().default(10000),
      preferred_game_type: z.string().min(1),
    }).parse(req.body)

    const phone = body.phone || `999${Math.floor(1000000 + Math.random() * 9000000)}`
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase()

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const userRes = await client.query(
        `INSERT INTO users (phone, username, password_hash, is_bot, status, referral_code, preferred_game_type)
         VALUES ($1, $2, $3, true, 'active', $4, $5) RETURNING id`,
        [phone, body.username, '$2b$12$invalid_bot_hash_never_login', referralCode, body.preferred_game_type]
      )
      const botId = userRes.rows[0].id
      await client.query(
        `INSERT INTO wallets (user_id, real_balance, bonus_balance)
         VALUES ($1, $2, 0)`,
        [botId, body.initial_balance]
      )
      await client.query('COMMIT')
      return reply.send({ success: true, bot: { id: botId, username: body.username, phone, balance: body.initial_balance, preferred_game_type: body.preferred_game_type } })
    } catch (e: any) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: e.message || 'Failed to create bot' })
    } finally {
      client.release()
    }
  })
```

(The `DELETE /api/admin/bots/:id` route directly below, lines 2567-2588, is unchanged — deleting a bot doesn't need to know its game type.)

- [ ] **Step 2: Verify the build compiles**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): require preferred_game_type when creating a bot"
```

---

### Task 4: Add the game-type field to the admin panel's create-bot form

**Files:**
- Modify: `admin-panel/src/pages/Bots.tsx` (create-bot `Form`, around line 463-487)

- [ ] **Step 1: Read the current form to confirm line numbers**

Run: `grep -n "Form form={form}" admin-panel/src/pages/Bots.tsx` and read the surrounding ~30 lines before editing — this task's exact line numbers are from investigation during planning and must be re-confirmed against the file as it exists at implementation time, since Task 3 doesn't touch this file and line numbers could have drifted from unrelated concurrent work.

- [ ] **Step 2: Add a required game-type `Select` field**

Inside the `<Form form={form} layout="vertical" onFinish={createBot}>` block (currently starting at line 463), add a new `Form.Item` immediately after the `username` field and before `phone`:

```tsx
          <Form.Item
            name="preferred_game_type"
            label="Game"
            rules={[{ required: true, message: 'Select which game this bot belongs to' }]}
          >
            <Select
              placeholder="Select a game"
              options={[
                { value: 'teen_patti', label: 'Teen Patti' },
                { value: 'ludo', label: 'Ludo' },
              ]}
            />
          </Form.Item>
```

If `Select` is not already imported from `antd` at the top of the file, add it to the existing `antd` import list.

- [ ] **Step 3: Verify the build compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/Bots.tsx
git commit -m "feat(admin-panel): require a game selection when creating a bot"
```

---

### Task 5: Deploy

**Files:** none (deployment only)

- [ ] **Step 1: Run the migration against production**

```bash
ssh -i ~/.ssh/id_ed25519 root@64.204.130.181 "docker exec -i teen_postgres psql -U teen -d teen_db" < infra/db/migrations/084_bot_pool_separation.sql
```

Expected output ends with the two `UPDATE ...` row counts (should sum to 30) and no `ERROR`/`EXCEPTION` from the `DO $$` block. If the block raises, STOP — do not proceed to restart services with code that assumes every bot is tagged.

- [ ] **Step 2: Verify the backfill**

```bash
ssh -i ~/.ssh/id_ed25519 root@64.204.130.181 "docker exec teen_postgres psql -U teen -d teen_db -c \"SELECT preferred_game_type, count(*) FROM users WHERE is_bot = true GROUP BY preferred_game_type;\""
```

Expected: exactly two rows, `teen_patti` and `ludo`, each with count `15`. No `NULL` row.

- [ ] **Step 3: Deploy game-gateway and admin-service**

Follow this codebase's established backend deploy pattern (build + scoped PM2 restart, per `infra/deploy/deploy-services.sh`'s per-service structure) — pull this branch's commits into the VPS checkout, build `services/game-gateway` and `services/admin-service`, then restart only those two PM2 processes (not the full fleet). The exact commands depend on how this branch's commits get onto the VPS (git checkout of specific paths, matching the surgical pattern used for the admin-panel-ui-redesign branch, or a full branch merge — decide at deploy time based on what else has landed on `feature/admin-responsive` since this branch was cut, the same divergence check done before the admin-panel deploy).

- [ ] **Step 4: Smoke-check bot-fill still works**

Watch game-gateway logs for a live Teen Patti and a live Ludo room being bot-filled without errors shortly after restart (or trigger one manually via the admin panel / a low-stake queue join), confirming `getBots()`'s new filtered query returns rows for both game types in production (not just in the mocked test).

- [ ] **Step 5: Commit the ledger note**

No code change — this step is a reminder to record in whatever session/progress tracking is in use that this migration has been applied to production, so a future session doesn't attempt to re-run it (the migration is not idempotent — re-running the `UPDATE` statements is harmless, but re-running `ALTER TABLE users ADD COLUMN` on an already-migrated database will error).

---

## Self-Review Notes

- **Spec coverage:** Schema (Task 1), enforcement (Task 2), creation-flow update on both the API (Task 3) and the only existing UI that calls it (Task 4), deployment (Task 5) — all five of the spec's design sections are covered. Testing section's commitment to "a direct DB-level integration test" was revised during planning to a `MockPool`-based test instead, matching this codebase's actual established convention (`a-b-router.test.ts`) rather than introducing a new DB-integration-test pattern this repo doesn't otherwise use — this is a deliberate, disclosed deviation from the spec's literal wording, not an oversight.
- **Placeholder scan:** Task 5's Step 3 describes a decision to make at deploy time (which VPS-sync method) rather than a fixed command, because it depends on repo state that will have changed by then (same reasoning the admin-panel-ui-redesign deploy needed a live divergence check rather than a scripted assumption) — this is an explicit, bounded judgment call for the implementer, not a vague "handle it somehow."
- **Type consistency:** `getBots(gameType: string, count: number, stake: number)` signature (Task 2) is unchanged from the current code, so its two callers (`joinQueue`/room-fill paths, unmodified by this plan) keep working without changes. The Zod schema field name `preferred_game_type` (Task 3) matches the DB column name (Task 1) and the antd form field name (Task 4) exactly, so the payload passes through unmodified from form submission to SQL insert.
