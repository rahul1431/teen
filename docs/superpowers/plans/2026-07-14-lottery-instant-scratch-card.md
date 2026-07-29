# Lottery Instant (Scratch Card) + Per-Type Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the mobile Lottery page from a flat 6-tab layout into a menu of 4 type cards (Daily/Instant/Weekly/Monthly), each opening its own page with local Browse/My Tickets/History sub-tabs; build the new Instant Lottery (Scratch Card) mechanic — an admin-configurable, standing catalog of scratch card products settled instantly via probability-based payouts (cash, an existing promo code, or no-win).

**Architecture:** Same three-layer structure (Postgres → Fastify `core-api-service`/`admin-service` → React admin panel / Flutter mobile app). Two new tables, purely additive — no changes to `lottery_draws`/`lottery_tickets`. Weekly/Monthly keep using the already-shipped Dedicated Number mechanic, just moved into the new per-type mobile page structure. Daily stays a "Coming Soon" placeholder (its own future spec). Coupon payouts reuse the existing `promo_codes` table/validation flow as-is — no new grant-tracking.

**Tech Stack:** PostgreSQL, Fastify + Zod + node-postgres (`core-api-service`, `admin-service`), React + antd (`admin-panel`), Flutter/Dart (`mobile`).

## Global Constraints

- Scratch card products are a standing catalog: `price` + a `payouts` array, `is_active` toggle, no `draw_time`/expiry.
- `payouts` entries: `{ outcome: 'cash' | 'coupon' | 'no_win', amount?: number, promo_code_id?: uuid, probability: number }`. All payouts for one product must sum to exactly 100 (validated server-side). `amount` required when `outcome = 'cash'`; `promo_code_id` (FK to the existing `promo_codes` table) required when `outcome = 'coupon'`.
- Purchases are settled instantly, independently, with no admin action: buy → debit → roll outcome via cumulative probability → settle (credit cash / return coupon code / record no-win) → return the fully-resolved result in one response. No separate "declare" step exists for this mechanic.
- Coupon wins return an existing `promo_codes.code` to the player — no new code generation, no new usage-tracking table. The existing `/wallet/promo/validate` and deposit-flow usage-limit enforcement apply unchanged when the player later uses it.
- Mobile: the Lottery page's top level becomes a menu of 4 type cards (Daily/Instant/Weekly/Monthly). Tapping Weekly or Monthly opens a per-type page with local Browse/My Tickets/History sub-tabs (not shared across types). Tapping Instant opens the new scratch card page (Browse/My Tickets only — History is folded into My Tickets for this type, since every purchase resolves immediately with no pending/settled distinction). Tapping Daily shows the existing "Coming Soon" placeholder inline (no navigation to a separate page needed for a placeholder).
- The scratch mobile reveal uses a real scratch/drag gesture (custom-painted scratch-off overlay), not a tap-to-flip — the result is already fully determined by the time the buy response returns; scratching is purely presentational.
- Verify each task by compiling (`npx tsc --noEmit` / `dart analyze`) and, where noted, direct `psql`/`curl` checks — this codebase has no automated test runner for these betting features; that's the established verification pattern here, follow it rather than introducing a new one.
- Design reference: `docs/superpowers/specs/2026-07-14-lottery-instant-scratch-card-design.md`.

---

### Task 1: Database migration — scratch card tables

**Files:**
- Create: `infra/db/migrations/074_lottery_scratch_cards.sql`

**Interfaces:**
- Produces: `lottery_scratch_products (id, name, price, payouts JSONB, is_active, created_at)`, `lottery_scratch_tickets (id, product_id, user_id, outcome, amount, promo_code_id, created_at)` — every later task's SQL depends on these exact column shapes.

- [ ] **Step 1: Write the migration file**

```sql
-- Instant Lottery (Scratch Card) mechanic: a standing, non-time-boxed
-- catalog of scratch card products. Each purchase is settled instantly
-- via an independent probability roll against the product's payout
-- table (cash, an existing promo_codes coupon, or no-win) — no draw
-- time, no admin declare step, unlike the Dedicated Number mechanic.
BEGIN;

CREATE TABLE lottery_scratch_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  price       NUMERIC(10,2) NOT NULL CHECK (price > 0),
  payouts     JSONB NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lottery_scratch_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES lottery_scratch_products(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  outcome        VARCHAR(16) NOT NULL CHECK (outcome IN ('cash', 'coupon', 'no_win')),
  amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  promo_code_id  UUID REFERENCES promo_codes(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_scratch_tickets_user ON lottery_scratch_tickets(user_id);
CREATE INDEX idx_lottery_scratch_tickets_product ON lottery_scratch_tickets(product_id);

COMMIT;
```

- [ ] **Step 2: Verify the migration is well-formed**

This environment has no local Postgres — static review only. Confirm:
- Wrapped in `BEGIN;`/`COMMIT;`.
- `lottery_scratch_products.payouts` is `JSONB NOT NULL` (no default — every product must be created with its payout table already validated by the backend, not a partial row).
- `lottery_scratch_tickets.outcome` has a `CHECK` matching exactly `'cash'`, `'coupon'`, `'no_win'`.
- Foreign keys reference `users(id)` and `promo_codes(id)` (both pre-existing tables — do not create them).

Full execution against the live database happens in Task 9 (VPS deployment).

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/074_lottery_scratch_cards.sql
git commit -m "feat(lottery-scratch): add scratch card products/tickets tables"
```

---

### Task 2: Backend helper — outcome roll

**Files:**
- Create: `services/core-api-service/src/helpers/scratch.ts`

**Interfaces:**
- Produces: `ScratchPayout` type, `ScratchResult` type, `rollOutcome(payouts: ScratchPayout[]): ScratchResult` — Task 3's buy endpoint depends on this exact function signature and return shape.

- [ ] **Step 1: Write the helper**

```ts
export type ScratchPayout = {
  outcome: 'cash' | 'coupon' | 'no_win'
  amount?: number
  promo_code_id?: string
  probability: number
}

export type ScratchResult = {
  outcome: 'cash' | 'coupon' | 'no_win'
  amount: number
  promo_code_id: string | null
}

// Rolls a single outcome against a product's payout table using
// cumulative probability — each payout's `probability` is a percentage
// (0-100) and the full set for one product must sum to 100 (enforced at
// creation time, see betting.ts's /internal/lottery/scratch/create).
// Independent roll per purchase — no shared pool, no finite stock.
export function rollOutcome(payouts: ScratchPayout[]): ScratchResult {
  const roll = Math.random() * 100
  let cumulative = 0
  for (const p of payouts) {
    cumulative += p.probability
    if (roll < cumulative) {
      return {
        outcome: p.outcome,
        amount: p.outcome === 'cash' ? Number(p.amount) : 0,
        promo_code_id: p.outcome === 'coupon' ? (p.promo_code_id || null) : null,
      }
    }
  }
  // Floating-point rounding safety net — probabilities summing to
  // 99.999...% or a roll landing exactly at the boundary falls through
  // here; treat as the last configured payout rather than throwing.
  const last = payouts[payouts.length - 1]
  return {
    outcome: last.outcome,
    amount: last.outcome === 'cash' ? Number(last.amount) : 0,
    promo_code_id: last.outcome === 'coupon' ? (last.promo_code_id || null) : null,
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Sanity-check the distribution manually**

This codebase has no test runner for these helpers (established pattern — see Global Constraints), so verify by temporarily running a one-off check, then discard it (do not commit a test file):

```bash
cd services/core-api-service && npx ts-node -e "
const { rollOutcome } = require('./src/helpers/scratch');
const payouts = [
  { outcome: 'cash', amount: 50, probability: 5 },
  { outcome: 'cash', amount: 20, probability: 10 },
  { outcome: 'coupon', promo_code_id: 'x', probability: 5 },
  { outcome: 'no_win', probability: 80 },
];
const counts = { cash: 0, coupon: 0, no_win: 0 };
for (let i = 0; i < 20000; i++) counts[rollOutcome(payouts).outcome]++;
console.log(counts);
"
```

Expected: roughly `cash` ≈ 3000 (15% combined), `coupon` ≈ 1000 (5%), `no_win` ≈ 16000 (80%) — within a few percent of these targets given random variance. If `ts-node` isn't available, compile with `npx tsc` to a temp location and run with plain `node` instead, or skip this step and rely on Task 6's live curl-based purchase testing to exercise the distribution instead — note which approach you used in your report.

- [ ] **Step 4: Commit**

```bash
git add services/core-api-service/src/helpers/scratch.ts
git commit -m "feat(lottery-scratch): add probability-based outcome roll helper"
```

---

### Task 3: Backend routes — player-facing + internal create

**Files:**
- Modify: `services/core-api-service/src/plugins/betting.ts` — add import near the top (after the existing `settleLottery, generateWinningNumber` import), add player-facing routes after the existing `/lottery/results` route (around line 181), add the internal create route after the existing `/internal/lottery/cancel` route (around line 428)

**Interfaces:**
- Consumes: `rollOutcome`, `ScratchPayout` from `../helpers/scratch` (Task 2).
- Produces: `POST /lottery/scratch/buy` returns `{ success: true, ticket_id, outcome, amount, promo_code }` — Task 8's mobile scratch page depends on this exact response shape. `POST /internal/lottery/scratch/create` requires `{ name, price, payouts }` — Task 4's admin-service proxy depends on this exact request shape.

- [ ] **Step 1: Add the import**

Find:

```ts
import { settleLottery, generateWinningNumber } from '../helpers/lottery'
```

Replace with:

```ts
import { settleLottery, generateWinningNumber } from '../helpers/lottery'
import { rollOutcome } from '../helpers/scratch'
```

- [ ] **Step 2: Add player-facing routes after `/lottery/results`**

Find (the end of the existing `/lottery/results` route, immediately followed by the cricket section comment):

```ts
        FROM lottery_draws d
        LEFT JOIN lottery_tickets t ON t.draw_id = d.id
        WHERE d.status = 'settled'
        GROUP BY d.id
        ORDER BY d.draw_time DESC
        LIMIT 20
      `)
      return { draws: rows.rows }
    })

    // ══ CRICKET (Dream11-style fantasy contests, plus session/fancy
```

Replace with:

```ts
        FROM lottery_draws d
        LEFT JOIN lottery_tickets t ON t.draw_id = d.id
        WHERE d.status = 'settled'
        GROUP BY d.id
        ORDER BY d.draw_time DESC
        LIMIT 20
      `)
      return { draws: rows.rows }
    })

    // ══ LOTTERY — INSTANT (SCRATCH CARD) ══
    app.get('/lottery/scratch/products', { onRequest: [auth] }, async () => {
      const rows = await db.query(`SELECT * FROM lottery_scratch_products WHERE is_active = true ORDER BY price ASC`)
      return { products: rows.rows }
    })

    app.post('/lottery/scratch/buy', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ product_id: z.string().uuid() }).parse(req.body)
      const productRes = await db.query(`SELECT * FROM lottery_scratch_products WHERE id = $1 AND is_active = true`, [body.product_id])
      if (!productRes.rows.length) return reply.code(409).send({ error: 'Product not available' })
      const product = productRes.rows[0]

      const ticketId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: Number(product.price), referenceId: ticketId, idempotencyKey: `scratch_buy_${ticketId}`, description: `Scratch Card: ${product.name}` })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })

      const result = rollOutcome(product.payouts)

      if (result.outcome === 'cash' && result.amount > 0) {
        await creditPrize({
          userId: uid(req),
          amount: result.amount,
          referenceId: ticketId,
          idempotencyKey: `scratch_payout_${ticketId}`,
          notification: { title: 'Scratch Card Win! 🎉', body: `You won ₹${result.amount.toFixed(2)} on ${product.name}!` },
        })
      }

      await db.query(
        `INSERT INTO lottery_scratch_tickets (id, product_id, user_id, outcome, amount, promo_code_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [ticketId, body.product_id, uid(req), result.outcome, result.amount, result.promo_code_id],
      )

      let promoCode: string | null = null
      if (result.outcome === 'coupon' && result.promo_code_id) {
        const promoRes = await db.query(`SELECT code FROM promo_codes WHERE id = $1`, [result.promo_code_id])
        promoCode = promoRes.rows[0]?.code || null
      }

      return { success: true, ticket_id: ticketId, outcome: result.outcome, amount: result.amount, promo_code: promoCode }
    })

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

- [ ] **Step 3: Add the internal create route after `/internal/lottery/cancel`**

Find (the end of the existing `/internal/lottery/cancel` route):

```ts
    app.post('/internal/lottery/cancel', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid() }).parse(req.body)
      const drawRes = await db.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open or already settled' })
      const tickets = await db.query(`SELECT * FROM lottery_tickets WHERE draw_id = $1`, [body.draw_id])
      await db.query(`UPDATE lottery_draws SET status = 'cancelled' WHERE id = $1`, [body.draw_id])
      await Promise.all(tickets.rows.map((t: any) =>
        creditPrize({ userId: t.user_id, amount: Number(t.amount), referenceId: t.id, idempotencyKey: `lottery_refund_${t.id}` })
      ))
      return { success: true, refunded: tickets.rows.length }
    })
```

Replace with:

```ts
    app.post('/internal/lottery/cancel', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid() }).parse(req.body)
      const drawRes = await db.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open or already settled' })
      const tickets = await db.query(`SELECT * FROM lottery_tickets WHERE draw_id = $1`, [body.draw_id])
      await db.query(`UPDATE lottery_draws SET status = 'cancelled' WHERE id = $1`, [body.draw_id])
      await Promise.all(tickets.rows.map((t: any) =>
        creditPrize({ userId: t.user_id, amount: Number(t.amount), referenceId: t.id, idempotencyKey: `lottery_refund_${t.id}` })
      ))
      return { success: true, refunded: tickets.rows.length }
    })

    app.post('/internal/lottery/scratch/create', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        name: z.string(),
        price: z.number().positive(),
        payouts: z.array(z.object({
          outcome: z.enum(['cash', 'coupon', 'no_win']),
          amount: z.number().positive().optional(),
          promo_code_id: z.string().uuid().optional(),
          probability: z.number().min(0).max(100),
        })).min(1),
      }).parse(req.body)

      const total = body.payouts.reduce((sum, p) => sum + p.probability, 0)
      if (Math.abs(total - 100) > 0.01) return reply.code(400).send({ error: 'Payout probabilities must sum to 100' })
      for (const p of body.payouts) {
        if (p.outcome === 'cash' && p.amount === undefined) return reply.code(400).send({ error: 'Cash payouts require an amount' })
        if (p.outcome === 'coupon' && !p.promo_code_id) return reply.code(400).send({ error: 'Coupon payouts require a promo_code_id' })
      }

      const r = await db.query(
        `INSERT INTO lottery_scratch_products (name, price, payouts) VALUES ($1,$2,$3) RETURNING *`,
        [body.name, body.price, JSON.stringify(body.payouts)],
      )
      return { success: true, product: r.rows[0] }
    })
```

- [ ] **Step 4: Verify it compiles**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/plugins/betting.ts
git commit -m "feat(lottery-scratch): buy/products/my-tickets routes + internal create"
```

---

### Task 4: Admin-service — scratch product proxy routes

**Files:**
- Modify: `services/admin-service/src/index.ts` — add routes immediately after the existing `/api/admin/betting/lottery/draw` route (around line 1889)

**Interfaces:**
- Consumes: `POST /internal/lottery/scratch/create` (Task 3) via the existing `callBetting` helper.
- Produces: `GET /api/admin/betting/lottery/scratch/products`, `POST /api/admin/betting/lottery/scratch/create`, `PATCH /api/admin/betting/lottery/scratch/products/:id` — Task 5's admin panel depends on these exact paths and response shapes.

- [ ] **Step 1: Add the three routes**

Find:

```ts
  app.post('/api/admin/betting/lottery/draw', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/lottery/draw', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })
```

Replace with:

```ts
  app.post('/api/admin/betting/lottery/draw', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/lottery/draw', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  // --- Lottery: Instant (Scratch Card) ---
  app.get('/api/admin/betting/lottery/scratch/products', { onRequest: [authenticate] }, async (_req, reply) => {
    const rows = await db.query(`
      SELECT p.*,
             (SELECT COUNT(*) FROM lottery_scratch_tickets t WHERE t.product_id = p.id) AS tickets_sold,
             (SELECT COALESCE(SUM(t.amount), 0) FROM lottery_scratch_tickets t WHERE t.product_id = p.id) AS total_paid,
             (SELECT COUNT(*) * p.price FROM lottery_scratch_tickets t WHERE t.product_id = p.id) AS total_revenue
      FROM lottery_scratch_products p ORDER BY p.created_at DESC`)
    return reply.send({ products: rows.rows })
  })

  app.post('/api/admin/betting/lottery/scratch/create', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/lottery/scratch/create', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.patch('/api/admin/betting/lottery/scratch/products/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({ is_active: z.boolean() }).parse(req.body)
    const r = await db.query(`UPDATE lottery_scratch_products SET is_active = $1 WHERE id = $2 RETURNING *`, [body.is_active, id])
    if (!r.rows.length) return reply.code(404).send({ error: 'Product not found' })
    return reply.send({ success: true, product: r.rows[0] })
  })
```

- [ ] **Step 2: Verify it compiles**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(lottery-scratch): admin-service proxy routes for scratch products"
```

---

### Task 5: Admin panel — Instant Lottery products UI

**Files:**
- Create: `admin-panel/src/pages/games/LotteryScratch.tsx`
- Modify: `admin-panel/src/pages/games/Lottery.tsx` — wrap the existing return in a `Tabs` with the new component as a second tab

**Interfaces:**
- Consumes: `GET /api/admin/betting/lottery/scratch/products`, `POST /api/admin/betting/lottery/scratch/create`, `PATCH /api/admin/betting/lottery/scratch/products/:id` (Task 4), `GET /api/admin/promo-codes` (pre-existing endpoint, returns a raw array of promo code rows).
- Produces: none consumed by later tasks — this task is self-contained.

- [ ] **Step 1: Create `LotteryScratch.tsx`**

```tsx
import { useEffect, useState } from 'react'
import {
  Card, Form, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, message, Switch
} from 'antd'
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons'
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'

const OUTCOME_COLORS: Record<string, string> = { cash: 'green', coupon: 'purple', no_win: 'default' }

export default function LotteryScratch() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [promoCodes, setPromoCodes] = useState<any[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const loadProducts = () => {
    setLoading(true)
    adminApi.get('/betting/lottery/scratch/products')
      .then(r => setProducts(r.data.products || []))
      .finally(() => setLoading(false))
  }

  const loadPromoCodes = () => {
    adminApi.get('/promo-codes')
      .then(r => setPromoCodes((r.data || []).filter((p: any) => p.is_active)))
      .catch(() => {})
  }

  useEffect(() => {
    loadProducts()
    loadPromoCodes()
  }, [])

  const create = async (v: any) => {
    const total = (v.payouts || []).reduce((sum: number, p: any) => sum + Number(p.probability || 0), 0)
    if (Math.abs(total - 100) > 0.01) {
      message.error(`Payout probabilities must sum to 100 (currently ${total})`)
      return
    }
    try {
      await adminApi.post('/betting/lottery/scratch/create', { name: v.name, price: v.price, payouts: v.payouts })
      message.success('Scratch card product created!')
      setCreateOpen(false)
      form.resetFields()
      loadProducts()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Create failed')
    }
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await adminApi.patch(`/betting/lottery/scratch/products/${id}`, { is_active: isActive })
      message.success(isActive ? 'Product activated' : 'Product deactivated')
      loadProducts()
    } catch {
      message.error('Failed to update product')
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
        title={<span style={{ color: '#f3f4f6' }}>Scratch Card Products</span>}
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
              Create Product
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadProducts} style={{ borderRadius: '8px', background: 'transparent', borderColor: '#4b5563', color: '#9ca3af' }}>
              Refresh
            </Button>
          </Space>
        }
        loading={loading}
      >
        <Table
          rowKey="id"
          dataSource={products}
          size="small"
          pagination={{ pageSize: 8 }}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (n) => <span style={{ fontWeight: 600, color: '#f9fafb' }}>{n}</span> },
            { title: 'Price', dataIndex: 'price', render: (v: any) => <span style={{ color: '#34d399', fontWeight: 600 }}>₹{Number(v).toFixed(0)}</span> },
            {
              title: 'Payouts',
              dataIndex: 'payouts',
              render: (payouts: any[]) => (
                <Space wrap size={4}>
                  {(payouts || []).map((p, i) => (
                    <Tag key={i} color={OUTCOME_COLORS[p.outcome]} style={{ fontWeight: 'bold', fontSize: 10 }}>
                      {p.outcome === 'cash' ? `₹${p.amount}` : p.outcome === 'coupon' ? 'Coupon' : 'No Win'}: {p.probability}%
                    </Tag>
                  ))}
                </Space>
              )
            },
            { title: 'Sold', dataIndex: 'tickets_sold', render: (v) => <span style={{ fontWeight: 'bold' }}>{v || 0}</span> },
            { title: 'Revenue', dataIndex: 'total_revenue', render: (v) => <span>₹{Number(v || 0).toFixed(0)}</span> },
            { title: 'Paid Out', dataIndex: 'total_paid', render: (v) => <span style={{ color: '#f87171' }}>₹{Number(v || 0).toFixed(0)}</span> },
            {
              title: 'Active',
              dataIndex: 'is_active',
              render: (active: boolean, record: any) => (
                <Switch checked={active} onChange={(checked) => toggleActive(record.id, checked)} />
              )
            },
            { title: 'Created', dataIndex: 'created_at', render: (v: string) => dayjs(v).format('DD MMM YY') },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title="Create Scratch Card Product"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create Product"
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={create} style={{ marginTop: '16px' }}>
          <Form.Item name="name" label="Product Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g., ₹10 Lucky Scratch" />
          </Form.Item>
          <Form.Item name="price" label="Price (₹)" rules={[{ required: true }]} initialValue={10}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Payouts" required tooltip="Probabilities across all payout rows must sum to exactly 100.">
            <Form.List name="payouts" initialValue={[{ outcome: 'no_win', probability: 100 }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Form.Item key={key} noStyle shouldUpdate>
                      {() => (
                        <Space style={{ display: 'flex', marginBottom: 12 }} align="baseline">
                          <Form.Item {...restField} name={[name, 'outcome']} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                            <Select style={{ width: 130 }} options={[
                              { value: 'cash', label: 'Cash' },
                              { value: 'coupon', label: 'Coupon' },
                              { value: 'no_win', label: 'No Win' },
                            ]} />
                          </Form.Item>
                          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.payouts?.[name]?.outcome !== cur.payouts?.[name]?.outcome}>
                            {({ getFieldValue }) => {
                              const outcome = getFieldValue(['payouts', name, 'outcome'])
                              if (outcome === 'cash') {
                                return (
                                  <Form.Item {...restField} name={[name, 'amount']} rules={[{ required: true, message: 'Amount required' }]} style={{ marginBottom: 0 }}>
                                    <InputNumber min={1} placeholder="Amount (₹)" style={{ width: 130 }} />
                                  </Form.Item>
                                )
                              }
                              if (outcome === 'coupon') {
                                return (
                                  <Form.Item {...restField} name={[name, 'promo_code_id']} rules={[{ required: true, message: 'Promo code required' }]} style={{ marginBottom: 0 }}>
                                    <Select style={{ width: 160 }} placeholder="Promo code" options={promoCodes.map(p => ({ value: p.id, label: p.code }))} />
                                  </Form.Item>
                                )
                              }
                              return null
                            }}
                          </Form.Item>
                          <Form.Item {...restField} name={[name, 'probability']} rules={[{ required: true, message: 'Probability required' }]} style={{ marginBottom: 0 }}>
                            <InputNumber min={0} max={100} placeholder="Probability" style={{ width: 120 }} formatter={(v) => `${v}%`} />
                          </Form.Item>
                          {fields.length > 1 ? <Button danger onClick={() => remove(name)}>Remove</Button> : null}
                        </Space>
                      )}
                    </Form.Item>
                  ))}
                  <Form.Item style={{ marginTop: '8px' }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                      Add Payout
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Wrap `Lottery.tsx`'s existing content in a Tabs component**

Find (the antd import list near the top of `admin-panel/src/pages/games/Lottery.tsx`):

```tsx
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, message, Row, Col, DatePicker, Divider, Popconfirm, Drawer, Statistic, Radio
} from 'antd'
```

Replace with:

```tsx
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, message, Row, Col, DatePicker, Divider, Popconfirm, Drawer, Statistic, Radio, Tabs
} from 'antd'
```

Find (the import line immediately after the antd import and icons import, before `const { Text, Title } = Typography`):

```tsx
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'

const { Text, Title } = Typography
```

Replace with:

```tsx
import { adminApi } from '../../api/client'
import dayjs from 'dayjs'
import LotteryScratch from './LotteryScratch'

const { Text, Title } = Typography
```

Find (the opening of the component's return statement):

```tsx
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
```

Replace with:

```tsx
  return (
    <Tabs
      defaultActiveKey="draws"
      items={[
        {
          key: 'draws',
          label: 'Weekly & Monthly Draws',
          children: (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
```

Find (the very end of the file — the closing of the Drawer, the outer div, and the component function):

```tsx
        />
      </Drawer>
    </div>
  )
}
```

Replace with:

```tsx
        />
      </Drawer>
    </div>
          ),
        },
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

- [ ] **Step 3: Verify it compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/games/LotteryScratch.tsx admin-panel/src/pages/games/Lottery.tsx
git commit -m "feat(lottery-scratch-admin): Instant Lottery products tab"
```

---

### Task 6: Mobile — Lottery landing page (4 type cards)

**Files:**
- Modify (full rewrite): `mobile/lib/features/games/betting/lottery_page.dart`

**Interfaces:**
- Consumes: none.
- Produces: `LotteryPage` (unchanged public name/constructor — `const LotteryPage()`, no params — the only call site is `mobile/lib/app.dart:86`, which needs no changes). Navigates to `LotteryDrawsPage(category: ..., title: ...)` (Task 7) and `LotteryScratchPage()` (Task 8) — both must exist by the time this compiles, or import errors will occur; if implementing tasks out of order, stub the imports and constructors matching Task 7/8's signatures below.

**IMPORTANT — scope discipline:** This file previously had a whole-file-reformatting incident. This task's Step 1 is a full, deliberate rewrite (not a Find/Replace patch) since the file's responsibility is changing completely — the entire old contents (the 6-tab TabController, `_drawCard`, `_TicketPickerSheet`, `_ticketRow`, `_resultCard`, `TicketClipper`, `DashedLinePainter`) are being *moved* to the new `lottery_draws_page.dart` file created in Task 7, not deleted outright. Do not attempt to preserve any of the old code in this file — replace the entire file content with exactly what Step 1 provides.

- [ ] **Step 1: Replace the entire file content**

```dart
import 'package:flutter/material.dart';
import '../../../shared/theme/app_theme.dart';
import 'lottery_draws_page.dart';
import 'lottery_scratch_page.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Lottery Page — top-level menu of the four lottery types
// ─────────────────────────────────────────────────────────────────────────────
class LotteryPage extends StatelessWidget {
  const LotteryPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('🎰', style: TextStyle(fontSize: 18)),
            SizedBox(width: 6),
            Text('LOTTERY',
                style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2.5,
                    color: AppColors.goldLight)),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _typeCard(
            context,
            title: 'Daily Lottery',
            subtitle: 'Card/Bingo — Coming Soon',
            icon: Icons.calendar_today_rounded,
            color: Colors.cyanAccent,
            onTap: () => _openComingSoon(context, 'Daily Lottery (Card/Bingo)'),
          ),
          const SizedBox(height: 16),
          _typeCard(
            context,
            title: 'Instant Lottery',
            subtitle: 'Scratch cards — win instantly',
            icon: Icons.auto_awesome_rounded,
            color: Colors.purpleAccent,
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const LotteryScratchPage())),
          ),
          const SizedBox(height: 16),
          _typeCard(
            context,
            title: 'Weekly Lottery',
            subtitle: 'Pick a 4-digit number',
            icon: Icons.event_repeat_rounded,
            color: Colors.lightBlueAccent,
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const LotteryDrawsPage(
                        category: 'weekly', title: 'Weekly Lottery'))),
          ),
          const SizedBox(height: 16),
          _typeCard(
            context,
            title: 'Monthly Lottery',
            subtitle: 'Bigger jackpots, monthly draw',
            icon: Icons.calendar_month_rounded,
            color: AppColors.gold,
            onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const LotteryDrawsPage(
                        category: 'monthly', title: 'Monthly Lottery'))),
          ),
        ],
      ),
    );
  }

  void _openComingSoon(BuildContext context, String label) {
    Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => Scaffold(
                  backgroundColor: const Color(0xFF03070A),
                  appBar: AppBar(
                    backgroundColor: const Color(0xFF03070A),
                    elevation: 0,
                    leading: const BackButton(color: AppColors.gold),
                  ),
                  body: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.hourglass_empty_rounded,
                            size: 64,
                            color: AppColors.textSecondary.withValues(alpha: 0.2)),
                        const SizedBox(height: 18),
                        Text(label,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 15,
                                fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        Text('This game mode is coming soon',
                            style: TextStyle(
                                color: AppColors.textSecondary.withValues(alpha: 0.45),
                                fontSize: 12)),
                      ],
                    ),
                  ),
                )));
  }

  Widget _typeCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFF11161C),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14)),
              child: Icon(icon, color: color, size: 26),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 4),
                  Text(subtitle,
                      style: TextStyle(
                          color: AppColors.textSecondary.withValues(alpha: 0.8),
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: color.withValues(alpha: 0.6)),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Confirm this file will fail to analyze until Tasks 7 and 8 exist**

`dart analyze` on this file alone will report missing-file import errors for `lottery_draws_page.dart` and `lottery_scratch_page.dart` until those files exist. This is expected — do not create placeholder/stub versions of those files as part of this task; Tasks 7 and 8 create them fully. Report this expected state in your report rather than treating it as a failure, and do not attempt `dart analyze lib/` (whole-project) until after Task 8 completes.

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/features/games/betting/lottery_page.dart
git commit -m "feat(lottery-mobile): landing page becomes a menu of 4 type cards"
```

---

### Task 7: Mobile — per-type draws page (Weekly/Monthly)

**Files:**
- Create: `mobile/lib/features/games/betting/lottery_draws_page.dart`

**Interfaces:**
- Consumes: `/api/betting/lottery/draws`, `/api/betting/lottery/my-tickets`, `/api/betting/lottery/results`, `/api/wallet/balance`, `/api/betting/lottery/buy` (all pre-existing, unchanged).
- Produces: `LotteryDrawsPage({ required String category, required String title })` — Task 6 depends on this exact constructor.

This file is adapted from the previous `lottery_page.dart`'s draw-browsing/ticket-picker/my-tickets/results code, now scoped to a single category (passed in via constructor) instead of iterating all four, with a local 3-tab controller (Browse/My Tickets/History) instead of the old 6-tab one. The 4-digit ticket picker mechanic itself (`_TicketPickerSheet`, Quick Pick, digit boxes) is unchanged — do not modify its internals, only its surrounding page structure.

- [ ] **Step 1: Create the file**

```dart
import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Lottery Draws Page — Weekly/Monthly Dedicated Number draws for ONE category
// ─────────────────────────────────────────────────────────────────────────────
class LotteryDrawsPage extends StatefulWidget {
  const LotteryDrawsPage({super.key, required this.category, required this.title});
  final String category;
  final String title;

  @override
  State<LotteryDrawsPage> createState() => _LotteryDrawsPageState();
}

class _LotteryDrawsPageState extends State<LotteryDrawsPage> with TickerProviderStateMixin {
  late final TabController _tab;
  List<dynamic> _draws = [];
  List<dynamic> _myTickets = [];
  List<dynamic> _results = [];
  bool _loading = true;
  bool _myLoading = false;
  bool _resLoading = false;
  double _balance = 0;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging) {
        if (_tab.index == 1 && _myTickets.isEmpty) _loadMyTickets();
        if (_tab.index == 2 && _results.isEmpty) _loadResults();
      }
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
      final res = await ApiClient().dio.get('/api/betting/lottery/draws');
      if (!mounted) return;
      final all = (res.data['draws'] as List?) ?? [];
      setState(() {
        _draws = all.where((d) => d['category'] == widget.category).toList();
        _loading = false;
      });
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
      final res = await ApiClient().dio.get('/api/betting/lottery/my-tickets');
      if (!mounted) return;
      final all = (res.data['tickets'] as List?) ?? [];
      setState(() {
        _myTickets = all.where((t) => t['draw_category'] == widget.category).toList();
        _myLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _myLoading = false);
    }
  }

  Future<void> _loadResults() async {
    setState(() => _resLoading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/results');
      if (!mounted) return;
      final all = (res.data['draws'] as List?) ?? [];
      setState(() {
        _results = all.where((d) => d['category'] == widget.category).toList();
        _resLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _resLoading = false);
    }
  }

  double get _totalJackpot => _draws.fold(0.0, (sum, d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final tiers = (d['prize_tiers'] as List?) ?? [];
    final exactTier = tiers.cast<Map>().firstWhere(
          (t) => t['match_type'] == 'exact',
          orElse: () => {},
        );
    final mult = double.tryParse(exactTier['multiplier']?.toString() ?? '0') ?? 0;
    return sum + price * mult;
  });

  DateTime? get _nextDraw {
    final times = _draws
        .map((d) => DateTime.tryParse(d['draw_time']?.toString() ?? ''))
        .whereType<DateTime>()
        .where((t) => t.isAfter(DateTime.now()))
        .toList()
      ..sort();
    return times.isEmpty ? null : times.first;
  }

  String _countdown(DateTime? dt) {
    if (dt == null) return '--:--:--';
    final diff = dt.difference(DateTime.now());
    if (diff.isNegative) return 'Drawing Now!';
    final h = diff.inHours;
    final m = diff.inMinutes % 60;
    final s = diff.inSeconds % 60;
    if (h > 0) {
      return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  String _fmtCurrency(double v) {
    if (v >= 10000000) return '₹${(v / 10000000).toStringAsFixed(2)} Cr';
    if (v >= 100000) return '₹${(v / 100000).toStringAsFixed(1)} L';
    if (v >= 1000) return '₹${(v / 1000).toStringAsFixed(1)}K';
    return '₹${v.toStringAsFixed(0)}';
  }

  String _fmtDt(DateTime dt) {
    final now = DateTime.now();
    final prefix = (dt.day == now.day && dt.month == now.month) ? 'Today' : '${dt.day}/${dt.month}';
    return '$prefix ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  // ── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      body: NestedScrollView(
        headerSliverBuilder: (ctx, _) => [_buildSliverAppBar()],
        body: TabBarView(
          controller: _tab,
          children: [_drawsTab(), _myTicketsTab(), _resultsTab()],
        ),
      ),
    );
  }

  SliverAppBar _buildSliverAppBar() {
    final jackpot = _totalJackpot;
    final next = _nextDraw;
    return SliverAppBar(
      expandedHeight: 240,
      pinned: true,
      backgroundColor: const Color(0xFF03070A),
      leading: const BackButton(color: AppColors.gold),
      title: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('🎰', style: TextStyle(fontSize: 18)),
          const SizedBox(width: 6),
          Text(widget.title.toUpperCase(),
              style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.5,
                  color: AppColors.goldLight)),
        ],
      ),
      actions: [
        Container(
          margin: const EdgeInsets.only(right: 12),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.gold.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.account_balance_wallet_rounded, size: 13, color: AppColors.gold),
              const SizedBox(width: 5),
              Text('₹${_balance.toStringAsFixed(0)}',
                  style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 12)),
            ],
          ),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(46),
        child: Container(
          color: const Color(0xFF03070A),
          child: TabBar(
            controller: _tab,
            indicatorColor: AppColors.gold,
            indicatorWeight: 3.0,
            labelColor: AppColors.gold,
            unselectedLabelColor: AppColors.textSecondary,
            labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.5),
            tabs: const [Tab(text: 'Browse'), Tab(text: 'My Tickets'), Tab(text: 'History')],
          ),
        ),
      ),
      flexibleSpace: FlexibleSpaceBar(
        background: _buildHeroContent(jackpot, next),
      ),
    );
  }

  Widget _buildHeroContent(double jackpot, DateTime? next) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF004D40), Color(0xFF002B24), Color(0xFF03070A)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: [0.0, 0.6, 1.0],
        ),
      ),
      child: Stack(
        children: [
          Positioned(right: -40, top: -20, child: _glowCircle(150, 0.08, color: const Color(0xFF0D9488))),
          Positioned(left: -30, bottom: 40, child: _glowCircle(110, 0.05, color: AppColors.gold)),
          Positioned(right: 60, bottom: 10, child: _glowCircle(75, 0.03, color: Colors.white)),
          Positioned(
            top: 0, left: 0, right: 0,
            child: Container(
              height: 1.5,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.transparent, AppColors.gold.withValues(alpha: 0.6), Colors.transparent],
                ),
              ),
            ),
          ),
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 48, 20, 40),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'TOTAL JACKPOT PRIZEPOOL',
                    style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.5),
                        fontSize: 10,
                        letterSpacing: 4.5,
                        fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  TweenAnimationBuilder<double>(
                    key: ValueKey(jackpot),
                    tween: Tween(begin: jackpot * 0.7, end: jackpot),
                    duration: const Duration(milliseconds: 1200),
                    curve: Curves.easeOutCubic,
                    builder: (_, v, __) => Text(
                      jackpot == 0 ? 'No Active Draws' : _fmtCurrency(v),
                      style: TextStyle(
                        fontSize: jackpot == 0 ? 22 : 44,
                        fontWeight: FontWeight.w900,
                        color: AppColors.goldLight,
                        letterSpacing: -0.5,
                        shadows: [
                          Shadow(color: AppColors.gold.withValues(alpha: 0.7), blurRadius: 24),
                          const Shadow(color: Colors.black45, blurRadius: 4, offset: Offset(0, 4))
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  if (next != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.45),
                        borderRadius: BorderRadius.circular(30),
                        border: Border.all(color: AppColors.gold.withValues(alpha: 0.35)),
                        boxShadow: [
                          BoxShadow(color: AppColors.gold.withValues(alpha: 0.08), blurRadius: 10, spreadRadius: 1)
                        ]
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.alarm_rounded, color: AppColors.gold, size: 14),
                          const SizedBox(width: 6),
                          Text('Next draw in ',
                              style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 11, fontWeight: FontWeight.w600)),
                          Text(
                            _countdown(next),
                            style: const TextStyle(
                                color: AppColors.goldLight,
                                fontWeight: FontWeight.w900,
                                fontSize: 14),
                          ),
                        ],
                      ),
                    )
                  else
                    Text('No upcoming draws',
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 13, fontWeight: FontWeight.w500)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _glowCircle(double size, double opacity, {Color color = Colors.white}) => Container(
    width: size, height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: color.withValues(alpha: opacity),
    ),
  );

  // ── Tab: Browse ──────────────────────────────────────────────────────────

  Widget _drawsTab() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_draws.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.confirmation_num_outlined,
                size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No draws open right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Check back soon for new jackpots',
                style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.45), fontSize: 12)),
            const SizedBox(height: 24),
            TextButton.icon(
              onPressed: _loadDraws,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Refresh'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.gold,
                side: BorderSide(color: AppColors.gold.withValues(alpha: 0.35)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8)
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadDraws,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _draws.length,
        itemBuilder: (_, i) => _drawCard(_draws[i]),
      ),
    );
  }

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
    final ticketCount = int.tryParse(d['ticket_count']?.toString() ?? '0') ?? 0;
    final remaining = drawTime != null ? drawTime.difference(DateTime.now()) : Duration.zero;
    final isExpired = remaining.isNegative;

    double progress = 0;
    if (drawTime != null && !isExpired) {
      final windowSecs = 86400;
      final elapsed = windowSecs - remaining.inSeconds.clamp(0, windowSecs);
      progress = (elapsed / windowSecs).clamp(0.0, 1.0);
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        boxShadow: isExpired
            ? []
            : [
                BoxShadow(
                  color: const Color(0xFF0D9488).withValues(alpha: 0.12),
                  blurRadius: 18,
                  offset: const Offset(0, 6),
                )
              ],
      ),
      child: ClipPath(
        clipper: TicketClipper(punchRadius: 9.0, cutLineYRatio: 0.74),
        child: Container(
          decoration: BoxDecoration(
            border: Border.all(
              color: isExpired ? AppColors.border : AppColors.gold.withValues(alpha: 0.22),
              width: 1.2,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: Stack(
              children: [
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: isExpired
                            ? [const Color(0xFF1E2430), const Color(0xFF0F1217)]
                            : [const Color(0xFF0F665D), const Color(0xFF063A34), const Color(0xFF021B19)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                  ),
                ),
                Positioned(right: -25, top: -25, child: _glowCircle(110, 0.06, color: const Color(0xFF0D9488))),
                Positioned(right: 40, bottom: -20, child: _glowCircle(70, 0.03, color: AppColors.gold)),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                                decoration: BoxDecoration(
                                  color: isExpired
                                      ? AppColors.border.withValues(alpha: 0.3)
                                      : AppColors.gold.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(
                                      color: isExpired
                                          ? AppColors.border
                                          : AppColors.gold.withValues(alpha: 0.4)),
                                ),
                                child: Text(
                                  isExpired ? 'DRAWING' : 'OPEN',
                                  style: TextStyle(
                                      color: isExpired ? AppColors.textSecondary : AppColors.gold,
                                      fontSize: 9,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: 1.5),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(d['name'] ?? 'Lottery Draw',
                                    style: const TextStyle(
                                        fontSize: 17,
                                        fontWeight: FontWeight.w900,
                                        color: Colors.white,
                                        letterSpacing: 0.2)),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.3),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Text('4-digit',
                                    style: TextStyle(
                                        color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.bold)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 18),
                          Row(
                            children: [
                              _statChip('JACKPOT', _fmtCurrency(maxPrize), AppColors.goldLight),
                              const SizedBox(width: 8),
                              _statChip('TICKET', '₹${price.toStringAsFixed(0)}', Colors.white),
                              const SizedBox(width: 8),
                              _statChip('SOLD', '$ticketCount', const Color(0xFF2DD4BF)),
                            ],
                          ),
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              Icon(
                                isExpired ? Icons.timelapse_rounded : Icons.av_timer_rounded,
                                size: 14,
                                color: isExpired ? AppColors.orange : AppColors.textSecondary,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                isExpired ? 'Draw in progress!' : 'Closes in ${_countdown(drawTime)}',
                                style: TextStyle(
                                    color: isExpired ? AppColors.orange : AppColors.textSecondary,
                                    fontSize: 12,
                                    fontWeight: isExpired ? FontWeight.w800 : FontWeight.w600),
                              ),
                              if (drawTime != null && !isExpired) ...[
                                const Spacer(),
                                Text(_fmtDt(drawTime),
                                    style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 11, fontWeight: FontWeight.w500)),
                              ],
                            ],
                          ),
                          const SizedBox(height: 8),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: isExpired ? 1.0 : progress,
                              backgroundColor: Colors.white.withValues(alpha: 0.08),
                              valueColor: AlwaysStoppedAnimation(
                                isExpired ? AppColors.orange : AppColors.gold),
                              minHeight: 3.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        return CustomPaint(
                          size: Size(constraints.maxWidth, 1),
                          painter: DashedLinePainter(
                            color: Colors.white.withValues(alpha: 0.12),
                            dashWidth: 6.0,
                            dashSpace: 4.0,
                          ),
                        );
                      },
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                      child: SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: isExpired ? null : () {
                            SoundService.instance.play(Sfx.buttonTap);
                            _showTicketPicker(d, price);
                          },
                          icon: const Icon(Icons.confirmation_num_rounded, size: 16),
                          label: const Text('Buy Ticket'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.gold,
                            foregroundColor: Colors.black,
                            disabledBackgroundColor: AppColors.border.withValues(alpha: 0.35),
                            disabledForegroundColor: AppColors.textSecondary,
                            minimumSize: const Size.fromHeight(48),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            textStyle: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, letterSpacing: 0.5),
                            elevation: 0
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _statChip(String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.24),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 8, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
            const SizedBox(height: 3),
            Text(value, style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w900)),
          ],
        ),
      ),
    );
  }

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

  // ── Tab: My Tickets ──────────────────────────────────────────────────────

  Widget _myTicketsTab() {
    if (_myLoading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_myTickets.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long_outlined,
                size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No tickets yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Buy a ticket from Browse',
                style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.45), fontSize: 12)),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () => _tab.animateTo(0),
              icon: const Icon(Icons.confirmation_num_rounded, size: 16),
              label: const Text('Browse Draws'),
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00796B),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12)
              ),
            ),
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
    final isWinner = t['is_winner'] == true;
    final isLoser = t['is_winner'] == false;
    final prize = double.tryParse(t['prize']?.toString() ?? '0') ?? 0;
    final winNum = t['winning_number']?.toString();
    final drawStatus = t['draw_status']?.toString() ?? 'open';
    final drawTime = DateTime.tryParse(t['draw_time']?.toString() ?? '');
    final ticketNum = t['ticket_number']?.toString() ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: isWinner
                ? AppColors.green.withValues(alpha: 0.12)
                : Colors.black.withValues(alpha: 0.15),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: ClipPath(
        clipper: TicketClipper(punchRadius: 8.0, cutLineYRatio: 0.58),
        child: Container(
          decoration: BoxDecoration(
            color: isWinner
                ? AppColors.green.withValues(alpha: 0.04)
                : AppColors.cardBg,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: isWinner
                  ? AppColors.green.withValues(alpha: 0.45)
                  : isLoser
                      ? AppColors.border.withValues(alpha: 0.5)
                      : AppColors.gold.withValues(alpha: 0.2),
              width: isWinner ? 1.5 : 1.0,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(t['draw_name'] ?? 'Lottery',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: Colors.white)),
                        ),
                        _statusBadge(isWinner, isLoser, drawStatus),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Text('Your pick  ',
                            style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 11, fontWeight: FontWeight.bold)),
                        ...ticketNum.split('').map((c) => _digitDisplay(c, isWinner ? AppColors.green : null)),
                      ],
                    ),
                  ],
                ),
              ),
              LayoutBuilder(
                builder: (context, constraints) {
                  return CustomPaint(
                    size: Size(constraints.maxWidth, 1),
                    painter: DashedLinePainter(
                      color: Colors.white.withValues(alpha: 0.1),
                      dashWidth: 5.0,
                      dashSpace: 3.0,
                    ),
                  );
                },
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (winNum != null && drawStatus == 'settled') ...[
                      Row(
                        children: [
                          Text('Winning   ',
                              style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 11, fontWeight: FontWeight.bold)),
                          ...winNum.split('').map((c) => _digitDisplay(c, AppColors.goldLight, bold: true)),
                        ],
                      ),
                      const SizedBox(height: 8),
                    ],
                    if (isWinner && prize > 0) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        margin: const EdgeInsets.only(bottom: 6),
                        decoration: BoxDecoration(
                          color: AppColors.green.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.green.withValues(alpha: 0.35)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.emoji_events_rounded, color: AppColors.green, size: 16),
                            const SizedBox(width: 6),
                            Text('You Won ₹${prize.toStringAsFixed(0)}!',
                                style: const TextStyle(
                                    color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 13)),
                          ],
                        ),
                      ),
                    ],
                    if (drawTime != null)
                      Text('Draw: ${_fmtDt(drawTime)}',
                          style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.5), fontSize: 10.5, fontWeight: FontWeight.w600)),
                  ],
                ),
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _digitDisplay(String c, Color? color, {bool bold = false}) {
    return Container(
      margin: const EdgeInsets.only(right: 5),
      width: 26, height: 32,
      decoration: BoxDecoration(
        color: color != null ? color.withValues(alpha: 0.12) : Colors.black.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
            color: color != null ? color.withValues(alpha: 0.45) : AppColors.border),
      ),
      alignment: Alignment.center,
      child: Text(c,
          style: TextStyle(
              fontWeight: bold ? FontWeight.w900 : FontWeight.w800,
              fontSize: 14,
              color: color ?? Colors.white)),
    );
  }

  Widget _statusBadge(bool isWinner, bool isLoser, String drawStatus) {
    if (isWinner) {
      return _badge('WINNER 🏆', AppColors.green, AppColors.green.withValues(alpha: 0.15));
    } else if (isLoser) {
      return _badge('NO WIN', AppColors.textSecondary, AppColors.border.withValues(alpha: 0.4));
    } else if (drawStatus == 'open') {
      return _badge('ACTIVE', AppColors.gold, AppColors.gold.withValues(alpha: 0.1));
    } else {
      return _badge('PENDING', const Color(0xFF2DD4BF), const Color(0xFF00796B).withValues(alpha: 0.15));
    }
  }

  Widget _badge(String label, Color fg, Color bg) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: fg.withValues(alpha: 0.35)),
    ),
    child: Text(label, style: TextStyle(color: fg, fontSize: 9, fontWeight: FontWeight.w900, letterSpacing: 0.2)),
  );

  // ── Tab: History ─────────────────────────────────────────────────────────

  Widget _resultsTab() {
    if (_resLoading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_results.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history_rounded,
                size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No results yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadResults,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _results.length,
        itemBuilder: (_, i) => _resultCard(_results[i]),
      ),
    );
  }

  Widget _resultCard(dynamic d) {
    final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
    final winNum = d['winning_number']?.toString() ?? '';
    final winners = int.tryParse(d['winner_count']?.toString() ?? '0') ?? 0;
    final paid = double.tryParse(d['total_paid']?.toString() ?? '0') ?? 0;
    final tickets = int.tryParse(d['total_tickets']?.toString() ?? '0') ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: ClipPath(
        clipper: TicketClipper(punchRadius: 8.0, cutLineYRatio: 0.62),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.border.withValues(alpha: 0.8)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 32, height: 32,
                          decoration: BoxDecoration(
                            color: AppColors.green.withValues(alpha: 0.12),
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.green.withValues(alpha: 0.35)),
                          ),
                          child: const Icon(Icons.check_rounded, color: AppColors.green, size: 16),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(d['name'] ?? 'Lottery Draw',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: Colors.white)),
                        ),
                        Text(drawTime != null ? _fmtDt(drawTime) : '',
                            style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 10.5, fontWeight: FontWeight.w600)),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (d['winners'] != null && (d['winners'] as List).isNotEmpty) ...[
                      const Row(
                        children: [
                          Icon(Icons.emoji_events_rounded, color: AppColors.gold, size: 14),
                          SizedBox(width: 6),
                          Text('Winning Tickets & Prizes:',
                              style: TextStyle(color: AppColors.goldLight, fontSize: 12.5, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ...(d['winners'] as List).map<Widget>((w) {
                        return Container(
                          margin: const EdgeInsets.only(bottom: 6),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.02),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
                          ),
                          child: Row(
                            children: [
                              Text('Ticket: ${w['ticket_number']}',
                                  style: const TextStyle(fontWeight: FontWeight.w800, color: Colors.white, fontSize: 13)),
                              const Spacer(),
                              Text('₹${w['prize']}',
                                  style: const TextStyle(color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 13.5)),
                            ],
                          ),
                        );
                      }).toList(),
                    ] else ...[
                      Row(
                        children: [
                          Text('Winning Number: ',
                              style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 12.5, fontWeight: FontWeight.bold)),
                          const SizedBox(width: 6),
                          Text(winNum.isNotEmpty ? winNum : '—',
                              style: const TextStyle(color: AppColors.goldLight, fontWeight: FontWeight.w900, fontSize: 14)),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              LayoutBuilder(
                builder: (context, constraints) {
                  return CustomPaint(
                    size: Size(constraints.maxWidth, 1),
                    painter: DashedLinePainter(
                      color: Colors.white.withValues(alpha: 0.1),
                      dashWidth: 5.0,
                      dashSpace: 3.0,
                    ),
                  );
                },
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(Icons.confirmation_num_rounded, size: 13,
                        color: AppColors.textSecondary.withValues(alpha: 0.6)),
                    const SizedBox(width: 4),
                    Text('$tickets tickets sold',
                        style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.7), fontSize: 11, fontWeight: FontWeight.w600)),
                    const SizedBox(width: 14),
                    Icon(Icons.people_alt_rounded, size: 13,
                        color: AppColors.textSecondary.withValues(alpha: 0.6)),
                    const SizedBox(width: 4),
                    Text('$winners winner${winners != 1 ? 's' : ''}',
                        style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.7), fontSize: 11, fontWeight: FontWeight.w600)),
                    const Spacer(),
                    Text('₹${paid.toStringAsFixed(0)} paid',
                        style: const TextStyle(color: AppColors.green, fontSize: 12, fontWeight: FontWeight.w800)),
                  ],
                ),
              )
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ticket Picker Bottom Sheet
// ─────────────────────────────────────────────────────────────────────────────
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
        onTap: () => _controllers[index].selection = TextSelection(
            baseOffset: 0, extentOffset: _controllers[index].text.length),
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

// ─────────────────────────────────────────────────────────────────────────────
//  Custom Clipper for "Lottery Ticket" Stub Design
// ─────────────────────────────────────────────────────────────────────────────
class TicketClipper extends CustomClipper<Path> {
  final double punchRadius;
  final double cutLineYRatio;
  TicketClipper({this.punchRadius = 10.0, this.cutLineYRatio = 0.7});

  @override
  Path getClip(Size size) {
    final path = Path();
    final cutY = size.height * cutLineYRatio;

    path.lineTo(0, 0);
    path.lineTo(0, cutY - punchRadius);
    path.arcToPoint(
      Offset(0, cutY + punchRadius),
      radius: Radius.circular(punchRadius),
      clockwise: true,
    );
    path.lineTo(0, size.height);
    path.lineTo(size.width, size.height);
    path.lineTo(size.width, cutY + punchRadius);
    path.arcToPoint(
      Offset(size.width, cutY - punchRadius),
      radius: Radius.circular(punchRadius),
      clockwise: true,
    );
    path.lineTo(size.width, 0);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Custom Painter for Dashed Divider Y-axis line
// ─────────────────────────────────────────────────────────────────────────────
class DashedLinePainter extends CustomPainter {
  final Color color;
  final double dashWidth;
  final double dashSpace;
  DashedLinePainter({required this.color, this.dashWidth = 5.0, this.dashSpace = 3.0});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.0
      ..style = PaintingStyle.stroke;
    double startX = 0;
    while (startX < size.width) {
      canvas.drawLine(Offset(startX, 0), Offset(startX + dashWidth, 0), paint);
      startX += dashWidth + dashSpace;
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
```

- [ ] **Step 2: Verify it analyzes clean**

Run: `cd mobile && dart analyze lib/features/games/betting/lottery_draws_page.dart`
Expected: only pre-existing `withValues`/deprecation-class info messages if any (none expected here since this code already uses `withValues`, not the deprecated `withOpacity`), no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/features/games/betting/lottery_draws_page.dart
git commit -m "feat(lottery-mobile): per-type draws page (Weekly/Monthly) with local Browse/My Tickets/History"
```

---

### Task 8: Mobile — Instant Lottery (Scratch Card) page

**Files:**
- Create: `mobile/lib/features/games/betting/lottery_scratch_page.dart`

**Interfaces:**
- Consumes: `GET /api/betting/lottery/scratch/products`, `POST /api/betting/lottery/scratch/buy`, `GET /api/betting/lottery/scratch/my-tickets` (Task 3), `GET /api/wallet/balance` (pre-existing).
- Produces: `LotteryScratchPage()` (no required params) — Task 6 depends on this exact constructor.

- [ ] **Step 1: Create the file**

```dart
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Instant Lottery — Scratch Card catalog + scratch-to-reveal + My Tickets
// ─────────────────────────────────────────────────────────────────────────────
class LotteryScratchPage extends StatefulWidget {
  const LotteryScratchPage({super.key});

  @override
  State<LotteryScratchPage> createState() => _LotteryScratchPageState();
}

class _LotteryScratchPageState extends State<LotteryScratchPage> with SingleTickerProviderStateMixin {
  late final TabController _tab;
  List<dynamic> _products = [];
  List<dynamic> _myTickets = [];
  bool _loading = true;
  bool _myLoading = false;
  double _balance = 0;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging && _tab.index == 1 && _myTickets.isEmpty) _loadMyTickets();
    });
    _loadProducts();
    _loadBalance();
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/scratch/products');
      if (!mounted) return;
      setState(() { _products = res.data['products'] ?? []; _loading = false; });
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
      final res = await ApiClient().dio.get('/api/betting/lottery/scratch/my-tickets');
      if (!mounted) return;
      setState(() { _myTickets = res.data['tickets'] ?? []; _myLoading = false; });
    } catch (_) {
      if (mounted) setState(() => _myLoading = false);
    }
  }

  Future<void> _buy(dynamic product) async {
    final price = double.tryParse(product['price']?.toString() ?? '0') ?? 0;
    if (price > _balance) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Insufficient balance — you have ₹${_balance.toStringAsFixed(0)}'),
        backgroundColor: AppColors.red,
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    try {
      final res = await ApiClient().dio.post('/api/betting/lottery/scratch/buy',
          data: {'product_id': product['id']});
      if (!mounted) return;
      _loadBalance();
      await Navigator.push(context, MaterialPageRoute(
        builder: (_) => _ScratchRevealScreen(
          productName: product['name'] ?? 'Scratch Card',
          outcome: res.data['outcome'],
          amount: double.tryParse(res.data['amount']?.toString() ?? '0') ?? 0,
          promoCode: res.data['promo_code'],
        ),
      ));
      _loadMyTickets();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Purchase failed — please try again'),
        backgroundColor: AppColors.red,
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  double _topPrize(dynamic product) {
    final payouts = (product['payouts'] as List?) ?? [];
    double top = 0;
    for (final p in payouts) {
      if (p['outcome'] == 'cash') {
        final amt = double.tryParse(p['amount']?.toString() ?? '0') ?? 0;
        if (amt > top) top = amt;
      }
    }
    return top;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('✨', style: TextStyle(fontSize: 18)),
            SizedBox(width: 6),
            Text('INSTANT LOTTERY',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                    color: AppColors.goldLight)),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.account_balance_wallet_rounded, size: 13, color: AppColors.gold),
                const SizedBox(width: 5),
                Text('₹${_balance.toStringAsFixed(0)}',
                    style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tab,
          indicatorColor: AppColors.gold,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
          tabs: const [Tab(text: 'Browse'), Tab(text: 'My Tickets')],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [_browseTab(), _myTicketsTab()],
      ),
    );
  }

  Widget _browseTab() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_products.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.auto_awesome_rounded, size: 64, color: AppColors.textSecondary.withValues(alpha: 0.2)),
            const SizedBox(height: 18),
            const Text('No scratch cards available right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadProducts,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
          childAspectRatio: 0.82,
        ),
        itemCount: _products.length,
        itemBuilder: (_, i) => _productCard(_products[i]),
      ),
    );
  }

  Widget _productCard(dynamic product) {
    final price = double.tryParse(product['price']?.toString() ?? '0') ?? 0;
    final topPrize = _topPrize(product);
    return InkWell(
      onTap: () {
        SoundService.instance.play(Sfx.buttonTap);
        _buy(product);
      },
      borderRadius: BorderRadius.circular(18),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: const LinearGradient(
            colors: [Color(0xFF3B0764), Color(0xFF1E1033)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: Colors.purpleAccent.withValues(alpha: 0.3)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.auto_awesome_rounded, color: Colors.purpleAccent, size: 28),
              const Spacer(),
              Text(product['name'] ?? 'Scratch Card',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13.5)),
              const SizedBox(height: 6),
              if (topPrize > 0)
                Text('Win up to ₹${topPrize.toStringAsFixed(0)}',
                    style: const TextStyle(color: AppColors.goldLight, fontSize: 11, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.gold,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('₹${price.toStringAsFixed(0)}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.black, fontWeight: FontWeight.w900, fontSize: 13)),
              ),
            ],
          ),
        ),
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
            const Text('No scratch cards bought yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
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
    final outcome = t['outcome']?.toString() ?? 'no_win';
    final amount = double.tryParse(t['amount']?.toString() ?? '0') ?? 0;
    final promoCode = t['promo_code']?.toString();
    final isWin = outcome == 'cash' || outcome == 'coupon';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isWin ? AppColors.green.withValues(alpha: 0.06) : AppColors.cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isWin ? AppColors.green.withValues(alpha: 0.35) : AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(t['product_name'] ?? 'Scratch Card',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13.5)),
          ),
          if (outcome == 'cash')
            Text('Won ₹${amount.toStringAsFixed(0)}',
                style: const TextStyle(color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 13))
          else if (outcome == 'coupon')
            Text('Coupon: ${promoCode ?? '—'}',
                style: const TextStyle(color: Colors.purpleAccent, fontWeight: FontWeight.w900, fontSize: 12))
          else
            const Text('No Win', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Scratch Reveal Screen — result is already known; scratching is presentational
// ─────────────────────────────────────────────────────────────────────────────
class _ScratchRevealScreen extends StatefulWidget {
  const _ScratchRevealScreen({
    required this.productName,
    required this.outcome,
    required this.amount,
    required this.promoCode,
  });
  final String productName;
  final String outcome;
  final double amount;
  final String? promoCode;

  @override
  State<_ScratchRevealScreen> createState() => _ScratchRevealScreenState();
}

class _ScratchRevealScreenState extends State<_ScratchRevealScreen> {
  final List<Offset> _scratchPoints = [];
  bool _revealed = false;
  static const double _revealThreshold = 0.55;

  void _addScratchPoint(Offset p) {
    setState(() => _scratchPoints.add(p));
    if (!_revealed && _scratchPoints.length > 40) {
      setState(() => _revealed = true);
      if (widget.outcome == 'cash' || widget.outcome == 'coupon') {
        SoundService.instance.play(Sfx.win);
        HapticFeedback.heavyImpact();
      } else {
        HapticFeedback.lightImpact();
      }
    }
  }

  Widget _resultContent() {
    if (widget.outcome == 'cash') {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.emoji_events_rounded, color: AppColors.goldLight, size: 48),
          const SizedBox(height: 12),
          Text('You Won ₹${widget.amount.toStringAsFixed(0)}!',
              style: const TextStyle(color: AppColors.goldLight, fontSize: 22, fontWeight: FontWeight.w900)),
        ],
      );
    }
    if (widget.outcome == 'coupon') {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.card_giftcard_rounded, color: Colors.purpleAccent, size: 48),
          const SizedBox(height: 12),
          const Text('You Won a Coupon!',
              style: TextStyle(color: Colors.purpleAccent, fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 6),
          Text(widget.promoCode ?? '',
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 2)),
        ],
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.sentiment_dissatisfied_rounded, color: AppColors.textSecondary.withValues(alpha: 0.6), size: 48),
        const SizedBox(height: 12),
        const Text('Better Luck Next Time',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 18, fontWeight: FontWeight.w800)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF03070A),
        elevation: 0,
        leading: const BackButton(color: AppColors.gold),
        title: Text(widget.productName,
            style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700)),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Scratch the card to reveal your result',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 20),
              SizedBox(
                width: 300,
                height: 300,
                child: Stack(
                  children: [
                    Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        color: const Color(0xFF11161C),
                        border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
                      ),
                      alignment: Alignment.center,
                      child: _resultContent(),
                    ),
                    if (!_revealed)
                      GestureDetector(
                        onPanUpdate: (details) => _addScratchPoint(details.localPosition),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(20),
                          child: CustomPaint(
                            size: const Size(300, 300),
                            painter: _ScratchOverlayPainter(points: _scratchPoints),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
              if (_revealed)
                ElevatedButton(
                  onPressed: () => Navigator.pop(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.gold,
                    foregroundColor: Colors.black,
                    minimumSize: const Size(200, 48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w900)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// Paints an opaque scratch-off layer with holes punched out at every
// dragged point — a simple, dependency-free stand-in for a real scratch
// texture. The underlying result is already rendered beneath this layer;
// scratching only reveals it, it never determines it.
class _ScratchOverlayPainter extends CustomPainter {
  final List<Offset> points;
  _ScratchOverlayPainter({required this.points});

  @override
  void paint(Canvas canvas, Size size) {
    final layerPaint = Paint();
    canvas.saveLayer(Offset.zero & size, layerPaint);

    final basePaint = Paint()
      ..shader = const LinearGradient(
        colors: [Color(0xFF9CA3AF), Color(0xFF4B5563)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, basePaint);

    final holePaint = Paint()
      ..blendMode = ui.BlendMode.clear
      ..style = PaintingStyle.fill;
    for (final p in points) {
      canvas.drawCircle(p, 24, holePaint);
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _ScratchOverlayPainter oldDelegate) => true;
}
```

- [ ] **Step 2: Verify the whole project analyzes clean**

Run: `cd mobile && dart analyze lib/`
Expected: no errors anywhere. Only pre-existing unrelated warnings in other files (`ludo_game_page.dart`/`wallet_page.dart`/`location_consent_service.dart`, and the `withOpacity` deprecation infos in files this plan didn't touch) are acceptable. `lottery_page.dart`, `lottery_draws_page.dart`, and `lottery_scratch_page.dart` must all be free of errors and warnings (info-level notices about `withOpacity` should not appear in these three files since all three consistently use `withValues` per this plan's code).

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/features/games/betting/lottery_scratch_page.dart
git commit -m "feat(lottery-mobile): Instant Lottery scratch card catalog + scratch-to-reveal"
```

---

### Task 9: End-to-end verification against the live VPS

**Files:** none (deployment + manual verification only)

**Interfaces:** none — this task exercises the full stack built in Tasks 1-8.

- [ ] **Step 1: Push and pull onto the VPS**

Run locally: `git push origin feature/admin-responsive`
Run on VPS: `cd /opt/teen-prod && git status --short` — expect only the known pre-existing untracked files.
Run on VPS: `git fetch origin && git reset --hard origin/feature/admin-responsive`

- [ ] **Step 2: Run the migration**

Run on VPS: `docker exec -i teen_postgres psql -U teen -d teen_db < /opt/teen-prod/infra/db/migrations/074_lottery_scratch_cards.sql`
Expected: `BEGIN`, `CREATE TABLE` ×2, `CREATE INDEX` ×2, `COMMIT`.

- [ ] **Step 3: Rebuild and restart the backend, rebuild and redeploy the admin panel**

Run on VPS: `cd /opt/teen-prod/services/core-api-service && npm run build && pm2 restart teen-core-api`
Run on VPS: `cd /opt/teen-prod/services/admin-service && npm run build && pm2 restart teen-admin-svc`
Run on VPS: `cd /opt/teen-prod/admin-panel && npm install --no-audit --no-fund && VITE_API_BASE_URL='' npm run build -- --base=/admin/`
Run on VPS: `rm -rf /home/admin/web/game.myonlinejoker.com/public_html/admin/* && cp -r /opt/teen-prod/admin-panel/dist/* /home/admin/web/game.myonlinejoker.com/public_html/admin/ && chown -R admin:admin /home/admin/web/game.myonlinejoker.com/public_html/admin/`
Expected: both backend builds succeed with no tsc errors, both processes show `online` in `pm2 status`, admin panel build succeeds.

- [ ] **Step 4: Verify health**

Run on VPS: `curl -s http://127.0.0.1:3001/health` — expect `{"status":"ok",...}`.
Run: `curl -s -o /dev/null -w '%{http_code}\n' https://game.myonlinejoker.com/admin/` — expect `200`.

- [ ] **Step 5: Create a test scratch product covering all three outcome types**

First, find an existing active promo code to link (or create a test one via the admin panel/`POST /api/admin/promo-codes` if none exist), then:

```bash
curl -s -X POST http://127.0.0.1:3001/internal/lottery/scratch/create -H 'Content-Type: application/json' -H 'x-internal-key: <INTERNAL_SERVICE_KEY>' -d '{"name":"Test Scratch ₹10","price":10,"payouts":[{"outcome":"cash","amount":50,"probability":10},{"outcome":"coupon","promo_code_id":"<existing promo_codes.id>","probability":10},{"outcome":"no_win","probability":80}]}'
```
Expected: `{"success":true,"product":{...,"payouts":[...]}}`.

Try an invalid payload with probabilities not summing to 100: expect `400 {"error":"Payout probabilities must sum to 100"}`.

- [ ] **Step 6: Buy several tickets and verify the distribution + settlement**

Using a real user JWT (mint one via `jsonwebtoken` + the service's `JWT_SECRET`, same approach used in prior lottery verification):

```bash
for i in $(seq 1 30); do
  curl -s -X POST http://127.0.0.1:3001/lottery/scratch/buy -H 'Content-Type: application/json' -H "Authorization: Bearer <token>" -d '{"product_id":"<product id from step 5>"}'
  echo
done
```
Expected: a mix of `{"success":true,...,"outcome":"cash","amount":50,...}`, `{"success":true,...,"outcome":"coupon","promo_code":"<code>",...}`, and `{"success":true,...,"outcome":"no_win","amount":0,...}` responses roughly matching the configured 10/10/80 split (exact counts will vary — this is a statistical check, not exact).

Run: `docker exec -i teen_postgres psql -U teen -d teen_db -c "SELECT outcome, COUNT(*), SUM(amount) FROM lottery_scratch_tickets GROUP BY outcome;"`
Expected: row counts roughly matching the 10/10/80 split across 30 purchases, and `SUM(amount)` for the `cash` group equal to `50 × <cash count>`.

Verify a wallet debit actually happened for one purchase and a credit happened for a `cash` outcome by checking the user's `/api/wallet/balance` before and after, or by inspecting the wallet-service's transaction log if convenient.

- [ ] **Step 7: Verify the admin panel Instant Lottery tab**

Manually (or describe for the user to confirm): open the admin panel Lottery page, confirm a new "Instant Lottery" tab exists alongside "Weekly & Monthly Draws", showing the test product with its payout tags, sold/revenue/paid-out stats, and an active/inactive toggle that works.

- [ ] **Step 8: Clean up the test product**

```bash
docker exec -i teen_postgres psql -U teen -d teen_db -c "DELETE FROM lottery_scratch_tickets WHERE product_id IN (SELECT id FROM lottery_scratch_products WHERE name LIKE 'Test %'); DELETE FROM lottery_scratch_products WHERE name LIKE 'Test %';"
```

- [ ] **Step 9: Build and hand off the mobile APK**

Run locally: `cd mobile && flutter build apk --release`
Expected: `√ Built build\app\outputs\flutter-apk\app-release.apk (...)`, no errors.

Report back to the user: migration ran clean, both backend services healthy, admin panel shows the new Instant Lottery tab with working product CRUD, the buy→roll→settle flow verified statistically across 30 purchases with correct wallet debits/credits, test product cleaned up, new APK built. Ask the user to install the APK and manually confirm: the Lottery page now opens to a menu of 4 type cards, Weekly/Monthly still work exactly as before (now inside their own page with local Browse/My Tickets/History), Daily shows Coming Soon, and Instant Lottery's catalog → buy → scratch-to-reveal flow feels right, before considering this cycle fully shipped.
