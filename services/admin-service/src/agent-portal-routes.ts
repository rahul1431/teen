import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { mergeReferralRows, conversionRate } from './referral-metrics'
import { validateChannelUrl } from './channel-validation'
import { calculateDailySettlement, AgentNode, PlayerNetLoss } from './agent-settlement'
import { validateRateAssignment, validateNewAgentParent } from './agent-hierarchy'

// Self-service routes for agents themselves (not admin staff).
export async function registerAgentPortalRoutes(
  app: FastifyInstance,
  db: Pool,
) {
  function generateAgentReferralCode(): string {
    return 'AG' + crypto.randomBytes(4).toString('hex').toUpperCase()
  }

  const authenticateAgent = async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
      if ((req.user as any)?.role !== 'agent') return reply.code(403).send({ error: 'Forbidden' })
    } catch {
      reply.code(401).send({ error: 'Unauthorized', session_expired: true })
    }
  }

  // POST /api/admin/agent-portal/auth/login — supports username OR phone login
  app.post('/api/admin/agent-portal/auth/login', async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body)
    const res = await db.query(
      `SELECT * FROM agents WHERE (LOWER(username) = LOWER($1) OR phone = $1) AND status = 'active'`,
      [username.trim()]
    )
    if (!res.rows.length) return reply.code(401).send({ error: 'Invalid agent credentials or account suspended' })
    const agent = res.rows[0]
    const valid = await bcrypt.compare(password, agent.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid agent credentials' })

    const token = app.jwt.sign({ sub: agent.id, username: agent.username, role: 'agent' }, { expiresIn: '8h' })
    return reply.send({
      token,
      admin: {
        id: agent.id,
        username: agent.username,
        role: 'agent',
        display_name: agent.display_name,
        referral_code: agent.referral_code,
      },
    })
  })

  // GET /api/admin/agent-portal/me — comprehensive dashboard summary
  app.get('/api/admin/agent-portal/me', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const [agentRes, walletRes, subAgentsRes, playersCountRes] = await Promise.all([
      db.query(
        `SELECT id, username, display_name, phone, commission_rate::float,
                COALESCE(game_commissions, '{}'::jsonb) AS game_commissions,
                referral_code, parent_agent_id, created_at
         FROM agents WHERE id = $1`,
        [agentId]
      ),
      db.query(
        `SELECT balance::float, locked_balance::float, total_earned::float, total_paid_out::float
         FROM agent_wallets WHERE agent_id = $1`,
        [agentId]
      ),
      db.query(
        `SELECT a.id, a.username, a.display_name, a.phone, a.commission_rate::float,
                COALESCE(a.game_commissions, '{}'::jsonb) AS game_commissions,
                a.status, a.created_at,
                (SELECT COUNT(*) FROM users u WHERE u.agent_id = a.id)::int AS player_count,
                COALESCE(w.balance, 0)::float AS balance,
                COALESCE(w.total_earned, 0)::float AS total_earned
         FROM agents a
         LEFT JOIN agent_wallets w ON w.agent_id = a.id
         WHERE a.parent_agent_id = $1
         ORDER BY a.created_at DESC`,
        [agentId]
      ),
      db.query(`SELECT COUNT(*)::int AS count FROM users WHERE agent_id = $1`, [agentId]),
    ])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })

    return reply.send({
      agent: agentRes.rows[0],
      wallet: walletRes.rows[0] || { balance: 0, locked_balance: 0, total_earned: 0, total_paid_out: 0 },
      sub_agents: subAgentsRes.rows,
      player_count: playersCountRes.rows[0]?.count || 0,
    })
  })

  // POST /api/admin/agent-portal/change-password
  app.post('/api/admin/agent-portal/change-password', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const body = z.object({
      current_password: z.string(),
      new_password: z.string().min(6),
    }).parse(req.body)

    const res = await db.query('SELECT password_hash FROM agents WHERE id = $1', [agentId])
    if (!res.rows.length) return reply.code(404).send({ error: 'Agent not found' })

    const valid = await bcrypt.compare(body.current_password, res.rows[0].password_hash)
    if (!valid) return reply.code(400).send({ error: 'Current password is incorrect' })

    const newHash = await bcrypt.hash(body.new_password, 12)
    await db.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [newHash, agentId])
    return reply.send({ success: true, message: 'Password changed successfully' })
  })

  // POST /api/admin/agent-portal/sub-agents — Master Agent can create a Sub-Agent
  app.post('/api/admin/agent-portal/sub-agents', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const masterAgentId = (req.user as any).sub
    const body = z.object({
      username: z.string().min(3).max(50),
      password: z.string().min(6),
      display_name: z.string().min(1).max(100),
      phone: z.string().optional(),
      commission_rate: z.number().min(0).max(100),
      game_commissions: z.record(z.string(), z.number().min(0).max(100)).optional(),
    }).parse(req.body)

    const existing = await db.query('SELECT id FROM agents WHERE username = $1', [body.username])
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Username already exists' })

    const allAgentsRes = await db.query('SELECT id, parent_agent_id, commission_rate FROM agents')
    const allAgents = allAgentsRes.rows.map(r => ({ id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate) }))

    const parentCheck = validateNewAgentParent(allAgents, masterAgentId)
    if (!parentCheck.ok) return reply.code(400).send({ error: parentCheck.error })

    const rateCheck = validateRateAssignment(allAgents, null, masterAgentId, body.commission_rate)
    if (!rateCheck.ok) return reply.code(400).send({ error: rateCheck.error })

    const passwordHash = await bcrypt.hash(body.password, 12)
    let referralCode = generateAgentReferralCode()
    const collision = await db.query('SELECT 1 FROM agents WHERE referral_code = $1', [referralCode])
    if (collision.rows.length > 0) referralCode = generateAgentReferralCode()

    const gameCommissions = body.game_commissions || {}

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const res = await client.query(
        `INSERT INTO agents (username, password_hash, display_name, phone, parent_agent_id, commission_rate, game_commissions, referral_code, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [body.username, passwordHash, body.display_name, body.phone || null, masterAgentId, body.commission_rate, JSON.stringify(gameCommissions), referralCode, masterAgentId]
      )
      const agentId = res.rows[0].id
      await client.query('INSERT INTO agent_wallets (agent_id) VALUES ($1)', [agentId])

      for (const [gameType, rate] of Object.entries(gameCommissions)) {
        await client.query(
          `INSERT INTO agent_game_commissions (agent_id, game_type, commission_rate) VALUES ($1, $2, $3)
           ON CONFLICT (agent_id, game_type) DO UPDATE SET commission_rate = EXCLUDED.commission_rate, updated_at = NOW()`,
          [agentId, gameType, rate]
        )
      }

      await client.query('COMMIT')
      return reply.code(201).send({ id: agentId, referral_code: referralCode, message: 'Sub-Agent created successfully!' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /api/admin/agent-portal/players — this agent's direct players with turnovers
  app.get('/api/admin/agent-portal/players', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT u.username, u.status, u.created_at,
              COALESCE(w.real_balance, 0)::float AS wallet_balance,
              (SELECT COALESCE(SUM(amount), 0)::float FROM wallet_transactions WHERE user_id = u.id AND type = 'game_debit' AND status = 'completed') AS total_turnover,
              (SELECT COALESCE(SUM(CASE WHEN type = 'game_debit' THEN amount ELSE -amount END), 0)::float FROM wallet_transactions WHERE user_id = u.id AND type IN ('game_debit', 'game_credit') AND status = 'completed') AS net_house_win,
              (SELECT MAX(created_at) FROM wallet_transactions WHERE user_id = u.id) AS last_active
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.agent_id = $1
       ORDER BY u.created_at DESC`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agent-portal/ledger — this agent's commission history
  app.get('/api/admin/agent-portal/ledger', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT id, date, direct_commission::float, override_commission::float, total_commission::float,
              COALESCE(game_breakdown, '{}'::jsonb) AS game_breakdown, status, created_at
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agent-portal/payouts — this agent's payout request history
  app.get('/api/admin/agent-portal/payouts', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT id, amount::float, metadata, status, reference, requested_at, processed_at
       FROM agent_payouts WHERE agent_id = $1 ORDER BY requested_at DESC LIMIT 50`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agent-portal/referrals — Comprehensive Multi-Stage Funnel & Attribution Analytics
  app.get('/api/admin/agent-portal/referrals', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query)

    const agentRes = await db.query('SELECT referral_code FROM agents WHERE id = $1', [agentId])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    const referralCode = agentRes.rows[0].referral_code

    const [clicksRes, usersRes, ftdRes, betsRes, vipRes, sourcesRes, devicesRes, dailySeriesRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total_clicks,
                COUNT(DISTINCT ip_address)::int AS unique_visitors
         FROM referral_clicks
         WHERE UPPER(ref_code) = UPPER($1) AND clicked_at >= NOW() - ($2 || ' days')::interval`,
        [referralCode, days]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total_signups
         FROM users
         WHERE agent_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval`,
        [agentId, days]
      ),
      db.query(
        `SELECT COUNT(DISTINCT ftd.user_id)::int AS total_ftds,
                COALESCE(SUM(ftd.amount), 0)::float AS total_ftd_amount,
                COALESCE(SUM(all_dep.amount), 0)::float AS total_deposits
         FROM users u
         JOIN (
           SELECT DISTINCT ON (user_id) user_id, amount
           FROM wallet_transactions
           WHERE type = 'deposit' AND status = 'completed'
           ORDER BY user_id, created_at ASC
         ) ftd ON ftd.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(amount) AS amount
           FROM wallet_transactions
           WHERE type = 'deposit' AND status = 'completed'
           GROUP BY user_id
         ) all_dep ON all_dep.user_id = u.id
         WHERE u.agent_id = $1 AND u.created_at >= NOW() - ($2 || ' days')::interval`,
        [agentId, days]
      ),
      db.query(
        `SELECT COUNT(DISTINCT u.id)::int AS total_betters,
                COALESCE(SUM(wt.amount), 0)::float AS total_turnover,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE -wt.amount END), 0)::float AS net_ggr
         FROM users u
         JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.status = 'completed' AND wt.type IN ('game_debit', 'game_credit')
         WHERE u.agent_id = $1 AND u.created_at >= NOW() - ($2 || ' days')::interval`,
        [agentId, days]
      ),
      db.query(
        `SELECT COUNT(DISTINCT u.id)::int AS total_vip_players
         FROM users u
         JOIN (
           SELECT user_id, SUM(amount) AS total_wager, COUNT(DISTINCT created_at::date) AS active_days
           FROM wallet_transactions
           WHERE type = 'game_debit' AND status = 'completed'
           GROUP BY user_id
           HAVING SUM(amount) >= 500 OR COUNT(DISTINCT created_at::date) >= 2
         ) vip ON vip.user_id = u.id
         WHERE u.agent_id = $1 AND u.created_at >= NOW() - ($2 || ' days')::interval`,
        [agentId, days]
      ),
      db.query(
        `SELECT COALESCE(rc.utm_source, 'Direct Referral Link') AS source,
                COUNT(rc.id)::int AS clicks,
                COUNT(DISTINCT rc.converted_user_id)::int AS signups,
                COUNT(DISTINCT ut.user_id)::int AS ftds,
                COALESCE(SUM(ut.deposits), 0)::float AS deposits,
                COALESCE(SUM(ut.turnover), 0)::float AS turnover
         FROM referral_clicks rc
         LEFT JOIN users u ON u.id = rc.converted_user_id AND u.agent_id = $1
         LEFT JOIN (
           SELECT 
             user_id,
             SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) AS deposits,
             SUM(CASE WHEN type = 'game_debit' THEN amount ELSE 0 END) AS turnover
           FROM wallet_transactions
           WHERE status = 'completed'
           GROUP BY user_id
         ) ut ON ut.user_id = u.id
         WHERE UPPER(rc.ref_code) = UPPER($2) AND rc.clicked_at >= NOW() - ($3 || ' days')::interval
         GROUP BY COALESCE(rc.utm_source, 'Direct Referral Link')
         ORDER BY clicks DESC LIMIT 10`,
        [agentId, referralCode, days]
      ),
      db.query(
        `SELECT COALESCE(device_type, 'mobile') AS device_type,
                COUNT(*)::int AS count
         FROM referral_clicks
         WHERE UPPER(ref_code) = UPPER($1) AND clicked_at >= NOW() - ($2 || ' days')::interval
         GROUP BY 1`,
        [referralCode, days]
      ),
      db.query(
        `SELECT d::date::text AS date,
                COALESCE(c.clicks, 0)::int AS clicks,
                COALESCE(s.signups, 0)::int AS signups,
                COALESCE(f.ftds, 0)::int AS ftds,
                COALESCE(t.turnover, 0)::float AS turnover
         FROM generate_series(CURRENT_DATE - ($2 || ' days')::interval, CURRENT_DATE, '1 day'::interval) d
         LEFT JOIN (
           SELECT clicked_at::date AS dt, COUNT(*) AS clicks
           FROM referral_clicks
           WHERE UPPER(ref_code) = UPPER($1)
           GROUP BY 1
         ) c ON c.dt = d::date
         LEFT JOIN (
           SELECT created_at::date AS dt, COUNT(*) AS signups
           FROM users
           WHERE agent_id = $3
           GROUP BY 1
         ) s ON s.dt = d::date
         LEFT JOIN (
           SELECT u.created_at::date AS dt, COUNT(DISTINCT u.id) AS ftds
           FROM users u
           JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'deposit' AND wt.status = 'completed'
           WHERE u.agent_id = $3
           GROUP BY 1
         ) f ON f.dt = d::date
         LEFT JOIN (
           SELECT wt.created_at::date AS dt, SUM(wt.amount) AS turnover
           FROM wallet_transactions wt
           JOIN users u ON u.id = wt.user_id AND u.agent_id = $3
           WHERE wt.type = 'game_debit' AND wt.status = 'completed'
           GROUP BY 1
         ) t ON t.dt = d::date
         ORDER BY d ASC`,
        [referralCode, days, agentId]
      ),
    ])

    const clicks = clicksRes.rows[0]?.total_clicks || 0
    const signups = usersRes.rows[0]?.total_signups || 0
    const ftds = ftdRes.rows[0]?.total_ftds || 0
    const betters = betsRes.rows[0]?.total_betters || 0
    const vips = vipRes.rows[0]?.total_vip_players || 0

    const effectiveVisits = Math.max(clicks, signups)

    const stages = [
      {
        key: 'visits',
        label: '1. Link Clicks & Hits',
        count: effectiveVisits,
        conversion_from_prev: 100,
        drop_off: 0,
        icon: '🔗',
      },
      {
        key: 'signups',
        label: '2. Registrations',
        count: signups,
        conversion_from_prev: effectiveVisits > 0 ? Number(((signups / effectiveVisits) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, effectiveVisits - signups),
        icon: '📝',
      },
      {
        key: 'ftd',
        label: '3. First Deposits (FTD)',
        count: ftds,
        conversion_from_prev: signups > 0 ? Number(((ftds / signups) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, signups - ftds),
        icon: '💳',
      },
      {
        key: 'bets',
        label: '4. Active Game Betters',
        count: betters,
        conversion_from_prev: ftds > 0 ? Number(((betters / ftds) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, ftds - betters),
        icon: '🎲',
      },
      {
        key: 'vip',
        label: '5. Retained / High-Value Players',
        count: vips,
        conversion_from_prev: betters > 0 ? Number(((vips / betters) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, betters - vips),
        icon: '⭐',
      },
    ]

    return reply.send({
      days,
      summary: {
        total_clicks: clicks,
        unique_visitors: clicksRes.rows[0]?.unique_visitors || 0,
        signups,
        ftds,
        total_ftd_amount: ftdRes.rows[0]?.total_ftd_amount || 0,
        total_deposits: ftdRes.rows[0]?.total_deposits || 0,
        total_betters: betters,
        total_turnover: betsRes.rows[0]?.total_turnover || 0,
        net_ggr: betsRes.rows[0]?.net_ggr || 0,
        total_vip_players: vips,
        click_to_signup_rate: effectiveVisits > 0 ? Number(((signups / effectiveVisits) * 100).toFixed(1)) : 0,
        signup_to_ftd_rate: signups > 0 ? Number(((ftds / signups) * 100).toFixed(1)) : 0,
        overall_conversion_rate: effectiveVisits > 0 ? Number(((ftds / effectiveVisits) * 100).toFixed(2)) : 0,
      },
      stages,
      sources: sourcesRes.rows.map(r => ({
        ...r,
        conv_rate: r.clicks > 0 ? Number(((r.signups / r.clicks) * 100).toFixed(1)) : 0,
      })),
      devices: devicesRes.rows,
      daily_series: dailySeriesRes.rows,
    })
  })

  // POST /api/admin/agent-portal/payout — request payout in ₹
  app.post('/api/admin/agent-portal/payout', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const body = z.object({
      amount: z.number().min(100),
      bank_account: z.string().optional(),
      ifsc: z.string().optional(),
      account_holder: z.string().optional(),
      upi_id: z.string().optional(),
    }).parse(req.body)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const walletRes = await client.query('SELECT balance FROM agent_wallets WHERE agent_id = $1 FOR UPDATE', [agentId])
      const balance = parseFloat(walletRes.rows[0]?.balance ?? '0')
      if (balance < body.amount) {
        await client.query('ROLLBACK')
        return reply.code(400).send({ error: `Insufficient wallet balance. You have ₹${balance.toFixed(2)}` })
      }
      await client.query(
        'UPDATE agent_wallets SET balance = balance - $1, locked_balance = locked_balance + $1, updated_at = NOW() WHERE agent_id = $2',
        [body.amount, agentId]
      )
      const payoutRes = await client.query(
        `INSERT INTO agent_payouts (agent_id, amount, metadata) VALUES ($1, $2, $3) RETURNING id`,
        [agentId, body.amount, JSON.stringify({ bank_account: body.bank_account, ifsc: body.ifsc, account_holder: body.account_holder, upi_id: body.upi_id })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true, payout_id: payoutRes.rows[0].id, message: 'Payout request submitted successfully. Processed within 24 hours.' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /api/admin/agent-portal/channels
  app.get('/api/admin/agent-portal/channels', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT id, platform, label, url, status, rejection_reason, created_at
       FROM agent_channels WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agent-portal/channels
  app.post('/api/admin/agent-portal/channels', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const body = z.object({
      platform: z.enum(['telegram', 'whatsapp', 'youtube', 'instagram', 'other']),
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

  // DELETE /api/admin/agent-portal/channels/:id
  app.delete('/api/admin/agent-portal/channels/:id', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const { id } = req.params as any
    const res = await db.query(`DELETE FROM agent_channels WHERE id = $1 AND agent_id = $2`, [id, agentId])
    if (res.rowCount === 0) return reply.code(404).send({ error: 'Channel not found' })
    return reply.send({ success: true })
  })

  // GET /api/admin/agent-portal/commission/live
  app.get('/api/admin/agent-portal/commission/live', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub

    const [agentsRes, lossesRes, playersRes] = await Promise.all([
      db.query('SELECT id, parent_agent_id, commission_rate, game_commissions, status FROM agents'),
      db.query(
        `SELECT u.agent_id,
                CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' WHEN wt.description ILIKE '%matka%' THEN 'matka' WHEN wt.description ILIKE '%cricket%' THEN 'cricket' WHEN wt.description ILIKE '%aviator%' THEN 'aviator' ELSE COALESCE(gr.game_type::text, 'general') END AS game_type,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
         FROM wallet_transactions wt
         JOIN users u ON u.id = wt.user_id
         LEFT JOIN game_rooms gr ON gr.id::text = wt.reference_id
         WHERE u.agent_id IS NOT NULL
           AND wt.type IN ('game_debit', 'game_credit')
           AND wt.status = 'completed'
           AND wt.created_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata')
           AND wt.created_at <  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1) AT TIME ZONE 'Asia/Kolkata')
         GROUP BY u.agent_id, CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' WHEN wt.description ILIKE '%matka%' THEN 'matka' WHEN wt.description ILIKE '%cricket%' THEN 'cricket' WHEN wt.description ILIKE '%aviator%' THEN 'aviator' ELSE COALESCE(gr.game_type::text, 'general') END`
      ),
      // Per-player breakdown for THIS agent's own direct players only.
      db.query(
        `SELECT u.username,
                CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' WHEN wt.description ILIKE '%matka%' THEN 'matka' WHEN wt.description ILIKE '%cricket%' THEN 'cricket' WHEN wt.description ILIKE '%aviator%' THEN 'aviator' ELSE COALESCE(gr.game_type::text, 'general') END AS game_type,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
         FROM wallet_transactions wt
         JOIN users u ON u.id = wt.user_id
         LEFT JOIN game_rooms gr ON gr.id::text = wt.reference_id
         WHERE u.agent_id = $1
           AND wt.type IN ('game_debit', 'game_credit')
           AND wt.status = 'completed'
           AND wt.created_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata')
           AND wt.created_at <  (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1) AT TIME ZONE 'Asia/Kolkata')
         GROUP BY u.username, CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' WHEN wt.description ILIKE '%matka%' THEN 'matka' WHEN wt.description ILIKE '%cricket%' THEN 'cricket' WHEN wt.description ILIKE '%aviator%' THEN 'aviator' ELSE COALESCE(gr.game_type::text, 'general') END
         ORDER BY net_house_win DESC`,
        [agentId]
      ),
    ])

    const agents: AgentNode[] = agentsRes.rows.map(r => ({
      id: r.id,
      parentAgentId: r.parent_agent_id,
      commissionRate: parseFloat(r.commission_rate),
      gameCommissions: typeof r.game_commissions === 'string' ? JSON.parse(r.game_commissions) : (r.game_commissions || {}),
      status: r.status,
    }))
    const playerLosses: PlayerNetLoss[] = lossesRes.rows.map(r => ({
      agentId: r.agent_id,
      gameType: r.game_type,
      netHouseWin: parseFloat(r.net_house_win),
    }))

    const results = calculateDailySettlement(agents, playerLosses)
    const mine = results.find(r => r.agentId === agentId)

    return reply.send({
      today: {
        direct_commission: mine?.directCommission ?? 0,
        override_commission: mine?.overrideCommission ?? 0,
        total_commission: mine?.totalCommission ?? 0,
        game_breakdown: mine?.gameBreakdown ?? {},
      },
      players: playersRes.rows.map(r => ({
        username: r.username,
        game_type: r.game_type,
        net_house_win: parseFloat(r.net_house_win),
      })),
    })
  })
}
