# Lottery Bot Ticket-Fill & Throttle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot accounts auto-buy Daily/Weekly/Monthly lottery tickets toward 60% of an admin-configurable pool, and release 1% of bot tickets (with a real wallet refund) whenever sold tickets reach 99%, continuously, for as long as a draw stays open — leaving room for real buyers while creating urgency.

**Architecture:** A single-row `lottery_bot_config` table holds admin-tunable thresholds. A shared helper module (`lottery-bot-fill.ts`) provides bot-selection and ticket-number primitives; two thin per-mechanic rebalance functions (Weekly/Monthly in `helpers/lottery-bot-fill.ts`, Daily in `modules/lottery/daily/bot-fill.ts`) run synchronously after every ticket purchase and after every draw creation. Bot tickets are ordinary rows bought via the existing `debitStake`/`creditPrize` wallet flow using dedicated `preferred_game_type = 'lottery'` bot accounts — no special-casing at settlement.

**Tech Stack:** Fastify + TypeScript (core-api-service, admin-service), PostgreSQL (raw SQL via `pg` Pool, no ORM), Vitest for tests, React + Ant Design (admin-panel).

## Global Constraints

- Bot fill applies ONLY to Daily, Weekly, and Monthly lottery draws — Instant (scratch card) lottery is untouched.
- Bot ticket purchases are real wallet transactions (real `debitStake`/`creditPrize`), not cosmetic.
- Thresholds (`fill_pct`=60, `trigger_pct`=99, `release_pct`=1) and `default_max_tickets` are admin-configurable via `lottery_bot_config`, not hardcoded.
- After a release, bots continuously refill toward `fill_pct` again — this is an ongoing throttle for the draw's whole `open` lifetime, not a one-time event.
- Bot tickets are fully eligible to win at settlement, identical to real tickets — no exclusion logic anywhere.
- Bot wallets are funded via manual admin top-up (the existing `/users/:id/credit` flow) — no auto-top-up.
- Percentages are computed against ticket **count**, not ticket value.
- Follow the existing repo pattern: raw SQL via `pool.query`, Zod for request validation, `x-internal-key` for internal endpoints, `requireRole('finance')` for admin write endpoints.

---

### Task 1: Database migration — bot config, pool size, bot tagging, seed lottery bots

**Files:**
- Create: `infra/db/migrations/084_lottery_bot_fill.sql`

**Interfaces:**
- Produces: table `lottery_bot_config` (columns: `id`, `enabled`, `default_max_tickets`, `fill_pct`, `trigger_pct`, `release_pct`, `updated_at`); `lottery_draws.max_tickets` and `lottery_daily_draws.max_tickets` (INT); `users.preferred_game_type` (VARCHAR(30)); 3 seeded bot users (`LotteryBot_A/B/C`) tagged `preferred_game_type = 'lottery'` with wallets funded at ₹5000.

- [ ] **Step 1: Write the migration file**

```sql
-- infra/db/migrations/084_lottery_bot_fill.sql
-- Bot ticket-fill/throttle for Daily/Weekly/Monthly lottery draws.
-- See docs/superpowers/specs/2026-07-22-lottery-bot-fill-design.md

CREATE TABLE IF NOT EXISTS lottery_bot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_max_tickets INT NOT NULL DEFAULT 200,
  fill_pct NUMERIC(5,2) NOT NULL DEFAULT 60,
  trigger_pct NUMERIC(5,2) NOT NULL DEFAULT 99,
  release_pct NUMERIC(5,2) NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lottery_bot_config (enabled, default_max_tickets, fill_pct, trigger_pct, release_pct)
SELECT FALSE, 200, 60, 99, 1
WHERE NOT EXISTS (SELECT 1 FROM lottery_bot_config);

ALTER TABLE lottery_draws ADD COLUMN IF NOT EXISTS max_tickets INT NOT NULL DEFAULT 200;
ALTER TABLE lottery_daily_draws ADD COLUMN IF NOT EXISTS max_tickets INT NOT NULL DEFAULT 200;

-- May already exist from the in-flight bot-pool-separation work on another
-- branch; IF NOT EXISTS makes this migration safe to apply either order.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_game_type VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_users_bot_game_type ON users(is_bot, preferred_game_type) WHERE is_bot = true;

-- Seed a small dedicated lottery bot pool, separate from Teen Patti/Ludo bots.
DO $$
DECLARE
  bot_id UUID;
  bot_names TEXT[] := ARRAY['LotteryBot_A', 'LotteryBot_B', 'LotteryBot_C'];
  bot_name TEXT;
BEGIN
  FOREACH bot_name IN ARRAY bot_names LOOP
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = bot_name) THEN
      INSERT INTO users (phone, username, password_hash, is_bot, status, referral_code, preferred_game_type)
      VALUES (
        '999' || floor(random() * 9000000 + 1000000)::text,
        bot_name,
        '$2b$12$invalid_bot_hash_never_login',
        true,
        'active',
        upper(substring(md5(random()::text || bot_name), 1, 8)),
        'lottery'
      )
      RETURNING id INTO bot_id;

      INSERT INTO wallets (user_id, real_balance, bonus_balance) VALUES (bot_id, 5000, 0);
    END IF;
  END LOOP;
END $$;

-- Fail loudly if any lottery bot ended up without a wallet (would silently
-- never be able to buy a ticket, same failure mode as the bot-pool-separation
-- migration's untagged-bot guard).
DO $$
DECLARE
  missing_wallets INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_wallets
  FROM users u LEFT JOIN wallets w ON w.user_id = u.id
  WHERE u.preferred_game_type = 'lottery' AND w.user_id IS NULL;
  IF missing_wallets > 0 THEN
    RAISE EXCEPTION 'lottery bot fill migration incomplete: % lottery bot(s) missing a wallet', missing_wallets;
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration locally and verify**

Run: `psql "$DATABASE_URL" -f infra/db/migrations/084_lottery_bot_fill.sql`

Then verify:
```bash
psql "$DATABASE_URL" -c "SELECT enabled, default_max_tickets, fill_pct, trigger_pct, release_pct FROM lottery_bot_config;"
psql "$DATABASE_URL" -c "SELECT username, preferred_game_type FROM users WHERE preferred_game_type = 'lottery';"
```

Expected: one config row (`enabled=false, default_max_tickets=200, fill_pct=60, trigger_pct=99, release_pct=1`); three users `LotteryBot_A/B/C` each with `preferred_game_type=lottery`.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/084_lottery_bot_fill.sql
git commit -m "feat(db): add lottery bot-fill config, pool size, and seed lottery bot pool"
```

---

### Task 2: Shared bot-fill primitives (`getBotConfig`, bot picker, ticket-number generator)

**Files:**
- Create: `services/core-api-service/src/helpers/lottery-bot-fill.ts`
- Test: `services/core-api-service/src/helpers/lottery-bot-fill.test.ts`

**Interfaces:**
- Consumes: `pool` from `../db/pool` (already initialized by `bettingPlugin` before any route runs — see `services/core-api-service/src/plugins/betting.ts:16-19`).
- Produces: `type BotConfig = { enabled: boolean; default_max_tickets: number; fill_pct: number; trigger_pct: number; release_pct: number }`, `getBotConfig(): Promise<BotConfig | null>` (null when disabled or missing), `pickLotteryBotWithBalance(minAmount: number): Promise<{ id: string } | null>`, `randomUnusedTicketNumber(existingNumbers: Set<string>, digits?: number): string | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// services/core-api-service/src/helpers/lottery-bot-fill.test.ts
import { pool } from '../db/pool'
import { getBotConfig, pickLotteryBotWithBalance, randomUnusedTicketNumber } from './lottery-bot-fill'

describe('lottery-bot-fill helpers', () => {
  describe('getBotConfig', () => {
    it('returns null when bot fill is disabled', async () => {
      await pool.query('UPDATE lottery_bot_config SET enabled = false')
      const config = await getBotConfig()
      expect(config).toBeNull()
    })

    it('returns the config row when enabled', async () => {
      await pool.query(
        `UPDATE lottery_bot_config SET enabled = true, default_max_tickets = 300, fill_pct = 60, trigger_pct = 99, release_pct = 1`
      )
      const config = await getBotConfig()
      expect(config).toEqual({
        enabled: true,
        default_max_tickets: 300,
        fill_pct: 60,
        trigger_pct: 99,
        release_pct: 1,
      })
      await pool.query('UPDATE lottery_bot_config SET enabled = false, default_max_tickets = 200')
    })
  })

  describe('pickLotteryBotWithBalance', () => {
    it('returns a lottery-tagged bot with sufficient balance', async () => {
      const bot = await pickLotteryBotWithBalance(50)
      expect(bot).not.toBeNull()
      const check = await pool.query(
        `SELECT is_bot, preferred_game_type FROM users WHERE id = $1`,
        [bot!.id]
      )
      expect(check.rows[0].is_bot).toBe(true)
      expect(check.rows[0].preferred_game_type).toBe('lottery')
    })

    it('returns null when no lottery bot has enough balance', async () => {
      const bot = await pickLotteryBotWithBalance(999999999)
      expect(bot).toBeNull()
    })
  })

  describe('randomUnusedTicketNumber', () => {
    it('never returns a number already in the existing set', () => {
      const existing = new Set(['0000', '0001', '0002'])
      const result = randomUnusedTicketNumber(existing, 4)
      expect(result).not.toBeNull()
      expect(existing.has(result!)).toBe(false)
      expect(result).toMatch(/^\d{4}$/)
    })

    it('returns null when the entire number space is exhausted', () => {
      const existing = new Set(['0', '1'])
      const result = randomUnusedTicketNumber(existing, 1)
      expect(result).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/core-api-service && npx vitest run src/helpers/lottery-bot-fill.test.ts`
Expected: FAIL — `Cannot find module './lottery-bot-fill'`

- [ ] **Step 3: Write the implementation**

```typescript
// services/core-api-service/src/helpers/lottery-bot-fill.ts
import { pool } from '../db/pool'

export type BotConfig = {
  enabled: boolean
  default_max_tickets: number
  fill_pct: number
  trigger_pct: number
  release_pct: number
}

export async function getBotConfig(): Promise<BotConfig | null> {
  const result = await pool.query('SELECT * FROM lottery_bot_config LIMIT 1')
  if (!result.rows.length || !result.rows[0].enabled) return null
  const row = result.rows[0]
  return {
    enabled: row.enabled,
    default_max_tickets: row.default_max_tickets,
    fill_pct: Number(row.fill_pct),
    trigger_pct: Number(row.trigger_pct),
    release_pct: Number(row.release_pct),
  }
}

export async function pickLotteryBotWithBalance(minAmount: number): Promise<{ id: string } | null> {
  const result = await pool.query(
    `SELECT u.id FROM users u
     JOIN wallets w ON w.user_id = u.id
     WHERE u.is_bot = true AND u.preferred_game_type = 'lottery' AND w.real_balance >= $1
     ORDER BY random() LIMIT 1`,
    [minAmount]
  )
  return result.rows[0] ? { id: result.rows[0].id } : null
}

export function randomUnusedTicketNumber(existingNumbers: Set<string>, digits: number = 4): string | null {
  const max = 10 ** digits
  if (existingNumbers.size >= max) return null
  let candidate: string
  do {
    candidate = Math.floor(Math.random() * max).toString().padStart(digits, '0')
  } while (existingNumbers.has(candidate))
  return candidate
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/core-api-service && npx vitest run src/helpers/lottery-bot-fill.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/helpers/lottery-bot-fill.ts services/core-api-service/src/helpers/lottery-bot-fill.test.ts
git commit -m "feat(lottery): add shared bot-fill config/bot-picker/ticket-number helpers"
```

---

### Task 3: Weekly/Monthly rebalance logic + wire into buy/create

**Files:**
- Modify: `services/core-api-service/src/helpers/lottery-bot-fill.ts` (add `rebalanceWeeklyMonthlyBotTickets`)
- Modify: `services/core-api-service/src/plugins/betting.ts:143-168` (`/lottery/buy`), `services/core-api-service/src/plugins/betting.ts:461-478` (`/internal/lottery/create`)
- Test: `services/core-api-service/src/helpers/lottery-bot-fill.test.ts` (append)

**Interfaces:**
- Consumes: `getBotConfig`, `pickLotteryBotWithBalance`, `randomUnusedTicketNumber` (Task 2); `debitStake`, `creditPrize` from `./wallet-client`.
- Produces: `rebalanceWeeklyMonthlyBotTickets(drawId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `services/core-api-service/src/helpers/lottery-bot-fill.test.ts`:

```typescript
import { rebalanceWeeklyMonthlyBotTickets } from './lottery-bot-fill'
import crypto from 'crypto'

describe('rebalanceWeeklyMonthlyBotTickets', () => {
  async function createTestDraw(maxTickets: number) {
    const id = crypto.randomUUID()
    await pool.query(
      `INSERT INTO lottery_draws (id, name, ticket_price, draw_time, prize_tiers, category, status, max_tickets)
       VALUES ($1, 'Test Weekly Draw', 10, NOW() + INTERVAL '1 day', '[{"match_type":"exact","multiplier":1000}]', 'weekly', 'open', $2)`,
      [id, maxTickets]
    )
    return id
  }

  it('does nothing when bot fill is disabled', async () => {
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
    const drawId = await createTestDraw(10)
    await rebalanceWeeklyMonthlyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(0)
  })

  it('bots buy up toward fill_pct of the pool when enabled', async () => {
    await pool.query(
      `UPDATE lottery_bot_config SET enabled = true, fill_pct = 60, trigger_pct = 99, release_pct = 1`
    )
    const drawId = await createTestDraw(10) // 60% of 10 = 6 tickets
    await rebalanceWeeklyMonthlyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(6)
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
  })

  it('releases 1% of bot tickets and refunds them once sold reaches trigger_pct', async () => {
    await pool.query(
      `UPDATE lottery_bot_config SET enabled = true, fill_pct = 60, trigger_pct = 90, release_pct = 20`
    )
    const drawId = await createTestDraw(10)
    await rebalanceWeeklyMonthlyBotTickets(drawId) // bots fill to 6/10 (60%)

    // Simulate 3 real purchases to push sold to 9/10 (90%, hits trigger)
    for (let i = 0; i < 3; i++) {
      const ticketId = crypto.randomUUID()
      await pool.query(
        `INSERT INTO lottery_tickets (id, draw_id, user_id, ticket_number, amount)
         VALUES ($1, $2, (SELECT id FROM users WHERE is_bot = false LIMIT 1), $3, 10)`,
        [ticketId, drawId, `100${i}`]
      )
    }
    await rebalanceWeeklyMonthlyBotTickets(drawId)

    const botCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lottery_tickets t JOIN users u ON u.id = t.user_id WHERE t.draw_id = $1 AND u.is_bot = true`,
      [drawId]
    )
    // Started with 6 bot tickets, release_pct=20% of 10 = 2 released -> 4 remain
    expect(botCount.rows[0].c).toBe(4)
    await pool.query('UPDATE lottery_bot_config SET enabled = false, fill_pct = 60, trigger_pct = 99, release_pct = 1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/core-api-service && npx vitest run src/helpers/lottery-bot-fill.test.ts`
Expected: FAIL — `rebalanceWeeklyMonthlyBotTickets is not a function` (and the first two tests above also fail until real users exist — ensure your local/test DB has at least one `is_bot = false` user, matching the fixture assumption already relied on by `routes.test.ts` in this repo)

- [ ] **Step 3: Implement `rebalanceWeeklyMonthlyBotTickets`**

Append to `services/core-api-service/src/helpers/lottery-bot-fill.ts`:

```typescript
import { debitStake, creditPrize } from './wallet-client'
import crypto from 'crypto'

export async function rebalanceWeeklyMonthlyBotTickets(drawId: string): Promise<void> {
  const config = await getBotConfig()
  if (!config) return

  const drawRes = await pool.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [drawId])
  if (!drawRes.rows.length) return
  const draw = drawRes.rows[0]
  const maxTickets = draw.max_tickets
  const ticketPrice = Number(draw.ticket_price)

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE u.is_bot = true)::int AS bot_count
     FROM lottery_tickets t JOIN users u ON u.id = t.user_id
     WHERE t.draw_id = $1`,
    [drawId]
  )
  const { total, bot_count } = countRes.rows[0]
  const soldPct = (total / maxTickets) * 100
  const botPct = (bot_count / maxTickets) * 100

  if (soldPct >= config.trigger_pct) {
    const releaseCount = Math.max(1, Math.round((config.release_pct / 100) * maxTickets))
    const toRelease = await pool.query(
      `SELECT t.id, t.user_id, t.amount FROM lottery_tickets t
       JOIN users u ON u.id = t.user_id
       WHERE t.draw_id = $1 AND u.is_bot = true
       ORDER BY random() LIMIT $2`,
      [drawId, releaseCount]
    )
    for (const ticket of toRelease.rows) {
      await pool.query('DELETE FROM lottery_tickets WHERE id = $1', [ticket.id])
      await creditPrize({
        userId: ticket.user_id,
        amount: Number(ticket.amount),
        referenceId: ticket.id,
        idempotencyKey: `lottery_bot_release_${ticket.id}`,
      })
    }
    return
  }

  if (soldPct < config.fill_pct && botPct < config.fill_pct) {
    const ceilingCount = Math.floor((config.fill_pct / 100) * maxTickets)
    const triggerCount = Math.floor((config.trigger_pct / 100) * maxTickets)
    let currentTotal = total
    let currentBot = bot_count
    const existingRes = await pool.query('SELECT ticket_number FROM lottery_tickets WHERE draw_id = $1', [drawId])
    const existingNumbers = new Set<string>(existingRes.rows.map((r: any) => r.ticket_number))

    while (currentBot < ceilingCount && currentTotal < triggerCount) {
      const bot = await pickLotteryBotWithBalance(ticketPrice)
      if (!bot) break
      const ticketNumber = randomUnusedTicketNumber(existingNumbers, 4)
      if (!ticketNumber) break
      const ticketId = crypto.randomUUID()
      const debit = await debitStake({
        userId: bot.id,
        amount: ticketPrice,
        referenceId: ticketId,
        idempotencyKey: `lottery_bot_buy_${ticketId}`,
        description: `Bot fill: ${draw.name}`,
      })
      if (!debit.ok) break
      await pool.query(
        `INSERT INTO lottery_tickets (id, draw_id, user_id, ticket_number, amount) VALUES ($1,$2,$3,$4,$5)`,
        [ticketId, drawId, bot.id, ticketNumber, ticketPrice]
      )
      existingNumbers.add(ticketNumber)
      currentTotal++
      currentBot++
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/core-api-service && npx vitest run src/helpers/lottery-bot-fill.test.ts`
Expected: PASS (8 tests total)

- [ ] **Step 5: Wire into `/lottery/buy` and `/internal/lottery/create`**

In `services/core-api-service/src/plugins/betting.ts`, add the import near the other helper imports (line 5):

```typescript
import { debitStake, creditPrize } from '../helpers/wallet-client'
import { rebalanceWeeklyMonthlyBotTickets } from '../helpers/lottery-bot-fill'
```

Modify `/lottery/buy` (around line 158-160) so the try block calls rebalance after a successful insert:

```typescript
      try {
        await db.query(`INSERT INTO lottery_tickets (id, draw_id, user_id, ticket_number, amount) VALUES ($1,$2,$3,$4,$5)`, [ticketId, body.draw_id, uid(req), ticketNumClean, draw.ticket_price])
        await rebalanceWeeklyMonthlyBotTickets(body.draw_id)
        return { success: true, ticket_id: ticketId }
      } catch (err: any) {
```

Modify `/internal/lottery/create` (around line 476-478) to trigger the initial bot fill immediately on draw creation:

```typescript
      const r = await db.query(`INSERT INTO lottery_draws (name, ticket_price, draw_time, prize_tiers, category) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [body.name, body.ticket_price, body.draw_time, JSON.stringify(body.prize_tiers), body.category])
      await rebalanceWeeklyMonthlyBotTickets(r.rows[0].id)
      return { success: true, draw: r.rows[0] }
```

- [ ] **Step 6: Run the full daily lottery + helper test suite to check nothing else broke**

Run: `cd services/core-api-service && npx vitest run src/helpers/lottery-bot-fill.test.ts src/modules/lottery/daily/routes.test.ts`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add services/core-api-service/src/helpers/lottery-bot-fill.ts services/core-api-service/src/helpers/lottery-bot-fill.test.ts services/core-api-service/src/plugins/betting.ts
git commit -m "feat(lottery): bot fill/throttle for Weekly and Monthly draws"
```

---

### Task 4: Daily rebalance logic + wire into buy/create

**Files:**
- Create: `services/core-api-service/src/modules/lottery/daily/bot-fill.ts`
- Test: `services/core-api-service/src/modules/lottery/daily/bot-fill.test.ts`
- Modify: `services/core-api-service/src/modules/lottery/daily/routes.ts` (buy route ~line 148-163, create-draw route ~line 375-380)

**Interfaces:**
- Consumes: `getBotConfig`, `pickLotteryBotWithBalance`, `randomUnusedTicketNumber` from `../../../helpers/lottery-bot-fill` (Task 2); `debitStake`, `creditPrize` from `../../../helpers/wallet-client`; `tiersService.getTier` from `./tiers`.
- Produces: `rebalanceDailyBotTickets(drawId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```typescript
// services/core-api-service/src/modules/lottery/daily/bot-fill.test.ts
import { pool } from '../../../db/pool'
import * as tiersService from './tiers'
import * as drawsService from './draws'
import { rebalanceDailyBotTickets } from './bot-fill'

describe('rebalanceDailyBotTickets', () => {
  async function createTestDrawWithTier(maxTickets: number, amount = 20) {
    const tier = await tiersService.createTier({
      amount,
      draw_time: '23:59:00',
      default_prize_tiers: [{ match_type: 'exact', outcome_type: 'cash', multiplier: 100 }],
      status: 'active',
    })
    const draw = await drawsService.createDraw({ tier_id: tier.id, draw_date: new Date(Date.now() + 86400000) })
    await pool.query('UPDATE lottery_daily_draws SET max_tickets = $1 WHERE id = $2', [maxTickets, draw.id])
    return draw.id
  }

  it('does nothing when bot fill is disabled', async () => {
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
    const drawId = await createTestDrawWithTier(10)
    await rebalanceDailyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_daily_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(0)
  })

  it('bots buy up toward fill_pct of the pool when enabled', async () => {
    await pool.query('UPDATE lottery_bot_config SET enabled = true, fill_pct = 60, trigger_pct = 99, release_pct = 1')
    const drawId = await createTestDrawWithTier(10) // 60% of 10 = 6 tickets
    await rebalanceDailyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_daily_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(6)
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/core-api-service && npx vitest run src/modules/lottery/daily/bot-fill.test.ts`
Expected: FAIL — `Cannot find module './bot-fill'`

- [ ] **Step 3: Implement `rebalanceDailyBotTickets`**

```typescript
// services/core-api-service/src/modules/lottery/daily/bot-fill.ts
import { pool } from '../../../db/pool'
import { debitStake, creditPrize } from '../../../helpers/wallet-client'
import { getBotConfig, pickLotteryBotWithBalance, randomUnusedTicketNumber } from '../../../helpers/lottery-bot-fill'
import * as tiersService from './tiers'
import crypto from 'crypto'

export async function rebalanceDailyBotTickets(drawId: string): Promise<void> {
  const config = await getBotConfig()
  if (!config) return

  const drawRes = await pool.query(`SELECT * FROM lottery_daily_draws WHERE id = $1 AND status = 'open'`, [drawId])
  if (!drawRes.rows.length) return
  const draw = drawRes.rows[0]
  const maxTickets = draw.max_tickets
  const tier = await tiersService.getTier(draw.tier_id)
  const ticketPrice = Number(tier.amount)

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE u.is_bot = true)::int AS bot_count
     FROM lottery_daily_tickets t JOIN users u ON u.id = t.user_id
     WHERE t.draw_id = $1`,
    [drawId]
  )
  const { total, bot_count } = countRes.rows[0]
  const soldPct = (total / maxTickets) * 100
  const botPct = (bot_count / maxTickets) * 100

  if (soldPct >= config.trigger_pct) {
    const releaseCount = Math.max(1, Math.round((config.release_pct / 100) * maxTickets))
    const toRelease = await pool.query(
      `SELECT t.id, t.user_id FROM lottery_daily_tickets t
       JOIN users u ON u.id = t.user_id
       WHERE t.draw_id = $1 AND u.is_bot = true
       ORDER BY random() LIMIT $2`,
      [drawId, releaseCount]
    )
    for (const ticket of toRelease.rows) {
      await pool.query('DELETE FROM lottery_daily_tickets WHERE id = $1', [ticket.id])
      await creditPrize({
        userId: ticket.user_id,
        amount: ticketPrice,
        referenceId: ticket.id,
        idempotencyKey: `lottery_daily_bot_release_${ticket.id}`,
      })
    }
    return
  }

  if (soldPct < config.fill_pct && botPct < config.fill_pct) {
    const ceilingCount = Math.floor((config.fill_pct / 100) * maxTickets)
    const triggerCount = Math.floor((config.trigger_pct / 100) * maxTickets)
    let currentTotal = total
    let currentBot = bot_count
    const existingRes = await pool.query('SELECT ticket_number FROM lottery_daily_tickets WHERE draw_id = $1', [drawId])
    const existingNumbers = new Set<string>(existingRes.rows.map((r: any) => r.ticket_number))

    while (currentBot < ceilingCount && currentTotal < triggerCount) {
      const bot = await pickLotteryBotWithBalance(ticketPrice)
      if (!bot) break
      const ticketNumber = randomUnusedTicketNumber(existingNumbers, 4)
      if (!ticketNumber) break
      const ticketId = crypto.randomUUID()
      const debit = await debitStake({
        userId: bot.id,
        amount: ticketPrice,
        referenceId: ticketId,
        idempotencyKey: `lottery_daily_bot_buy_${ticketId}`,
        description: 'Bot fill: Daily Lottery',
      })
      if (!debit.ok) break
      await pool.query(
        `INSERT INTO lottery_daily_tickets (id, draw_id, user_id, ticket_number, outcome_type) VALUES ($1,$2,$3,$4,'none')`,
        [ticketId, drawId, bot.id, ticketNumber]
      )
      existingNumbers.add(ticketNumber)
      currentTotal++
      currentBot++
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/core-api-service && npx vitest run src/modules/lottery/daily/bot-fill.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire into daily buy and create-draw routes**

In `services/core-api-service/src/modules/lottery/daily/routes.ts`, add the import near the top (after line 9):

```typescript
import type { PrizeTier } from './tiers'
import { rebalanceDailyBotTickets } from './bot-fill'
```

In the `/lottery/daily/buy` handler, after the ticket insert (around line 148-154):

```typescript
        // Step 2: Create ticket record
        const ticketId = crypto.randomUUID()
        await pool.query(
          `INSERT INTO lottery_daily_tickets (id, draw_id, user_id, ticket_number, outcome_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [ticketId, body.draw_id, user_id, body.ticket_number, 'none']
        )
        await rebalanceDailyBotTickets(body.draw_id)
```

In the `/lottery/daily/admin/draws` POST handler, after `createDraw` (around line 375-380):

```typescript
        const draw = await drawsService.createDraw({
          tier_id: body.tier_id,
          draw_date: drawDate,
          prize_tiers: body.prize_tiers as PrizeTier[] | undefined,
        })
        await rebalanceDailyBotTickets(draw.id)
```

- [ ] **Step 6: Run full test file to confirm the wiring didn't break existing daily lottery tests**

Run: `cd services/core-api-service && npx vitest run src/modules/lottery/daily/`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add services/core-api-service/src/modules/lottery/daily/bot-fill.ts services/core-api-service/src/modules/lottery/daily/bot-fill.test.ts services/core-api-service/src/modules/lottery/daily/routes.ts
git commit -m "feat(lottery): bot fill/throttle for Daily lottery draws"
```

---

### Task 5: Admin bot-config CRUD endpoints (internal + admin-service proxy)

**Files:**
- Modify: `services/core-api-service/src/plugins/betting.ts` (add `/internal/lottery/bot-config` GET/POST, near the other `/internal/lottery/*` routes at line ~461)
- Modify: `services/admin-service/src/index.ts` (add `/api/admin/betting/lottery/bot-config` GET/POST proxy, near line ~1940)

**Interfaces:**
- Produces: `GET /internal/lottery/bot-config` → `BotConfig` row (raw, including `enabled` regardless of value — unlike `getBotConfig()` which returns null when disabled); `POST /internal/lottery/bot-config` → updates and returns the row.

- [ ] **Step 1: Add internal endpoints to `betting.ts`**

Insert after the `/internal/lottery/cancel` handler (after line 502, before `/internal/lottery/scratch/create`):

```typescript
    app.get('/internal/lottery/bot-config', { onRequest: [internal] }, async (_req, reply) => {
      const result = await db.query('SELECT * FROM lottery_bot_config LIMIT 1')
      return reply.send(result.rows[0] || null)
    })

    app.post('/internal/lottery/bot-config', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        enabled: z.boolean(),
        default_max_tickets: z.number().int().positive(),
        fill_pct: z.number().min(0).max(100),
        trigger_pct: z.number().min(0).max(100),
        release_pct: z.number().min(0).max(100),
      }).parse(req.body)
      const result = await db.query(
        `UPDATE lottery_bot_config
         SET enabled = $1, default_max_tickets = $2, fill_pct = $3, trigger_pct = $4, release_pct = $5, updated_at = NOW()
         RETURNING *`,
        [body.enabled, body.default_max_tickets, body.fill_pct, body.trigger_pct, body.release_pct]
      )
      return reply.send(result.rows[0])
    })
```

- [ ] **Step 2: Add admin-service proxy endpoints**

In `services/admin-service/src/index.ts`, insert after the `/api/admin/betting/lottery/draw` handler (after line 1945, before the `-- Lottery: Instant` comment):

```typescript
  app.get('/api/admin/betting/lottery/bot-config', { onRequest: [authenticate] }, async (_req, reply) => {
    const r = await callBetting('/internal/lottery/bot-config', undefined, 'GET')
    return reply.code(r.status).send(r.data)
  })

  app.post('/api/admin/betting/lottery/bot-config', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/lottery/bot-config', req.body)
    return reply.code(r.status).send(r.data)
  })
```

- [ ] **Step 3: Manually verify with curl against a running dev stack**

Run (with core-api-service and admin-service running locally, `INTERNAL_SERVICE_KEY` set in both envs):
```bash
curl -s -X GET http://127.0.0.1:3012/internal/lottery/bot-config -H "x-internal-key: $INTERNAL_SERVICE_KEY"
```
Expected: JSON with `enabled: false, default_max_tickets: 200, fill_pct: "60.00", trigger_pct: "99.00", release_pct: "1.00"`

- [ ] **Step 4: Commit**

```bash
git add services/core-api-service/src/plugins/betting.ts services/admin-service/src/index.ts
git commit -m "feat(admin): add lottery bot-config CRUD endpoints"
```

---

### Task 6: Bot/real ticket breakdown in admin draws list and stats

**Files:**
- Modify: `services/admin-service/src/index.ts` (`/api/admin/betting/lottery/draws` at line 1929, `/api/admin/betting/lottery/stats` at line 2483)
- Modify: `services/core-api-service/src/modules/lottery/daily/draws.ts` (`getDrawsForToday` and `formatDraw`)

**Interfaces:**
- Produces: `draws[].bot_ticket_count` on the Weekly/Monthly admin draws list; `overview.total_bot_tickets` on the stats endpoint; `Draw.bot_tickets_count` (optional field, same pattern as existing `tickets_count`) from `drawsService.getDrawsForToday()`.

- [ ] **Step 1: Extend the Weekly/Monthly admin draws query**

In `services/admin-service/src/index.ts`, replace the `/api/admin/betting/lottery/draws` handler (line 1929-1935):

```typescript
  app.get('/api/admin/betting/lottery/draws', { onRequest: [authenticate] }, async (_req, reply) => {
    const rows = await db.query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM lottery_tickets t WHERE t.draw_id = d.id) AS ticket_count,
              (SELECT COUNT(*) FROM lottery_tickets t JOIN users u ON u.id = t.user_id WHERE t.draw_id = d.id AND u.is_bot = true) AS bot_ticket_count
       FROM lottery_draws d ORDER BY d.draw_time DESC LIMIT 100`)
    return reply.send({ draws: rows.rows })
  })
```

- [ ] **Step 2: Extend the stats overview query**

In `services/admin-service/src/index.ts`, modify the `/api/admin/betting/lottery/stats` overview query (line 2485-2494) to add a bot-ticket total:

```typescript
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'open') AS open_draws,
          COUNT(*) FILTER (WHERE status = 'settled') AS settled_draws,
          COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_draws,
          (SELECT COUNT(*) FROM lottery_tickets) AS total_tickets,
          (SELECT COUNT(*) FROM lottery_tickets t JOIN users u ON u.id = t.user_id WHERE u.is_bot = true) AS total_bot_tickets,
          (SELECT COALESCE(SUM(amount), 0) FROM lottery_tickets) AS total_revenue,
          (SELECT COALESCE(SUM(prize), 0) FROM lottery_tickets WHERE is_winner = true) AS total_paid_out
        FROM lottery_draws
      `),
```

- [ ] **Step 3: Extend Daily's `getDrawsForToday` with a bot ticket count**

In `services/core-api-service/src/modules/lottery/daily/draws.ts`, modify `getDrawsForToday` (lines 99-113):

```typescript
export async function getDrawsForToday(): Promise<Draw[]> {
  const today = new Date().toISOString().split('T')[0]

  const result = await pool.query(
    `SELECT d.*, COUNT(t.id)::int AS tickets_count,
            COUNT(t.id) FILTER (WHERE u.is_bot = true)::int AS bot_tickets_count
     FROM lottery_daily_draws d
     LEFT JOIN lottery_daily_tickets t ON t.draw_id = d.id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE d.draw_date = $1
     GROUP BY d.id
     ORDER BY d.draw_time ASC`,
    [today]
  )

  return result.rows.map(formatDraw)
}
```

Modify the `Draw` interface (line 5-15) and `formatDraw` (line 152-164) to carry the new field:

```typescript
export interface Draw {
  id: string
  tier_id: string
  draw_date: string // YYYY-MM-DD
  draw_time: string // ISO timestamp
  status: 'open' | 'calling' | 'settled' | 'cancelled'
  winning_number: string | null
  prize_tiers: PrizeTier[]
  created_at: string
  tickets_count?: number
  bot_tickets_count?: number
}
```

```typescript
function formatDraw(row: any): Draw {
  return {
    id: row.id,
    tier_id: row.tier_id,
    draw_date: row.draw_date,
    draw_time: row.draw_time,
    status: row.status,
    winning_number: row.winning_number,
    prize_tiers: row.prize_tiers,
    created_at: row.created_at,
    ...(row.tickets_count !== undefined && { tickets_count: row.tickets_count }),
    ...(row.bot_tickets_count !== undefined && { bot_tickets_count: row.bot_tickets_count }),
  }
}
```

- [ ] **Step 4: Run the daily lottery test suite to confirm the query change didn't break `getDrawsForToday` callers**

Run: `cd services/core-api-service && npx vitest run src/modules/lottery/daily/`
Expected: PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/index.ts services/core-api-service/src/modules/lottery/daily/draws.ts
git commit -m "feat(admin): surface bot vs real ticket counts on lottery draws/stats"
```

---

### Task 7: Admin panel — Bot Fill Config card + bot/real breakdown column

**Files:**
- Modify: `admin-panel/src/pages/games/Lottery.tsx`

**Interfaces:**
- Consumes: `GET/POST /betting/lottery/bot-config` (Task 5, via `adminApi` which already prefixes `/api/admin`), `bot_ticket_count`/`max_tickets` fields now present on `/betting/lottery/draws` response (Task 6).

- [ ] **Step 1: Add bot-config state and load/save functions**

In `admin-panel/src/pages/games/Lottery.tsx`, add state near the existing config state (after line 22):

```typescript
  const [botConfig, setBotConfig] = useState<any>(null)
  const [loadingBotConfig, setLoadingBotConfig] = useState(false)
  const [savingBotConfig, setSavingBotConfig] = useState(false)
```

Add load/save functions near `loadConfig`/`saveConfig` (after line 62):

```typescript
  const loadBotConfig = () => {
    setLoadingBotConfig(true)
    adminApi.get('/betting/lottery/bot-config')
      .then(r => setBotConfig(r.data))
      .finally(() => setLoadingBotConfig(false))
  }

  const saveBotConfig = async (values: any) => {
    setSavingBotConfig(true)
    try {
      const r = await adminApi.post('/betting/lottery/bot-config', values)
      setBotConfig(r.data)
      message.success('Bot fill configuration saved!')
    } catch {
      message.error('Failed to save bot fill configuration')
    } finally {
      setSavingBotConfig(false)
    }
  }
```

Call it alongside the other loaders in the existing `useEffect` (line 134-138):

```typescript
  useEffect(() => {
    loadConfig()
    loadDraws()
    loadStats()
    loadBotConfig()
  }, [])
```

- [ ] **Step 2: Add the Bot Fill Config card**

Insert a new full-width `Row` right before the existing `<Row gutter={[24, 24]}>` that holds the Lottery Settings and Draws cards (before line 257):

```jsx
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <Card
            title={
              <Space>
                <SettingOutlined style={{ color: '#d4af37' }} />
                <span style={{ color: '#f3f4f6' }}>Bot Ticket Fill (Daily / Weekly / Monthly)</span>
              </Space>
            }
            loading={loadingBotConfig}
            style={cardStyle}
            headStyle={{ borderBottom: '1px solid #374151' }}
          >
            {botConfig && (
              <Form
                layout="vertical"
                initialValues={botConfig}
                onFinish={saveBotConfig}
                style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}
              >
                <Form.Item name="enabled" label={<span style={{ color: '#d1d5db' }}>Enabled</span>} valuePropName="checked">
                  <Switch checkedChildren="ON" unCheckedChildren="OFF" />
                </Form.Item>
                <Form.Item name="default_max_tickets" label={<span style={{ color: '#d1d5db' }}>Pool Size (new draws)</span>}>
                  <InputNumber min={1} style={{ width: 160 }} />
                </Form.Item>
                <Form.Item name="fill_pct" label={<span style={{ color: '#d1d5db' }}>Bot Fill %</span>}>
                  <InputNumber min={0} max={100} style={{ width: 120 }} />
                </Form.Item>
                <Form.Item name="trigger_pct" label={<span style={{ color: '#d1d5db' }}>Release Trigger %</span>}>
                  <InputNumber min={0} max={100} style={{ width: 120 }} />
                </Form.Item>
                <Form.Item name="release_pct" label={<span style={{ color: '#d1d5db' }}>Release %</span>}>
                  <InputNumber min={0} max={100} style={{ width: 120 }} />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={savingBotConfig}>
                    Save
                  </Button>
                </Form.Item>
              </Form>
            )}
          </Card>
        </Col>
      </Row>
```

- [ ] **Step 3: Show the bot/real breakdown in the "Sold" column**

Modify the `Sold` column definition (lines 392-396):

```jsx
                {
                  title: 'Sold',
                  dataIndex: 'ticket_count',
                  render: (v, record: any) => (
                    <span style={{ fontWeight: 'bold' }}>
                      {v || 0}{record.max_tickets ? ` / ${record.max_tickets}` : ''}
                      {record.bot_ticket_count > 0 && (
                        <Tag color="purple" style={{ marginLeft: 6, fontSize: 10 }}>{record.bot_ticket_count} bot</Tag>
                      )}
                    </span>
                  )
                },
```

- [ ] **Step 4: Build the admin panel to catch type errors**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/games/Lottery.tsx
git commit -m "feat(admin-panel): add Bot Fill Config card and bot/real ticket breakdown"
```

---

### Task 8: Tag lottery bots from the Bots admin page

**Files:**
- Modify: `services/admin-service/src/index.ts` (`POST /api/admin/bots` handler, line 2533-2565)
- Modify: `admin-panel/src/pages/Bots.tsx` (create-bot form, line 463-487)

**Interfaces:**
- Produces: `POST /api/admin/bots` accepts an optional `preferred_game_type` field and stores it on the created `users` row.

- [ ] **Step 1: Accept `preferred_game_type` in the create-bot endpoint**

In `services/admin-service/src/index.ts`, modify the `POST /api/admin/bots` handler (lines 2533-2565):

```typescript
  app.post('/api/admin/bots', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const body = z.object({
      username: z.string(),
      phone: z.string().optional(),
      initial_balance: z.number().nonnegative().default(10000),
      preferred_game_type: z.enum(['teen_patti', 'ludo', 'lottery']).optional(),
    }).parse(req.body)

    const phone = body.phone || `999${Math.floor(1000000 + Math.random() * 9000000)}`
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase()

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const userRes = await client.query(
        `INSERT INTO users (phone, username, password_hash, is_bot, status, referral_code, preferred_game_type)
         VALUES ($1, $2, $3, true, 'active', $4, $5) RETURNING id`,
        [phone, body.username, '$2b$12$invalid_bot_hash_never_login', referralCode, body.preferred_game_type ?? null]
      )
      const botId = userRes.rows[0].id
      await client.query(
        `INSERT INTO wallets (user_id, real_balance, bonus_balance)
         VALUES ($1, $2, 0)`,
        [botId, body.initial_balance]
      )
      await client.query('COMMIT')
      return reply.send({ success: true, bot: { id: botId, username: body.username, phone, balance: body.initial_balance } })
    } catch (e: any) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: e.message || 'Failed to create bot' })
    } finally {
      client.release()
    }
  })
```

- [ ] **Step 2: Add the game-type selector to the create-bot form**

In `admin-panel/src/pages/Bots.tsx`, add a `Select` field to the create-bot `Form` (after the `initial_balance` field, line 486):

```jsx
          <Form.Item
            name="preferred_game_type"
            label="Bot Pool"
            tooltip={{ title: 'Which feature this bot is dedicated to — lottery bots only buy lottery tickets, never join Teen Patti/Ludo rooms.', icon: <InfoCircleOutlined /> }}
          >
            <Select placeholder="Unassigned (general pool)" allowClear>
              <Select.Option value="lottery">Lottery (ticket fill)</Select.Option>
              <Select.Option value="teen_patti">Teen Patti</Select.Option>
              <Select.Option value="ludo">Ludo</Select.Option>
            </Select>
          </Form.Item>
```

Confirm `Select` is already imported at the top of `Bots.tsx` (it is, per the game-difficulty dropdown at line 256-262 — reuse the same import, add nothing new).

- [ ] **Step 3: Build the admin panel to catch type errors**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 4: Manually verify by creating a lottery bot**

With the dev stack running, open the Bots admin page, create a bot named `TestLotteryBot` with `Bot Pool = Lottery`, and confirm via:
```bash
psql "$DATABASE_URL" -c "SELECT username, preferred_game_type FROM users WHERE username = 'TestLotteryBot';"
```
Expected: `preferred_game_type = lottery`

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/index.ts admin-panel/src/pages/Bots.tsx
git commit -m "feat(admin-panel): let admin tag new bots into the lottery pool"
```

---

## Post-Implementation

- Re-lock Lottery in memory once this ships (per [[lottery-bot-fill-feature]] / [[lottery-locked]] — no further Lottery changes without fresh re-authorization).
- Admin must manually top up `LotteryBot_A/B/C` wallets (or the ones they tag) via the existing "Allot Balance to Bot" flow before enabling `lottery_bot_config.enabled = true` in production, since ticket purchases will silently skip bots with insufficient balance rather than erroring.
