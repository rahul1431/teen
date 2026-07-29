# Live Commission Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can see a live, read-only estimate of today's commission (before the nightly settlement job runs) plus today's per-player net win/loss, in the existing Commission History tab.

**Architecture:** A new endpoint reuses the exact pure `calculateDailySettlement` function the nightly job already uses, fed with today's (still in-progress) completed transactions instead of a finalized past day. Nothing is written to `agent_commission_ledger`/`agent_wallets` — pure read. Frontend adds a small "Today (live estimate)" block above the existing historical ledger table.

**Tech Stack:** Fastify + Zod + `pg` (admin-service), React + antd (admin-panel).

## Global Constraints

- This is a pure read — no INSERT/UPDATE anywhere in this feature. It must never touch `agent_commission_ledger` or `agent_wallets`.
- Must reuse `calculateDailySettlement` from `services/admin-service/src/agent-settlement.ts` — do not reimplement the direct/override commission formula.
- Must use the same `status = 'completed'` filter and `AT TIME ZONE 'Asia/Kolkata'` day-boundary logic as `AgentSettlementJob.runSettlementForDate` (`services/admin-service/src/agent-settlement-job.ts`) — this is a financial-correctness requirement (the pending/completed double-counting bug the job's own comments warn about), not a style choice.
- No per-player commission split is invented — the UI shows each player's raw net win/loss and the real aggregate commission separately, never a fabricated per-row commission number.
- No test framework needed for this task — no new pure logic is introduced (the existing `calculateDailySettlement` is reused, not modified), so verification is `npx tsc --noEmit` only.

---

### Task 1: Backend — live commission preview endpoint

**Files:**
- Modify: `services/admin-service/src/agent-portal-routes.ts`

**Interfaces:**
- Consumes: `calculateDailySettlement(agents, playerLosses)` from `services/admin-service/src/agent-settlement.ts` (already exported, already used by `agent-settlement-job.ts`). `wallet_transactions`, `users`, `agents` tables (all existing).
- Produces: `GET /api/admin/agent-portal/commission/live` (behind the existing `authenticateAgent` guard) → `200 { today: { direct_commission, override_commission, total_commission }, players: [{ username, net_house_win }, ...] }`. Consumed by Task 2's frontend.

- [ ] **Step 1: Read the settlement job and pure function to confirm the exact reusable pieces**

Run: `sed -n '1,40p' services/admin-service/src/agent-settlement-job.ts` and `sed -n '1,40p' services/admin-service/src/agent-settlement.ts`
Expected: confirms `calculateDailySettlement(agents: AgentNode[], playerLosses: PlayerNetLoss[]): AgentSettlementResult[]` is a pure function with no DB access, and that `AgentNode`/`PlayerNetLoss`/`AgentSettlementResult` are exported interfaces.

- [ ] **Step 2: Add the import**

Modify `services/admin-service/src/agent-portal-routes.ts`. Replace:

```typescript
import { mergeReferralRows, conversionRate } from './referral-metrics'
import { validateChannelUrl } from './channel-validation'
```

With:

```typescript
import { mergeReferralRows, conversionRate } from './referral-metrics'
import { validateChannelUrl } from './channel-validation'
import { calculateDailySettlement, AgentNode, PlayerNetLoss } from './agent-settlement'
```

- [ ] **Step 3: Add the new route**

Modify `services/admin-service/src/agent-portal-routes.ts`. Replace the file's final lines:

```typescript
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

With:

```typescript
  // DELETE /api/admin/agent-portal/channels/:id — remove own channel only
  app.delete('/api/admin/agent-portal/channels/:id', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const { id } = req.params as any
    const res = await db.query(`DELETE FROM agent_channels WHERE id = $1 AND agent_id = $2`, [id, agentId])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'Channel not found' })
    return reply.send({ success: true })
  })

  // GET /api/admin/agent-portal/commission/live — read-only estimate of
  // today's commission, computed with the exact same formula the nightly
  // AgentSettlementJob uses, fed with today's (still in-progress) completed
  // transactions instead of a finalized past day. Writes nothing.
  app.get('/api/admin/agent-portal/commission/live', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub

    const [agentsRes, lossesRes, playersRes] = await Promise.all([
      db.query('SELECT id, parent_agent_id, commission_rate, status FROM agents'),
      // Same shape as AgentSettlementJob.runSettlementForDate's query, but
      // scoped to "today so far" (Asia/Kolkata) instead of a fixed past date.
      // The status = 'completed' filter is REQUIRED — see the identical
      // comment in agent-settlement-job.ts for why (pending/completed
      // double-counting in the lock/consume lifecycle).
      db.query(
        `SELECT u.agent_id,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
         FROM wallet_transactions wt
         JOIN users u ON u.id = wt.user_id
         WHERE u.agent_id IS NOT NULL
           AND wt.type IN ('game_debit', 'game_credit')
           AND wt.status = 'completed'
           AND wt.created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')
           AND wt.created_at <  ((CURRENT_DATE + 1) AT TIME ZONE 'Asia/Kolkata')
         GROUP BY u.agent_id`
      ),
      // Per-player breakdown for THIS agent's own direct players only.
      db.query(
        `SELECT u.username,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
         FROM wallet_transactions wt
         JOIN users u ON u.id = wt.user_id
         WHERE u.agent_id = $1
           AND wt.type IN ('game_debit', 'game_credit')
           AND wt.status = 'completed'
           AND wt.created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')
           AND wt.created_at <  ((CURRENT_DATE + 1) AT TIME ZONE 'Asia/Kolkata')
         GROUP BY u.username
         ORDER BY net_house_win DESC`,
        [agentId]
      ),
    ])

    const agents: AgentNode[] = agentsRes.rows.map(r => ({
      id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate), status: r.status,
    }))
    const playerLosses: PlayerNetLoss[] = lossesRes.rows.map(r => ({
      agentId: r.agent_id, netHouseWin: parseFloat(r.net_house_win),
    }))

    const results = calculateDailySettlement(agents, playerLosses)
    const mine = results.find(r => r.agentId === agentId)

    return reply.send({
      today: {
        direct_commission: mine?.directCommission ?? 0,
        override_commission: mine?.overrideCommission ?? 0,
        total_commission: mine?.totalCommission ?? 0,
      },
      players: playersRes.rows.map(r => ({
        username: r.username,
        net_house_win: parseFloat(r.net_house_win),
      })),
    })
  })
}
```

- [ ] **Step 4: Build check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification against real test data**

Record this check (run by the user against the live/deployed instance — no local DB in this environment):

```bash
# Confirm the endpoint returns a non-zero total_commission for the test1
# agent used to originally report this request, and that it matches the
# hand-computed expected value (~₹4.34 as of 2026-07-22, from the test1
# agent's referred player "tessst" — recompute for whatever day this is
# actually run).
curl -s https://game.myonlinejoker.com/api/admin/agent-portal/commission/live \
  -H "Authorization: Bearer <test1_agent_jwt>"

# Confirm it wrote NOTHING — row counts must be identical before and after:
docker exec teen_postgres psql -U teen -d teen_db -c \
  "SELECT COUNT(*) FROM agent_commission_ledger; SELECT COUNT(*) FROM agent_wallets;"
```

- [ ] **Step 6: Commit**

```bash
git add services/admin-service/src/agent-portal-routes.ts
git commit -m "feat(agents): add live commission preview endpoint (read-only, reuses settlement formula)"
```

---

### Task 2: Agent Portal UI — "Today (live estimate)" section

**Files:**
- Modify: `admin-panel/src/pages/AgentPortal.tsx`

**Interfaces:**
- Consumes: `GET /agent-portal/commission/live` (Task 1, reached via `adminApi` which already prefixes `/api/admin`) → `{ today: { direct_commission, override_commission, total_commission }, players: [{ username, net_house_win }] }`.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add state and load call**

Modify `admin-panel/src/pages/AgentPortal.tsx`. Replace:

```typescript
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
```

With:

```typescript
  const [channels, setChannels] = useState<any[]>([])
  const [liveCommission, setLiveCommission] = useState<{ today: any; players: any[] }>({
    today: { direct_commission: 0, override_commission: 0, total_commission: 0 },
    players: [],
  })
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [channelForm] = Form.useForm()
  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const load = async () => {
    const [meRes, playersRes, ledgerRes, referralsRes, channelsRes, liveCommissionRes] = await Promise.all([
      adminApi.get('/agent-portal/me'),
      adminApi.get('/agent-portal/players'),
      adminApi.get('/agent-portal/ledger'),
      adminApi.get('/agent-portal/referrals'),
      adminApi.get('/agent-portal/channels'),
      adminApi.get('/agent-portal/commission/live'),
    ])
    setMe(meRes.data)
    setPlayers(playersRes.data)
    setLedger(ledgerRes.data)
    setReferrals(referralsRes.data)
    setChannels(channelsRes.data)
    setLiveCommission(liveCommissionRes.data)
  }
```

- [ ] **Step 2: Add the "Today (live estimate)" block to the Commission History tab**

Modify `admin-panel/src/pages/AgentPortal.tsx`. Replace:

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
```

With:

```typescript
          {
            key: 'ledger', label: 'Commission History',
            children: <>
              <Typography.Title level={5} style={{ marginTop: 0 }}>Today (live estimate)</Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                Not yet paid out — settles into your balance after tonight's processing.
              </Typography.Text>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}><Card><Statistic title="Direct (est.)" value={liveCommission.today.direct_commission} prefix="₹" precision={2} /></Card></Col>
                <Col span={8}><Card><Statistic title="Override (est.)" value={liveCommission.today.override_commission} prefix="₹" precision={2} /></Card></Col>
                <Col span={8}><Card><Statistic title="Total (est.)" value={liveCommission.today.total_commission} prefix="₹" precision={2} /></Card></Col>
              </Row>
              {liveCommission.players.length > 0 && (
                <Table
                  rowKey="username"
                  dataSource={liveCommission.players}
                  pagination={false}
                  size="small"
                  style={{ marginBottom: 24 }}
                  columns={[
                    { title: 'Player (today)', dataIndex: 'username' },
                    {
                      title: 'Net Win/Loss', dataIndex: 'net_house_win',
                      render: (v: number) => `₹${v.toFixed(2)}`,
                    },
                  ]}
                />
              )}
              <Typography.Title level={5}>History</Typography.Title>
              <Table rowKey="date" dataSource={ledger} columns={[
                { title: 'Date', dataIndex: 'date' },
                { title: 'Direct', dataIndex: 'direct_commission', render: (v: number) => `₹${v.toFixed(2)}` },
                { title: 'Override', dataIndex: 'override_commission', render: (v: number) => `₹${v.toFixed(2)}` },
                { title: 'Total', dataIndex: 'total_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              ]} />
            </>,
          },
```

- [ ] **Step 3: Build check**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/AgentPortal.tsx
git commit -m "feat(agents): show live commission preview in Agent Portal"
```
