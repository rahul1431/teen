# Lottery Dedicated Number Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current free-text alphanumeric lottery ticket system with a fixed 4-digit numeric "Dedicated Number" game — numeric keypad + Quick Pick entry, admin-defined digit-match prize tiers, and automatic settlement (manual or randomly-generated winning number).

**Architecture:** Same three-layer structure already used throughout this app (Postgres → Fastify `core-api-service`/`admin-service` → React admin panel / Flutter mobile app). No new services. `lottery_draws`/`lottery_tickets` schema is altered in place (clean-slate migration, only test data exists). Settlement moves from fully-manual per-ticket winner entry to one automatic digit-matching routine shared by both the manual-entry and random-generation admin paths.

**Tech Stack:** PostgreSQL, Fastify + Zod + node-postgres (`core-api-service`, `admin-service`), React + antd (`admin-panel`), Flutter/Dart (`mobile`).

## Global Constraints

- Ticket numbers are always exactly 4 digits (`0000`–`9999`), numeric only — no more admin-configurable digit count.
- Numbers stay exclusive per draw (first-come-first-served, `UNIQUE(draw_id, ticket_number)`) — multiple players cannot pick the same number for the same draw.
- Prize tiers are admin-defined per draw: `{ match_type: 'exact' | 'last_3' | 'last_2' | 'last_1', multiplier: number }[]`. A ticket qualifies for only its single highest tier (checked `exact` → `last_3` → `last_2` → `last_1`, not cumulative). Payout = `ticket_price × tier.multiplier`.
- No backward compatibility with the old free-text system anywhere (mobile, admin, backend) — it is fully replaced, not deprecated alongside.
- Verify each task by compiling (`npx tsc --noEmit` / `dart analyze`) and, where noted, direct `psql`/`curl` checks — this codebase has no automated test runner for these betting features; that's the established verification pattern here, follow it rather than introducing a new one.
- Design reference: `docs/superpowers/specs/2026-07-14-lottery-dedicated-number-design.md`.

---

### Task 1: Database migration — schema + clean-slate wipe

**Files:**
- Create: `infra/db/migrations/072_lottery_dedicated_number.sql`

**Interfaces:**
- Produces: `lottery_draws.prize_tiers` (JSONB), `lottery_draws.winning_number` (VARCHAR(4)), `lottery_tickets.ticket_number` (VARCHAR(4), numeric-only check constraint) — every later task's SQL depends on these exact column shapes.

- [ ] **Step 1: Confirm current lottery data is safe to wipe**

Run: `docker exec -i teen_postgres psql -U teen -d teen_db -c "SELECT COUNT(*) FROM lottery_draws;"` (on the VPS, or against whatever DB this is being developed against)
Expected: a small number (test data only, confirmed 6 draws / 6 tickets as of 2026-07-14 per the design spec). If this returns a large number suggesting real user activity, STOP and re-confirm with the user before proceeding — this migration is destructive.

- [ ] **Step 2: Write the migration file**

```sql
-- Lottery redesign: Dedicated Number mode. Replaces the free-text
-- alphanumeric ticket system with a fixed 4-digit numeric pick and real
-- digit-match prize tiers, replacing the old fully-manual winner-list
-- settlement. Clean-slate migration — confirmed only test data exists
-- (6 draws, 6 tickets, no real users) as of 2026-07-14.

DELETE FROM lottery_tickets;
DELETE FROM lottery_draws;

ALTER TABLE lottery_draws DROP COLUMN IF EXISTS digits;
ALTER TABLE lottery_draws DROP COLUMN IF EXISTS prize_multiplier;
ALTER TABLE lottery_draws ADD COLUMN IF NOT EXISTS prize_tiers JSONB NOT NULL DEFAULT '[]';
ALTER TABLE lottery_draws ALTER COLUMN winning_number TYPE VARCHAR(4);

ALTER TABLE lottery_tickets ALTER COLUMN ticket_number TYPE VARCHAR(4);
ALTER TABLE lottery_tickets ADD CONSTRAINT lottery_tickets_ticket_number_numeric CHECK (ticket_number ~ '^[0-9]{4}$');
```

- [ ] **Step 3: Run it locally/on the target DB and verify the new shape**

Run: `docker exec -i teen_postgres psql -U teen -d teen_db < infra/db/migrations/072_lottery_dedicated_number.sql`
Expected: `DELETE 6` (or however many), `DELETE 6`, `ALTER TABLE` ×5, no errors.

Run: `docker exec -i teen_postgres psql -U teen -d teen_db -c "\d lottery_draws" -c "\d lottery_tickets"`
Expected: `lottery_draws` has no `digits`/`prize_multiplier` columns, has `prize_tiers jsonb not null default '[]'::jsonb` and `winning_number character varying(4)`; `lottery_tickets` has `ticket_number character varying(4)` with a check constraint `lottery_tickets_ticket_number_numeric`.

- [ ] **Step 4: Commit**

```bash
git add infra/db/migrations/072_lottery_dedicated_number.sql
git commit -m "feat(lottery): migrate schema to fixed 4-digit tickets + prize tiers"
```

---

### Task 2: Backend helper — tier matching, random number generation, automatic settlement

**Files:**
- Modify: `services/core-api-service/src/helpers/lottery.ts` (full rewrite of `settleLottery`, add `findMatchingTier`/`generateWinningNumber`/`PrizeTier` type)

**Interfaces:**
- Consumes: `creditPrize` from `./wallet-client` (unchanged import, same signature as today).
- Produces: `export type PrizeTier = { match_type: 'exact' | 'last_3' | 'last_2' | 'last_1'; multiplier: number }`, `export function findMatchingTier(ticketNumber: string, winningNumber: string, tiers: PrizeTier[]): PrizeTier | null`, `export function generateWinningNumber(): string` (returns a random 4-digit zero-padded string), `export async function settleLottery(db: Pool, drawId: string, winningNumber: string): Promise<{ tickets: number; winners: number; paid: number }>` — note the signature change from the old `winnersList` array param to a single `winningNumber: string`. Task 3 calls this with the new signature.

- [ ] **Step 1: Replace the full file content**

```typescript
import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export type PrizeTier = { match_type: 'exact' | 'last_3' | 'last_2' | 'last_1'; multiplier: number }

const TIER_ORDER: PrizeTier['match_type'][] = ['exact', 'last_3', 'last_2', 'last_1']
const TIER_LENGTH: Record<PrizeTier['match_type'], number> = { exact: 4, last_3: 3, last_2: 2, last_1: 1 }

// Returns the highest-value tier a ticket qualifies for, checked in order —
// NOT cumulative. A ticket matching all 4 digits wins only the exact tier,
// not every lower tier too.
export function findMatchingTier(ticketNumber: string, winningNumber: string, tiers: PrizeTier[]): PrizeTier | null {
  for (const matchType of TIER_ORDER) {
    const len = TIER_LENGTH[matchType]
    if (ticketNumber.slice(-len) === winningNumber.slice(-len)) {
      const tier = tiers.find(t => t.match_type === matchType)
      if (tier) return tier
    }
  }
  return null
}

export function generateWinningNumber(): string {
  return Math.floor(Math.random() * 10000).toString().padStart(4, '0')
}

export async function settleLottery(
  db: Pool,
  drawId: string,
  winningNumber: string,
): Promise<{ tickets: number; winners: number; paid: number }> {
  const client = await db.connect()
  const winnerPayouts: { userId: string; prize: number; ticketId: string }[] = []
  let tickets = 0
  let winners = 0
  let paid = 0

  try {
    await client.query('BEGIN')

    const drawRes = await client.query('SELECT * FROM lottery_draws WHERE id = $1 FOR UPDATE', [drawId])
    if (!drawRes.rows.length) throw new Error('Draw not found')
    const draw = drawRes.rows[0]
    const tiers: PrizeTier[] = draw.prize_tiers || []
    const ticketPrice = Number(draw.ticket_price)

    await client.query(
      `UPDATE lottery_draws SET winning_number = $1, status = 'settled' WHERE id = $2`,
      [winningNumber, drawId],
    )

    const ticketsRes = await client.query('SELECT * FROM lottery_tickets WHERE draw_id = $1', [drawId])
    tickets = ticketsRes.rows.length

    for (const t of ticketsRes.rows) {
      const tier = findMatchingTier(t.ticket_number, winningNumber, tiers)
      if (tier) {
        const prize = ticketPrice * Number(tier.multiplier)
        await client.query(`UPDATE lottery_tickets SET is_winner = true, prize = $1 WHERE id = $2`, [prize, t.id])
        winners++
        paid += prize
        winnerPayouts.push({ userId: t.user_id, prize, ticketId: t.id })
      } else {
        await client.query(`UPDATE lottery_tickets SET is_winner = false, prize = 0 WHERE id = $1`, [t.id])
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await Promise.all(winnerPayouts.map(w =>
    creditPrize({
      userId: w.userId,
      amount: w.prize,
      referenceId: w.ticketId,
      idempotencyKey: `lottery_payout_${w.ticketId}`,
      notification: {
        title: 'Lottery Win! 🎰',
        body: `Congratulations! Your ticket won a prize of ₹${w.prize.toFixed(2)} in the draw.`,
      },
    }),
  ))

  return { tickets, winners, paid }
}
```

- [ ] **Step 2: Verify it compiles standalone**

Run: `cd services/core-api-service && npx tsc --noEmit -p .`
Expected: no output (clean). This will show errors from `betting.ts` still calling the old `settleLottery` signature — that's expected until Task 3; ignore errors in `betting.ts` at this step, confirm no errors are reported *inside* `lottery.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add services/core-api-service/src/helpers/lottery.ts
git commit -m "feat(lottery): automatic digit-match tier settlement + random number generator"
```

---

### Task 3: Backend routes — buy validation, create draw, declare result

**Files:**
- Modify: `services/core-api-service/src/plugins/betting.ts:7` (import), `:133-158` (buy endpoint), `:392-409` (create/draw internal endpoints)

**Interfaces:**
- Consumes: `PrizeTier`, `generateWinningNumber`, `settleLottery(db, drawId, winningNumber)` from `../helpers/lottery` (Task 2).
- Produces: `POST /internal/lottery/create` now takes `{ name, ticket_price, draw_time, prize_tiers }` (no `digits`/`prize_multiplier`). `POST /internal/lottery/draw` now takes `{ draw_id, winning_number? }` OR `{ draw_id, random: true }` and returns `{ success, winning_number, tickets, winners, paid }`. Task 4 (admin-service) proxies both of these bodies through unchanged.

- [ ] **Step 1: Update the import**

In `services/core-api-service/src/plugins/betting.ts`, change line 7:

```typescript
import { settleLottery, generateWinningNumber } from '../helpers/lottery'
```

- [ ] **Step 2: Update ticket number validation in the buy endpoint**

Find this block (currently around line 133-142):

```typescript
    app.post('/lottery/buy', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid(), ticket_number: z.string() }).parse(req.body)
      const ticketNumClean = body.ticket_number.trim()
      const drawRes = await db.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open' })
      const draw = drawRes.rows[0]
      if (!/^[a-zA-Z0-9]{1,8}$/.test(ticketNumClean)) return reply.code(400).send({ error: 'Ticket must be alphanumeric and up to 8 characters.' })
      
      const checkRes = await db.query(`SELECT 1 FROM lottery_tickets WHERE draw_id = $1 AND ticket_number = $2`, [body.draw_id, ticketNumClean])
```

Replace with:

```typescript
    app.post('/lottery/buy', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid(), ticket_number: z.string() }).parse(req.body)
      const ticketNumClean = body.ticket_number.trim()
      const drawRes = await db.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open' })
      const draw = drawRes.rows[0]
      if (!/^[0-9]{4}$/.test(ticketNumClean)) return reply.code(400).send({ error: 'Ticket number must be exactly 4 digits.' })
      
      const checkRes = await db.query(`SELECT 1 FROM lottery_tickets WHERE draw_id = $1 AND ticket_number = $2`, [body.draw_id, ticketNumClean])
```

(Only the regex line and its error message changed — everything else in this endpoint, including the `debitStake`/insert/refund logic below it, stays exactly as-is.)

- [ ] **Step 3: Update create and declare internal endpoints**

Find this block (currently around line 392-409):

```typescript
    app.post('/internal/lottery/create', { onRequest: [internal] }, async (req) => {
      const body = z.object({ name: z.string(), ticket_price: z.number().positive(), draw_time: z.string(), digits: z.number().int().min(1).max(8).default(4), prize_multiplier: z.number().positive().default(1000) }).parse(req.body)
      const r = await db.query(`INSERT INTO lottery_draws (name, ticket_price, draw_time, digits, prize_multiplier) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [body.name, body.ticket_price, body.draw_time, body.digits, body.prize_multiplier])
      return { success: true, draw: r.rows[0] }
    })

    app.post('/internal/lottery/draw', { onRequest: [internal] }, async (req) => {
      const body = z.object({
        draw_id: z.string().uuid(),
        winners: z.array(z.object({
          ticket_number: z.string(),
          prize: z.number().positive(),
          rank: z.number().optional()
        }))
      }).parse(req.body)
      const res = await settleLottery(db, body.draw_id, body.winners as any)
      return { success: true, ...res }
    })
```

Replace with:

```typescript
    app.post('/internal/lottery/create', { onRequest: [internal] }, async (req) => {
      const body = z.object({
        name: z.string(),
        ticket_price: z.number().positive(),
        draw_time: z.string(),
        prize_tiers: z.array(z.object({
          match_type: z.enum(['exact', 'last_3', 'last_2', 'last_1']),
          multiplier: z.number().positive(),
        })).min(1),
      }).parse(req.body)
      const r = await db.query(`INSERT INTO lottery_draws (name, ticket_price, draw_time, prize_tiers) VALUES ($1,$2,$3,$4) RETURNING *`, [body.name, body.ticket_price, body.draw_time, JSON.stringify(body.prize_tiers)])
      return { success: true, draw: r.rows[0] }
    })

    app.post('/internal/lottery/draw', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        draw_id: z.string().uuid(),
        winning_number: z.string().regex(/^[0-9]{4}$/).optional(),
        random: z.boolean().optional(),
      }).parse(req.body)
      const winningNumber = body.random ? generateWinningNumber() : body.winning_number
      if (!winningNumber) return reply.code(400).send({ error: 'winning_number or random must be provided' })
      const res = await settleLottery(db, body.draw_id, winningNumber)
      return { success: true, winning_number: winningNumber, ...res }
    })
```

- [ ] **Step 4: Verify it compiles**

Run: `cd services/core-api-service && npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/plugins/betting.ts
git commit -m "feat(lottery): 4-digit ticket validation, prize-tier create, manual/random declare"
```

---

### Task 4: Backend admin-service — edit-draw endpoint prize_tiers support

**Files:**
- Modify: `services/admin-service/src/index.ts:2303-2323` (PATCH edit-draw endpoint)

**Interfaces:**
- Consumes: nothing new — `callBetting` (already imported/defined in this file) is reused unchanged for the create/draw proxy routes at `:1881-1889`, which need **no changes** since they pass `req.body` straight through to Task 3's updated internal endpoints.
- Produces: `PATCH /api/admin/betting/lottery/draws/:id` now accepts `prize_tiers` instead of `prize_multiplier`.

- [ ] **Step 1: Update the edit-draw endpoint**

Find this block (currently around line 2303-2323):

```typescript
  app.patch('/api/admin/betting/lottery/draws/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as any
    const body = z.object({
      name: z.string().optional(),
      ticket_price: z.number().positive().optional(),
      draw_time: z.string().optional(),
      prize_multiplier: z.number().positive().optional(),
    }).parse(req.body)
    const existing = await db.query(`SELECT status FROM lottery_draws WHERE id = $1`, [id])
    if (!existing.rows.length) return reply.code(404).send({ error: 'Draw not found' })
    if (existing.rows[0].status !== 'open') return reply.code(409).send({ error: 'Can only edit open draws' })
    const fields: string[] = [], params: any[] = [id]
    let i = 2
    if (body.name) { fields.push(`name = $${i++}`); params.push(body.name) }
    if (body.ticket_price) { fields.push(`ticket_price = $${i++}`); params.push(body.ticket_price) }
    if (body.draw_time) { fields.push(`draw_time = $${i++}`); params.push(body.draw_time) }
    if (body.prize_multiplier) { fields.push(`prize_multiplier = $${i++}`); params.push(body.prize_multiplier) }
    if (!fields.length) return reply.code(400).send({ error: 'No fields to update' })
    const r = await db.query(`UPDATE lottery_draws SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params)
    return reply.send({ success: true, draw: r.rows[0] })
  })
```

Replace with:

```typescript
  app.patch('/api/admin/betting/lottery/draws/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as any
    const body = z.object({
      name: z.string().optional(),
      ticket_price: z.number().positive().optional(),
      draw_time: z.string().optional(),
      prize_tiers: z.array(z.object({
        match_type: z.enum(['exact', 'last_3', 'last_2', 'last_1']),
        multiplier: z.number().positive(),
      })).optional(),
    }).parse(req.body)
    const existing = await db.query(`SELECT status FROM lottery_draws WHERE id = $1`, [id])
    if (!existing.rows.length) return reply.code(404).send({ error: 'Draw not found' })
    if (existing.rows[0].status !== 'open') return reply.code(409).send({ error: 'Can only edit open draws' })
    const fields: string[] = [], params: any[] = [id]
    let i = 2
    if (body.name) { fields.push(`name = $${i++}`); params.push(body.name) }
    if (body.ticket_price) { fields.push(`ticket_price = $${i++}`); params.push(body.ticket_price) }
    if (body.draw_time) { fields.push(`draw_time = $${i++}`); params.push(body.draw_time) }
    if (body.prize_tiers) { fields.push(`prize_tiers = $${i++}`); params.push(JSON.stringify(body.prize_tiers)) }
    if (!fields.length) return reply.code(400).send({ error: 'No fields to update' })
    const r = await db.query(`UPDATE lottery_draws SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params)
    return reply.send({ success: true, draw: r.rows[0] })
  })
```

- [ ] **Step 2: Verify it compiles**

Run: `cd services/admin-service && npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(lottery): edit-draw endpoint accepts prize_tiers"
```

---

### Task 5: Admin panel — Create Draw modal (prize tiers)

**Files:**
- Modify: `admin-panel/src/pages/games/Lottery.tsx:84-98` (`create` function), `:460-482` (Create Draw modal form fields)

**Interfaces:**
- Consumes: `POST /betting/lottery/create` now expects `{ name, ticket_price, prize_tiers, draw_time }` (Task 3).
- Produces: none consumed by later tasks in this file directly, but Task 6 follows the same `Form.List` UI pattern established here.

- [ ] **Step 1: Update the `create` function**

Find (currently around line 84-98):

```typescript
  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/create', {
        name: v.name, ticket_price: v.ticket_price, digits: v.digits,
        prize_multiplier: v.prize_multiplier, draw_time: v.draw_time.toISOString(),
      })
      message.success('Draw created successfully!')
      setCreateOpen(false)
      cForm.resetFields()
      loadDraws()
      loadStats()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }
```

Replace with:

```typescript
  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/create', {
        name: v.name, ticket_price: v.ticket_price,
        prize_tiers: v.prize_tiers, draw_time: v.draw_time.toISOString(),
      })
      message.success('Draw created successfully!')
      setCreateOpen(false)
      cForm.resetFields()
      loadDraws()
      loadStats()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }
```

- [ ] **Step 2: Replace the digits/prize_multiplier form fields with a Prize Tiers list**

Find (currently around line 460-482):

```tsx
        <Form form={cForm} layout="vertical" onFinish={create} style={{ marginTop: '16px' }}>
          <Form.Item name="name" label="Draw Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Weekly Megadraw, Daily Lucky Draw" style={{ borderRadius: '6px' }} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="ticket_price" label="Ticket Price (₹)" rules={[{ required: true }]} initialValue={10}>
                <InputNumber min={1} style={{ width: '100%', borderRadius: '6px' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="digits" label="Length limit (digits)" initialValue={8}>
                <InputNumber min={1} max={8} style={{ width: '100%', borderRadius: '6px' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="prize_multiplier" label="Prize Multiplier (payout = price × multiplier)" initialValue={1000} rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true, message: 'Please select draw time' }]}>
            <DatePicker showTime style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
        </Form>
```

Replace with:

```tsx
        <Form form={cForm} layout="vertical" onFinish={create} style={{ marginTop: '16px' }}>
          <Form.Item name="name" label="Draw Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Weekly Megadraw, Daily Lucky Draw" style={{ borderRadius: '6px' }} />
          </Form.Item>
          <Form.Item name="ticket_price" label="Ticket Price (₹)" rules={[{ required: true }]} initialValue={10}>
            <InputNumber min={1} style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
          <Form.Item label="Prize Tiers" required tooltip="Every ticket is a 4-digit number. Define which digit-match patterns pay out and at what multiple of the ticket price.">
            <Form.List name="prize_tiers" initialValue={[{ match_type: 'exact', multiplier: 5000 }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'match_type']}
                        rules={[{ required: true, message: 'Missing match type' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Select style={{ width: 180, borderRadius: '6px' }} options={[
                          { value: 'exact', label: 'Exact (4/4 digits)' },
                          { value: 'last_3', label: 'Last 3 digits' },
                          { value: 'last_2', label: 'Last 2 digits' },
                          { value: 'last_1', label: 'Last 1 digit' },
                        ]} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'multiplier']}
                        rules={[{ required: true, message: 'Missing multiplier' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={1} placeholder="Multiplier" style={{ width: 140, borderRadius: '6px' }} formatter={(v) => `${v}x`} />
                      </Form.Item>
                      {fields.length > 1 ? (
                        <Button danger onClick={() => remove(name)} style={{ borderRadius: '6px' }}>Remove</Button>
                      ) : null}
                    </Space>
                  ))}
                  <Form.Item style={{ marginTop: '8px' }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ borderRadius: '8px' }}>
                      Add Prize Tier
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true, message: 'Please select draw time' }]}>
            <DatePicker showTime style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
        </Form>
```

- [ ] **Step 3: Verify it compiles**

Run: `cd admin-panel && npx tsc --noEmit -p .`
Expected: no output (there will be errors from the Declare Winners modal and table columns still referencing `digits`/`prize_multiplier` — those are fixed in Task 6, ignore them at this step; confirm no NEW errors appear in the Create Draw section you just edited).

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/games/Lottery.tsx
git commit -m "feat(lottery-admin): Create Draw modal — prize tiers list replaces digits/multiplier"
```

---

### Task 6: Admin panel — Declare Result modal (manual/random) + table columns

**Files:**
- Modify: `admin-panel/src/pages/games/Lottery.tsx:1-13` (imports), `:100-114` (`declare` function), `:356-365` (table columns: remove Length, rework Payout), `:486-560` (Declare Winners modal)

**Interfaces:**
- Consumes: `POST /betting/lottery/draw` now expects `{ draw_id, winning_number }` or `{ draw_id, random: true }`, returns `{ success, winning_number, tickets, winners, paid }` (Task 3).

- [ ] **Step 1: Add `Radio` to the antd import**

Find (line 1-9):

```tsx
import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, message, Row, Col, DatePicker, Divider, Popconfirm, Drawer, Statistic
} from 'antd'
import { 
  ReloadOutlined, DeleteOutlined, TrophyOutlined, WalletOutlined, 
  ShoppingCartOutlined, CalendarOutlined, PlusOutlined, SettingOutlined, WarningOutlined
} from '@ant-design/icons'
```

Replace with:

```tsx
import { useEffect, useState } from 'react'
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, message, Row, Col, DatePicker, Divider, Popconfirm, Drawer, Statistic, Radio
} from 'antd'
import { 
  ReloadOutlined, DeleteOutlined, TrophyOutlined, WalletOutlined, 
  ShoppingCartOutlined, CalendarOutlined, PlusOutlined, SettingOutlined, WarningOutlined
} from '@ant-design/icons'
```

- [ ] **Step 2: Add `declareMode` state**

Find (line 23-25):

```typescript
  const [drawFor, setDrawFor] = useState<any>(null)
  const [cForm] = Form.useForm()
  const [dForm] = Form.useForm()
```

Replace with:

```typescript
  const [drawFor, setDrawFor] = useState<any>(null)
  const [declareMode, setDeclareMode] = useState<'manual' | 'random'>('manual')
  const [cForm] = Form.useForm()
  const [dForm] = Form.useForm()
```

- [ ] **Step 3: Rewrite the `declare` function**

Find (currently around line 100-114):

```typescript
  const declare = async (v: any) => {
    try {
      const r = await adminApi.post('/betting/lottery/draw', {
        draw_id: drawFor.id,
        winners: v.winners,
      })
      message.success(`Drawn — ${r.data.winners}/${r.data.tickets} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      setDrawFor(null)
      dForm.resetFields()
      loadDraws()
      loadStats()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Draw failed')
    }
  }
```

Replace with:

```typescript
  const declare = async (v: any) => {
    try {
      const payload: any = { draw_id: drawFor.id }
      if (declareMode === 'random') payload.random = true
      else payload.winning_number = v.winning_number
      const r = await adminApi.post('/betting/lottery/draw', payload)
      message.success(`Drawn (${r.data.winning_number}) — ${r.data.winners}/${r.data.tickets} winners, ₹${Number(r.data.paid).toFixed(0)} paid`)
      setDrawFor(null)
      setDeclareMode('manual')
      dForm.resetFields()
      loadDraws()
      loadStats()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Draw failed')
    }
  }
```

- [ ] **Step 4: Update the draws table columns**

Find (currently around line 356-365):

```tsx
                { 
                  title: 'Length', 
                  dataIndex: 'digits',
                  render: (v: any) => `${v} Digits`
                },
                { 
                  title: 'Payout', 
                  dataIndex: 'prize_multiplier', 
                  render: (v: any) => <Tag color="gold" style={{ fontWeight: 'bold' }}>{Number(v).toLocaleString()}x</Tag> 
                },
```

Replace with:

```tsx
                { 
                  title: 'Prize Tiers', 
                  dataIndex: 'prize_tiers', 
                  render: (tiers: any[]) => (
                    <Space wrap size={4}>
                      {(tiers || []).map((t, i) => (
                        <Tag key={i} color="gold" style={{ fontWeight: 'bold', fontSize: 10 }}>
                          {t.match_type === 'exact' ? '4/4' : t.match_type.replace('last_', 'Last ')}: {t.multiplier}x
                        </Tag>
                      ))}
                    </Space>
                  )
                },
```

- [ ] **Step 5: Rewrite the Declare Winners modal**

Find (currently around line 486-560, the entire `{/* Modal: Declare Winners */}` block):

```tsx
      {/* Modal: Declare Winners */}
      <Modal 
        open={!!drawFor} 
        title={
          <span style={{ fontSize: '18px' }}>
            🏆 Declare Winners — <span style={{ color: '#d4af37' }}>{drawFor?.name}</span>
          </span>
        } 
        onCancel={() => { setDrawFor(null); dForm.resetFields(); }} 
        onOk={() => dForm.submit()} 
        okText="Declare & Settle"
        okButtonProps={{ danger: true, style: { borderRadius: '6px' } }}
        cancelButtonProps={{ style: { borderRadius: '6px' } }}
        width={600}
      >
        <Form 
          form={dForm} 
          layout="vertical" 
          onFinish={declare} 
          initialValues={{ winners: [{ ticket_number: '', prize: 1000 }] }}
          style={{ marginTop: '16px' }}
        >
          <Form.List name="winners">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'ticket_number']}
                      rules={[{ required: true, message: 'Missing ticket number' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="Ticket Number (e.g. LUCKY7)" style={{ width: 220, borderRadius: '6px' }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'prize']}
                      rules={[{ required: true, message: 'Missing prize amount' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber min={1} placeholder="Prize (₹)" style={{ width: 180, borderRadius: '6px' }} formatter={(v) => `₹ ${v}`} />
                    </Form.Item>
                    {fields.length > 1 ? (
                      <Button danger onClick={() => remove(name)} style={{ borderRadius: '6px' }}>Remove</Button>
                    ) : null}
                  </Space>
                ))}
                <Form.Item style={{ marginTop: '8px' }}>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ borderRadius: '8px' }}>
                    Add Another Winner Rank
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
          
          <div style={{ 
            background: '#fff2f0', 
            border: '1px solid #ffccc7', 
            borderRadius: '8px', 
            padding: '12px 16px', 
            marginTop: '20px', 
            display: 'flex',
            alignItems: 'flex-start'
          }}>
            <WarningOutlined style={{ color: '#ff4d4f', fontSize: '18px', marginRight: '10px', marginTop: '3px' }} />
            <div>
              <Text strong style={{ color: '#ff4d4f', display: 'block', marginBottom: '2px' }}>Critical Action</Text>
              <Text type="danger" style={{ fontSize: '12px' }}>
                This will close the draw, credit all winner balances immediately, and mark all other tickets as lost. This cannot be undone.
              </Text>
            </div>
          </div>
        </Form>
      </Modal>
```

Replace with:

```tsx
      {/* Modal: Declare Result */}
      <Modal 
        open={!!drawFor} 
        title={
          <span style={{ fontSize: '18px' }}>
            🏆 Declare Result — <span style={{ color: '#d4af37' }}>{drawFor?.name}</span>
          </span>
        } 
        onCancel={() => { setDrawFor(null); setDeclareMode('manual'); dForm.resetFields(); }} 
        onOk={() => { if (declareMode === 'random') declare({}); else dForm.submit(); }}
        okText="Declare & Settle"
        okButtonProps={{ danger: true, style: { borderRadius: '6px' } }}
        cancelButtonProps={{ style: { borderRadius: '6px' } }}
        width={600}
      >
        <div style={{ marginTop: '16px' }}>
          <Radio.Group value={declareMode} onChange={e => setDeclareMode(e.target.value)} style={{ marginBottom: 20 }}>
            <Radio.Button value="manual">Enter Manually</Radio.Button>
            <Radio.Button value="random">Generate Randomly 🎲</Radio.Button>
          </Radio.Group>

          {declareMode === 'manual' ? (
            <Form form={dForm} layout="vertical" onFinish={declare}>
              <Form.Item
                name="winning_number"
                label="Winning 4-Digit Number"
                rules={[{ required: true, pattern: /^[0-9]{4}$/, message: 'Must be exactly 4 digits' }]}
              >
                <Input
                  maxLength={4}
                  placeholder="e.g. 4821"
                  style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: 'bold', borderRadius: '6px' }}
                />
              </Form.Item>
            </Form>
          ) : (
            <Text type="secondary">A random 4-digit number will be generated by the server and used to settle this draw.</Text>
          )}

          <div style={{ 
            background: '#fff2f0', 
            border: '1px solid #ffccc7', 
            borderRadius: '8px', 
            padding: '12px 16px', 
            marginTop: '20px', 
            display: 'flex',
            alignItems: 'flex-start'
          }}>
            <WarningOutlined style={{ color: '#ff4d4f', fontSize: '18px', marginRight: '10px', marginTop: '3px' }} />
            <div>
              <Text strong style={{ color: '#ff4d4f', display: 'block', marginBottom: '2px' }}>Critical Action</Text>
              <Text type="danger" style={{ fontSize: '12px' }}>
                This will close the draw, automatically match every ticket against the winning number using this draw's prize tiers, credit all winner balances immediately, and mark all other tickets as lost. This cannot be undone.
              </Text>
            </div>
          </div>
        </div>
      </Modal>
```

- [ ] **Step 6: Verify it compiles**

Run: `cd admin-panel && npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 7: Verify the full build**

Run: `cd admin-panel && npm run build`
Expected: `✓ built in ...s`, no errors.

- [ ] **Step 8: Commit**

```bash
git add admin-panel/src/pages/games/Lottery.tsx
git commit -m "feat(lottery-admin): Declare Result modal — manual/random winning number, tier-based table column"
```

---

### Task 7: Mobile — 4-digit ticket picker with Quick Pick

**Files:**
- Modify: `mobile/lib/features/games/betting/lottery_page.dart:1242-1614` (entire `_TicketPickerSheet` class + its state class)

**Interfaces:**
- Consumes: `widget.draw['reserved_tickets']` (list of taken ticket_number strings, unchanged shape from `GET /lottery/draws`), `widget.price`, `widget.balance`, `widget.onPurchased` — same as before, **minus** the `digits` field (dropped, always 4 now).
- Produces: `_TicketPickerSheet({ required draw, required price, required balance, required onPurchased })` — Task 8's `_showTicketPicker` call site must match this constructor (no `digits` argument).

- [ ] **Step 1: Replace the entire `_TicketPickerSheet` widget + state class**

Find the full block from `class _TicketPickerSheet extends StatefulWidget {` through the closing `}` of `_TicketPickerSheetState` (currently lines 1242-1614, ending right before the `// ─── Custom Clipper` comment).

Replace with:

```dart
class _TicketPickerSheet extends StatefulWidget {
  const _TicketPickerSheet({
    required this.draw,
    required this.price,
    required this.balance,
    required this.onPurchased,
  });
  final dynamic draw;
  final double price;
  final double balance;
  final VoidCallback onPurchased;

  @override
  State<_TicketPickerSheet> createState() => _TicketPickerSheetState();
}

class _TicketPickerSheetState extends State<_TicketPickerSheet> {
  final List<TextEditingController> _controllers =
      List.generate(4, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());
  bool _submitting = false;
  String? _error;
  static const int _totalNumbers = 10000;

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  String get _ticketNumber => _controllers.map((c) => c.text).join();

  List<String> get _reserved {
    final resTickets = widget.draw['reserved_tickets'];
    if (resTickets is List) {
      return resTickets.map((t) => t.toString().trim()).toList();
    }
    return [];
  }

  void _fillNumber(String number) {
    for (var i = 0; i < 4; i++) {
      _controllers[i].text = number[i];
    }
    setState(() => _error = null);
  }

  void _quickPick() {
    final reserved = _reserved.toSet();
    String candidate;
    var attempts = 0;
    do {
      candidate = math.Random().nextInt(10000).toString().padLeft(4, '0');
      attempts++;
    } while (reserved.contains(candidate) && attempts < 200);
    _fillNumber(candidate);
    HapticFeedback.selectionClick();
  }

  Future<void> _submit() async {
    final t = _ticketNumber;
    if (t.length != 4 || !RegExp(r'^[0-9]{4}$').hasMatch(t)) {
      setState(() => _error = 'Please pick all 4 digits');
      return;
    }
    if (_reserved.contains(t)) {
      setState(() => _error = 'This number is already taken for this draw');
      return;
    }
    if (widget.price > widget.balance) {
      setState(() => _error =
          'Insufficient balance — you have ₹${widget.balance.toStringAsFixed(0)}');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient().dio.post('/api/betting/lottery/buy',
          data: {'draw_id': widget.draw['id'], 'ticket_number': t});
      SoundService.instance.play(Sfx.win);
      HapticFeedback.heavyImpact();
      if (!mounted) return;
      Navigator.pop(context);
      widget.onPurchased();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Ticket "$t" purchased! Good luck 🍀'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ));
    } catch (e) {
      setState(() {
        _submitting = false;
        _error = 'Purchase failed — please try again';
      });
    }
  }

  Widget _digitBox(int index) {
    return SizedBox(
      width: 56,
      height: 64,
      child: TextField(
        controller: _controllers[index],
        focusNode: _focusNodes[index],
        textAlign: TextAlign.center,
        keyboardType: TextInputType.number,
        maxLength: 1,
        style: const TextStyle(
            color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900),
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(
          counterText: '',
          filled: true,
          fillColor: Colors.black.withValues(alpha: 0.3),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: AppColors.border)),
          focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide:
                  const BorderSide(color: Color(0xFF0D9488), width: 1.8)),
        ),
        onChanged: (val) {
          setState(() => _error = null);
          if (val.isNotEmpty && index < 3) {
            _focusNodes[index + 1].requestFocus();
          } else if (val.isEmpty && index > 0) {
            _focusNodes[index - 1].requestFocus();
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
          color: Color(0xFF0D1117),
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
          boxShadow: [
            BoxShadow(color: Colors.black54, blurRadius: 20, spreadRadius: 5)
          ]),
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Align(
              alignment: Alignment.center,
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(top: 8, bottom: 18),
                decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0D9488), Color(0xFF064E45)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.confirmation_num_rounded,
                      color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.draw['name'] ?? 'Lottery Draw',
                            style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                                color: Colors.white)),
                        Text(
                            '₹${widget.price.toStringAsFixed(0)} per ticket · 4-digit number',
                            style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 11,
                                fontWeight: FontWeight.w600)),
                      ]),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: AppColors.gold.withValues(alpha: 0.25)),
                  ),
                  child: Column(children: [
                    Text('Balance',
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.55),
                            fontSize: 9,
                            fontWeight: FontWeight.bold)),
                    Text('₹${widget.balance.toStringAsFixed(0)}',
                        style: const TextStyle(
                            color: AppColors.gold,
                            fontWeight: FontWeight.bold,
                            fontSize: 12)),
                  ]),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Divider(color: AppColors.border, height: 1),
            const SizedBox(height: 16),

            Row(
              children: [
                const Icon(Icons.info_outline_rounded,
                    size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 5),
                Text(
                    '${_reserved.length} / $_totalNumbers numbers taken for this draw',
                    style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 18),

            const Text("Pick Your 4-Digit Number",
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),

            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(children: [
                  for (var i = 0; i < 4; i++) ...[
                    _digitBox(i),
                    if (i < 3) const SizedBox(width: 8),
                  ],
                ]),
                OutlinedButton.icon(
                  onPressed: _quickPick,
                  icon: const Text('🎲', style: TextStyle(fontSize: 16)),
                  label: const Text('Quick Pick'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.gold,
                    side: const BorderSide(color: AppColors.gold),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
                "Numbers are exclusive — first to buy a number reserves it for this draw.",
                style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w500)),

            if (_error != null) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.red.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(10),
                  border:
                      Border.all(color: AppColors.red.withValues(alpha: 0.3)),
                ),
                child: Row(children: [
                  const Icon(Icons.error_outline_rounded,
                      color: AppColors.red, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                      child: Text(_error!,
                          style: const TextStyle(
                              color: AppColors.red,
                              fontSize: 12.5,
                              fontWeight: FontWeight.bold))),
                ]),
              ),
            ],
            const SizedBox(height: 24),

            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('1 ticket',
                          style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 11,
                              fontWeight: FontWeight.bold)),
                      Text('₹${widget.price.toStringAsFixed(0)}',
                          style: const TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 20,
                              color: AppColors.goldLight)),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.gold,
                          foregroundColor: Colors.black,
                          disabledBackgroundColor: AppColors.border,
                          disabledForegroundColor: AppColors.textSecondary,
                          minimumSize: const Size.fromHeight(50),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                          textStyle: const TextStyle(
                              fontWeight: FontWeight.w900, fontSize: 15),
                          elevation: 0),
                      child: _submitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.5, color: Colors.black))
                          : const Text('Confirm Purchase'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Verify no unresolved references remain to the old constructor**

Run: `grep -n "_TicketPickerSheet(" mobile/lib/features/games/betting/lottery_page.dart`
Expected: two matches — the class declaration (just edited) and the `_showTicketPicker` call site (which still passes `digits:` at this point — that's fixed in Task 8, don't worry about the compile error yet).

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/features/games/betting/lottery_page.dart
git commit -m "feat(lottery-mobile): 4-digit OTP-style ticket picker with Quick Pick"
```

---

### Task 8: Mobile — draw card jackpot display + call site + verification

**Files:**
- Modify: `mobile/lib/features/games/betting/lottery_page.dart:440-450` (`_drawCard` variable setup), `:572-577` ("$digits digits" badge), `:670-675` (`_showTicketPicker` call site), `:732-750` (`_showTicketPicker` method signature)

**Interfaces:**
- Consumes: `_TicketPickerSheet({ draw, price, balance, onPurchased })` from Task 7 (no `digits` param).

- [ ] **Step 1: Update `_drawCard`'s variable setup to read `prize_tiers` instead of `prize_multiplier`/`digits`**

Find (currently around line 440-450):

```dart
  Widget _drawCard(dynamic d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final mult = double.tryParse(d['prize_multiplier']?.toString() ?? '0') ?? 0;
    final digits = d['digits'] is int
        ? d['digits'] as int
        : int.tryParse(d['digits']?.toString() ?? '4') ?? 4;
    final maxPrize = price * mult;
    final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
```

Replace with:

```dart
  Widget _drawCard(dynamic d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final tiers = (d['prize_tiers'] as List?) ?? [];
    final exactTier = tiers.cast<Map>().firstWhere(
          (t) => t['match_type'] == 'exact',
          orElse: () => {},
        );
    final mult = double.tryParse(exactTier['multiplier']?.toString() ?? '0') ?? 0;
    final maxPrize = price * mult;
    final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
```

- [ ] **Step 2: Replace the "$digits digits" badge with a fixed "4-digit" label**

Find (currently around line 565-577):

```dart
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.3),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text('$digits digits',
                                    style: const TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold)),
                              ),
```

Replace with:

```dart
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.3),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Text('4-digit',
                                    style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold)),
                              ),
```

- [ ] **Step 3: Update the Buy Ticket button's call site**

Find (currently around line 670-675):

```dart
                          onPressed: isExpired
                              ? null
                              : () {
                                  SoundService.instance.play(Sfx.buttonTap);
                                  _showTicketPicker(d, digits, price);
                                },
```

Replace with:

```dart
                          onPressed: isExpired
                              ? null
                              : () {
                                  SoundService.instance.play(Sfx.buttonTap);
                                  _showTicketPicker(d, price);
                                },
```

- [ ] **Step 4: Update the `_showTicketPicker` method signature**

Find (currently around line 732-750):

```dart
  void _showTicketPicker(dynamic draw, int digits, double price) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      useSafeArea: true,
      builder: (_) => _TicketPickerSheet(
        draw: draw,
        digits: digits,
        price: price,
        balance: _balance,
        onPurchased: () {
          _loadBalance();
          _loadDraws();
          _loadMyTickets();
        },
      ),
    );
  }
```

Replace with:

```dart
  void _showTicketPicker(dynamic draw, double price) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      useSafeArea: true,
      builder: (_) => _TicketPickerSheet(
        draw: draw,
        price: price,
        balance: _balance,
        onPurchased: () {
          _loadBalance();
          _loadDraws();
          _loadMyTickets();
        },
      ),
    );
  }
```

- [ ] **Step 5: Verify the whole file analyzes clean**

Run: `cd mobile && dart analyze lib/features/games/betting/lottery_page.dart`
Expected: `No issues found!`

- [ ] **Step 6: Verify the whole project still analyzes clean**

Run: `cd mobile && dart analyze lib/`
Expected: only the same pre-existing unrelated warnings seen before this work started (unused import in `lottery_page.dart:2:8` — wait, that import (`dart:math`) is now used by `_quickPick`, so that particular pre-existing warning should actually disappear; the other unrelated warnings in `ludo_game_page.dart`/`wallet_page.dart`/`location_consent_service.dart` are expected to remain). No NEW errors or warnings in `lottery_page.dart`.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/features/games/betting/lottery_page.dart
git commit -m "feat(lottery-mobile): draw card reads prize_tiers, fixed 4-digit labeling"
```

---

### Task 9: End-to-end verification against the live VPS

**Files:** none (deployment + manual verification only)

**Interfaces:** none — this task exercises the full stack built in Tasks 1-8.

- [ ] **Step 1: Push and pull onto the VPS**

Run locally: `git push origin feature/admin-responsive`
Run on VPS: `cd /opt/teen-prod && git status --short` — expect only the known pre-existing untracked files (`SERVICE_RESTART_FIX.md`, `ecosystem.dev.config.js`, `services/admin-service/src/index.ts.bak.*`), confirming it's safe to reset.
Run on VPS: `git fetch origin && git reset --hard origin/feature/admin-responsive`

- [ ] **Step 2: Run the migration**

Run on VPS: `docker exec -i teen_postgres psql -U teen -d teen_db < /opt/teen-prod/infra/db/migrations/072_lottery_dedicated_number.sql`
Expected: as in Task 1 Step 3.

- [ ] **Step 3: Rebuild and restart the backend services**

Run on VPS: `cd /opt/teen-prod/services/core-api-service && npm run build && pm2 restart teen-core-api`
Run on VPS: `cd /opt/teen-prod/services/admin-service && npm run build && pm2 restart teen-admin-svc`
Expected: both builds succeed with no tsc errors, both processes show `online` in `pm2 status`.

- [ ] **Step 4: Rebuild and deploy the admin panel**

Run on VPS: `cd /opt/teen-prod/admin-panel && npm install --no-audit --no-fund && VITE_API_BASE_URL='' npm run build -- --base=/admin/`
Run on VPS: `rm -rf /home/admin/web/game.myonlinejoker.com/public_html/admin/* && cp -r /opt/teen-prod/admin-panel/dist/* /home/admin/web/game.myonlinejoker.com/public_html/admin/ && chown -R admin:admin /home/admin/web/game.myonlinejoker.com/public_html/admin/`

- [ ] **Step 5: Verify health**

Run on VPS: `curl -s http://127.0.0.1:3001/health` — expect `{"status":"ok",...}`.
Run: `curl -s -o /dev/null -w '%{http_code}\n' https://game.myonlinejoker.com/admin/` — expect `200`.

- [ ] **Step 6: Create a test draw via the admin panel API and verify prize_tiers persisted**

Run on VPS (using the internal key already used elsewhere in this session):
```bash
curl -s -X POST http://127.0.0.1:3001/internal/lottery/create -H 'Content-Type: application/json' -H 'x-internal-key: <INTERNAL_SERVICE_KEY from services/core-api-service/.env>' -d '{"name":"Test Draw","ticket_price":10,"draw_time":"2026-07-15T12:00:00Z","prize_tiers":[{"match_type":"exact","multiplier":5000},{"match_type":"last_2","multiplier":10}]}'
```
Expected: `{"success":true,"draw":{...,"prize_tiers":[{"match_type":"exact","multiplier":5000},{"match_type":"last_2","multiplier":10}],...}}`.

- [ ] **Step 7: Buy two tickets against it and verify exclusivity + 4-digit validation**

Using a real user JWT (mint one the same way done earlier this session via `jsonwebtoken` + the service's `JWT_SECRET`, or use an existing session token):
```bash
curl -s -X POST http://127.0.0.1:3001/lottery/buy -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' -d '{"draw_id":"<draw id from step 6>","ticket_number":"1234"}'
```
Expected: `{"success":true,"ticket_id":"..."}`.

Retry the identical request:
Expected: `{"error":"Ticket number is already reserved by another player"}` (409).

Try a non-numeric ticket: `{"ticket_number":"ABCD"}`
Expected: `{"error":"Ticket number must be exactly 4 digits."}` (400).

- [ ] **Step 8: Declare the result manually and verify tier-based settlement**

```bash
curl -s -X POST http://127.0.0.1:3001/internal/lottery/draw -H 'Content-Type: application/json' -H 'x-internal-key: <key>' -d '{"draw_id":"<draw id>","winning_number":"5634"}'
```
(`5634` shares its last 2 digits, `34`, with the ticket `1234` bought in Step 7 — this should trigger the `last_2` tier.)
Expected: `{"success":true,"winning_number":"5634","tickets":1,"winners":1,"paid":100}` (₹10 ticket_price × 10 multiplier).

Run: `docker exec -i teen_postgres psql -U teen -d teen_db -c "SELECT ticket_number, is_winner, prize FROM lottery_tickets WHERE draw_id = '<draw id>';"`
Expected: `1234 | t | 100.00`.

- [ ] **Step 9: Create a second test draw and verify the random-generation path**

Repeat Step 6 with a new draw, then:
```bash
curl -s -X POST http://127.0.0.1:3001/internal/lottery/draw -H 'Content-Type: application/json' -H 'x-internal-key: <key>' -d '{"draw_id":"<new draw id>","random":true}'
```
Expected: `{"success":true,"winning_number":"<some 4-digit string>","tickets":0,"winners":0,"paid":0}` (no tickets were bought for this second draw, but confirms the random path runs end-to-end without error).

- [ ] **Step 10: Clean up test draws**

```bash
docker exec -i teen_postgres psql -U teen -d teen_db -c "DELETE FROM lottery_tickets WHERE draw_id IN ('<draw id 1>', '<draw id 2>'); DELETE FROM lottery_draws WHERE id IN ('<draw id 1>', '<draw id 2>');"
```

- [ ] **Step 11: Build and hand off the mobile APK**

Run locally: `cd mobile && flutter build apk --release`
Expected: `√ Built build\app\outputs\flutter-apk\app-release.apk (...)`, no errors.

Report back to the user: migration ran clean, both backend services healthy, admin panel deployed and reachable, full buy→exclusivity-reject→manual-declare→tier-payout and buy→random-declare flows verified via curl, new APK built. Ask the user to install the APK and manually confirm the 4-digit picker + Quick Pick UX feels right before considering Dedicated Number mode fully shipped.
