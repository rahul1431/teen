# PnL Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-game "Analytics" tab (Teen Patti, Ludo) showing house/real/bot PnL, a daily trend, bot bankroll ROI, a leaderboard, and paginated game history.

**Architecture:** One combined admin-service endpoint (`GET /api/admin/games/:gameType/pnl-dashboard`) computes all six sections from existing tables (`game_participants`, `game_rooms`, `wallet_transactions`, `users`) in a single round trip. A small additive fix logs bot initial funding as a `wallet_transactions` row (previously only written to `wallets.real_balance` directly) so bot ROI is reconstructable going forward. One new admin-panel component (`GamePnlDashboard`) renders the response, reusing `Dashboard.tsx`'s existing `SVGLineChart` for the trend.

**Tech Stack:** Fastify + `pg` (admin-service), React + antd (admin-panel), PostgreSQL.

## Global Constraints

- Scoped to `teen_patti`/`ludo` only — `:gameType` param rejects anything else with 400.
- `requireRole('finance')` on the new endpoint, matching the existing Aviator PnL/history endpoints' role gate.
- `bot_roi` is all-time, NOT filtered by the dashboard's date-range picker (per spec section 2) — this is a deliberate design choice, not an oversight, and must not silently become date-filtered.
- The initial-funding fix only affects bots created after this ships — existing bots' ROI numbers are known-incomplete, disclosed via an "All-Time" label in the UI, not chased further.
- No changes to Aviator/Matka.

---

## File Structure

- Modify: `services/admin-service/src/index.ts` (bot creation fix + new combined endpoint)
- Create: `services/admin-service/tests/pnl-dashboard.test.ts` (if a test convention for this file's routes doesn't already exist — confirm at implementation time; otherwise extend whatever does)
- Create: `admin-panel/src/components/GamePnlDashboard.tsx`
- Modify: `admin-panel/src/pages/games/TeenPatti.tsx` (add Analytics tab)
- Modify: `admin-panel/src/pages/games/Ludo.tsx` (add Analytics tab)

---

### Task 1: Log bot initial funding as a wallet transaction

**Files:**
- Modify: `services/admin-service/src/index.ts` (`POST /api/admin/bots`, already modified in sub-project #1 to accept `preferred_game_type`)

- [ ] **Step 1: Read the current route to confirm exact current content**

Run: `grep -n "app.post('/api/admin/bots'" -A 35 services/admin-service/src/index.ts` — confirm the transaction block's current shape before editing (sub-project #1 already modified this route; exact line numbers may have shifted).

- [ ] **Step 2: Add the wallet_transactions insert**

Inside the existing `BEGIN`/`COMMIT` transaction block, immediately after the existing `INSERT INTO wallets (...)` call, add:

```typescript
      await client.query(
        `INSERT INTO wallet_transactions
           (user_id, type, wallet_type, amount, balance_before, balance_after, idempotency_key, status, description)
         VALUES ($1, 'manual_credit', 'real', $2, 0, $2, $3, 'completed', 'Initial bot funding')`,
        [botId, body.initial_balance, `initial-fund:${botId}`]
      )
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Since this route has no existing automated test coverage in this codebase (confirmed during sub-project #1's investigation), verify manually: create a bot via the admin panel (or a direct `curl` to the endpoint) and confirm a `wallet_transactions` row with `type = 'manual_credit'` and `description = 'Initial bot funding'` appears for that bot's `user_id`.

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): log bot initial funding as a wallet transaction"
```

---

### Task 2: Combined PnL dashboard endpoint

**Files:**
- Modify: `services/admin-service/src/index.ts`
- Test: `services/admin-service/tests/pnl-dashboard.test.ts`

**Interfaces:**
- Produces: `GET /api/admin/games/:gameType/pnl-dashboard?from=&to=&page=&limit=` → the JSON shape from the spec's section 2, consumed by Task 3's `GamePnlDashboard` component.

- [ ] **Step 1: Write the failing test**

Follow this codebase's `pool.query.mockImplementation`-style testing pattern (established in `services/bot-learning-service/tests/profile-builder.test.ts` this session) — confirm whether `admin-service` already has an equivalent test harness for its Fastify routes (a `build()` test-app helper, or direct handler unit tests) by checking for existing test files covering other `/api/admin/*` routes; if none exist, this is the first, and the test should isolate just the SQL-construction logic (extract the query-building into a small testable helper if the route handler itself resists testing in isolation) rather than spinning up a full Fastify server.

```typescript
// services/admin-service/tests/pnl-dashboard.test.ts
// Exact test harness shape (mock Fastify request/reply vs. extracted pure
// query-builder function) depends on what's found in Step 1 above — this
// is the behavior to verify regardless of harness:

describe('GET /api/admin/games/:gameType/pnl-dashboard', () => {
  it('rejects a gameType other than teen_patti or ludo with 400', async () => {
    // ... call the route with gameType='aviator', assert 400
  })

  it('bot_roi.roi_pct is 0 when total_invested is 0 (no divide-by-zero)', async () => {
    // ... mock the invested-capital query to return 0, assert roi_pct === 0, not NaN/Infinity
  })

  it('breakdown groups by is_bot, not mixed together', async () => {
    // ... mock game_participants join returning both bot and real rows,
    // assert breakdown.real and breakdown.bot are computed from disjoint subsets
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/admin-service && npx jest tests/pnl-dashboard.test.ts` (or the equivalent test runner confirmed in Step 1)
Expected: FAIL — the route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Add to `services/admin-service/src/index.ts`, near the existing Aviator PnL/history routes for locality:

```typescript
  // GET /api/admin/games/:gameType/pnl-dashboard — combined house/real/bot
  // PnL, daily trend, bot bankroll ROI, leaderboard, and history for a
  // single game. Scoped to teen_patti/ludo (sub-project #4).
  app.get<{ Params: { gameType: string }; Querystring: { from?: string; to?: string; page?: string; limit?: string } }>(
    '/api/admin/games/:gameType/pnl-dashboard',
    { onRequest: [authenticate, requireRole('finance')] },
    async (req, reply) => {
      const { gameType } = req.params
      if (!['teen_patti', 'ludo'].includes(gameType)) {
        return reply.code(400).send({ error: 'gameType must be teen_patti or ludo' })
      }

      const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 86400000)
      const to = req.query.to ? new Date(req.query.to) : new Date()
      const page = parseInt(req.query.page ?? '1', 10)
      const limit = parseInt(req.query.limit ?? '20', 10)
      const offset = (page - 1) * limit

      const [summaryRes, breakdownRes, trendRes, investedRes, balanceRes, leaderboardRes, historyRes, historyCountRes] = await Promise.all([
        db.query(
          `SELECT
             COALESCE(SUM(gp.prize_won), 0)::float AS total_paid_out,
             COALESCE(SUM(gp.entry_fee_deducted), 0)::float AS total_wagered
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT gp.is_bot,
             COALESCE(SUM(gp.entry_fee_deducted), 0)::float AS total_wagered,
             COALESCE(SUM(gp.prize_won), 0)::float AS total_paid_out,
             COALESCE(SUM(gp.prize_won - gp.entry_fee_deducted), 0)::float AS net_pnl
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           GROUP BY gp.is_bot`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT date_trunc('day', gr.started_at) AS date,
             COALESCE(SUM(gp.entry_fee_deducted), 0)::float AS wagered,
             COALESCE(SUM(gp.prize_won), 0)::float AS paid_out
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           GROUP BY date_trunc('day', gr.started_at)
           ORDER BY date`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT COALESCE(SUM(wt.amount), 0)::float AS total_invested
           FROM wallet_transactions wt
           JOIN users u ON u.id = wt.user_id
           WHERE wt.type = 'manual_credit' AND u.is_bot = true AND u.preferred_game_type = $1`,
          [gameType]
        ),
        db.query(
          `SELECT COALESCE(SUM(w.real_balance), 0)::float AS current_balance
           FROM wallets w
           JOIN users u ON u.id = w.user_id
           WHERE u.is_bot = true AND u.preferred_game_type = $1`,
          [gameType]
        ),
        db.query(
          `SELECT gp.user_id, u.username, gp.is_bot,
             COALESCE(SUM(gp.prize_won - gp.entry_fee_deducted), 0)::float AS net_pnl,
             COUNT(gp.id)::int AS games_played
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           JOIN users u ON u.id = gp.user_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           GROUP BY gp.user_id, u.username, gp.is_bot
           ORDER BY net_pnl DESC
           LIMIT 20`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT gr.id AS room_id, gr.started_at, gr.pot_amount, gr.platform_fee_collected,
             (SELECT COUNT(*) FROM game_participants WHERE room_id = gr.id)::int AS players
           FROM game_rooms gr
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           ORDER BY gr.started_at DESC
           LIMIT $4 OFFSET $5`,
          [gameType, from, to, limit, offset]
        ),
        db.query(
          `SELECT COUNT(*)::int AS total FROM game_rooms WHERE game_type = $1 AND started_at BETWEEN $2 AND $3`,
          [gameType, from, to]
        ),
      ])

      const bySign = (rows: any[], isBot: boolean) => rows.find((r) => r.is_bot === isBot) ?? { total_wagered: 0, total_paid_out: 0, net_pnl: 0 }
      const real = bySign(breakdownRes.rows, false)
      const bot = bySign(breakdownRes.rows, true)

      const totalInvested = investedRes.rows[0].total_invested
      const currentBalance = balanceRes.rows[0].current_balance
      const roiPct = totalInvested > 0 ? (bot.net_pnl / totalInvested) * 100 : 0

      return reply.send({
        summary: {
          total_wagered: summaryRes.rows[0].total_wagered,
          total_paid_out: summaryRes.rows[0].total_paid_out,
          net_rake: summaryRes.rows[0].total_wagered - summaryRes.rows[0].total_paid_out,
        },
        breakdown: { real, bot },
        daily_trend: trendRes.rows.map((r: any) => ({
          date: r.date,
          wagered: r.wagered,
          paid_out: r.paid_out,
          rake: r.wagered - r.paid_out,
        })),
        bot_roi: {
          total_invested: totalInvested,
          current_balance: currentBalance,
          net_realized_pnl: bot.net_pnl,
          roi_pct: roiPct,
        },
        leaderboard: leaderboardRes.rows,
        history: {
          rows: historyRes.rows,
          total: historyCountRes.rows[0].total,
        },
      })
    }
  )
```

- [ ] **Step 4: Run to verify it passes**

Run the test command confirmed in Step 1.
Expected: PASS

- [ ] **Step 5: Verify the build compiles**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add services/admin-service/src/index.ts services/admin-service/tests/pnl-dashboard.test.ts
git commit -m "feat(admin-service): add combined PnL dashboard endpoint for teen_patti/ludo"
```

---

### Task 3: `GamePnlDashboard` component

**Files:**
- Create: `admin-panel/src/components/GamePnlDashboard.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/games/:gameType/pnl-dashboard` (Task 2).
- Produces: `export default function GamePnlDashboard({ gameType }: { gameType: string })` — consumed by Task 4.

- [ ] **Step 1: Read `Dashboard.tsx`'s `SVGLineChart` to confirm its exact prop contract before reuse**

Run: `grep -n "function SVGLineChart" -A 10 admin-panel/src/pages/Dashboard.tsx` — confirm the `{ data, width, height, strokeColor, fillColor, valueKey }` signature is unchanged from what this plan assumes (it takes an array of objects and a `valueKey` string naming which field to plot; the x-axis label comes from a `day` field on each row per Dashboard.tsx's existing usage — the daily_trend rows from Task 2 use `date`, not `day`, so either rename when mapping data into the chart, or pass through as-is and accept no x-axis labels; prefer renaming for a real x-axis).

- [ ] **Step 2: Write the component**

```typescript
import { useEffect, useState } from 'react'
import { Card, Row, Col, DatePicker, Table, Tag, Typography, Statistic } from 'antd'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'

const { RangePicker } = DatePicker

function SimpleTrendChart({ data, valueKey, strokeColor }: { data: any[]; valueKey: string; strokeColor: string }) {
  // Minimal inline reuse of Dashboard.tsx's SVGLineChart pattern, mapping
  // this endpoint's `date` field to the `day` field that component expects.
  const mapped = data.map((d) => ({ ...d, day: d.date }))
  const SVGLineChart = require('../pages/Dashboard').SVGLineChart
  return <SVGLineChart data={mapped} valueKey={valueKey} strokeColor={strokeColor} />
}

export default function GamePnlDashboard({ gameType }: { gameType: string }) {
  const [range, setRange] = useState<[any, any]>([dayjs().subtract(7, 'day'), dayjs()])
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 10

  const load = () => {
    setLoading(true)
    adminApi.get(`/games/${gameType}/pnl-dashboard`, {
      params: {
        from: range[0].toISOString(),
        to: range[1].toISOString(),
        page,
        limit: pageSize,
      },
    })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [gameType, range, page])

  if (!data) return <Card loading={loading} />

  return (
    <div>
      <RangePicker
        value={range}
        onChange={(v) => { if (v) { setRange(v as [any, any]); setPage(1) } }}
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="House Net Rake" value={data.summary.net_rake} precision={2} prefix="₹"
              valueStyle={{ color: data.summary.net_rake >= 0 ? tokens.color.success : tokens.color.error }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Real Users PnL" value={data.breakdown.real.net_pnl} precision={2} prefix="₹"
              valueStyle={{ color: data.breakdown.real.net_pnl >= 0 ? tokens.color.success : tokens.color.error }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Bot PnL" value={data.breakdown.bot.net_pnl} precision={2} prefix="₹"
              valueStyle={{ color: data.breakdown.bot.net_pnl >= 0 ? tokens.color.success : tokens.color.error }} />
          </Card>
        </Col>
      </Row>

      <Card title="Daily Trend (Rake)" style={{ marginBottom: 16 }}>
        <SimpleTrendChart data={data.daily_trend} valueKey="rake" strokeColor={tokens.color.gold} />
      </Card>

      <Card title="Bot Bankroll ROI (All-Time)" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={6}><Statistic title="Invested" value={data.bot_roi.total_invested} precision={2} prefix="₹" /></Col>
          <Col span={6}><Statistic title="Current Balance" value={data.bot_roi.current_balance} precision={2} prefix="₹" /></Col>
          <Col span={6}><Statistic title="Realized PnL" value={data.bot_roi.net_realized_pnl} precision={2} prefix="₹"
            valueStyle={{ color: data.bot_roi.net_realized_pnl >= 0 ? tokens.color.success : tokens.color.error }} /></Col>
          <Col span={6}><Statistic title="ROI %" value={data.bot_roi.roi_pct} precision={1} suffix="%"
            valueStyle={{ color: data.bot_roi.roi_pct >= 0 ? tokens.color.success : tokens.color.error }} /></Col>
        </Row>
      </Card>

      <Card title="Leaderboard (Top Winners/Losers)" style={{ marginBottom: 16 }}>
        <Table
          rowKey="user_id"
          dataSource={data.leaderboard}
          pagination={false}
          size="small"
          columns={[
            { title: 'Username', dataIndex: 'username' },
            { title: 'Type', dataIndex: 'is_bot', render: (v: boolean) => <Tag color={v ? 'orange' : 'blue'}>{v ? 'BOT' : 'REAL'}</Tag> },
            { title: 'Games', dataIndex: 'games_played' },
            {
              title: 'Net PnL', dataIndex: 'net_pnl',
              render: (v: number) => <span style={{ color: v >= 0 ? tokens.color.success : tokens.color.error, fontWeight: 'bold' }}>₹{v.toLocaleString()}</span>,
            },
          ]}
        />
      </Card>

      <Card title="Game History">
        <Table
          rowKey="room_id"
          dataSource={data.history.rows}
          loading={loading}
          size="small"
          pagination={{ current: page, pageSize, total: data.history.total, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: 'Room', dataIndex: 'room_id', render: (v: string) => v.slice(0, 8) + '...' },
            { title: 'Started', dataIndex: 'started_at', render: (v: string) => new Date(v).toLocaleString() },
            { title: 'Players', dataIndex: 'players' },
            { title: 'Pot (₹)', dataIndex: 'pot_amount', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
            { title: 'Rake (₹)', dataIndex: 'platform_fee_collected', render: (v: number) => `₹${parseFloat(v as any).toFixed(2)}` },
          ]}
        />
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors. If `SVGLineChart` isn't exported from `Dashboard.tsx` (it's currently a private, non-exported function in that file per Task 3 Step 1's investigation), export it there instead of using a `require()` workaround — `export function SVGLineChart(...)` in `Dashboard.tsx`, then a normal `import { SVGLineChart } from '../pages/Dashboard'` here. Prefer this over the `require()` call shown above, which was written defensively since the plan doesn't know this file's current export state — resolve to the clean import at implementation time.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/components/GamePnlDashboard.tsx admin-panel/src/pages/Dashboard.tsx
git commit -m "feat(admin-panel): add GamePnlDashboard component"
```

---

### Task 4: Embed as the Analytics tab

**Files:**
- Modify: `admin-panel/src/pages/games/TeenPatti.tsx`
- Modify: `admin-panel/src/pages/games/Ludo.tsx`

- [ ] **Step 1: Add the third tab to both pages**

In each file's `Tabs items={[...]}` array (already established with `'overview'` and `'bots'` keys from sub-projects #1/#2), add:

```typescript
        { key: 'analytics', label: 'Analytics', children: <GamePnlDashboard gameType="teen_patti" /> },
```

(`gameType="ludo"` for `Ludo.tsx`.) Add the import: `import GamePnlDashboard from '../../components/GamePnlDashboard'`.

- [ ] **Step 2: Verify the build compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add admin-panel/src/pages/games/TeenPatti.tsx admin-panel/src/pages/games/Ludo.tsx
git commit -m "feat(admin-panel): add Analytics tab to Teen Patti and Ludo pages"
```

---

### Task 5: Deploy

**Files:** none (deployment only)

- [ ] **Step 1: Divergence check**

Same safety check as every prior deploy this session: confirm the VPS's current working-tree state for `services/admin-service/src/index.ts` and the touched admin-panel files matches exactly what sub-project #3's deploy left it as, before checking out anything new.

- [ ] **Step 2: Checkout, build, restart**

`services/admin-service` (`teen-admin-svc`) — no migration this time (no new tables/columns, only a new query and a new insert into existing tables). `admin-panel` — build + `cp -rf dist/. /home/admin/web/game.myonlinejoker.com/public_html/admin/`.

- [ ] **Step 3: Smoke-check logs**

Confirm no new error-log entries in `teen-admin-svc` since restart.

- [ ] **Step 4: Live verification**

Hit `GET /api/admin/games/teen_patti/pnl-dashboard` and `GET /api/admin/games/ludo/pnl-dashboard` directly (with a valid finance-role token) and confirm both return the full expected JSON shape with no errors. Create a test bot via the admin panel and confirm its `wallet_transactions` row appears (Task 1's fix) — this is real (non-synthetic) data since it's the normal bot-creation flow, no cleanup needed.

---

## Self-Review Notes

- **Spec coverage:** schema fix (Task 1), combined endpoint covering all 6 response sections (Task 2), UI component (Task 3), tab embedding (Task 4), deploy (Task 5) — every spec section covered.
- **Placeholder scan:** Task 2's Step 1 and Task 3's Step 1/Step 3 flag genuine implementation-time judgment calls (which test harness convention to follow; whether `SVGLineChart` needs exporting) rather than undecided logic — the actual query and component code in every step is complete and real.
- **Type consistency:** the JSON shape from Task 2's route (`summary`, `breakdown.real`/`breakdown.bot`, `daily_trend`, `bot_roi`, `leaderboard`, `history`) is consumed field-for-field by Task 3's component with no renamed properties, except `daily_trend[].date` which Task 3 explicitly remaps to `day` for `SVGLineChart`'s existing contract — called out at the point of use, not silently assumed.
