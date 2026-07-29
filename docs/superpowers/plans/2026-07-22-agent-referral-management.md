# Agent Referral Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can see how their referral link performs — clicks, signups, conversion rate, daily breakdown — and get a real shareable link with a copy button, instead of just a bare referral code.

**Architecture:** A new `referral_clicks` table records every hit of the public `/join?ref=CODE` landing page via a new unauthenticated `POST /referral/click` endpoint on `core-api-service`. Signups are already attributed via the existing `users.agent_id` column. A new `GET /agent-portal/referrals` endpoint on `admin-service` (behind the existing agent JWT guard) merges clicks and signups by day and returns totals + a daily breakdown, which the Agent Portal UI renders as a new tab.

**Tech Stack:** Fastify + Zod + `pg` (`core-api-service`, `admin-service`), vitest (admin-service unit tests), React + antd (`admin-panel`), nginx (HestiaCP custom conf).

## Global Constraints

- No dedup, no IP/device storage — every page load of `/join?ref=CODE` counts as one click (per spec decision).
- Daily breakdown window: last 90 days, matching the existing `/agent-portal/ledger` endpoint's window.
- `conversion_rate` is `signups / clicks`, and must be `0` (not `NaN`/`Infinity`) when `clicks` is `0`.
- This repo proxies each API namespace through its own explicit nginx `location` block (no catch-all `/api/`) — a new backend route is NOT reachable in production without a matching nginx block.
- admin-service has vitest (`services/admin-service/tests/*.test.ts`, run via `npm test`); wallet-service and core-api-service do not — only write automated tests for the admin-service task, matching this repo's existing per-service convention.
- The `/join` landing page is served on the VPS from `/opt/teen/infra/web/join/`, a directory **outside** the git-tracked `/opt/teen-prod` checkout — flagged again in Task 4, do not skip it at deploy time.

---

### Task 1: Database — `referral_clicks` table

**Files:**
- Create: `infra/db/migrations/087_referral_clicks.sql`

**Interfaces:**
- Produces: table `referral_clicks(id UUID, ref_code VARCHAR(20), clicked_at TIMESTAMPTZ)`, index `idx_referral_clicks_ref_code(ref_code)`. Task 2 inserts into it; Task 5 reads from it.

- [ ] **Step 1: Write the migration**

```sql
-- Records every hit of the /join?ref=CODE referral landing page. No IP/UA/
-- device data — a click is just "this ref code was hit at this time," by
-- design (see docs/superpowers/specs/2026-07-22-agent-referral-management-design.md).
-- Logged for any ref code (agent or regular user) indiscriminately; readers
-- filter by the ref_code they care about.
CREATE TABLE referral_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code VARCHAR(20) NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_clicks_ref_code ON referral_clicks(ref_code);
```

- [ ] **Step 2: Verify the SQL is valid**

Run: `grep -c "CREATE TABLE\|CREATE INDEX" infra/db/migrations/087_referral_clicks.sql`
Expected: `2`

(This migration is applied to the real database only as part of a VPS deploy via `infra/db/apply-migrations.sh` — there is no local Postgres in this environment to apply it against directly. Do not attempt to spin one up; the deploy step handles it.)

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/087_referral_clicks.sql
git commit -m "feat(referral): add referral_clicks table for agent link-click tracking"
```

---

### Task 2: Backend — click-tracking endpoint on `core-api-service`

**Files:**
- Create: `services/core-api-service/src/plugins/referral.ts`
- Modify: `services/core-api-service/src/index.ts` (add import + registration, alongside the existing `analyticsPlugin` registration)

**Interfaces:**
- Consumes: `referral_clicks` table from Task 1 (column names must match exactly: `ref_code`, `clicked_at`).
- Produces: `POST /referral/click` — internal route path (nginx in Task 3 maps external `/api/referral/click` to this). Body `{ ref_code: string }` (1-20 chars). Always responds `200 { success: true }` on a syntactically valid body; a `ref_code` that doesn't match any real agent/user is still recorded (no validation against `agents`/`users`, per spec — logging is intentionally blind and cheap).

- [ ] **Step 1: Read the existing `analytics.ts` plugin for the pattern to follow**

Run: `cat services/core-api-service/src/plugins/analytics.ts`
Expected: shows the `analyticsPlugin(db: Pool)` factory function pattern — a function that takes `db` and returns an `async function (app: FastifyInstance) { ... }`, registered as `await app.register(analyticsPlugin(db))` with no path prefix.

- [ ] **Step 2: Write the new plugin file**

Create `services/core-api-service/src/plugins/referral.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Public, unauthenticated click tracking for the /join?ref=CODE referral
// landing page (infra/web/join/index.html). See
// docs/superpowers/specs/2026-07-22-agent-referral-management-design.md
export function referralPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    // POST /referral/click — logs a hit for any ref_code, no validation
    // against agents/users (intentionally blind and cheap; the reader in
    // agent-portal-routes.ts filters by the exact code it cares about).
    app.post('/referral/click', async (req, reply) => {
      const body = z.object({
        ref_code: z.string().min(1).max(20),
      }).parse(req.body)

      await db.query(
        `INSERT INTO referral_clicks (ref_code) VALUES ($1)`,
        [body.ref_code]
      )
      return reply.send({ success: true })
    })
  }
}
```

- [ ] **Step 3: Register the plugin in `index.ts`**

Modify `services/core-api-service/src/index.ts`. Replace:

```typescript
import { analyticsPlugin } from './plugins/analytics'
```

With:

```typescript
import { analyticsPlugin } from './plugins/analytics'
import { referralPlugin } from './plugins/referral'
```

Replace:

```typescript
  await app.register(analyticsPlugin(db))
```

With:

```typescript
  await app.register(analyticsPlugin(db))
  await app.register(referralPlugin(db))
```

- [ ] **Step 4: Build check**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/plugins/referral.ts services/core-api-service/src/index.ts
git commit -m "feat(referral): add public click-tracking endpoint on core-api-service"
```

---

### Task 3: nginx — route `/api/referral/` to core-api-service

**Files:**
- Modify: `infra/nginx/hestia-proxy.conf`

**Interfaces:**
- Consumes: Task 2's `POST /referral/click` internal route.
- Produces: external path `/api/referral/click` reachable from the public internet, proxied to `127.0.0.1:3001` (core-api-service's port, confirmed by the existing `/api/analytics/` and `/api/users/` blocks in this same file).

- [ ] **Step 1: Read the existing `/api/analytics/` block for the exact style to match**

Run: `grep -n -A8 "location /api/analytics/" infra/nginx/hestia-proxy.conf`
Expected: shows a `location` block with a `rewrite` line, `proxy_pass http://127.0.0.1:3001;`, and standard proxy headers.

- [ ] **Step 2: Add the new location block**

Modify `infra/nginx/hestia-proxy.conf`. Insert immediately after the existing `/api/analytics/` block (after its closing `}`, before the `# ── WebSocket: Aviator Engine` comment):

```nginx

# ── Referral click tracking → core-api ──
location /api/referral/ {
    rewrite ^/api/referral/(.*) /referral/$1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

This rewrite strips only the `/api` segment (keeping `/referral/...`), matching the `/api/users/`, `/api/wallet/`, and `/api/leaderboard/` blocks in this same file (not the `/api/analytics/` block, which strips the whole namespace — that one doesn't apply here since Task 2's route keeps the `referral` segment).

- [ ] **Step 3: Verify the block was added correctly**

Run: `grep -n -A8 "location /api/referral/" infra/nginx/hestia-proxy.conf`
Expected: shows the new block exactly as written above.

- [ ] **Step 4: Commit**

```bash
git add infra/nginx/hestia-proxy.conf
git commit -m "feat(referral): add nginx route for /api/referral/ -> core-api-service"
```

(This file is only live once deployed to the VPS's actual HestiaCP conf path and reloaded — that's a deploy-time step, not part of this task. See the plan's Global Constraints and Task 4 for the related `/join` static-file deploy-path gotcha.)

---

### Task 4: Referral landing page — fire the click beacon

**Files:**
- Modify: `infra/web/join/index.html`

**Interfaces:**
- Consumes: Task 2/3's `POST /api/referral/click` endpoint (now reachable from this same-origin static page).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the existing inline script to confirm the exact insertion point**

Run: `grep -n -A5 "var ref = params.get" infra/web/join/index.html`
Expected:
```
      var ref = params.get('ref') || '';

      if (ref) {
        document.getElementById('refCode').textContent = ref;
        document.getElementById('refInline').textContent = ref;
      }
```

- [ ] **Step 2: Add the tracking beacon**

Modify `infra/web/join/index.html`. Replace:

```javascript
      if (ref) {
        document.getElementById('refCode').textContent = ref;
        document.getElementById('refInline').textContent = ref;
      }
```

With:

```javascript
      if (ref) {
        document.getElementById('refCode').textContent = ref;
        document.getElementById('refInline').textContent = ref;

        // Fire-and-forget click tracking — never let a tracking failure
        // block the download buttons below.
        fetch('/api/referral/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref_code: ref }),
          keepalive: true,
        }).catch(function () {});
      }
```

- [ ] **Step 3: Verify the change**

Run: `grep -n "referral/click" infra/web/join/index.html`
Expected: one match, inside the new `fetch(...)` call.

- [ ] **Step 4: Commit**

```bash
git add infra/web/join/index.html
git commit -m "feat(referral): fire click-tracking beacon from the /join landing page"
```

**Deploy reminder for later (not part of this task's steps, called out so it isn't missed):** this file lives on the VPS at `/opt/teen/infra/web/join/index.html`, outside the git-tracked `/opt/teen-prod` checkout that a normal `git pull` updates. Deploying this change requires an explicit `cp` to that path in addition to the usual deploy steps — see the plan's Global Constraints.

---

### Task 5: Backend — referral metrics + agent-facing endpoint on `admin-service`

**Files:**
- Create: `services/admin-service/src/referral-metrics.ts`
- Create: `services/admin-service/tests/referral-metrics.test.ts`
- Modify: `services/admin-service/src/agent-portal-routes.ts` (add new route)

**Interfaces:**
- Consumes: `referral_clicks` table (Task 1); `users.agent_id`, `agents.id`, `agents.referral_code` (existing schema); the existing `authenticateAgent` guard already defined in `agent-portal-routes.ts`.
- Produces: exported from `referral-metrics.ts`:
  - `conversionRate(signups: number, clicks: number): number` — `0` when `clicks` is `0`, otherwise `signups / clicks` (not rounded/formatted — the caller/UI formats for display).
  - `mergeReferralRows(clickRows: { date: string; clicks: number }[], signupRows: { date: string; signups: number }[]): { date: string; clicks: number; signups: number; conversion_rate: number }[]` — a full outer join on `date` (a date present in only one input list gets `0` for the missing side), sorted ascending by `date`.
  These are consumed by the new route `GET /api/admin/agent-portal/referrals` (behind `authenticateAgent`), which returns `{ rows: <merged rows, last 90 days>, totals: { clicks, signups, conversion_rate } }` where `totals.clicks`/`totals.signups` are the sums across `rows` and `totals.conversion_rate` is `conversionRate(totals.signups, totals.clicks)`.

- [ ] **Step 1: Write the failing tests**

Create `services/admin-service/tests/referral-metrics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { conversionRate, mergeReferralRows } from '../src/referral-metrics'

describe('conversionRate', () => {
  it('is 0 when clicks is 0 (no divide-by-zero)', () => {
    expect(conversionRate(0, 0)).toBe(0)
    expect(conversionRate(5, 0)).toBe(0)
  })

  it('computes signups / clicks otherwise', () => {
    expect(conversionRate(25, 100)).toBe(0.25)
    expect(conversionRate(1, 4)).toBe(0.25)
  })
})

describe('mergeReferralRows', () => {
  it('merges matching dates from both lists', () => {
    const clicks = [{ date: '2026-07-20', clicks: 10 }]
    const signups = [{ date: '2026-07-20', signups: 2 }]
    expect(mergeReferralRows(clicks, signups)).toEqual([
      { date: '2026-07-20', clicks: 10, signups: 2, conversion_rate: 0.2 },
    ])
  })

  it('fills 0 for a date with clicks but no signups', () => {
    const clicks = [{ date: '2026-07-20', clicks: 10 }]
    const signups: { date: string; signups: number }[] = []
    expect(mergeReferralRows(clicks, signups)).toEqual([
      { date: '2026-07-20', clicks: 10, signups: 0, conversion_rate: 0 },
    ])
  })

  it('fills 0 for a date with signups but no clicks (e.g. code shared verbally, no link click)', () => {
    const clicks: { date: string; clicks: number }[] = []
    const signups = [{ date: '2026-07-20', signups: 3 }]
    expect(mergeReferralRows(clicks, signups)).toEqual([
      { date: '2026-07-20', clicks: 0, signups: 3, conversion_rate: 0 },
    ])
  })

  it('sorts merged rows ascending by date', () => {
    const clicks = [
      { date: '2026-07-22', clicks: 5 },
      { date: '2026-07-20', clicks: 10 },
    ]
    const signups = [{ date: '2026-07-21', signups: 1 }]
    const result = mergeReferralRows(clicks, signups)
    expect(result.map((r) => r.date)).toEqual(['2026-07-20', '2026-07-21', '2026-07-22'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/admin-service && npx vitest run tests/referral-metrics.test.ts`
Expected: FAIL — `Cannot find module '../src/referral-metrics'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `services/admin-service/src/referral-metrics.ts`:

```typescript
// Pure helpers for the agent-facing referral dashboard
// (GET /api/admin/agent-portal/referrals). Kept separate from the route
// handler so they're unit-testable without a database — see
// pnl-dashboard-routes.ts's computeRoiPct/bySign for the same pattern.

export function conversionRate(signups: number, clicks: number): number {
  if (clicks === 0) return 0
  return signups / clicks
}

interface ClickRow { date: string; clicks: number }
interface SignupRow { date: string; signups: number }
interface MergedRow { date: string; clicks: number; signups: number; conversion_rate: number }

export function mergeReferralRows(clickRows: ClickRow[], signupRows: SignupRow[]): MergedRow[] {
  const byDate = new Map<string, { clicks: number; signups: number }>()

  for (const row of clickRows) {
    byDate.set(row.date, { clicks: row.clicks, signups: byDate.get(row.date)?.signups ?? 0 })
  }
  for (const row of signupRows) {
    byDate.set(row.date, { clicks: byDate.get(row.date)?.clicks ?? 0, signups: row.signups })
  }

  return Array.from(byDate.entries())
    .map(([date, { clicks, signups }]) => ({
      date,
      clicks,
      signups,
      conversion_rate: conversionRate(signups, clicks),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/admin-service && npx vitest run tests/referral-metrics.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Add the route to `agent-portal-routes.ts`**

Modify `services/admin-service/src/agent-portal-routes.ts`. First, add the import at the top of the file. Replace:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
```

With:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { mergeReferralRows, conversionRate } from './referral-metrics'
```

Then add the new route. Replace:

```typescript
  // GET /api/admin/agent-portal/ledger — this agent's commission history
  app.get('/api/admin/agent-portal/ledger', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT date, direct_commission::float, override_commission::float, total_commission::float, status
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [agentId]
    )
    return reply.send(res.rows)
  })
```

With:

```typescript
  // GET /api/admin/agent-portal/ledger — this agent's commission history
  app.get('/api/admin/agent-portal/ledger', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT date, direct_commission::float, override_commission::float, total_commission::float, status
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agent-portal/referrals — click/signup funnel for this
  // agent's own referral_code, last 90 days, merged by day.
  app.get('/api/admin/agent-portal/referrals', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const agentRes = await db.query('SELECT referral_code FROM agents WHERE id = $1', [agentId])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    const referralCode = agentRes.rows[0].referral_code

    const [clicksRes, signupsRes] = await Promise.all([
      db.query(
        `SELECT clicked_at::date::text AS date, COUNT(*)::int AS clicks
         FROM referral_clicks
         WHERE ref_code = $1 AND clicked_at >= NOW() - INTERVAL '90 days'
         GROUP BY 1`,
        [referralCode]
      ),
      db.query(
        `SELECT created_at::date::text AS date, COUNT(*)::int AS signups
         FROM users
         WHERE agent_id = $1 AND created_at >= NOW() - INTERVAL '90 days'
         GROUP BY 1`,
        [agentId]
      ),
    ])

    const rows = mergeReferralRows(clicksRes.rows, signupsRes.rows)
    const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0)
    const totalSignups = rows.reduce((sum, r) => sum + r.signups, 0)

    return reply.send({
      rows,
      totals: {
        clicks: totalClicks,
        signups: totalSignups,
        conversion_rate: conversionRate(totalSignups, totalClicks),
      },
    })
  })
```

- [ ] **Step 6: Build check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Re-run the unit tests**

Run: `cd services/admin-service && npx vitest run tests/referral-metrics.test.ts`
Expected: PASS, 6/6 (confirms Step 5's import/wiring didn't break the pure functions).

- [ ] **Step 8: Commit**

```bash
git add services/admin-service/src/referral-metrics.ts services/admin-service/tests/referral-metrics.test.ts services/admin-service/src/agent-portal-routes.ts
git commit -m "feat(referral): add agent-facing referral funnel endpoint (clicks/signups/conversion)"
```

---

### Task 6: Agent Portal UI — shareable link + Referrals tab

**Files:**
- Modify: `admin-panel/src/pages/AgentPortal.tsx`

**Interfaces:**
- Consumes: `GET /agent-portal/referrals` (Task 5, reached via `adminApi` which already prefixes `/api/admin`) → `{ rows: [{date, clicks, signups, conversion_rate}], totals: {clicks, signups, conversion_rate} }`. `me.agent.referral_code` (already loaded by the existing `/agent-portal/me` call).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add `Typography` to the antd import and load the new data**

Modify `admin-panel/src/pages/AgentPortal.tsx`. Replace:

```typescript
import { Card, Table, Tabs, Statistic, Row, Col, Button, Modal, Form, InputNumber, Input, message } from 'antd'
```

With:

```typescript
import { Card, Table, Tabs, Statistic, Row, Col, Button, Modal, Form, InputNumber, Input, message, Typography } from 'antd'
```

Replace:

```typescript
  const [me, setMe] = useState<any>(null)
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const load = async () => {
    const [meRes, playersRes, ledgerRes] = await Promise.all([
      adminApi.get('/agent-portal/me'),
      adminApi.get('/agent-portal/players'),
      adminApi.get('/agent-portal/ledger'),
    ])
    setMe(meRes.data)
    setPlayers(playersRes.data)
    setLedger(ledgerRes.data)
  }
```

With:

```typescript
  const [me, setMe] = useState<any>(null)
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [referrals, setReferrals] = useState<{ rows: any[]; totals: any }>({ rows: [], totals: { clicks: 0, signups: 0, conversion_rate: 0 } })
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const load = async () => {
    const [meRes, playersRes, ledgerRes, referralsRes] = await Promise.all([
      adminApi.get('/agent-portal/me'),
      adminApi.get('/agent-portal/players'),
      adminApi.get('/agent-portal/ledger'),
      adminApi.get('/agent-portal/referrals'),
    ])
    setMe(meRes.data)
    setPlayers(playersRes.data)
    setLedger(ledgerRes.data)
    setReferrals(referralsRes.data)
  }
```

- [ ] **Step 2: Turn the referral code stat card into a shareable link**

Replace:

```typescript
        <Col span={6}><Card><Statistic title="Your Referral Code" value={me.agent.referral_code} /></Card></Col>
```

With:

```typescript
        <Col span={6}>
          <Card>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Your Referral Link</Typography.Text>
            <div style={{ marginTop: 4 }}>
              <Typography.Text
                copyable={{ text: `${window.location.origin}/join?ref=${me.agent.referral_code}` }}
                style={{ fontSize: 13 }}
              >
                /join?ref={me.agent.referral_code}
              </Typography.Text>
            </div>
          </Card>
        </Col>
```

- [ ] **Step 3: Add the Referrals tab**

Replace:

```typescript
          {
            key: 'ledger', label: 'Commission History',
            children: <Table rowKey="date" dataSource={ledger} columns={[
              { title: 'Date', dataIndex: 'date' },
              { title: 'Direct', dataIndex: 'direct_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Override', dataIndex: 'override_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Total', dataIndex: 'total_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            ]} />,
          },
        ]}
      />
```

With:

```typescript
          {
            key: 'ledger', label: 'Commission History',
            children: <Table rowKey="date" dataSource={ledger} columns={[
              { title: 'Date', dataIndex: 'date' },
              { title: 'Direct', dataIndex: 'direct_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Override', dataIndex: 'override_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Total', dataIndex: 'total_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            ]} />,
          },
          {
            key: 'referrals', label: 'Referrals',
            children: <>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}><Card><Statistic title="Total Clicks" value={referrals.totals.clicks} /></Card></Col>
                <Col span={8}><Card><Statistic title="Total Signups" value={referrals.totals.signups} /></Card></Col>
                <Col span={8}><Card><Statistic title="Conversion Rate" value={referrals.totals.conversion_rate * 100} precision={1} suffix="%" /></Card></Col>
              </Row>
              <Table rowKey="date" dataSource={referrals.rows} columns={[
                { title: 'Date', dataIndex: 'date' },
                { title: 'Clicks', dataIndex: 'clicks' },
                { title: 'Signups', dataIndex: 'signups' },
                { title: 'Conversion', dataIndex: 'conversion_rate', render: (v: number) => `${(v * 100).toFixed(1)}%` },
              ]} />
            </>,
          },
        ]}
      />
```

- [ ] **Step 4: Build check**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/AgentPortal.tsx
git commit -m "feat(referral): show shareable link + Referrals tab in Agent Portal"
```
