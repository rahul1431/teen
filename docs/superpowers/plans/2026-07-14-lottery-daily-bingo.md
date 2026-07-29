# Lottery Daily (90-Ball Bingo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Daily Lottery mechanic — a live-paced 90-ball bingo draw. Admin creates a draw with a scheduled start time; players buy tickets (server-generated 3×9 cards) beforehand; at the scheduled time a dedicated engine service calls all 90 numbers one at a time over a new `/ws/bingo` WebSocket channel; tickets that complete One Line / Two Lines / Full House win automatically and cumulatively, settled the moment calling finishes.

**Architecture:** Ticket purchase and draw/admin management are plain REST, hosted in the existing `core-api-service`/`admin-service` pair (same pattern as every other lottery mechanic). The live-calling game loop is a NEW standalone service, `services/game-engines/bingo`, following the exact structure of the existing `services/game-engines/aviator` engine (Fastify + raw `ws` WebSocketServer on its own port, JWT-at-handshake auth, its own nginx location + pm2 entry) — a scheduled draw with a server-driven timer loop is architecturally the same shape as Aviator's round loop, just without live betting. Two new DB tables, purely additive.

**Tech Stack:** PostgreSQL, Fastify + Zod + node-postgres (`core-api-service`, `admin-service`), Fastify + `ws` + node-postgres (new `bingo` engine, mirroring `aviator`), React + antd (`admin-panel`), Flutter/Dart + `web_socket_channel` (`mobile`).

## Global Constraints

- `lottery_bingo_draws.prize_tiers`: `{ match_type: 'one_line' | 'two_lines' | 'full_house', multiplier: number }[]` — same shape convention as Weekly/Monthly's `prize_tiers`. Cumulative payout: a ticket collects `ticket_price × multiplier` for EVERY tier in its `tiers_won`, not just the highest.
- Cards are always server-generated at purchase time — a valid 90-ball card has 3 rows × 9 columns, exactly 5 numbers per row (15 total), column ranges `1-9, 10-19, 20-29, ..., 80-90` (last column 80-90 inclusive, 11 possible numbers), numbers within a column sorted ascending top-to-bottom. Never player-chosen.
- All 90 numbers are always called, one every 3-4 seconds, once a draw's `draw_time` arrives — no early stopping, no racing/claiming. Every ticket that completes a pattern by the end wins that tier automatically.
- The live WebSocket channel is `/ws/bingo`, a NEW dedicated endpoint (not the shared Teen Patti/Ludo `/ws` gateway) — mirrors the existing `/ws/aviator` pattern exactly: its own nginx `location` block (placed before the generic `/ws` catch-all, with `proxy_pass_header Upgrade`/`Connection` — see the documented nginx WS pitfall), its own pm2 process, its own mobile-side socket singleton.
- Message envelope on the WS channel: `{ event: string, data: any }` JSON, matching every other WS channel in this codebase.
- Verify each task by compiling (`npx tsc --noEmit` / `dart analyze`) and, where noted, direct `psql`/`curl`/`wscat`-equivalent checks — this codebase has no automated test runner for these betting features; that's the established verification pattern here.
- Design reference: `docs/superpowers/specs/2026-07-14-lottery-daily-bingo-design.md`.

---

### Task 1: Database migration — bingo draws + tickets tables

**Files:**
- Create: `infra/db/migrations/075_lottery_bingo.sql`

**Interfaces:**
- Produces: `lottery_bingo_draws (id, name, ticket_price, draw_time, status, prize_tiers JSONB, called_numbers JSONB, created_at)`, `lottery_bingo_tickets (id, draw_id, user_id, card JSONB, tiers_won JSONB, prize, created_at)` — every later task's SQL depends on these exact column names/types.

- [ ] **Step 1: Write the migration file**

```sql
-- Daily Lottery: 90-ball bingo. Admin schedules a draw (draw_time); players
-- buy tickets (server-generated 3x9 cards) beforehand; the bingo-engine
-- service calls all 90 numbers live over /ws/bingo starting at draw_time,
-- and every ticket that completes a pattern (one_line/two_lines/full_house)
-- wins that tier automatically and cumulatively once calling finishes.
BEGIN;

CREATE TABLE lottery_bingo_draws (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  ticket_price    NUMERIC(10,2) NOT NULL CHECK (ticket_price > 0),
  draw_time       TIMESTAMPTZ NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'calling', 'settled', 'cancelled')),
  prize_tiers     JSONB NOT NULL,
  called_numbers  JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_bingo_draws_status_time ON lottery_bingo_draws(status, draw_time);

CREATE TABLE lottery_bingo_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id     UUID NOT NULL REFERENCES lottery_bingo_draws(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  card        JSONB NOT NULL,
  tiers_won   JSONB NOT NULL DEFAULT '[]',
  prize       NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_bingo_tickets_draw ON lottery_bingo_tickets(draw_id);
CREATE INDEX idx_lottery_bingo_tickets_user ON lottery_bingo_tickets(user_id);

COMMIT;
```

- [ ] **Step 2: Verify the migration is well-formed**

Static review only (no local Postgres). Confirm: wrapped in `BEGIN`/`COMMIT`; `status` CHECK lists exactly `'open','calling','settled','cancelled'`; both FKs reference pre-existing tables (`users`, and `lottery_bingo_draws` self-reference for tickets) — do not create `users`. Full execution happens in Task 10 (VPS deployment).

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/075_lottery_bingo.sql
git commit -m "feat(lottery-bingo): add bingo draws/tickets tables"
```

---

### Task 2: Core-api-service — buy/draws/my-tickets + internal create/cancel

**Files:**
- Create: `services/core-api-service/src/helpers/bingo.ts`
- Modify: `services/core-api-service/src/plugins/betting.ts` — add import, add player-facing routes after the existing `/lottery/scratch/my-tickets` route, add internal create/cancel routes after `/internal/lottery/scratch/create`

**Interfaces:**
- Produces: `generateBingoCard(): number[][]` (3×9 grid, `null` for blanks) in `helpers/bingo.ts` — Task 7's engine service needs an IDENTICAL algorithm (it will import this same file, since the engine is a separate deployable but can still `import` from a relative path is NOT possible across service boundaries — Task 7 duplicates this exact function verbatim in its own file; keep the two copies byte-identical since Task 9's review will check that).
- Produces: `POST /lottery/bingo/buy` returns `{ success, ticket_id, card }`. `GET /lottery/bingo/draws` returns `{ draws }` (each with `reserved_count` or similar—see below). `GET /lottery/bingo/my-tickets` returns `{ tickets }`. `POST /internal/lottery/bingo/create` requires `{ name, ticket_price, draw_time, prize_tiers }`. `POST /internal/lottery/bingo/cancel` requires `{ draw_id }`.

- [ ] **Step 1: Write the card-generation helper**

```ts
// 90-ball bingo card generator: a 3x9 grid, 5 numbers per row (15 total),
// column ranges 1-9,10-19,...,80-90 (last column has 11 possible numbers),
// numbers within a column sorted ascending top-to-bottom, rest blank (null).
//
// Column fill-counts are chosen first (each column gets 1-3 numbers,
// summing to 15), then which of the 3 rows get a number in each column is
// assigned with a greedy balancer that always fills the row(s) currently
// furthest from its target of 5 — this reliably converges to exactly 5
// per row for any valid column-count distribution in this range.
const COLUMN_RANGES: [number, number][] = [
  [1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
  [50, 59], [60, 69], [70, 79], [80, 90],
]

function pickColumnCounts(): number[] {
  const counts = new Array(9).fill(1) // 9 columns, min 1 each = 9
  let remaining = 15 - 9 // 6 more to distribute, max 2 more per column (cap 3)
  while (remaining > 0) {
    const col = Math.floor(Math.random() * 9)
    if (counts[col] < 3) {
      counts[col]++
      remaining--
    }
  }
  return counts
}

function assignRows(columnCounts: number[]): boolean[][] {
  // grid[row][col] = true means this cell gets a number
  const grid: boolean[][] = [[], [], []].map(() => new Array(9).fill(false))
  const rowNeed = [5, 5, 5]
  const colOrder = [...Array(9).keys()].sort(() => Math.random() - 0.5)
  for (const col of colOrder) {
    const count = columnCounts[col]
    const rowsByNeed = [0, 1, 2].sort((a, b) => rowNeed[b] - rowNeed[a])
    for (let i = 0; i < count; i++) {
      const row = rowsByNeed[i]
      grid[row][col] = true
      rowNeed[row]--
    }
  }
  return grid
}

export function generateBingoCard(): (number | null)[][] {
  const columnCounts = pickColumnCounts()
  const grid = assignRows(columnCounts)
  const card: (number | null)[][] = [[], [], []].map(() => new Array(9).fill(null))
  for (let col = 0; col < 9; col++) {
    const filledRows = [0, 1, 2].filter(r => grid[r][col])
    if (!filledRows.length) continue
    const [lo, hi] = COLUMN_RANGES[col]
    const pool: number[] = []
    for (let n = lo; n <= hi; n++) pool.push(n)
    // Fisher-Yates partial shuffle, take the first `filledRows.length`
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    const chosen = pool.slice(0, filledRows.length).sort((a, b) => a - b)
    filledRows.forEach((row, idx) => { card[row][col] = chosen[idx] })
  }
  return card
}

export type BingoTier = 'one_line' | 'two_lines' | 'full_house'

// Returns which tiers a card newly qualifies for, given the numbers called
// so far, EXCLUDING any tier already present in `alreadyWon` — cumulative,
// not "highest tier only": a card that completes all 3 rows returns
// ['one_line','two_lines','full_house'] in one call if none were recorded
// yet, or just the newly-reached ones if some were already recorded.
export function checkNewTiers(
  card: (number | null)[][],
  calledNumbers: number[],
  alreadyWon: BingoTier[],
): BingoTier[] {
  const called = new Set(calledNumbers)
  const completedRows = card.filter(row =>
    row.every(cell => cell === null || called.has(cell))
  ).length
  const newTiers: BingoTier[] = []
  if (completedRows >= 1 && !alreadyWon.includes('one_line')) newTiers.push('one_line')
  if (completedRows >= 2 && !alreadyWon.includes('two_lines')) newTiers.push('two_lines')
  if (completedRows >= 3 && !alreadyWon.includes('full_house')) newTiers.push('full_house')
  return newTiers
}
```

- [ ] **Step 2: Add the import to `betting.ts`**

Find:

```ts
import { rollOutcome } from '../helpers/scratch'
```

Replace with:

```ts
import { rollOutcome } from '../helpers/scratch'
import { generateBingoCard } from '../helpers/bingo'
```

- [ ] **Step 3: Add player-facing routes after `/lottery/scratch/my-tickets`**

Find (the end of the existing `/lottery/scratch/my-tickets` route, immediately followed by the cricket section comment):

```ts
    app.get('/lottery/scratch/my-tickets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(
        `SELECT t.*, p.name AS product_name, p.price AS product_price, pc.code AS promo_code
         FROM lottery_scratch_tickets t
         JOIN lottery_scratch_products p ON p.id = t.product_id
         LEFT JOIN promo_codes pc ON pc.id = t.promo_code_id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
        [uid(req)],
      )
      return { tickets: rows.rows }
    })

    // ══ CRICKET (Dream11-style fantasy contests, plus session/fancy
```

Replace with:

```ts
    app.get('/lottery/scratch/my-tickets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(
        `SELECT t.*, p.name AS product_name, p.price AS product_price, pc.code AS promo_code
         FROM lottery_scratch_tickets t
         JOIN lottery_scratch_products p ON p.id = t.product_id
         LEFT JOIN promo_codes pc ON pc.id = t.promo_code_id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
        [uid(req)],
      )
      return { tickets: rows.rows }
    })

    // ══ LOTTERY — DAILY (90-BALL BINGO) ══
    app.get('/lottery/bingo/draws', { onRequest: [auth] }, async () => {
      const rows = await db.query(`
        SELECT d.*, COUNT(t.id)::int AS ticket_count
        FROM lottery_bingo_draws d
        LEFT JOIN lottery_bingo_tickets t ON t.draw_id = d.id
        WHERE d.status IN ('open', 'calling') AND d.draw_time > NOW() - INTERVAL '15 minutes'
        GROUP BY d.id
        ORDER BY d.draw_time ASC
      `)
      return { draws: rows.rows }
    })

    app.post('/lottery/bingo/buy', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid() }).parse(req.body)
      const drawRes = await db.query(`SELECT * FROM lottery_bingo_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open' })
      const draw = drawRes.rows[0]

      const ticketId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: Number(draw.ticket_price), referenceId: ticketId, idempotencyKey: `bingo_buy_${ticketId}`, description: `Bingo: ${draw.name}` })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })

      const card = generateBingoCard()
      try {
        await db.query(
          `INSERT INTO lottery_bingo_tickets (id, draw_id, user_id, card) VALUES ($1,$2,$3,$4)`,
          [ticketId, body.draw_id, uid(req), JSON.stringify(card)],
        )
      } catch (err) {
        await creditPrize({ userId: uid(req), amount: Number(draw.ticket_price), referenceId: ticketId, idempotencyKey: `bingo_buy_refund_${ticketId}` })
        return reply.code(500).send({ error: 'Purchase failed, your stake has been refunded' })
      }

      return { success: true, ticket_id: ticketId, card }
    })

    app.get('/lottery/bingo/my-tickets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(
        `SELECT t.*, d.name AS draw_name, d.draw_time, d.status AS draw_status
         FROM lottery_bingo_tickets t
         JOIN lottery_bingo_draws d ON d.id = t.draw_id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
        [uid(req)],
      )
      return { tickets: rows.rows }
    })

    // ══ CRICKET (Dream11-style fantasy contests, plus session/fancy
```

- [ ] **Step 4: Add internal create/cancel routes after `/internal/lottery/scratch/create`**

Find (the end of the existing `/internal/lottery/scratch/create` route):

```ts
      const r = await db.query(
        `INSERT INTO lottery_scratch_products (name, price, payouts) VALUES ($1,$2,$3) RETURNING *`,
        [body.name, body.price, JSON.stringify(body.payouts)],
      )
      return { success: true, product: r.rows[0] }
    })
```

Replace with:

```ts
      const r = await db.query(
        `INSERT INTO lottery_scratch_products (name, price, payouts) VALUES ($1,$2,$3) RETURNING *`,
        [body.name, body.price, JSON.stringify(body.payouts)],
      )
      return { success: true, product: r.rows[0] }
    })

    app.post('/internal/lottery/bingo/create', { onRequest: [internal] }, async (req) => {
      const body = z.object({
        name: z.string(),
        ticket_price: z.number().positive(),
        draw_time: z.string(),
        prize_tiers: z.array(z.object({
          match_type: z.enum(['one_line', 'two_lines', 'full_house']),
          multiplier: z.number().positive(),
        })).min(1),
      }).parse(req.body)
      const r = await db.query(
        `INSERT INTO lottery_bingo_draws (name, ticket_price, draw_time, prize_tiers) VALUES ($1,$2,$3,$4) RETURNING *`,
        [body.name, body.ticket_price, body.draw_time, JSON.stringify(body.prize_tiers)],
      )
      return { success: true, draw: r.rows[0] }
    })

    app.post('/internal/lottery/bingo/cancel', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid() }).parse(req.body)
      const drawRes = await db.query(`SELECT * FROM lottery_bingo_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open or already started' })
      const tickets = await db.query(`SELECT * FROM lottery_bingo_tickets WHERE draw_id = $1`, [body.draw_id])
      await db.query(`UPDATE lottery_bingo_draws SET status = 'cancelled' WHERE id = $1`, [body.draw_id])
      const draw = drawRes.rows[0]
      await Promise.all(tickets.rows.map((t: any) =>
        creditPrize({ userId: t.user_id, amount: Number(draw.ticket_price), referenceId: t.id, idempotencyKey: `bingo_refund_${t.id}` })
      ))
      return { success: true, refunded: tickets.rows.length }
    })
```

- [ ] **Step 5: Verify it compiles**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/core-api-service/src/helpers/bingo.ts services/core-api-service/src/plugins/betting.ts
git commit -m "feat(lottery-bingo): buy/draws/my-tickets routes + internal create/cancel"
```

---

### Task 3: Admin-service — bingo draw proxy routes

**Files:**
- Modify: `services/admin-service/src/index.ts` — add routes immediately after Task 4 (prior plan)'s scratch routes, i.e. after the existing `/api/admin/betting/lottery/scratch/products` PATCH route

**Interfaces:**
- Consumes: `POST /internal/lottery/bingo/create`, `POST /internal/lottery/bingo/cancel` (Task 2) via `callBetting`.
- Produces: `GET /api/admin/betting/lottery/bingo/draws`, `POST /api/admin/betting/lottery/bingo/create`, `POST /api/admin/betting/lottery/bingo/cancel/:id` — Task 4's admin panel depends on these exact paths.

- [ ] **Step 1: Add the three routes**

Find (the end of the existing scratch-products PATCH route added in the prior plan):

```ts
  app.patch('/api/admin/betting/lottery/scratch/products/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({ is_active: z.boolean() }).parse(req.body)
    const r = await db.query(`UPDATE lottery_scratch_products SET is_active = $1 WHERE id = $2 RETURNING *`, [body.is_active, id])
    if (!r.rows.length) return reply.code(404).send({ error: 'Product not found' })
    return reply.send({ success: true, product: r.rows[0] })
  })
```

Replace with:

```ts
  app.patch('/api/admin/betting/lottery/scratch/products/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({ is_active: z.boolean() }).parse(req.body)
    const r = await db.query(`UPDATE lottery_scratch_products SET is_active = $1 WHERE id = $2 RETURNING *`, [body.is_active, id])
    if (!r.rows.length) return reply.code(404).send({ error: 'Product not found' })
    return reply.send({ success: true, product: r.rows[0] })
  })

  // --- Lottery: Daily (Bingo) ---
  app.get('/api/admin/betting/lottery/bingo/draws', { onRequest: [authenticate] }, async (_req, reply) => {
    const rows = await db.query(`
      SELECT d.*,
             (SELECT COUNT(*) FROM lottery_bingo_tickets t WHERE t.draw_id = d.id) AS ticket_count,
             (SELECT COALESCE(SUM(t.prize), 0) FROM lottery_bingo_tickets t WHERE t.draw_id = d.id) AS total_paid
      FROM lottery_bingo_draws d ORDER BY d.draw_time DESC LIMIT 100`)
    return reply.send({ draws: rows.rows })
  })

  app.post('/api/admin/betting/lottery/bingo/create', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/lottery/bingo/create', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/lottery/bingo/cancel/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const r = await callBetting('/internal/lottery/bingo/cancel', { draw_id: id })
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })
```

- [ ] **Step 2: Verify it compiles**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(lottery-bingo): admin-service proxy routes for bingo draws"
```

---

### Task 4: Admin panel — Daily Lottery tab

**Files:**
- Create: `admin-panel/src/pages/games/LotteryBingo.tsx`
- Modify: `admin-panel/src/pages/games/Lottery.tsx` — add a third tab

**Interfaces:**
- Consumes: `GET/POST /api/admin/betting/lottery/bingo/*` (Task 3).
- Produces: none consumed by later tasks.

- [ ] **Step 1: Create `LotteryBingo.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Select, Button, Table, Tag, Space, Modal, Input, DatePicker, message, Popconfirm } from 'antd'
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'

export default function LotteryBingo() {
  const [draws, setDraws] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const loadDraws = () => {
    setLoading(true)
    adminApi.get('/betting/lottery/bingo/draws')
      .then(r => setDraws(r.data.draws || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDraws() }, [])

  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/bingo/create', {
        name: v.name, ticket_price: v.ticket_price,
        prize_tiers: v.prize_tiers, draw_time: v.draw_time.toISOString(),
      })
      message.success('Bingo draw created!')
      setCreateOpen(false)
      form.resetFields()
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }

  const cancelDraw = async (id: string) => {
    try {
      await adminApi.post(`/betting/lottery/bingo/cancel/${id}`)
      message.success('Draw cancelled, tickets refunded')
      loadDraws()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Cancel failed')
    }
  }

  const cardStyle = {
    background: 'linear-gradient(145deg, #111827 0%, #1f2937 100%)',
    border: '1px solid #374151',
    borderRadius: '16px',
    color: '#f3f4f6'
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <Card
        title={<span style={{ color: '#f3f4f6' }}>Daily Bingo Draws</span>}
        headStyle={{ borderBottom: '1px solid #374151' }}
        style={cardStyle}
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
              style={{ borderRadius: '8px', background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', border: 'none', fontWeight: 600 }}
            >
              Create Draw
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadDraws} style={{ borderRadius: '8px', background: 'transparent', borderColor: '#4b5563', color: '#9ca3af' }}>
              Refresh
            </Button>
          </Space>
        }
        loading={loading}
      >
        <Table
          rowKey="id"
          dataSource={draws}
          size="small"
          pagination={{ pageSize: 8 }}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (n) => <span style={{ fontWeight: 600, color: '#f9fafb' }}>{n}</span> },
            { title: 'Price', dataIndex: 'ticket_price', render: (v: any) => <span style={{ color: '#34d399', fontWeight: 600 }}>₹{Number(v).toFixed(0)}</span> },
            {
              title: 'Prize Tiers',
              dataIndex: 'prize_tiers',
              render: (tiers: any[]) => (
                <Space wrap size={4}>
                  {(tiers || []).map((t, i) => (
                    <Tag key={i} color="gold" style={{ fontWeight: 'bold', fontSize: 10 }}>
                      {t.match_type.replace('_', ' ')}: {t.multiplier}x
                    </Tag>
                  ))}
                </Space>
              )
            },
            { title: 'Sold', dataIndex: 'ticket_count', render: (v) => <span style={{ fontWeight: 'bold' }}>{v || 0}</span> },
            { title: 'Called', dataIndex: 'called_numbers', render: (v: any[]) => `${(v || []).length}/90` },
            { title: 'Draw Time', dataIndex: 'draw_time', render: (v: string) => dayjs(v).format('DD MMM YY · hh:mm A') },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => <Tag color={s === 'settled' ? 'default' : s === 'calling' ? 'processing' : s === 'cancelled' ? 'error' : 'success'} style={{ textTransform: 'uppercase', fontWeight: 'bold' }}>{s}</Tag>
            },
            { title: 'Paid Out', dataIndex: 'total_paid', render: (v) => <span style={{ color: '#34d399' }}>₹{Number(v || 0).toFixed(0)}</span> },
            {
              title: 'Action',
              render: (_: any, d: any) => d.status === 'open' ? (
                <Popconfirm title="Cancel Draw" description="Refund all tickets and cancel this draw?" onConfirm={() => cancelDraw(d.id)} okText="Cancel Draw" cancelText="Keep">
                  <Button danger size="small">Cancel</Button>
                </Popconfirm>
              ) : null
            },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title="Create Daily Bingo Draw"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create Draw"
      >
        <Form form={form} layout="vertical" onFinish={create} style={{ marginTop: '16px' }}>
          <Form.Item name="name" label="Draw Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., Evening Bingo" />
          </Form.Item>
          <Form.Item name="ticket_price" label="Ticket Price (₹)" rules={[{ required: true }]} initialValue={10}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Prize Tiers" required tooltip="Multiplier applies per tier, cumulative — a Full House winner also collects One Line and Two Lines.">
            <Form.List name="prize_tiers" initialValue={[
              { match_type: 'one_line', multiplier: 5 },
              { match_type: 'two_lines', multiplier: 15 },
              { match_type: 'full_house', multiplier: 100 },
            ]}>
              {(fields) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                      <Form.Item {...restField} name={[name, 'match_type']} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                        <Select style={{ width: 160 }} options={[
                          { value: 'one_line', label: 'One Line' },
                          { value: 'two_lines', label: 'Two Lines' },
                          { value: 'full_house', label: 'Full House' },
                        ]} />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'multiplier']} rules={[{ required: true, message: 'Missing multiplier' }]} style={{ marginBottom: 0 }}>
                        <InputNumber min={1} placeholder="Multiplier" style={{ width: 140 }} formatter={(v) => `${v}x`} />
                      </Form.Item>
                    </Space>
                  ))}
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true, message: 'Please select draw time' }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Add the Daily Lottery tab to `Lottery.tsx`**

Find:

```tsx
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'
import LotteryScratch from './LotteryScratch'
```

Replace with:

```tsx
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'
import LotteryScratch from './LotteryScratch'
import LotteryBingo from './LotteryBingo'
```

Find:

```tsx
        {
          key: 'scratch',
          label: 'Instant Lottery',
          children: <LotteryScratch />,
        },
      ]}
    />
  )
}
```

Replace with:

```tsx
        {
          key: 'scratch',
          label: 'Instant Lottery',
          children: <LotteryScratch />,
        },
        {
          key: 'bingo',
          label: 'Daily Lottery',
          children: <LotteryBingo />,
        },
      ]}
    />
  )
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/games/LotteryBingo.tsx admin-panel/src/pages/games/Lottery.tsx
git commit -m "feat(lottery-bingo-admin): Daily Lottery tab"
```

---

### Task 5: Bingo engine service — scaffold + WS auth skeleton

**Files:**
- Create: `services/game-engines/bingo/package.json`
- Create: `services/game-engines/bingo/tsconfig.json`
- Create: `services/game-engines/bingo/src/index.ts`
- Modify: `ecosystem.config.js` — add the `teen-bingo` pm2 entry
- Modify: `infra/nginx/game.myonlinejoker.com.conf` — add the `/ws/bingo` location + upstream

**Interfaces:**
- Produces: a running Fastify+WS service on port 3006, `/health` endpoint, `/ws/bingo` WebSocket endpoint with JWT-at-handshake auth (no game logic yet — Task 7 adds the scheduler/calling loop on top of this skeleton).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "teen-bingo-engine",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "@fastify/jwt": "^8.0.1",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "pg": "^8.12.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/pg": "^8.11.6",
    "@types/ws": "^8.5.12",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `src/index.ts` (scaffold + WS auth, no game loop yet)**

```ts
import Fastify from 'fastify'
import { WebSocketServer, WebSocket } from 'ws'
import { Pool } from 'pg'
import 'dotenv/config'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })

app.get('/health', async () => ({ status: 'ok', service: 'bingo-engine' }))

type BingoConn = { ws: WebSocket; userId: string; drawId: string }
const conns = new Set<BingoConn>()

function send(ws: WebSocket, event: string, data: any) {
  if (ws.readyState !== WebSocket.OPEN) return
  try { ws.send(JSON.stringify({ event, data })) } catch { /* connection closing */ }
}

function broadcastToDraw(drawId: string, event: string, data: any) {
  for (const c of conns) {
    if (c.drawId === drawId) send(c.ws, event, data)
  }
}

async function start() {
  await app.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET! })
  await app.register(require('@fastify/cors'), { origin: true })

  const httpServer = app.server
  await app.ready()

  const wss = new WebSocketServer({ server: httpServer, path: '/ws/bingo' })

  wss.on('connection', (ws: WebSocket, req) => {
    let userId: string, drawId: string
    try {
      const u = new URL(req.url || '', 'http://localhost')
      const token = u.searchParams.get('token') || req.headers.authorization?.split(' ')[1]
      drawId = u.searchParams.get('draw_id') || ''
      if (!token || !drawId) { ws.close(4001, 'Missing token or draw_id'); return }
      const payload = (app.jwt as any).verify(token) as any
      userId = payload.sub
    } catch {
      ws.close(4001, 'Invalid token')
      return
    }

    const conn: BingoConn = { ws, userId, drawId }
    conns.add(conn)

    db.query('SELECT status, called_numbers FROM lottery_bingo_draws WHERE id = $1', [drawId])
      .then(res => {
        if (res.rows.length) {
          send(ws, 'bingo:draw_state', { status: res.rows[0].status, called_numbers: res.rows[0].called_numbers })
        }
      })
      .catch(() => {})

    ws.on('close', () => conns.delete(conn))
  })

  const port = Number(process.env.PORT || 3006)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[bingo-engine] listening on ${port}`)
}

start().catch(err => {
  console.error('[bingo-engine] failed to start', err)
  process.exit(1)
})

export { broadcastToDraw }
```

- [ ] **Step 4: Add the `teen-bingo` pm2 entry to `ecosystem.config.js`**

Find:

```js
    {
      name: 'teen-aviator',
      cwd: `${BASE}/game-engines/aviator`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/aviator'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: NODE_OPTS,
    },
```

Replace with:

```js
    {
      name: 'teen-aviator',
      cwd: `${BASE}/game-engines/aviator`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/aviator'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: NODE_OPTS,
    },
    {
      name: 'teen-bingo',
      cwd: `${BASE}/game-engines/bingo`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/bingo'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: NODE_OPTS,
    },
```

- [ ] **Step 5: Add the nginx upstream + `/ws/bingo` location**

Find:

```nginx
upstream aviator_backend   { server 127.0.0.1:3005; keepalive 16; }
```

Replace with:

```nginx
upstream aviator_backend   { server 127.0.0.1:3005; keepalive 16; }
upstream bingo_backend     { server 127.0.0.1:3006; keepalive 16; }
```

Find:

```nginx
    # ── WebSocket: Aviator Engine (longer prefix wins) ──
    location /ws/aviator {
        proxy_pass http://aviator_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass_header Upgrade;
        proxy_pass_header Connection;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
```

Replace with:

```nginx
    # ── WebSocket: Aviator Engine (longer prefix wins) ──
    location /ws/aviator {
        proxy_pass http://aviator_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass_header Upgrade;
        proxy_pass_header Connection;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # ── WebSocket: Bingo Engine (longer prefix wins) ──
    location /ws/bingo {
        proxy_pass http://bingo_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass_header Upgrade;
        proxy_pass_header Connection;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
```

- [ ] **Step 6: Verify the new service compiles**

Run: `cd services/game-engines/bingo && npm install && npx tsc --noEmit`
Expected: no errors. (`npm install` is expected to take a minute — this is a brand-new package.)

- [ ] **Step 7: Commit**

```bash
git add services/game-engines/bingo/package.json services/game-engines/bingo/tsconfig.json services/game-engines/bingo/src/index.ts ecosystem.config.js infra/nginx/game.myonlinejoker.com.conf
git commit -m "feat(lottery-bingo): scaffold bingo-engine service + /ws/bingo infra"
```

---

### Task 6: Bingo engine — card generation + tier-checking (mirrored helper)

**Files:**
- Create: `services/game-engines/bingo/src/bingo-logic.ts`

**Interfaces:**
- Produces: `generateBingoCard()`, `checkNewTiers()`, `BingoTier` type — MUST be byte-identical to `services/core-api-service/src/helpers/bingo.ts` from Task 2 (this engine is a separate deployable service and cannot import across service boundaries, so the logic is duplicated intentionally; keeping the two copies identical is a correctness requirement, not a style preference — a card the engine "sees" as complete must match what the purchase-time helper generated).

- [ ] **Step 1: Copy the helper verbatim**

Copy the ENTIRE content of `services/core-api-service/src/helpers/bingo.ts` (as written in Task 2, Step 1) into this new file, unchanged.

- [ ] **Step 2: Verify it compiles**

Run: `cd services/game-engines/bingo && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Byte-diff the two files to confirm they're identical**

Run: `diff services/core-api-service/src/helpers/bingo.ts services/game-engines/bingo/src/bingo-logic.ts`
Expected: no output (files identical). If there's any difference, fix it before committing — this is not a "close enough" check.

- [ ] **Step 4: Commit**

```bash
git add services/game-engines/bingo/src/bingo-logic.ts
git commit -m "feat(lottery-bingo): mirror card-generation/tier-checking logic into bingo-engine"
```

---

### Task 7: Bingo engine — scheduler, live calling, settlement

**Files:**
- Modify: `services/game-engines/bingo/src/index.ts`

**Interfaces:**
- Consumes: `generateBingoCard`/`checkNewTiers`/`BingoTier` from `./bingo-logic` (Task 6).
- Produces: the complete game loop — this is the last piece the engine needs; nothing downstream depends on new interfaces from this task (Task 9's mobile page is driven purely by the WS events this task defines: `bingo:draw_state`, `bingo:number_called`, `bingo:tier_won`, `bingo:draw_complete`).

- [ ] **Step 1: Add the scheduler and calling loop**

Find (in `services/game-engines/bingo/src/index.ts`):

```ts
import Fastify from 'fastify'
import { WebSocketServer, WebSocket } from 'ws'
import { Pool } from 'pg'
import 'dotenv/config'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })
```

Replace with:

```ts
import Fastify from 'fastify'
import { WebSocketServer, WebSocket } from 'ws'
import { Pool } from 'pg'
import 'dotenv/config'
import { generateBingoCard, checkNewTiers, BingoTier } from './bingo-logic'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })

const CALL_INTERVAL_MS = 3500
const SCHEDULER_POLL_MS = 10_000
const WALLET_URL = process.env.WALLET_SERVICE_URL || 'http://127.0.0.1:3003'
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || ''

async function creditPrize(userId: string, amount: number, referenceId: string, idempotencyKey: string) {
  if (amount <= 0) return
  try {
    await fetch(`${WALLET_URL}/internal/wallet/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify({ user_id: userId, amount, type: 'game_credit', reference_id: referenceId, idempotency_key: idempotencyKey }),
    })
  } catch (e) {
    console.error(`[bingo-engine] credit failed for ticket ${referenceId}`, e)
  }
}

// One entry per draw currently in the 'calling' phase in this process.
type ActiveDraw = { sequence: number[]; calledCount: number; timer: NodeJS.Timeout }
const activeDraws = new Map<string, ActiveDraw>()

function shuffle90(): number[] {
  const nums = Array.from({ length: 90 }, (_, i) => i + 1)
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[nums[i], nums[j]] = [nums[j], nums[i]]
  }
  return nums
}

async function startCalling(drawId: string) {
  const sequence = shuffle90()
  await db.query(`UPDATE lottery_bingo_draws SET status = 'calling' WHERE id = $1`, [drawId])
  broadcastToDraw(drawId, 'bingo:draw_state', { status: 'calling', called_numbers: [] })

  const entry: ActiveDraw = {
    sequence,
    calledCount: 0,
    timer: setInterval(() => callNext(drawId), CALL_INTERVAL_MS),
  }
  activeDraws.set(drawId, entry)
}

async function callNext(drawId: string) {
  const entry = activeDraws.get(drawId)
  if (!entry) return

  const number = entry.sequence[entry.calledCount]
  entry.calledCount++
  const calledSoFar = entry.sequence.slice(0, entry.calledCount)

  await db.query(`UPDATE lottery_bingo_draws SET called_numbers = $1 WHERE id = $2`, [JSON.stringify(calledSoFar), drawId])
  broadcastToDraw(drawId, 'bingo:number_called', { number, called_numbers: calledSoFar })

  const ticketsRes = await db.query(`SELECT * FROM lottery_bingo_tickets WHERE draw_id = $1`, [drawId])
  for (const t of ticketsRes.rows) {
    const alreadyWon: BingoTier[] = t.tiers_won || []
    const newTiers = checkNewTiers(t.card, calledSoFar, alreadyWon)
    if (newTiers.length) {
      const updatedTiers = [...alreadyWon, ...newTiers]
      await db.query(`UPDATE lottery_bingo_tickets SET tiers_won = $1 WHERE id = $2`, [JSON.stringify(updatedTiers), t.id])
      broadcastToDraw(drawId, 'bingo:tier_won', { ticket_id: t.id, user_id: t.user_id, new_tiers: newTiers })
    }
  }

  if (entry.calledCount >= 90) {
    clearInterval(entry.timer)
    activeDraws.delete(drawId)
    await settleDraw(drawId)
  }
}

async function settleDraw(drawId: string) {
  const drawRes = await db.query(`SELECT * FROM lottery_bingo_draws WHERE id = $1`, [drawId])
  const draw = drawRes.rows[0]
  const tiers: { match_type: BingoTier; multiplier: number }[] = draw.prize_tiers || []
  const ticketPrice = Number(draw.ticket_price)

  const ticketsRes = await db.query(`SELECT * FROM lottery_bingo_tickets WHERE draw_id = $1`, [drawId])
  for (const t of ticketsRes.rows) {
    const tiersWon: BingoTier[] = t.tiers_won || []
    let prize = 0
    for (const matchType of tiersWon) {
      const tier = tiers.find(x => x.match_type === matchType)
      if (tier) prize += ticketPrice * Number(tier.multiplier)
    }
    if (prize > 0) {
      await db.query(`UPDATE lottery_bingo_tickets SET prize = $1 WHERE id = $2`, [prize, t.id])
      await creditPrize(t.user_id, prize, t.id, `bingo_payout_${t.id}`)
    }
  }

  await db.query(`UPDATE lottery_bingo_draws SET status = 'settled' WHERE id = $1`, [drawId])
  broadcastToDraw(drawId, 'bingo:draw_complete', { draw_id: drawId })
}

async function scheduleSweep() {
  try {
    const dueRes = await db.query(
      `SELECT id FROM lottery_bingo_draws WHERE status = 'open' AND draw_time <= NOW()`,
    )
    for (const row of dueRes.rows) {
      if (!activeDraws.has(row.id)) await startCalling(row.id)
    }
  } catch (e) {
    console.error('[bingo-engine] scheduler sweep failed', e)
  }
}
```

- [ ] **Step 2: Start the scheduler and wire the WS auth handler into the same room registry**

Find:

```ts
  const port = Number(process.env.PORT || 3006)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[bingo-engine] listening on ${port}`)
}
```

Replace with:

```ts
  setInterval(scheduleSweep, SCHEDULER_POLL_MS)
  scheduleSweep()

  const port = Number(process.env.PORT || 3006)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[bingo-engine] listening on ${port}`)
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd services/game-engines/bingo && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add services/game-engines/bingo/src/index.ts
git commit -m "feat(lottery-bingo): scheduler, live number-calling, automatic settlement"
```

---

### Task 8: Mobile — `BingoSocketService`

**Files:**
- Modify: `mobile/lib/core/socket/socket_service.dart` — add a new `BingoSocketService` class mirroring `AviatorSocketService`

**Interfaces:**
- Produces: `BingoSocketService()` singleton with `connect(String drawId)`, `disconnect()`, `on(String event)`, `emit(String event, [data])` — Task 9's Live Draw screen depends on this exact API shape.

- [ ] **Step 1: Add the class**

Find (the very end of the file, after the closing brace of `AviatorSocketService`):

```dart
  void emit(String event, [dynamic data]) {
    _channel?.sink.add(json.encode({'event': event, 'data': data ?? {}}));
  }

  void disconnect() {
    _manuallyClosed = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close(ws_status.normalClosure);
    _channel = null;
    _connecting = false;
    for (final c in _controllers.values) {
      c.close();
    }
    _controllers.clear();
  }
}
```

Replace with:

```dart
  void emit(String event, [dynamic data]) {
    _channel?.sink.add(json.encode({'event': event, 'data': data ?? {}}));
  }

  void disconnect() {
    _manuallyClosed = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close(ws_status.normalClosure);
    _channel = null;
    _connecting = false;
    for (final c in _controllers.values) {
      c.close();
    }
    _controllers.clear();
  }
}

class BingoSocketService {
  static final BingoSocketService _instance = BingoSocketService._internal();
  factory BingoSocketService() => _instance;
  BingoSocketService._internal();

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  final _controllers = <String, StreamController<dynamic>>{};
  bool _manuallyClosed = false;
  bool _connecting = false;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  String? _drawId;

  String get _base {
    var b = AppConfig.socketUrl.trim();
    if (b.startsWith('https://')) b = 'wss://${b.substring(8)}';
    else if (b.startsWith('http://')) b = 'ws://${b.substring(7)}';
    return b.replaceAll(RegExp(r'/+$'), '');
  }

  Future<void> connect(String drawId) async {
    _manuallyClosed = false;
    _drawId = drawId;
    if (_channel != null || _connecting) return;
    _connecting = true;
    if (_reconnectAttempts >= 20) _reconnectAttempts = 0;
    final token = await SocketService()._freshToken();
    if (token == null || token.isEmpty) {
      _connecting = false;
      _scheduleReconnect();
      return;
    }
    final uri = Uri.parse('$_base/ws/bingo?token=${Uri.encodeComponent(token)}&draw_id=${Uri.encodeComponent(drawId)}');
    try {
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;
      _sub = _channel!.stream.listen(
        (raw) {
          if (raw is! String) return;
          try {
            final msg = json.decode(raw) as Map<String, dynamic>;
            final event = msg['event'] as String?;
            if (event != null) _controllers[event]?.add(msg['data']);
          } catch (_) {}
        },
        onError: (_) => _onClosed(),
        onDone: () => _onClosed(),
        cancelOnError: true,
      );
      _connecting = false;
      _reconnectAttempts = 0;
    } catch (e) {
      print('[BingoSocket] connect error: $e');
      _channel = null;
      _connecting = false;
      _scheduleReconnect();
    }
  }

  void _onClosed() {
    final code = _channel?.closeCode;
    _sub?.cancel();
    _sub = null;
    _channel = null;
    _connecting = false;
    if (code == 4001) {
      SocketService().markForceRefresh();
      print('[BingoSocket] close 4001 — will force token refresh');
    }
    if (!_manuallyClosed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    if (_reconnectAttempts >= 20 || _drawId == null) {
      print('[BingoSocket] max reconnect attempts reached — giving up');
      return;
    }
    final delaySec = [2, 2, 4, 4, 8, 8, 16][_reconnectAttempts.clamp(0, 6)];
    _reconnectAttempts++;
    _reconnectTimer = Timer(Duration(seconds: delaySec), () => connect(_drawId!));
  }

  Stream<dynamic> on(String event) {
    _controllers[event] ??= StreamController<dynamic>.broadcast();
    return _controllers[event]!.stream;
  }

  void emit(String event, [dynamic data]) {
    _channel?.sink.add(json.encode({'event': event, 'data': data ?? {}}));
  }

  void disconnect() {
    _manuallyClosed = true;
    _drawId = null;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close(ws_status.normalClosure);
    _channel = null;
    _connecting = false;
    for (final c in _controllers.values) {
      c.close();
    }
    _controllers.clear();
  }
}
```

- [ ] **Step 2: Verify it analyzes clean**

Run: `cd mobile && dart analyze lib/core/socket/socket_service.dart`
Expected: `No issues found!`

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/core/socket/socket_service.dart
git commit -m "feat(lottery-bingo-mobile): BingoSocketService for /ws/bingo"
```

---

### Task 9: Mobile — Daily Lottery page (Browse/My Tickets/History + Live Draw)

**Files:**
- Create: `mobile/lib/features/games/betting/lottery_bingo_page.dart`
- Modify: `mobile/lib/features/games/betting/lottery_page.dart` — replace the Daily "Coming Soon" tap target with navigation to the new page

**Interfaces:**
- Consumes: `/api/betting/lottery/bingo/draws`, `/api/betting/lottery/bingo/buy`, `/api/betting/lottery/bingo/my-tickets` (Task 2), `BingoSocketService` (Task 8), `/api/wallet/balance` (pre-existing).
- Produces: `LotteryBingoPage()` — Task 9's own modification to `lottery_page.dart` is the only consumer.

- [ ] **Step 1: Create the file**

```dart
import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../shared/theme/app_theme.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Daily Lottery — 90-ball bingo: Browse / My Tickets / History
// ─────────────────────────────────────────────────────────────────────────────
class LotteryBingoPage extends StatefulWidget {
  const LotteryBingoPage({super.key});

  @override
  State<LotteryBingoPage> createState() => _LotteryBingoPageState();
}

class _LotteryBingoPageState extends State<LotteryBingoPage> with SingleTickerProviderStateMixin {
  late final TabController _tab;
  List<dynamic> _draws = [];
  List<dynamic> _myTickets = [];
  bool _loading = true;
  bool _myLoading = false;
  double _balance = 0;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging && _tab.index == 1 && _myTickets.isEmpty) _loadMyTickets();
    });
    _loadDraws();
    _loadBalance();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }

  @override
  void dispose() {
    _tab.dispose();
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _loadDraws() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/bingo/draws');
      if (!mounted) return;
      setState(() { _draws = res.data['draws'] ?? []; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance = double.tryParse(res.data['real_balance'].toString()) ?? 0);
    } catch (_) {}
  }

  Future<void> _loadMyTickets() async {
    setState(() => _myLoading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/bingo/my-tickets');
      if (!mounted) return;
      setState(() { _myTickets = res.data['tickets'] ?? []; _myLoading = false; });
    } catch (_) {
      if (mounted) setState(() => _myLoading = false);
    }
  }

  Future<void> _buy(dynamic draw) async {
    try {
      final res = await ApiClient().dio.post('/api/betting/lottery/bingo/buy', data: {'draw_id': draw['id']});
      if (!mounted) return;
      _loadBalance();
      _loadDraws();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Ticket purchased! Check My Tickets for your card.'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
      ));
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Purchase failed — please try again'),
        backgroundColor: AppColors.red,
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  String _countdown(DateTime dt) {
    final diff = dt.difference(DateTime.now());
    if (diff.isNegative) return 'Starting…';
    final h = diff.inHours, m = diff.inMinutes % 60, s = diff.inSeconds % 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: const Text('DAILY LOTTERY',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: 1.2, color: AppColors.goldLight)),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
            ),
            child: Text('₹${_balance.toStringAsFixed(0)}',
                style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 12)),
          ),
        ],
        bottom: TabBar(
          controller: _tab,
          indicatorColor: AppColors.gold,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
          tabs: const [Tab(text: 'Browse'), Tab(text: 'My Tickets'), Tab(text: 'History')],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [_browseTab(), _myTicketsTab(), _historyTab()],
      ),
    );
  }

  Widget _browseTab() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    final open = _draws.where((d) => d['status'] == 'open').toList();
    final calling = _draws.where((d) => d['status'] == 'calling').toList();
    if (open.isEmpty && calling.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.grid_on_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No bingo draws open right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadDraws,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: [...calling, ...open].map<Widget>((d) => _drawCard(d)).toList(),
      ),
    );
  }

  Widget _drawCard(dynamic d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
    final isCalling = d['status'] == 'calling';
    final tiers = (d['prize_tiers'] as List?) ?? [];

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: isCalling ? AppColors.gold : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(d['name'] ?? 'Bingo Draw',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 15)),
              ),
              if (isCalling)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: AppColors.gold.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
                  child: const Text('LIVE NOW', style: TextStyle(color: AppColors.gold, fontSize: 10, fontWeight: FontWeight.w900)),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text('₹${price.toStringAsFixed(0)} per ticket',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: tiers.map<Widget>((t) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(6)),
              child: Text('${(t['match_type'] as String).replaceAll('_', ' ')}: ${t['multiplier']}x',
                  style: const TextStyle(color: AppColors.goldLight, fontSize: 10, fontWeight: FontWeight.w700)),
            )).toList(),
          ),
          const SizedBox(height: 12),
          if (drawTime != null && !isCalling)
            Text('Starts in ${_countdown(drawTime)}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          Row(
            children: [
              if (!isCalling)
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => _buy(d),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      foregroundColor: Colors.black,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Buy Ticket', style: TextStyle(fontWeight: FontWeight.w900)),
                  ),
                ),
              if (isCalling) ...[
                const SizedBox(width: 0),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(
                      builder: (_) => _LiveDrawScreen(draw: d),
                    )),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.gold,
                      side: const BorderSide(color: AppColors.gold),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Watch Live', style: TextStyle(fontWeight: FontWeight.w900)),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _myTicketsTab() {
    if (_myLoading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_myTickets.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long_outlined, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No bingo tickets yet', style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadMyTickets,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _myTickets.length,
        itemBuilder: (_, i) => _ticketRow(_myTickets[i]),
      ),
    );
  }

  Widget _ticketRow(dynamic t) {
    final drawStatus = t['draw_status']?.toString() ?? 'open';
    final tiersWon = (t['tiers_won'] as List?) ?? [];
    final prize = double.tryParse(t['prize']?.toString() ?? '0') ?? 0;
    final card = (t['card'] as List?) ?? [];
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: prize > 0 ? AppColors.green.withValues(alpha: 0.06) : AppColors.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: prize > 0 ? AppColors.green.withValues(alpha: 0.4) : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(t['draw_name'] ?? 'Bingo', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13.5))),
              Text(drawStatus, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 8),
          _miniCard(card),
          if (tiersWon.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, children: tiersWon.map<Widget>((tier) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: AppColors.green.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
              child: Text('$tier'.replaceAll('_', ' '), style: const TextStyle(color: AppColors.green, fontSize: 10, fontWeight: FontWeight.w700)),
            )).toList()),
          ],
          if (prize > 0) ...[
            const SizedBox(height: 8),
            Text('Won ₹${prize.toStringAsFixed(0)}', style: const TextStyle(color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 14)),
          ],
        ],
      ),
    );
  }

  Widget _miniCard(List card) {
    return Column(
      children: card.map<Widget>((row) {
        final cells = (row as List);
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: cells.map<Widget>((cell) => Container(
            width: 22, height: 22,
            margin: const EdgeInsets.all(1),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: cell == null ? Colors.transparent : Colors.black.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(3),
            ),
            child: cell == null ? null : Text('$cell', style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w700)),
          )).toList(),
        );
      }).toList(),
    );
  }

  Widget _historyTab() {
    final settled = _draws.where((d) => d['status'] == 'settled').toList();
    if (settled.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No settled draws yet', style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
      itemCount: settled.length,
      itemBuilder: (_, i) => _drawCard(settled[i]),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Live Draw Screen — connects to /ws/bingo, shows numbers as they're called
// ─────────────────────────────────────────────────────────────────────────────
class _LiveDrawScreen extends StatefulWidget {
  const _LiveDrawScreen({required this.draw});
  final dynamic draw;

  @override
  State<_LiveDrawScreen> createState() => _LiveDrawScreenState();
}

class _LiveDrawScreenState extends State<_LiveDrawScreen> {
  final List<int> _calledNumbers = [];
  String _status = 'calling';
  StreamSubscription? _stateSub, _numberSub, _completeSub, _tierSub;

  @override
  void initState() {
    super.initState();
    final drawId = widget.draw['id'] as String;
    BingoSocketService().connect(drawId);
    _stateSub = BingoSocketService().on('bingo:draw_state').listen((data) {
      if (!mounted) return;
      setState(() {
        _status = data['status'] ?? 'calling';
        _calledNumbers
          ..clear()
          ..addAll((data['called_numbers'] as List? ?? []).map((n) => n as int));
      });
    });
    _numberSub = BingoSocketService().on('bingo:number_called').listen((data) {
      if (!mounted) return;
      setState(() {
        _calledNumbers
          ..clear()
          ..addAll((data['called_numbers'] as List? ?? []).map((n) => n as int));
      });
    });
    _completeSub = BingoSocketService().on('bingo:draw_complete').listen((_) {
      if (!mounted) return;
      setState(() => _status = 'settled');
    });
    _tierSub = BingoSocketService().on('bingo:tier_won').listen((data) {
      if (!mounted) return;
      final tiers = (data['new_tiers'] as List? ?? []).join(', ').replaceAll('_', ' ');
      if (tiers.isEmpty) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('🎉 A ticket just won: $tiers!'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ));
    });
  }

  @override
  void dispose() {
    _stateSub?.cancel();
    _numberSub?.cancel();
    _completeSub?.cancel();
    _tierSub?.cancel();
    BingoSocketService().disconnect();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lastCalled = _calledNumbers.isNotEmpty ? _calledNumbers.last : null;
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: Text(widget.draw['name'] ?? 'Live Draw', style: const TextStyle(color: Colors.white, fontSize: 15)),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            if (_status == 'settled')
              const Text('Draw Complete!', style: TextStyle(color: AppColors.gold, fontSize: 20, fontWeight: FontWeight.w900))
            else ...[
              const Text('LAST NUMBER CALLED', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, letterSpacing: 2)),
              const SizedBox(height: 12),
              Container(
                width: 100, height: 100,
                decoration: BoxDecoration(color: AppColors.gold, borderRadius: BorderRadius.circular(50)),
                alignment: Alignment.center,
                child: Text(lastCalled?.toString() ?? '-',
                    style: const TextStyle(color: Colors.black, fontSize: 36, fontWeight: FontWeight.w900)),
              ),
            ],
            const SizedBox(height: 20),
            Text('${_calledNumbers.length} / 90 numbers called',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
            const SizedBox(height: 20),
            Expanded(
              child: SingleChildScrollView(
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: _calledNumbers.map((n) => Container(
                    width: 32, height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: AppColors.cardBg, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.border)),
                    child: Text('$n', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                  )).toList(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Wire up the Daily tap target in `lottery_page.dart`**

Find:

```dart
import 'package:flutter/material.dart';
import '../../../shared/theme/app_theme.dart';
import 'lottery_draws_page.dart';
import 'lottery_scratch_page.dart';
```

Replace with:

```dart
import 'package:flutter/material.dart';
import '../../../shared/theme/app_theme.dart';
import 'lottery_draws_page.dart';
import 'lottery_scratch_page.dart';
import 'lottery_bingo_page.dart';
```

Find:

```dart
          _typeCard(
            context,
            title: 'Daily Lottery',
            subtitle: 'Card/Bingo — Coming Soon',
            icon: Icons.calendar_today_rounded,
            color: Colors.cyanAccent,
            onTap: () => _openComingSoon(context, 'Daily Lottery (Card/Bingo)'),
          ),
```

Replace with:

```dart
          _typeCard(
            context,
            title: 'Daily Lottery',
            subtitle: '90-ball bingo — live number calling',
            icon: Icons.calendar_today_rounded,
            color: Colors.cyanAccent,
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const LotteryBingoPage())),
          ),
```

- [ ] **Step 3: Verify the whole project analyzes clean**

Run: `cd mobile && dart analyze lib/`
Expected: no errors anywhere; only the same pre-existing unrelated warnings documented in prior lottery tasks (`ludo_game_page.dart` x2, `wallet_page.dart`, `location_consent_service.dart`). No issues in any of the lottery files including the new `lottery_bingo_page.dart`.

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/features/games/betting/lottery_bingo_page.dart mobile/lib/features/games/betting/lottery_page.dart
git commit -m "feat(lottery-bingo-mobile): Daily Lottery page with live draw screen"
```

---

### Task 10: End-to-end verification against the live VPS

**Files:** none (deployment + manual verification only)

**Interfaces:** none — this task exercises the full stack built in Tasks 1-9.

- [ ] **Step 1: Push and pull onto the VPS**

Run locally: `git push origin feature/admin-responsive`
Run on VPS: `cd /opt/teen-prod && git status --short` — expect only the known pre-existing untracked files.
Run on VPS: `git fetch origin && git reset --hard origin/feature/admin-responsive`

- [ ] **Step 2: Run the migration**

Run on VPS: `docker exec -i teen_postgres psql -U teen -d teen_db < /opt/teen-prod/infra/db/migrations/075_lottery_bingo.sql`
Expected: `BEGIN`, `CREATE TABLE` ×2, `CREATE INDEX` ×3, `COMMIT`.

- [ ] **Step 3: Set up and start the new bingo-engine service**

Run on VPS: `mkdir -p /opt/teen-prod/services/game-engines/bingo && cd /opt/teen-prod/services/game-engines/bingo && npm install --no-audit --no-fund && npm run build`
Run on VPS: create `/opt/teen-prod/services/game-engines/bingo/.env` with `DATABASE_URL`, `JWT_SECRET` (same value as `core-api-service`'s, since tokens are shared across services), `WALLET_SERVICE_URL=http://127.0.0.1:3003`, `INTERNAL_SERVICE_KEY` (same value used elsewhere), `PORT=3006` — copy the pattern/values from `services/game-engines/aviator/.env` on the VPS (same JWT_SECRET and INTERNAL_SERVICE_KEY across all services).
Run on VPS: `cd /opt/teen-prod && pm2 start ecosystem.config.js --only teen-bingo` (first-time start; subsequent deploys use `pm2 restart teen-bingo`)
Expected: build succeeds with no `tsc` errors, `pm2 status` shows `teen-bingo` `online`.

- [ ] **Step 4: Rebuild and restart the existing backend services, redeploy the admin panel**

Run on VPS: `cd /opt/teen-prod/services/core-api-service && npm run build && pm2 restart teen-core-api`
Run on VPS: `cd /opt/teen-prod/services/admin-service && npm run build && pm2 restart teen-admin-svc`
Run on VPS: `cd /opt/teen-prod/admin-panel && npm install --no-audit --no-fund && VITE_API_BASE_URL='' npm run build -- --base=/admin/`
Run on VPS: `rm -rf /home/admin/web/game.myonlinejoker.com/public_html/admin/* && cp -r /opt/teen-prod/admin-panel/dist/* /home/admin/web/game.myonlinejoker.com/public_html/admin/ && chown -R admin:admin /home/admin/web/game.myonlinejoker.com/public_html/admin/`

- [ ] **Step 5: Reload nginx with the new `/ws/bingo` location**

Run on VPS: `nginx -t` (syntax check first) then `systemctl reload nginx` (or the equivalent reload command already used in this environment).
Expected: `nginx -t` reports syntax OK, reload succeeds with no downtime for existing routes.

- [ ] **Step 6: Verify health**

Run on VPS: `curl -s http://127.0.0.1:3001/health`, `curl -s http://127.0.0.1:3006/health` (new bingo engine) — both expect `{"status":"ok",...}`.
Run: `curl -s -o /dev/null -w '%{http_code}\n' https://game.myonlinejoker.com/admin/` — expect `200`.

- [ ] **Step 7: Create a test draw scheduled ~1 minute out**

```bash
curl -s -X POST http://127.0.0.1:3001/internal/lottery/bingo/create -H 'Content-Type: application/json' -H 'x-internal-key: <INTERNAL_SERVICE_KEY>' -d '{"name":"Test Bingo","ticket_price":10,"draw_time":"<now + ~90 seconds, ISO8601>","prize_tiers":[{"match_type":"one_line","multiplier":5},{"match_type":"two_lines","multiplier":15},{"match_type":"full_house","multiplier":100}]}'
```
Expected: `{"success":true,"draw":{...}}`.

- [ ] **Step 8: Buy a few tickets, then watch the draw call live**

Using a real user JWT, buy 2-3 tickets:
```bash
curl -s -X POST http://127.0.0.1:3001/lottery/bingo/buy -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' -d '{"draw_id":"<draw id>"}'
```
Expected each time: `{"success":true,"ticket_id":"...","card":[[...],[...],[...]]}` — a 3×9 array, each row containing exactly 5 non-null numbers.

Wait until `draw_time` passes, then poll: `docker exec -i teen_postgres psql -U teen -d teen_db -c "SELECT status, jsonb_array_length(called_numbers) FROM lottery_bingo_draws WHERE id = '<draw id>';"` a few times over the next ~5 minutes — expect `status` to move `open` → `calling` → `settled`, and `jsonb_array_length(called_numbers)` to climb from 0 toward 90 roughly every 3-4 seconds.

Optionally verify the WS channel directly with a quick Node script using the `ws` package (`node -e "const WebSocket = require('ws'); ..."`) connecting to `ws://127.0.0.1:3006/ws/bingo?token=<token>&draw_id=<draw id>` and logging received messages — confirm `bingo:number_called` events arrive roughly every 3.5 seconds.

- [ ] **Step 9: Verify settlement**

After the draw reaches `status = 'settled'`:
```bash
docker exec -i teen_postgres psql -U teen -d teen_db -c "SELECT id, tiers_won, prize FROM lottery_bingo_tickets WHERE draw_id = '<draw id>';"
```
Expected: each ticket's `tiers_won` and `prize` reflect the actual called numbers against that ticket's card — spot-check at least one ticket by hand (pick a row from its `card`, confirm every non-null number in that row appears in the draw's final `called_numbers`, confirms `one_line` should be in `tiers_won`).

Check the buyer's `/api/wallet/balance` reflects the debit(s) and any prize credit(s), same style of before/after arithmetic check used in prior lottery verifications.

- [ ] **Step 10: Clean up the test draw**

```bash
docker exec -i teen_postgres psql -U teen -d teen_db -c "DELETE FROM lottery_bingo_tickets WHERE draw_id = '<draw id>'; DELETE FROM lottery_bingo_draws WHERE id = '<draw id>';"
```

- [ ] **Step 11: Build and hand off the mobile APK**

Run locally: `cd mobile && flutter build apk --release`
Expected: `√ Built build\app\outputs\flutter-apk\app-release.apk (...)`, no errors.

Report back to the user: migration ran clean, the new bingo-engine service is healthy and running under pm2, nginx reloaded with the new `/ws/bingo` route, a live test draw was verified end-to-end (ticket purchase → card generation → live number-calling over WebSocket → automatic tier detection → settlement → wallet credit), test draw cleaned up, new APK built. Ask the user to install the APK, create a real draw a couple minutes out via the admin panel, buy a ticket, and watch it call live before considering Daily Lottery fully shipped — this is the most novel and highest-risk piece of the three lottery mechanics (new service, new WS channel, timing-sensitive), so hands-on confirmation matters more here than for the earlier two.
