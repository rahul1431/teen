import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { mergeReferralRows, conversionRate } from './referral-metrics'
import { validateChannelUrl } from './channel-validation'
import { calculateDailySettlement, AgentNode, PlayerNetLoss } from './agent-settlement'

// Self-service routes for agents themselves (not admin staff). Agent JWTs
// carry role: 'agent', which is intentionally outside the admin ROLES
// hierarchy in index.ts. These routes use their own combined verify+role guard
// (authenticateAgent) rather than index.ts's shared `authenticate` decorator,
// because that shared decorator now REJECTS role: 'agent' tokens (so agent JWTs
// can't leak into general admin routes). req.jwtVerify() is available globally
// once @fastify/jwt is registered in index.ts, so no passed-in guard is needed.
export async function registerAgentPortalRoutes(
  app: FastifyInstance,
  db: Pool,
) {
  const authenticateAgent = async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
      if ((req.user as any)?.role !== 'agent') return reply.code(403).send({ error: 'Forbidden' })
    } catch { reply.code(401).send({ error: 'Unauthorized', session_expired: true }) }
  }

  // POST /api/admin/agent-portal/auth/login
  app.post('/api/admin/agent-portal/auth/login', async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body)
    const res = await db.query(`SELECT * FROM agents WHERE username = $1 AND status = 'active'`, [username])
    if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })
    const agent = res.rows[0]
    const valid = await bcrypt.compare(password, agent.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ sub: agent.id, username: agent.username, role: 'agent' }, { expiresIn: '8h' })
    return reply.send({
      token,
      admin: { id: agent.id, username: agent.username, role: 'agent', display_name: agent.display_name },
    })
  })

  // GET /api/admin/agent-portal/me — dashboard summary
  app.get('/api/admin/agent-portal/me', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const [agentRes, walletRes, subAgentsRes] = await Promise.all([
      db.query('SELECT id, username, display_name, commission_rate, referral_code, parent_agent_id FROM agents WHERE id = $1', [agentId]),
      db.query('SELECT balance::float, locked_balance::float, total_earned::float, total_paid_out::float FROM agent_wallets WHERE agent_id = $1', [agentId]),
      db.query(`SELECT id, display_name, commission_rate FROM agents WHERE parent_agent_id = $1`, [agentId]),
    ])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    return reply.send({
      agent: agentRes.rows[0],
      wallet: walletRes.rows[0] || { balance: 0, locked_balance: 0, total_earned: 0, total_paid_out: 0 },
      sub_agents: subAgentsRes.rows,
    })
  })

  // GET /api/admin/agent-portal/players — this agent's direct players (read-only)
  app.get('/api/admin/agent-portal/players', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT username, status, created_at,
              (SELECT MAX(created_at) FROM wallet_transactions WHERE user_id = users.id) AS last_active
       FROM users WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    )
    return reply.send(res.rows)
  })

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

  // POST /api/admin/agent-portal/payout — request a payout against the current balance
  app.post('/api/admin/agent-portal/payout', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const body = z.object({
      amount: z.number().min(100),
      bank_account: z.string().optional(),
      upi_id: z.string().optional(),
    }).parse(req.body)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const walletRes = await client.query('SELECT balance FROM agent_wallets WHERE agent_id = $1 FOR UPDATE', [agentId])
      const balance = parseFloat(walletRes.rows[0]?.balance ?? '0')
      if (balance < body.amount) {
        await client.query('ROLLBACK')
        return reply.code(400).send({ error: 'Insufficient balance' })
      }
      await client.query(
        'UPDATE agent_wallets SET balance = balance - $1, locked_balance = locked_balance + $1, updated_at = NOW() WHERE agent_id = $2',
        [body.amount, agentId]
      )
      const payoutRes = await client.query(
        `INSERT INTO agent_payouts (agent_id, amount, metadata) VALUES ($1, $2, $3) RETURNING id`,
        [agentId, body.amount, JSON.stringify({ bank_account: body.bank_account, upi_id: body.upi_id })]
      )
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
      // Uses (now() AT TIME ZONE 'Asia/Kolkata')::date rather than bare
      // CURRENT_DATE: CURRENT_DATE resolves in the Postgres session's
      // configured TimeZone (this DB's session TimeZone is UTC, confirmed
      // via `SHOW TimeZone`), which would silently shift this window by a
      // day during the ~5.5h/day UTC/IST calendar-date mismatch window
      // (UTC 18:30-23:59 = IST 00:00-05:29) — exactly the kind of
      // day-boundary bug this feature exists to compute correctly.
      db.query(
        `SELECT u.agent_id,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
         FROM wallet_transactions wt
         JOIN users u ON u.id = wt.user_id
         WHERE u.agent_id IS NOT NULL
           AND wt.type IN ('game_debit', 'game_credit')
           AND wt.status = 'completed'
           AND wt.created_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata')
           AND wt.created_at <  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1) AT TIME ZONE 'Asia/Kolkata')
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
           AND wt.created_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata')
           AND wt.created_at <  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1) AT TIME ZONE 'Asia/Kolkata')
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
