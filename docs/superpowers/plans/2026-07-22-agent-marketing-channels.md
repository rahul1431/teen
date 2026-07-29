# Marketing Channel Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can register their own Telegram/WhatsApp/other promotional channels; admin reviews and approves or rejects each one. Internal-only oversight — no public visibility.

**Architecture:** One new table (`agent_channels`) holds submissions. Agent-facing CRUD lives in `agent-portal-routes.ts` behind the existing agent JWT guard; admin-facing review lives in `agent-routes.ts` behind `requireRole('finance')` (the same gate used for bank-details verification). A small pure `validateChannelUrl` helper (unit-tested) rejects malformed per-platform URLs before they ever hit the DB. Both `AgentPortal.tsx` and `Marketing.tsx` get a new tab.

**Tech Stack:** Fastify + Zod + `pg` (admin-service), vitest (admin-service unit tests), React + antd (admin-panel).

## Global Constraints

- No uniqueness constraint on `(agent_id, platform)` — an agent may register multiple channels on the same platform.
- Visibility is internal-only: no public directory, no player-facing surface anywhere in this plan.
- Telegram URLs must contain `t.me/` or `telegram.me/`; WhatsApp URLs must contain `wa.me/` or `chat.whatsapp.com/`; "other" just needs `http(s)://`. Reject with 400 on mismatch, don't silently accept.
- `DELETE /agent-portal/channels/:id` must scope by `agent_id` in the SQL `WHERE`, not just the row id — one agent must never be able to delete another agent's channel.
- Rejecting a channel requires a non-empty `rejection_reason`; approving does not.
- admin-service has vitest — the URL validation logic must be extracted into a pure, unit-tested function (matching the existing `agent-hierarchy.ts`/`referral-metrics.ts` precedent), not inlined in a route handler.
- admin-panel has no test framework for this kind of page — verification is `npx tsc --noEmit` only.

---

### Task 1: Database — `agent_channels` table

**Files:**
- Create: `infra/db/migrations/088_agent_channels.sql`

**Interfaces:**
- Produces: table `agent_channels(id, agent_id, platform, label, url, status, rejection_reason, created_at, reviewed_at, reviewed_by)`. Task 2 inserts/selects/deletes from it (agent-scoped); Task 3 selects/updates it (admin-scoped, joined against `agents`).

- [ ] **Step 1: Write the migration**

```sql
-- Agent-submitted marketing channels (Telegram/WhatsApp/other groups they
-- run to promote their referral link). Internal-only oversight registry —
-- no public visibility anywhere. See
-- docs/superpowers/specs/2026-07-22-agent-marketing-channels-design.md
CREATE TABLE agent_channels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES agents(id),
  platform          VARCHAR(20) NOT NULL CHECK (platform IN ('telegram', 'whatsapp', 'other')),
  label             VARCHAR(100) NOT NULL,
  url               VARCHAR(300) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES admin_users(id)
);

CREATE INDEX idx_agent_channels_agent_id ON agent_channels(agent_id);
CREATE INDEX idx_agent_channels_status ON agent_channels(status);
```

- [ ] **Step 2: Verify the SQL**

Run: `grep -c "CREATE TABLE\|CREATE INDEX" infra/db/migrations/088_agent_channels.sql`
Expected: `3`

(No local Postgres to apply this against — the deploy-time `infra/db/apply-migrations.sh` step handles it, same as every other migration in this repo. Do not attempt to start a local database.)

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/088_agent_channels.sql
git commit -m "feat(marketing): add agent_channels table for channel registration"
```

---

### Task 2: Backend — agent-facing channel routes + URL validation

**Files:**
- Create: `services/admin-service/src/channel-validation.ts`
- Create: `services/admin-service/tests/channel-validation.test.ts`
- Modify: `services/admin-service/src/agent-portal-routes.ts`

**Interfaces:**
- Consumes: `agent_channels` table (Task 1).
- Produces: exported from `channel-validation.ts`: `validateChannelUrl(platform: 'telegram' | 'whatsapp' | 'other', url: string): { ok: true } | { ok: false; error: string }`. Consumed by the new `POST /api/admin/agent-portal/channels` route below.
- Produces routes (all behind the existing `authenticateAgent` guard already defined in this file):
  - `GET /api/admin/agent-portal/channels` → `200 [{ id, platform, label, url, status, rejection_reason, created_at }, ...]` for the calling agent only.
  - `POST /api/admin/agent-portal/channels` body `{ platform, label, url }` → `201 { id, platform, label, url, status: 'pending', rejection_reason: null, created_at }`, or `400 { error }` if `validateChannelUrl` rejects the URL.
  - `DELETE /api/admin/agent-portal/channels/:id` → `200 { success: true }` if the row belongs to the caller, `404 { error }` otherwise (including if the id belongs to a different agent — must not leak whether the id exists at all).

- [ ] **Step 1: Write the failing tests**

Create `services/admin-service/tests/channel-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateChannelUrl } from '../src/channel-validation'

describe('validateChannelUrl', () => {
  it('accepts a valid t.me Telegram URL', () => {
    expect(validateChannelUrl('telegram', 'https://t.me/myonlinejoker_group')).toEqual({ ok: true })
  })

  it('accepts a valid telegram.me Telegram URL', () => {
    expect(validateChannelUrl('telegram', 'https://telegram.me/myonlinejoker_group')).toEqual({ ok: true })
  })

  it('rejects a non-Telegram URL for platform telegram', () => {
    const result = validateChannelUrl('telegram', 'https://wa.me/1234567890')
    expect(result.ok).toBe(false)
  })

  it('accepts a valid wa.me WhatsApp URL', () => {
    expect(validateChannelUrl('whatsapp', 'https://wa.me/1234567890')).toEqual({ ok: true })
  })

  it('accepts a valid chat.whatsapp.com WhatsApp URL', () => {
    expect(validateChannelUrl('whatsapp', 'https://chat.whatsapp.com/ABC123')).toEqual({ ok: true })
  })

  it('rejects a non-WhatsApp URL for platform whatsapp', () => {
    const result = validateChannelUrl('whatsapp', 'https://t.me/somegroup')
    expect(result.ok).toBe(false)
  })

  it('accepts any http(s) URL for platform other', () => {
    expect(validateChannelUrl('other', 'https://instagram.com/myonlinejoker')).toEqual({ ok: true })
  })

  it('rejects a non-http(s) URL for platform other', () => {
    const result = validateChannelUrl('other', 'ftp://example.com')
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/admin-service && npx vitest run tests/channel-validation.test.ts`
Expected: FAIL — `Cannot find module '../src/channel-validation'`.

- [ ] **Step 3: Write the implementation**

Create `services/admin-service/src/channel-validation.ts`:

```typescript
// Per-platform URL sanity check for agent-submitted marketing channels. See
// docs/superpowers/specs/2026-07-22-agent-marketing-channels-design.md

export type ChannelPlatform = 'telegram' | 'whatsapp' | 'other'

export function validateChannelUrl(
  platform: ChannelPlatform,
  url: string
): { ok: true } | { ok: false; error: string } {
  if (platform === 'telegram') {
    if (!/^https?:\/\/(t\.me|telegram\.me)\//i.test(url)) {
      return { ok: false, error: 'Telegram link must be a t.me/ or telegram.me/ URL' }
    }
  } else if (platform === 'whatsapp') {
    if (!/^https?:\/\/(wa\.me|chat\.whatsapp\.com)\//i.test(url)) {
      return { ok: false, error: 'WhatsApp link must be a wa.me/ or chat.whatsapp.com/ URL' }
    }
  } else {
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Link must start with http:// or https://' }
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/admin-service && npx vitest run tests/channel-validation.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Add the routes to `agent-portal-routes.ts`**

Modify `services/admin-service/src/agent-portal-routes.ts`. Replace:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { mergeReferralRows, conversionRate } from './referral-metrics'
```

With:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { mergeReferralRows, conversionRate } from './referral-metrics'
import { validateChannelUrl } from './channel-validation'
```

Then, replace the end of the file (the closing brace after the `payout` route):

```typescript
      await client.query('COMMIT')
      return reply.send({ success: true, payout_id: payoutRes.rows[0].id, message: 'Payout request submitted. Processed within 24 hours.' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
```

With:

```typescript
      await client.query('COMMIT')
      return reply.send({ success: true, payout_id: payoutRes.rows[0].id, message: 'Payout request submitted. Processed within 24 hours.' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /api/admin/agent-portal/channels — this agent's own marketing channels
  app.get('/api/admin/agent-portal/channels', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT id, platform, label, url, status, rejection_reason, created_at
       FROM agent_channels WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agent-portal/channels — register a new channel (starts pending)
  app.post('/api/admin/agent-portal/channels', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const body = z.object({
      platform: z.enum(['telegram', 'whatsapp', 'other']),
      label: z.string().min(1).max(100),
      url: z.string().min(1).max(300),
    }).parse(req.body)

    const check = validateChannelUrl(body.platform, body.url)
    if (!check.ok) return reply.code(400).send({ error: check.error })

    const res = await db.query(
      `INSERT INTO agent_channels (agent_id, platform, label, url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, platform, label, url, status, rejection_reason, created_at`,
      [agentId, body.platform, body.label, body.url]
    )
    return reply.code(201).send(res.rows[0])
  })

  // DELETE /api/admin/agent-portal/channels/:id — remove own channel only
  app.delete('/api/admin/agent-portal/channels/:id', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const { id } = req.params as any
    const res = await db.query(`DELETE FROM agent_channels WHERE id = $1 AND agent_id = $2`, [id, agentId])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'Channel not found' })
    return reply.send({ success: true })
  })
}
```

- [ ] **Step 6: Build check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Re-run the unit tests**

Run: `cd services/admin-service && npx vitest run tests/channel-validation.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 8: Commit**

```bash
git add services/admin-service/src/channel-validation.ts services/admin-service/tests/channel-validation.test.ts services/admin-service/src/agent-portal-routes.ts
git commit -m "feat(marketing): add agent-facing channel registration routes"
```

---

### Task 3: Backend — admin review routes

**Files:**
- Modify: `services/admin-service/src/agent-routes.ts`

**Interfaces:**
- Consumes: `agent_channels` table (Task 1). `validateChannelUrl` is NOT needed here — admin review only changes `status`/`rejection_reason`, it doesn't re-validate the URL.
- Produces routes (behind `{ onRequest: [authenticate, requireRole('finance')] }`, matching the existing bank-details-verification and agent-payout role gate in this codebase):
  - `GET /api/admin/agent-channels?status=pending` → `200 [{ id, agent_id, agent_display_name, platform, label, url, status, rejection_reason, created_at }, ...]`. `status` query param optional (omitted = all statuses).
  - `PATCH /api/admin/agent-channels/:id` body `{ status: 'approved' | 'rejected', rejection_reason?: string }` → `200 { success: true }`, `400 { error }` if `status: 'rejected'` with no `rejection_reason`, `404 { error }` if the channel doesn't exist or isn't `pending` anymore.

- [ ] **Step 1: Read the end of the file to confirm the exact insertion point**

Run: `tail -20 services/admin-service/src/agent-routes.ts`
Expected: shows the end of the `agent-payouts` PATCH route (approve/reject payout) followed by the closing `}` of `registerAgentRoutes`.

- [ ] **Step 2: Add the new routes**

Modify `services/admin-service/src/agent-routes.ts`. Replace the file's final lines:

```typescript
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'agent_payout', $3, $4)`,
        [admin.sub, `agent_payout_${body.status}`, id, JSON.stringify({ agent_id, amount, reference: body.reference })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
```

With:

```typescript
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'agent_payout', $3, $4)`,
        [admin.sub, `agent_payout_${body.status}`, id, JSON.stringify({ agent_id, amount, reference: body.reference })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /api/admin/agent-channels — all agent-submitted marketing channels, for review
  app.get('/api/admin/agent-channels', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { status } = req.query as any
    const params: any[] = []
    let where = ''
    if (status) { params.push(status); where = `WHERE c.status = $1` }
    const res = await db.query(
      `SELECT c.id, c.agent_id, a.display_name AS agent_display_name, c.platform, c.label, c.url,
              c.status, c.rejection_reason, c.created_at
       FROM agent_channels c JOIN agents a ON a.id = c.agent_id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    )
    return reply.send(res.rows)
  })

  // PATCH /api/admin/agent-channels/:id — approve or reject
  app.patch('/api/admin/agent-channels/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      status: z.enum(['approved', 'rejected']),
      rejection_reason: z.string().optional(),
    }).parse(req.body)

    if (body.status === 'rejected' && !body.rejection_reason?.trim()) {
      return reply.code(400).send({ error: 'Rejection reason is required' })
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const res = await client.query(
        `UPDATE agent_channels
         SET status = $1, rejection_reason = $2, reviewed_at = NOW(), reviewed_by = $3
         WHERE id = $4 AND status = 'pending'
         RETURNING id`,
        [body.status, body.status === 'rejected' ? body.rejection_reason : null, admin.sub, id]
      )
      if (!res.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Channel not found or already reviewed' })
      }
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'agent_channel', $3, $4)`,
        [admin.sub, `agent_channel_${body.status}`, id, JSON.stringify({ rejection_reason: body.rejection_reason || null })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
```

- [ ] **Step 3: Build check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/agent-routes.ts
git commit -m "feat(marketing): add admin review routes for agent channels"
```

---

### Task 4: Agent Portal UI — Channels tab

**Files:**
- Modify: `admin-panel/src/pages/AgentPortal.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /agent-portal/channels` (Task 2, reached via `adminApi` which already prefixes `/api/admin`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add antd imports and new state**

Modify `admin-panel/src/pages/AgentPortal.tsx`. Replace:

```typescript
import { Card, Table, Tabs, Statistic, Row, Col, Button, Modal, Form, InputNumber, Input, message, Typography } from 'antd'
```

With:

```typescript
import { Card, Table, Tabs, Statistic, Row, Col, Button, Modal, Form, InputNumber, Input, message, Typography, Select, Tag, Popconfirm, Space } from 'antd'
```

Replace:

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

With:

```typescript
  const [me, setMe] = useState<any>(null)
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [referrals, setReferrals] = useState<{ rows: any[]; totals: any }>({ rows: [], totals: { clicks: 0, signups: 0, conversion_rate: 0 } })
  const [channels, setChannels] = useState<any[]>([])
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [channelForm] = Form.useForm()
  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const load = async () => {
    const [meRes, playersRes, ledgerRes, referralsRes, channelsRes] = await Promise.all([
      adminApi.get('/agent-portal/me'),
      adminApi.get('/agent-portal/players'),
      adminApi.get('/agent-portal/ledger'),
      adminApi.get('/agent-portal/referrals'),
      adminApi.get('/agent-portal/channels'),
    ])
    setMe(meRes.data)
    setPlayers(playersRes.data)
    setLedger(ledgerRes.data)
    setReferrals(referralsRes.data)
    setChannels(channelsRes.data)
  }

  const addChannel = async (values: any) => {
    try {
      await adminApi.post('/agent-portal/channels', values)
      message.success('Channel submitted for review')
      channelForm.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to add channel')
    }
  }

  const deleteChannel = async (id: string) => {
    try {
      await adminApi.delete(`/agent-portal/channels/${id}`)
      message.success('Channel removed')
      load()
    } catch (e: any) {
      message.error('Failed to remove channel')
    }
  }
```

- [ ] **Step 2: Add the Channels tab**

Modify `admin-panel/src/pages/AgentPortal.tsx`. Replace the end of the `Tabs` `items` array (the `referrals` tab entry and the closing of the array):

```typescript
          {
            key: 'referrals', label: 'Referrals',
            children: <>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}><Card><Statistic title="Total Clicks" value={referrals.totals.clicks} /></Card></Col>
                <Col span={8}><Card><Statistic title="Total Signups" value={referrals.totals.signups} /></Card></Col>
                <Col span={8}><Card><Statistic title="Conversion Rate" value={Math.min(referrals.totals.conversion_rate * 100, 100)} precision={1} suffix="%" /></Card></Col>
              </Row>
              <Table rowKey="date" dataSource={referrals.rows} columns={[
                { title: 'Date', dataIndex: 'date' },
                { title: 'Clicks', dataIndex: 'clicks' },
                { title: 'Signups', dataIndex: 'signups' },
                {
                  title: 'Conversion', dataIndex: 'conversion_rate',
                  // Clicks and signups come from independent sources (a code
                  // can be shared verbally with zero tracked clicks), so the
                  // raw ratio can exceed 100% — cap the display, not the data.
                  render: (v: number) => `${Math.min(v * 100, 100).toFixed(1)}%`,
                },
              ]} />
            </>,
          },
        ]}
      />
```

With:

```typescript
          {
            key: 'referrals', label: 'Referrals',
            children: <>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}><Card><Statistic title="Total Clicks" value={referrals.totals.clicks} /></Card></Col>
                <Col span={8}><Card><Statistic title="Total Signups" value={referrals.totals.signups} /></Card></Col>
                <Col span={8}><Card><Statistic title="Conversion Rate" value={Math.min(referrals.totals.conversion_rate * 100, 100)} precision={1} suffix="%" /></Card></Col>
              </Row>
              <Table rowKey="date" dataSource={referrals.rows} columns={[
                { title: 'Date', dataIndex: 'date' },
                { title: 'Clicks', dataIndex: 'clicks' },
                { title: 'Signups', dataIndex: 'signups' },
                {
                  title: 'Conversion', dataIndex: 'conversion_rate',
                  // Clicks and signups come from independent sources (a code
                  // can be shared verbally with zero tracked clicks), so the
                  // raw ratio can exceed 100% — cap the display, not the data.
                  render: (v: number) => `${Math.min(v * 100, 100).toFixed(1)}%`,
                },
              ]} />
            </>,
          },
          {
            key: 'channels', label: 'Channels',
            children: <>
              <Form form={channelForm} layout="inline" onFinish={addChannel} style={{ marginBottom: 16 }}>
                <Form.Item name="platform" rules={[{ required: true, message: 'Select a platform' }]} initialValue="telegram">
                  <Select style={{ width: 140 }} options={[
                    { value: 'telegram', label: 'Telegram' },
                    { value: 'whatsapp', label: 'WhatsApp' },
                    { value: 'other', label: 'Other' },
                  ]} />
                </Form.Item>
                <Form.Item name="label" rules={[{ required: true, message: 'Enter a label' }]}>
                  <Input placeholder="e.g. My Telegram Group" style={{ width: 220 }} />
                </Form.Item>
                <Form.Item name="url" rules={[{ required: true, message: 'Enter the channel URL' }]}>
                  <Input placeholder="https://t.me/..." style={{ width: 260 }} />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit">Add Channel</Button>
                </Form.Item>
              </Form>
              <Table rowKey="id" dataSource={channels} columns={[
                { title: 'Platform', dataIndex: 'platform', render: (v: string) => v.charAt(0).toUpperCase() + v.slice(1) },
                { title: 'Label', dataIndex: 'label' },
                { title: 'URL', dataIndex: 'url', render: (v: string) => <a href={v} target="_blank" rel="noreferrer">{v}</a> },
                {
                  title: 'Status', dataIndex: 'status',
                  render: (v: string, r: any) => (
                    <Space direction="vertical" size={0}>
                      <Tag color={v === 'approved' ? 'green' : v === 'rejected' ? 'red' : 'orange'}>{v.toUpperCase()}</Tag>
                      {v === 'rejected' && r.rejection_reason && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.rejection_reason}</Typography.Text>}
                    </Space>
                  ),
                },
                {
                  title: 'Actions', render: (r: any) => (
                    <Popconfirm title="Remove this channel?" onConfirm={() => deleteChannel(r.id)}>
                      <Button danger size="small">Delete</Button>
                    </Popconfirm>
                  ),
                },
              ]} />
            </>,
          },
        ]}
      />
```

- [ ] **Step 3: Build check**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/AgentPortal.tsx
git commit -m "feat(marketing): add Channels tab to Agent Portal"
```

---

### Task 5: Admin Panel UI — Agent Channels review tab

**Files:**
- Modify: `admin-panel/src/pages/Marketing.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /agent-channels` (Task 3, reached via `adminApi`).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add antd/icon imports**

Modify `admin-panel/src/pages/Marketing.tsx`. Replace:

```typescript
import { useEffect, useState } from 'react'
import {
  Card, Tabs, Table, Tag, Button, Modal, Form, Input, Space, message, Popconfirm,
  Row, Col, Statistic, Tooltip, InputNumber
} from 'antd'
import {
  LineChartOutlined, GlobalOutlined, ShareAltOutlined, CopyOutlined,
  PlusOutlined, DeleteOutlined, SaveOutlined, InfoCircleOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'
```

With:

```typescript
import { useEffect, useState } from 'react'
import {
  Card, Tabs, Table, Tag, Button, Modal, Form, Input, Space, message, Popconfirm,
  Row, Col, Statistic, Tooltip, InputNumber, Select
} from 'antd'
import {
  LineChartOutlined, GlobalOutlined, ShareAltOutlined, CopyOutlined,
  PlusOutlined, DeleteOutlined, SaveOutlined, InfoCircleOutlined, MessageOutlined
} from '@ant-design/icons'
import { adminApi } from '../api/client'
```

- [ ] **Step 2: Add the `AgentChannelsTab` component**

Modify `admin-panel/src/pages/Marketing.tsx`. Insert immediately before the final `export default function Marketing()`:

```typescript
interface AgentChannel {
  id: string
  agent_id: string
  agent_display_name: string
  platform: string
  label: string
  url: string
  status: string
  rejection_reason?: string
  created_at: string
}

function AgentChannelsTab() {
  const [channels, setChannels] = useState<AgentChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>('pending')
  const [rejecting, setRejecting] = useState<AgentChannel | null>(null)
  const [reason, setReason] = useState('')

  const load = () => {
    setLoading(true)
    adminApi.get('/agent-channels', { params: statusFilter ? { status: statusFilter } : {} })
      .then(r => setChannels(r.data))
      .catch(() => message.error('Failed to load channels'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [statusFilter])

  const approve = async (id: string) => {
    try {
      await adminApi.patch(`/agent-channels/${id}`, { status: 'approved' })
      message.success('Channel approved')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to approve')
    }
  }

  const reject = async () => {
    if (!reason.trim()) { message.warning('Rejection reason required'); return }
    try {
      await adminApi.patch(`/agent-channels/${rejecting!.id}`, { status: 'rejected', rejection_reason: reason })
      message.success('Channel rejected')
      setRejecting(null)
      setReason('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to reject')
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} allowClear placeholder="All statuses">
          <Select.Option value="pending">Pending</Select.Option>
          <Select.Option value="approved">Approved</Select.Option>
          <Select.Option value="rejected">Rejected</Select.Option>
        </Select>
      </Space>
      <Table rowKey="id" dataSource={channels} loading={loading} columns={[
        { title: 'Agent', dataIndex: 'agent_display_name' },
        { title: 'Platform', dataIndex: 'platform', render: (v: string) => v.charAt(0).toUpperCase() + v.slice(1) },
        { title: 'Label', dataIndex: 'label' },
        { title: 'URL', dataIndex: 'url', render: (v: string) => <a href={v} target="_blank" rel="noreferrer">{v}</a> },
        { title: 'Status', dataIndex: 'status', render: (v: string) => (
          <Tag color={v === 'approved' ? 'green' : v === 'rejected' ? 'red' : 'orange'}>{v.toUpperCase()}</Tag>
        )},
        { title: 'Submitted', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
        {
          title: 'Actions', render: (r: AgentChannel) => r.status === 'pending' ? (
            <Space>
              <Button size="small" type="primary" onClick={() => approve(r.id)}>Approve</Button>
              <Button size="small" danger onClick={() => setRejecting(r)}>Reject</Button>
            </Space>
          ) : null,
        },
      ]} />
      <Modal title="Reject Channel" open={!!rejecting} onCancel={() => { setRejecting(null); setReason('') }} onOk={reject}>
        <p>Reason for rejection (required):</p>
        <Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Not an official group, suspicious link" />
      </Modal>
    </>
  )
}

```

- [ ] **Step 3: Add the new tab to the `Marketing` component**

Modify `admin-panel/src/pages/Marketing.tsx`. Replace:

```typescript
export default function Marketing() {
  return (
    <Card title="SEO & Marketing System">
      <Tabs defaultActiveKey="campaigns" items={[
        { key: 'campaigns', label: <><ShareAltOutlined /> UTM Tracking Links</>, children: <CampaignsTab /> },
        { key: 'referrals', label: <><LineChartOutlined /> Referral Analytics</>, children: <ReferralsTab /> },
        { key: 'seo', label: <><GlobalOutlined /> Global SEO Settings</>, children: <GlobalSeoTab /> }
      ]} />
    </Card>
  )
```

With:

```typescript
export default function Marketing() {
  return (
    <Card title="SEO & Marketing System">
      <Tabs defaultActiveKey="campaigns" items={[
        { key: 'campaigns', label: <><ShareAltOutlined /> UTM Tracking Links</>, children: <CampaignsTab /> },
        { key: 'referrals', label: <><LineChartOutlined /> Referral Analytics</>, children: <ReferralsTab /> },
        { key: 'agent_channels', label: <><MessageOutlined /> Agent Channels</>, children: <AgentChannelsTab /> },
        { key: 'seo', label: <><GlobalOutlined /> Global SEO Settings</>, children: <GlobalSeoTab /> }
      ]} />
    </Card>
  )
```

- [ ] **Step 4: Build check**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/Marketing.tsx
git commit -m "feat(marketing): add Agent Channels review tab to Admin Panel"
```
