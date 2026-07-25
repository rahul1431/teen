# Notifications: History, Views & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a history log, delivery/read analytics, and a trend chart for the two existing notification systems (user-facing push notifications, and admin-bell internal alerts) — today both either discard this data or never expose it.

**Architecture:** One new table (`notification_campaigns`) groups the per-recipient rows created by an admin-initiated push send into a single trackable record; a nullable `campaign_id` column on the existing `notifications` table links them. System-triggered sends (KYC/deposit/withdrawal confirmations) never pass a `campaign_id`, so they're unaffected and never appear in the new history/analytics. The admin-bell system needs no schema change — it already has full history data, just no sidebar link and no trend rollup.

**Tech Stack:** Fastify + `pg` (admin-service, core-api-service), React + antd + recharts (admin-panel), Vitest.

## Global Constraints

- Aggregate-only history — no per-recipient drill-down (confirmed scope).
- "Views" = both push delivery count (from Firebase's `sendEach`/`send` response) AND in-app read count (existing `read`/`read_at` columns).
- System-triggered notification sends (KYC approval, deposit confirmation, withdrawal confirmation — `services/admin-service/src/index.ts` lines ~538, ~859, ~965, all calling `/internal/notifications/send` directly) must NEVER create a campaign row or get a `campaign_id` — only sends through `POST /api/admin/notifications/broadcast` and `POST /api/admin/notifications/send` (the two routes behind the Notifications page's Send form) do.
- Follow this codebase's established pattern for DB-touching route handlers: extract pure, testable helper functions (filter builders, pagination resolvers, rate calculators) into their own module and unit-test those directly — see `services/admin-service/src/withdrawals-query.ts` / `withdrawals-query.test.ts` as the reference pattern. Full route handlers with live Postgres queries are verified by careful inspection against the schema, not live-executed (no local Postgres in this sandbox).
- Match existing chart styling: `admin-panel/src/components/BotTrainingTrendChart.tsx` is the reference for every new recharts component in this plan (Card wrapper, `Spin`, `ResponsiveContainer`, `dayjs` date formatting, `Empty` state).
- `menuConfig.test.ts` locks the exact set of navigable route keys — any sidebar addition must update `EXPECTED_KEYS` in the same task, not as an afterthought.

---

### Task 1: Migration — `notification_campaigns` table + `notifications.campaign_id`

**Files:**
- Create: `infra/db/migrations/20260726_notification_campaigns.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `notification_campaigns` table (columns below) and `notifications.campaign_id` (nullable UUID FK) — every later backend task reads/writes these.

- [ ] **Step 1: Write the migration**

```sql
-- Groups the per-recipient rows one admin-initiated push send creates
-- (broadcast or specific-user) into a single trackable record, so the
-- admin panel can show send history + delivery/read analytics instead of
-- losing that data the moment the send completes. System-triggered sends
-- (KYC/deposit/withdrawal confirmations) never populate campaign_id, so
-- they stay invisible to this history — only sends through the Notifications
-- page's Send form (POST /api/admin/notifications/broadcast|send) do.
CREATE TABLE notification_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('all', 'specific_user')),
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_by UUID NOT NULL REFERENCES admin_users(id),
  total_recipients INT NOT NULL DEFAULT 0,
  delivered_count INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_campaigns_created_at ON notification_campaigns(created_at DESC);
CREATE INDEX idx_notification_campaigns_type ON notification_campaigns(type);

ALTER TABLE notifications ADD COLUMN campaign_id UUID REFERENCES notification_campaigns(id) ON DELETE SET NULL;
CREATE INDEX idx_notifications_campaign_id ON notifications(campaign_id) WHERE campaign_id IS NOT NULL;
```

- [ ] **Step 2: Commit**

```bash
git add infra/db/migrations/20260726_notification_campaigns.sql
git commit -m "feat(notifications): add notification_campaigns table + notifications.campaign_id"
```

---

### Task 2: core-api-service — tag `campaign_id` on send/broadcast, report delivery

**Files:**
- Modify: `services/core-api-service/src/plugins/notifications.ts`

**Interfaces:**
- Consumes: `notification_campaigns` table from Task 1 (FK only — this task never writes to it)
- Produces: `POST /internal/notifications/send` now accepts optional `campaign_id` in its body and returns `{ success: true, delivered: 0 | 1 }` (new `delivered` field — 1 if the user had an `fcm_token` and the push was attempted, 0 otherwise). `POST /internal/notifications/broadcast` accepts optional `campaign_id` and its existing `{ success, sent, total }` response shape is unchanged (Task 3 reads `sent` as the delivered count). Both tag every inserted `notifications` row with `campaign_id` when provided, `NULL` when omitted (system-triggered calls never provide one, so their behavior is byte-for-byte unchanged).

- [ ] **Step 1: Update `/internal/notifications/send`**

Replace the existing handler:

```typescript
    app.post('/internal/notifications/send', { onRequest: [internal] }, async (req, reply) => {
      const { user_id, title, body, type = 'general', data, campaign_id } = req.body as any
      await db.query(
        'INSERT INTO notifications (user_id, type, title, body, data, campaign_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [user_id, type, title, body, JSON.stringify(data || {}), campaign_id || null],
      )
      const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [user_id])
      let delivered = 0
      if (userRes.rows[0]?.fcm_token) {
        await sendPushNotification(userRes.rows[0].fcm_token, title, body, data)
        delivered = 1
      }
      return reply.send({ success: true, delivered })
    })
```

- [ ] **Step 2: Update `/internal/notifications/broadcast`**

Replace the destructuring line and the two INSERT/return points:

```typescript
    app.post('/internal/notifications/broadcast', { onRequest: [internal] }, async (req, reply) => {
      const { title, body, type = 'broadcast', data, campaign_id } = req.body as any
      const usersRes = await db.query(`SELECT id, fcm_token FROM users WHERE is_bot = false AND status = $1`, ['active'])
      const users = usersRes.rows
      if (users.length === 0) return reply.send({ success: true, sent: 0, total: 0 })

      // 1. Bulk insert DB notifications in batches of 1000 to stay under Postgres parameter limits
      const dbBatchSize = 1000
      for (let i = 0; i < users.length; i += dbBatchSize) {
        const batch = users.slice(i, i + dbBatchSize)
        const values: any[] = []
        let queryText = 'INSERT INTO notifications (user_id, type, title, body, data, campaign_id) VALUES '
        for (let j = 0; j < batch.length; j++) {
          const u = batch[j]
          const offset = j * 6
          queryText += `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
          if (j < batch.length - 1) queryText += ', '
          values.push(u.id, type, title, body, JSON.stringify(data || {}), campaign_id || null)
        }
        await db.query(queryText, values)
      }

      // 2. Batch send push notifications using sendEach in batches of 500
      const tokens = users.map(u => u.fcm_token).filter(Boolean) as string[]
      let sent = 0
      if (tokens.length > 0) {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
          console.log(`[PUSH DEV] Broadcasted to ${tokens.length} tokens: ${title}: ${body}`)
          sent = tokens.length
        } else {
          const fcmMessages = tokens.map(token => ({
            token,
            notification: { title, body },
            data,
            android: { priority: 'high' } as any,
            apns: { payload: { aps: { sound: 'default' } } } as any
          }))
          const fcmBatchSize = 500
          for (let i = 0; i < fcmMessages.length; i += fcmBatchSize) {
            const batch = fcmMessages.slice(i, i + fcmBatchSize)
            try {
              const response = await admin.messaging().sendEach(batch)
              sent += response.successCount
            } catch (err) {
              console.error('[broadcast] FCM batch failed:', err)
            }
          }
        }
      }

      return reply.send({ success: true, sent, total: users.length })
    })
```

- [ ] **Step 3: Verify**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

No live-DB test for this task (no local Postgres in this sandbox, matches this codebase's established pattern for DB-touching handlers — see Global Constraints). Verify by inspection: confirm the three existing direct callers of `/internal/notifications/send` (KYC approval, deposit confirmation, withdrawal confirmation in `services/admin-service/src/index.ts`) never send a `campaign_id` field, so `campaign_id || null` in both queries above evaluates to `null` for them — identical behavior to before this change.

- [ ] **Step 4: Commit**

```bash
git add services/core-api-service/src/plugins/notifications.ts
git commit -m "feat(notifications): tag campaign_id on send/broadcast, report delivery count"
```

---

### Task 3: admin-service — create campaign on send, backfill delivered_count

**Files:**
- Modify: `services/admin-service/src/index.ts` (the two routes at ~line 1269-1293)

**Interfaces:**
- Consumes: `notification_campaigns` table (Task 1), `POST /internal/notifications/send|broadcast`'s new `campaign_id` param and `delivered`/`sent` response fields (Task 2)
- Produces: nothing new consumed by later tasks — Task 4's routes read `notification_campaigns` directly via SQL, not through this task's code.

- [ ] **Step 1: Replace both routes**

```typescript
  // POST /api/admin/notifications/broadcast
  app.post('/api/admin/notifications/broadcast', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const body = req.body as any
    const me = req.user as any
    const CORE_API_URL = process.env.CORE_API_URL || 'http://127.0.0.1:3001'

    const totalRes = await db.query(`SELECT COUNT(*)::int AS c FROM users WHERE is_bot = false AND status = 'active'`)
    const totalRecipients = totalRes.rows[0].c

    const campaignRes = await db.query(
      `INSERT INTO notification_campaigns (title, body, type, target_type, sent_by, total_recipients)
       VALUES ($1, $2, $3, 'all', $4, $5) RETURNING id`,
      [body.title, body.body, body.type || 'broadcast', me.sub, totalRecipients],
    )
    const campaignId = campaignRes.rows[0].id

    const res = await fetch(`${CORE_API_URL}/internal/notifications/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ ...body, campaign_id: campaignId }),
    })
    const data = await res.json()

    await db.query(`UPDATE notification_campaigns SET delivered_count = $1 WHERE id = $2`, [data.sent ?? 0, campaignId])

    return reply.send({ ...data, campaign_id: campaignId })
  })

  // POST /api/admin/notifications/send
  app.post('/api/admin/notifications/send', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const body = req.body as any
    const me = req.user as any
    const CORE_API_URL = process.env.CORE_API_URL || 'http://127.0.0.1:3001'

    const campaignRes = await db.query(
      `INSERT INTO notification_campaigns (title, body, type, target_type, target_user_id, sent_by, total_recipients)
       VALUES ($1, $2, $3, 'specific_user', $4, $5, 1) RETURNING id`,
      [body.title, body.body, body.type || 'general', body.user_id, me.sub],
    )
    const campaignId = campaignRes.rows[0].id

    const res = await fetch(`${CORE_API_URL}/internal/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ ...body, campaign_id: campaignId }),
    })
    const data = await res.json()

    await db.query(`UPDATE notification_campaigns SET delivered_count = $1 WHERE id = $2`, [data.delivered ?? 0, campaignId])

    return reply.send({ ...data, campaign_id: campaignId })
  })
```

- [ ] **Step 2: Verify**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

No live-DB test (same reasoning as Task 2). Verify by inspection: confirm `req.user` carries `.sub` (matches the exact pattern already used in `services/admin-service/src/notifications-routes.ts` line 21, `const me = req.user as any` / `me.sub`), and confirm the three system-triggered call sites in this same file (KYC/deposit/withdrawal, calling `/internal/notifications/send` directly, NOT through this route) are untouched by this diff.

- [ ] **Step 3: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(notifications): create campaign row + backfill delivered_count on admin send/broadcast"
```

---

### Task 4: admin-service — campaign query helpers + GET /campaigns, GET /analytics routes

**Files:**
- Create: `services/admin-service/src/notification-campaigns-query.ts`
- Test: `services/admin-service/tests/notification-campaigns-query.test.ts`
- Create: `services/admin-service/src/notification-campaigns-routes.ts`
- Modify: `services/admin-service/src/index.ts` (register the new routes)

**Interfaces:**
- Consumes: `notification_campaigns` + `notifications` tables (Tasks 1-3)
- Produces: `GET /api/admin/notifications/campaigns`, `GET /api/admin/notifications/analytics` — consumed by admin-panel Task 6/7.

- [ ] **Step 1: Write the pure query-helper module**

```typescript
// services/admin-service/src/notification-campaigns-query.ts

export interface CampaignsFilter {
  clause: string
  params: any[]
}

/** Builds the WHERE clause + params for filtering notification_campaigns by
 *  type and/or a created_at date range. Params are numbered starting at
 *  $1 so callers can safely append LIMIT/OFFSET placeholders after. */
export function buildCampaignsFilter(type?: string, startDate?: string, endDate?: string): CampaignsFilter {
  const conditions: string[] = []
  const params: any[] = []
  let idx = 1

  if (type) {
    conditions.push(`type = $${idx}`)
    params.push(type)
    idx++
  }
  if (startDate) {
    conditions.push(`created_at >= $${idx}`)
    params.push(startDate)
    idx++
  }
  if (endDate) {
    conditions.push(`created_at <= $${idx}`)
    params.push(endDate)
    idx++
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/** Clamps a raw page-size query param to [1, 100], defaulting to 20. */
export function resolveCampaignsLimit(raw?: string): number {
  const n = parseInt(raw ?? '', 10)
  if (isNaN(n)) return 20
  return Math.max(1, Math.min(n, 100))
}

/** Read rate as a 0-1 fraction; 0 when there were no recipients (avoids
 *  divide-by-zero showing as NaN in the UI). */
export function computeReadRate(readCount: number, totalRecipients: number): number {
  if (totalRecipients <= 0) return 0
  return readCount / totalRecipients
}
```

- [ ] **Step 2: Write the tests**

```typescript
// services/admin-service/tests/notification-campaigns-query.test.ts
import { describe, it, expect } from 'vitest'
import { buildCampaignsFilter, resolveCampaignsLimit, computeReadRate } from '../src/notification-campaigns-query'

describe('buildCampaignsFilter', () => {
  it('returns no clause when nothing is provided', () => {
    expect(buildCampaignsFilter()).toEqual({ clause: '', params: [] })
  })

  it('filters by type only', () => {
    expect(buildCampaignsFilter('promotion')).toEqual({ clause: 'WHERE type = $1', params: ['promotion'] })
  })

  it('filters by date range only', () => {
    expect(buildCampaignsFilter(undefined, '2026-07-01', '2026-07-31')).toEqual({
      clause: 'WHERE created_at >= $1 AND created_at <= $2',
      params: ['2026-07-01', '2026-07-31'],
    })
  })

  it('combines type and date range with correctly numbered params', () => {
    expect(buildCampaignsFilter('general', '2026-07-01', '2026-07-31')).toEqual({
      clause: 'WHERE type = $1 AND created_at >= $2 AND created_at <= $3',
      params: ['general', '2026-07-01', '2026-07-31'],
    })
  })
})

describe('resolveCampaignsLimit', () => {
  it('defaults to 20 when raw is missing', () => {
    expect(resolveCampaignsLimit(undefined)).toBe(20)
  })

  it('parses a numeric string', () => {
    expect(resolveCampaignsLimit('50')).toBe(50)
  })

  it('clamps values above 100 down to 100', () => {
    expect(resolveCampaignsLimit('9999')).toBe(100)
  })

  it('clamps values below 1 up to 1', () => {
    expect(resolveCampaignsLimit('0')).toBe(1)
    expect(resolveCampaignsLimit('-5')).toBe(1)
  })

  it('defaults to 20 when raw is not a number', () => {
    expect(resolveCampaignsLimit('not-a-number')).toBe(20)
  })
})

describe('computeReadRate', () => {
  it('returns 0 when total recipients is 0', () => {
    expect(computeReadRate(0, 0)).toBe(0)
  })

  it('computes a fraction', () => {
    expect(computeReadRate(25, 100)).toBe(0.25)
  })

  it('returns 1 when everyone read it', () => {
    expect(computeReadRate(50, 50)).toBe(1)
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `cd services/admin-service && npx vitest run tests/notification-campaigns-query.test.ts`
Expected: 13/13 pass.

- [ ] **Step 4: Write the routes file**

```typescript
// services/admin-service/src/notification-campaigns-routes.ts
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { buildCampaignsFilter, resolveCampaignsLimit } from './notification-campaigns-query'

export function registerNotificationCampaignRoutes(app: FastifyInstance, db: Pool, authenticate: any, requireRole: any) {
  // GET /api/admin/notifications/campaigns — paginated history of admin-initiated sends
  app.get('/api/admin/notifications/campaigns', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const q = req.query as { type?: string; startDate?: string; endDate?: string; page?: string; limit?: string }
    const limit = resolveCampaignsLimit(q.limit)
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1)
    const offset = (page - 1) * limit

    const { clause, params } = buildCampaignsFilter(q.type, q.startDate, q.endDate)
    const listParams = [...params, limit, offset]

    const rows = await db.query(
      `SELECT c.id, c.title, c.type, c.target_type, c.target_user_id, c.total_recipients,
              c.delivered_count, c.created_at, au.username AS sent_by_username,
              (SELECT COUNT(*)::int FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) AS read_count
       FROM notification_campaigns c
       LEFT JOIN admin_users au ON au.id = c.sent_by
       ${clause}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    )

    const countRes = await db.query(`SELECT COUNT(*)::int AS c FROM notification_campaigns ${clause}`, params)

    return reply.send({
      campaigns: rows.rows.map((r: any) => ({
        ...r,
        read_rate: r.total_recipients > 0 ? r.read_count / r.total_recipients : 0,
      })),
      total: countRes.rows[0].c,
      page,
      limit,
    })
  })

  // GET /api/admin/notifications/analytics?days=30 — daily send/read-rate trend + per-type breakdown
  app.get('/api/admin/notifications/analytics', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { days = '30' } = req.query as any
    const daysInt = parseInt(days, 10) || 30

    const trendRes = await db.query(
      `SELECT date_trunc('day', c.created_at) AS day,
              COUNT(*)::int AS campaigns_sent,
              AVG(CASE WHEN c.total_recipients > 0
                THEN (SELECT COUNT(*)::float FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) / c.total_recipients
                ELSE 0 END) AS avg_read_rate
       FROM notification_campaigns c
       WHERE c.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day ASC`,
      [daysInt],
    )

    const typeRes = await db.query(
      `SELECT c.type,
              COUNT(*)::int AS campaigns_sent,
              AVG(CASE WHEN c.total_recipients > 0
                THEN (SELECT COUNT(*)::float FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) / c.total_recipients
                ELSE 0 END) AS avg_read_rate
       FROM notification_campaigns c
       WHERE c.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY c.type
       ORDER BY campaigns_sent DESC`,
      [daysInt],
    )

    return reply.send({
      trend: trendRes.rows.map((r: any) => ({
        date: r.day,
        campaignsSent: r.campaigns_sent,
        avgReadRate: parseFloat(r.avg_read_rate) || 0,
      })),
      byType: typeRes.rows.map((r: any) => ({
        type: r.type,
        campaignsSent: r.campaigns_sent,
        avgReadRate: parseFloat(r.avg_read_rate) || 0,
      })),
    })
  })
}
```

- [ ] **Step 5: Register the routes**

In `services/admin-service/src/index.ts`, add the import near the other route-file imports:

```typescript
import { registerNotificationCampaignRoutes } from './notification-campaigns-routes'
```

And register it next to the existing `registerNotificationRoutes(app, db, authenticate)` call (~line 166):

```typescript
  registerNotificationCampaignRoutes(app, db, authenticate, requireRole)
```

- [ ] **Step 6: Verify**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

No live-DB test for the route handlers themselves (same reasoning as Tasks 2-3) — the pure query-building logic they depend on is fully covered by Step 3's tests. Verify by inspection: confirm the `read_count`/`avg_read_rate` subqueries correctly scope to `n.campaign_id = c.id` (not a cross join), and that `buildCampaignsFilter`'s params are spliced correctly before the `LIMIT`/`OFFSET` placeholders in the campaigns list query.

- [ ] **Step 7: Commit**

```bash
git add services/admin-service/src/notification-campaigns-query.ts services/admin-service/tests/notification-campaigns-query.test.ts services/admin-service/src/notification-campaigns-routes.ts services/admin-service/src/index.ts
git commit -m "feat(notifications): add campaign history + analytics routes"
```

---

### Task 5: admin-service — GET /bell-trend (admin-bell volume by type)

**Files:**
- Modify: `services/admin-service/src/notifications-routes.ts`

**Interfaces:**
- Consumes: `admin_notifications` table (existing, from `081_admin_notifications.sql`)
- Produces: `GET /api/admin/notifications/bell-trend` — consumed by admin-panel Task 9.

- [ ] **Step 1: Add the route**

Add this inside `registerNotificationRoutes`, after the existing `PATCH /api/admin/notifications/read-all` handler and before the `// WebSocket push` comment:

```typescript
  // GET /api/admin/notifications/bell-trend?days=30 — daily alert volume by type,
  // for spotting spikes (e.g. a run of payment issues) instead of reacting one at a time.
  app.get('/api/admin/notifications/bell-trend', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const satisfiedRoles = satisfiedRolesFor(role)
    const { days = '30' } = req.query as any
    const daysInt = parseInt(days, 10) || 30

    const rows = await db.query(
      `SELECT date_trunc('day', created_at) AS day, type, COUNT(*)::int AS count
       FROM admin_notifications
       WHERE target_role = ANY($1) AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY day, type
       ORDER BY day ASC`,
      [satisfiedRoles, daysInt],
    )

    return reply.send({
      trend: rows.rows.map((r: any) => ({ date: r.day, type: r.type, count: r.count })),
    })
  })
```

- [ ] **Step 2: Verify**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

No live-DB test (same reasoning as prior tasks — this route has no extractable pure logic beyond `satisfiedRolesFor`, which is already tested indirectly by this file's existing behavior and has no new logic added here). Verify by inspection: confirm `satisfiedRolesFor(role)` is called with the same pattern as the sibling `GET /api/admin/notifications` handler directly above it in this file.

- [ ] **Step 3: Commit**

```bash
git add services/admin-service/src/notifications-routes.ts
git commit -m "feat(notifications): add admin-bell volume-by-type trend route"
```

---

### Task 6: admin-panel — Notifications.tsx History tab

**Files:**
- Modify: `admin-panel/src/pages/Notifications.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/notifications/campaigns` (Task 4)
- Produces: nothing new consumed by later tasks (Task 7 adds a sibling tab to the same file, independently).

- [ ] **Step 1: Restructure into a tabbed page**

Replace the full file contents:

```tsx
import { useState } from 'react'
import { Form, Input, Button, Select, Card, message, Radio, Tabs } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { adminApi } from '../api/client'
import { NotificationHistoryTab } from '../components/NotificationHistoryTab'
import { NotificationAnalyticsTab } from '../components/NotificationAnalyticsTab'

function SendTab() {
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const [target, setTarget] = useState<'all' | 'user'>('all')

  const onSend = async (values: any) => {
    setLoading(true)
    try {
      if (target === 'all') {
        await adminApi.post('/notifications/broadcast', { title: values.title, body: values.body, type: values.type || 'broadcast' })
        message.success('Broadcast sent to all users!')
      } else {
        await adminApi.post('/notifications/send', { user_id: values.user_id, title: values.title, body: values.body, type: values.type || 'general' })
        message.success('Notification sent!')
      }
      form.resetFields()
    } catch {
      message.error('Failed to send notification')
    } finally { setLoading(false) }
  }

  return (
    <Card title="Send Push Notification" style={{ maxWidth: 600 }}>
      <Form form={form} layout="vertical" onFinish={onSend}>
        <Form.Item label="Send To">
          <Radio.Group value={target} onChange={e => setTarget(e.target.value)}>
            <Radio.Button value="all">All Users</Radio.Button>
            <Radio.Button value="user">Specific User</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {target === 'user' && (
          <Form.Item name="user_id" label="User ID" rules={[{ required: true }]}>
            <Input placeholder="Paste user UUID" />
          </Form.Item>
        )}

        <Form.Item name="type" label="Type" initialValue="general">
          <Select>
            <Select.Option value="general">General</Select.Option>
            <Select.Option value="promotion">Promotion</Select.Option>
            <Select.Option value="game_result">Game Result</Select.Option>
            <Select.Option value="wallet">Wallet Update</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item name="title" label="Title" rules={[{ required: true, max: 100 }]}>
          <Input placeholder="Notification title" />
        </Form.Item>

        <Form.Item name="body" label="Message" rules={[{ required: true, max: 300 }]}>
          <Input.TextArea rows={3} placeholder="Notification body" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={loading} block>
            {target === 'all' ? 'Broadcast to All Users' : 'Send Notification'}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default function Notifications() {
  return (
    <div style={{ padding: 24 }}>
      <Tabs
        items={[
          { key: 'send', label: 'Send', children: <SendTab /> },
          { key: 'history', label: 'History', children: <NotificationHistoryTab /> },
          { key: 'analytics', label: 'Analytics', children: <NotificationAnalyticsTab /> },
        ]}
      />
    </div>
  )
}
```

- [ ] **Step 2: Write the History tab component**

```tsx
// admin-panel/src/components/NotificationHistoryTab.tsx
import { useEffect, useState } from 'react'
import { Card, Table, Tag, Select, DatePicker, Space, message, Progress } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { adminApi } from '../api/client'

const { RangePicker } = DatePicker

interface Campaign {
  id: string
  title: string
  type: string
  target_type: 'all' | 'specific_user'
  target_user_id: string | null
  total_recipients: number
  delivered_count: number | null
  read_count: number
  read_rate: number
  sent_by_username: string | null
  created_at: string
}

export function NotificationHistoryTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [type, setType] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  useEffect(() => {
    fetchCampaigns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, type, dateRange])

  async function fetchCampaigns() {
    setLoading(true)
    try {
      const params: any = { page, limit: 20 }
      if (type) params.type = type
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.startDate = dateRange[0].startOf('day').toISOString()
        params.endDate = dateRange[1].endOf('day').toISOString()
      }
      const res = await adminApi.get('/notifications/campaigns', { params })
      setCampaigns(res.data.campaigns)
      setTotal(res.data.total)
    } catch {
      message.error('Failed to load notification history')
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<Campaign> = [
    { title: 'Title', dataIndex: 'title' },
    { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
    {
      title: 'Target',
      dataIndex: 'target_type',
      render: (v, row) => (v === 'all' ? 'All Users' : `User: ${row.target_user_id?.slice(0, 8)}…`),
    },
    { title: 'Sent By', dataIndex: 'sent_by_username', render: (v) => v ?? '—' },
    { title: 'Recipients', dataIndex: 'total_recipients' },
    { title: 'Delivered', dataIndex: 'delivered_count', render: (v) => v ?? '—' },
    {
      title: 'Read Rate',
      dataIndex: 'read_rate',
      render: (v, row) => <Progress percent={Math.round(v * 100)} size="small" format={() => `${row.read_count}/${row.total_recipients}`} />,
    },
    { title: 'Sent At', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('en-IN') },
  ]

  return (
    <Card>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Filter by type"
          style={{ width: 180 }}
          value={type}
          onChange={setType}
          options={[
            { value: 'general', label: 'General' },
            { value: 'promotion', label: 'Promotion' },
            { value: 'game_result', label: 'Game Result' },
            { value: 'wallet', label: 'Wallet Update' },
            { value: 'broadcast', label: 'Broadcast' },
          ]}
        />
        <RangePicker value={dateRange as any} onChange={(range) => setDateRange(range as [Dayjs | null, Dayjs | null] | null)} allowClear />
      </Space>
      <Table
        dataSource={campaigns}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
      />
    </Card>
  )
}
```

- [ ] **Step 3: Verify**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/Notifications.tsx admin-panel/src/components/NotificationHistoryTab.tsx
git commit -m "feat(notifications): add push notification History tab"
```

---

### Task 7: admin-panel — Notifications.tsx Analytics tab

**Files:**
- Create: `admin-panel/src/components/NotificationAnalyticsTab.tsx`
- Modify: nothing further in `Notifications.tsx` (Task 6 already wired the `analytics` tab to `NotificationAnalyticsTab`)

**Interfaces:**
- Consumes: `GET /api/admin/notifications/analytics` (Task 4)
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the Analytics tab component**

```tsx
// admin-panel/src/components/NotificationAnalyticsTab.tsx
import { useEffect, useState } from 'react'
import { Card, Empty, Spin, Row, Col } from 'antd'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

interface TrendPoint {
  date: string
  campaignsSent: number
  avgReadRate: number
}

interface TypeBreakdown {
  type: string
  campaignsSent: number
  avgReadRate: number
}

export function NotificationAnalyticsTab() {
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [byType, setByType] = useState<TypeBreakdown[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics()
  }, [])

  async function fetchAnalytics() {
    setLoading(true)
    try {
      const res = await adminApi.get('/notifications/analytics', { params: { days: 30 } })
      setTrend(res.data.trend || [])
      setByType(res.data.byType || [])
    } catch {
      setTrend([])
      setByType([])
    } finally {
      setLoading(false)
    }
  }

  const trendFormatted = trend.map((p) => ({
    ...p,
    date: dayjs(p.date).format('MMM DD'),
    avgReadRatePct: p.avgReadRate * 100,
  }))
  const byTypeFormatted = byType.map((t) => ({ ...t, avgReadRatePct: t.avgReadRate * 100 }))

  return (
    <Spin spinning={loading}>
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card title="Sends & Read Rate (last 30 days)" bordered={false}>
            {trendFormatted.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trendFormatted}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: 'Campaigns Sent', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} label={{ value: 'Read Rate (%)', angle: 90, position: 'insideRight' }} />
                  <Tooltip formatter={(value: any, name: string) => (name === 'Avg Read Rate' ? `${Number(value).toFixed(1)}%` : value)} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="campaignsSent" name="Campaigns Sent" stroke="#1677ff" strokeWidth={2} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="avgReadRatePct" name="Avg Read Rate" stroke="#00c853" strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              !loading && <Empty description="No notifications sent yet" />
            )}
          </Card>
        </Col>
        <Col span={24}>
          <Card title="Read Rate by Type (last 30 days)" bordered={false}>
            {byTypeFormatted.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byTypeFormatted}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} label={{ value: 'Avg Read Rate (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
                  <Bar dataKey="avgReadRatePct" name="Avg Read Rate" fill="#d4af37" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              !loading && <Empty description="No notifications sent yet" />
            )}
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add admin-panel/src/components/NotificationAnalyticsTab.tsx
git commit -m "feat(notifications): add push notification Analytics tab"
```

---

### Task 8: admin-panel — sidebar link for admin-bell history

**Files:**
- Modify: `admin-panel/src/pages/layout/menuConfig.ts`
- Modify: `admin-panel/src/pages/layout/menuConfig.test.ts`

**Interfaces:**
- Consumes: the existing `/admin/notifications-history` route (already registered in `main.tsx`, confirmed present — no route change needed)
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the sidebar entry**

In `admin-panel/src/pages/layout/menuConfig.ts`, add `HistoryOutlined` is already imported — reuse it isn't ideal since it's used for Changelog; import a distinct icon. Add `AlertOutlined` to the icon import list:

```typescript
  BellOutlined, TrophyOutlined, CustomerServiceOutlined,
  FundOutlined, MobileOutlined, SettingOutlined, LineChartOutlined,
  RobotOutlined, ProfileOutlined, HistoryOutlined, AlertOutlined,
} from '@ant-design/icons'
```

In the `engagement_group` children array, add the new entry right after the existing Notifications link:

```typescript
        { key: '/admin/notifications', icon: createElement(BellOutlined), label: link('/admin/notifications', 'Notifications') },
        { key: '/admin/notifications-history', icon: createElement(AlertOutlined), label: link('/admin/notifications-history', 'Admin Alerts') },
        { key: '/admin/leaderboard', icon: createElement(TrophyOutlined), label: link('/admin/leaderboard', 'Leaderboard') },
```

- [ ] **Step 2: Update the locked key list**

In `admin-panel/src/pages/layout/menuConfig.test.ts`, add the new key to `EXPECTED_KEYS`:

```typescript
  '/admin/notifications',
  '/admin/notifications-history',
  '/admin/risk-center',
```

- [ ] **Step 3: Run the test**

Run: `cd admin-panel && npx vitest run src/pages/layout/menuConfig.test.ts`
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/layout/menuConfig.ts admin-panel/src/pages/layout/menuConfig.test.ts
git commit -m "feat(notifications): add sidebar link to admin-bell notification history"
```

---

### Task 9: admin-panel — admin-bell volume trend chart

**Files:**
- Create: `admin-panel/src/components/NotificationBellTrendChart.tsx`
- Modify: `admin-panel/src/pages/NotificationsHistory.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/notifications/bell-trend` (Task 5)
- Produces: nothing consumed by later tasks (final task in this plan).

- [ ] **Step 1: Write the trend chart component**

```tsx
// admin-panel/src/components/NotificationBellTrendChart.tsx
import { useEffect, useState } from 'react'
import { Card, Empty, Spin } from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import dayjs from 'dayjs'
import { adminApi } from '../api/client'

interface RawPoint { date: string; type: string; count: number }

export function NotificationBellTrendChart() {
  const [points, setPoints] = useState<RawPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTrend()
  }, [])

  async function fetchTrend() {
    setLoading(true)
    try {
      const res = await adminApi.get('/notifications/bell-trend', { params: { days: 30 } })
      setPoints(res.data.trend || [])
    } catch {
      setPoints([])
    } finally {
      setLoading(false)
    }
  }

  // Pivot [{date, type, count}] into one row per date with a column per type,
  // which is what recharts' stacked <Bar> needs.
  const types = Array.from(new Set(points.map((p) => p.type)))
  const byDate = new Map<string, any>()
  for (const p of points) {
    const key = dayjs(p.date).format('MMM DD')
    if (!byDate.has(key)) byDate.set(key, { date: key })
    byDate.get(key)[p.type] = p.count
  }
  const chartData = Array.from(byDate.values())

  const COLORS = ['#1677ff', '#faad14', '#00c853', '#d4af37', '#eb2f96', '#722ed1']

  return (
    <Card title="Alert Volume by Type (last 30 days)" bordered={false} style={{ marginBottom: 16 }}>
      <Spin spinning={loading}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              {types.map((t, i) => (
                <Bar key={t} dataKey={t} name={t} stackId="alerts" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          !loading && <Empty description="No alerts recorded yet" />
        )}
      </Spin>
    </Card>
  )
}
```

- [ ] **Step 2: Wire it into the history page**

In `admin-panel/src/pages/NotificationsHistory.tsx`, add the import:

```tsx
import { NotificationBellTrendChart } from '../components/NotificationBellTrendChart'
```

And render it above the existing `<Card>` that wraps the filters/table (right after the header `<div>` that contains the title and "Mark All Read" button):

```tsx
      <NotificationBellTrendChart />
      <Card>
```

- [ ] **Step 3: Verify**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/components/NotificationBellTrendChart.tsx admin-panel/src/pages/NotificationsHistory.tsx
git commit -m "feat(notifications): add admin-bell alert volume trend chart"
```
