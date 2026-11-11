// services/admin-service/src/agent-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { validateNewAgentParent, validateRateAssignment } from './agent-hierarchy'
import { AgentSettlementJob } from './agent-settlement-job'
import { createAgentNotification } from './agent-portal-routes'

// Superadmin-only CRUD for the agent/sub-agent commission system with Per-Game Rates.
export async function registerAgentRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  function generateAgentReferralCode(): string {
    return 'AG' + crypto.randomBytes(4).toString('hex').toUpperCase()
  }

  // GET /api/admin/agents — full hierarchy, flat list with parent ids, balances, KYC, bank details, and per-game rates
  app.get('/api/admin/agents', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT a.id, a.username, a.display_name, a.phone, a.email, a.avatar_url, a.status, a.parent_agent_id,
              a.commission_rate::float AS commission_rate,
              COALESCE(a.game_commissions, '{}'::jsonb) AS game_commissions,
              a.referral_code, a.created_at,
              COALESCE(a.bank_details, '{}'::jsonb) AS bank_details,
              COALESCE(a.kyc_status, 'pending') AS kyc_status,
              COALESCE(a.kyc_data, '{}'::jsonb) AS kyc_data,
              COALESCE(w.balance, 0)::float AS balance,
              COALESCE(w.locked_balance, 0)::float AS locked_balance,
              COALESCE(w.total_earned, 0)::float AS total_earned,
              COALESCE(w.total_paid_out, 0)::float AS total_paid_out,
              (SELECT COUNT(*) FROM users u WHERE u.agent_id = a.id)::int AS player_count,
              (SELECT COUNT(*) FROM agents sub WHERE sub.parent_agent_id = a.id)::int AS sub_agent_count,
              (SELECT COUNT(*) FROM referral_clicks rc WHERE rc.ref_code = a.referral_code)::int AS click_count
       FROM agents a
       LEFT JOIN agent_wallets w ON w.agent_id = a.id
       ORDER BY a.created_at DESC`
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agents/:id — single agent complete profile
  app.get('/api/admin/agents/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT a.id, a.username, a.display_name, a.phone, a.email, a.avatar_url, a.status, a.parent_agent_id,
              a.commission_rate::float AS commission_rate,
              COALESCE(a.game_commissions, '{}'::jsonb) AS game_commissions,
              a.referral_code, a.created_at,
              COALESCE(a.bank_details, '{}'::jsonb) AS bank_details,
              COALESCE(a.kyc_status, 'pending') AS kyc_status,
              COALESCE(a.kyc_data, '{}'::jsonb) AS kyc_data,
              COALESCE(w.balance, 0)::float AS balance,
              COALESCE(w.locked_balance, 0)::float AS locked_balance,
              COALESCE(w.total_earned, 0)::float AS total_earned,
              COALESCE(w.total_paid_out, 0)::float AS total_paid_out,
              (SELECT COUNT(*) FROM users u WHERE u.agent_id = a.id)::int AS player_count,
              (SELECT COUNT(*) FROM agents sub WHERE sub.parent_agent_id = a.id)::int AS sub_agent_count,
              (SELECT COUNT(*) FROM referral_clicks rc WHERE rc.ref_code = a.referral_code)::int AS click_count
       FROM agents a
       LEFT JOIN agent_wallets w ON w.agent_id = a.id
       WHERE a.id = $1`,
      [id]
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    return reply.send(res.rows[0])
  })

  // POST /api/admin/agents — create agent with per-game commissions
  app.post('/api/admin/agents', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const body = z.object({
      username: z.string().min(3).max(50),
      password: z.string().min(6),
      display_name: z.string().min(1).max(100),
      phone: z.string().optional(),
      parent_agent_id: z.string().uuid().nullable().optional(),
      commission_rate: z.number().min(0).max(100).default(5),
      game_commissions: z.record(z.string(), z.number().min(0).max(100)).optional(),
    }).parse(req.body)

    const existing = await db.query('SELECT id FROM agents WHERE username = $1', [body.username])
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Username already exists' })

    const allAgentsRes = await db.query('SELECT id, parent_agent_id, commission_rate FROM agents')
    const allAgents = allAgentsRes.rows.map(r => ({ id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate) }))
    const parentAgentId = body.parent_agent_id || null

    const parentCheck = validateNewAgentParent(allAgents, parentAgentId)
    if (!parentCheck.ok) return reply.code(400).send({ error: parentCheck.error })

    const rateCheck = validateRateAssignment(allAgents, null, parentAgentId, body.commission_rate)
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
        [body.username, passwordHash, body.display_name, body.phone || null, parentAgentId, body.commission_rate, JSON.stringify(gameCommissions), referralCode, admin.sub]
      )
      const agentId = res.rows[0].id
      await client.query('INSERT INTO agent_wallets (agent_id) VALUES ($1)', [agentId])

      // Upsert into agent_game_commissions table
      for (const [gameType, rate] of Object.entries(gameCommissions)) {
        await client.query(
          `INSERT INTO agent_game_commissions (agent_id, game_type, commission_rate) VALUES ($1, $2, $3)
           ON CONFLICT (agent_id, game_type) DO UPDATE SET commission_rate = EXCLUDED.commission_rate, updated_at = NOW()`,
          [agentId, gameType, rate]
        )
      }

      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'create_agent', 'agent', $2, $3)`,
        [admin.sub, agentId, JSON.stringify({ username: body.username, commission_rate: body.commission_rate, game_commissions: gameCommissions, parent_agent_id: parentAgentId })]
      )
      await client.query('COMMIT')
      return reply.code(201).send({ id: agentId, referral_code: referralCode })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // PATCH /api/admin/agents/:id — edit rate/status/display_name/phone/email/bank/kyc/game_commissions
  app.patch('/api/admin/agents/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      display_name: z.string().min(1).max(100).optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      status: z.enum(['active', 'suspended']).optional(),
      commission_rate: z.number().min(0).max(100).optional(),
      game_commissions: z.record(z.string(), z.number().min(0).max(100)).optional(),
      bank_details: z.record(z.string(), z.any()).optional(),
      kyc_status: z.enum(['pending', 'submitted', 'verified', 'rejected']).optional(),
      kyc_data: z.record(z.string(), z.any()).optional(),
    }).parse(req.body)

    const existingRes = await db.query('SELECT id, parent_agent_id FROM agents WHERE id = $1', [id])
    if (!existingRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })

    if (body.commission_rate !== undefined) {
      const allAgentsRes = await db.query('SELECT id, parent_agent_id, commission_rate FROM agents')
      const allAgents = allAgentsRes.rows.map(r => ({ id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate) }))
      const rateCheck = validateRateAssignment(allAgents, id, existingRes.rows[0].parent_agent_id, body.commission_rate)
      if (!rateCheck.ok) return reply.code(400).send({ error: rateCheck.error })
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const sets: string[] = []
      const params: any[] = []
      if (body.display_name !== undefined) { params.push(body.display_name); sets.push(`display_name = $${params.length}`) }
      if (body.phone !== undefined) { params.push(body.phone); sets.push(`phone = $${params.length}`) }
      if (body.email !== undefined) { params.push(body.email); sets.push(`email = $${params.length}`) }
      if (body.status !== undefined) { params.push(body.status); sets.push(`status = $${params.length}`) }
      if (body.commission_rate !== undefined) { params.push(body.commission_rate); sets.push(`commission_rate = $${params.length}`) }
      if (body.bank_details !== undefined) { params.push(JSON.stringify(body.bank_details)); sets.push(`bank_details = $${params.length}`) }
      if (body.kyc_status !== undefined) { params.push(body.kyc_status); sets.push(`kyc_status = $${params.length}`) }
      if (body.kyc_data !== undefined) { params.push(JSON.stringify(body.kyc_data)); sets.push(`kyc_data = $${params.length}`) }
      if (body.game_commissions !== undefined) {
        params.push(JSON.stringify(body.game_commissions))
        sets.push(`game_commissions = $${params.length}`)

        for (const [gameType, rate] of Object.entries(body.game_commissions)) {
          await client.query(
            `INSERT INTO agent_game_commissions (agent_id, game_type, commission_rate) VALUES ($1, $2, $3)
             ON CONFLICT (agent_id, game_type) DO UPDATE SET commission_rate = EXCLUDED.commission_rate, updated_at = NOW()`,
            [id, gameType, rate]
          )
        }
      }

      if (sets.length > 0) {
        params.push(id)
        await client.query(`UPDATE agents SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
      }

      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'update_agent', 'agent', $2, $3)`,
        [admin.sub, id, JSON.stringify(body)]
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

  // POST /api/admin/agents/:id/assign-player — Admin manually assigns a player to this agent
  app.post('/api/admin/agents/:id/assign-player', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      player_identifier: z.string().min(1),
    }).parse(req.body)

    const agentRes = await db.query('SELECT id, username, display_name, referral_code FROM agents WHERE id = $1', [id])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    const agent = agentRes.rows[0]

    const cleanInput = body.player_identifier.trim().replace(/^@/, '')
    const digitsOnly = cleanInput.replace(/\D/g, '')

    const playerRes = await db.query(
      `SELECT id, username, phone, agent_id FROM users 
       WHERE LOWER(username) = LOWER($1) 
          OR phone = $1 
          OR ($2 <> '' AND (phone = $2 OR phone LIKE '%' || $2))
          OR id::text = $1 
       LIMIT 1`,
      [cleanInput, digitsOnly]
    )
    if (!playerRes.rows.length) {
      return reply.code(404).send({ error: `Player not found matching "${body.player_identifier}"` })
    }
    const player = playerRes.rows[0]

    // Assign player to agent. Note: referred_by is a UUID foreign key to users.id for player-to-player referrals,
    // whereas agent link is strictly tracked via users.agent_id.
    await db.query(
      `UPDATE users SET agent_id = $1 WHERE id = $2`,
      [id, player.id]
    )

    try {
      const adminId = admin?.sub || admin?.id || null
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'assign_player_to_agent', 'user', $2, $3)`,
        [adminId, player.id, JSON.stringify({ agent_id: id, agent_username: agent.username, previous_agent_id: player.agent_id })]
      )
    } catch (auditErr: any) {
      req.log.warn({ err: auditErr }, 'Failed to insert into admin_audit_log')
    }

    // Also notify agent of new player attribution
    try {
      await db.query(
        `INSERT INTO agent_notifications (agent_id, title, body, type, metadata)
         VALUES ($1, 'New Player Assigned', $2, 'player_assigned', $3)`,
        [
          id,
          `Player @${player.username || player.phone} was attributed to your account by administration.`,
          JSON.stringify({ player_id: player.id, player_username: player.username }),
        ]
      )
    } catch (_) {}

    return reply.send({
      success: true,
      message: `Player @${player.username || player.phone} assigned to Agent ${agent.display_name}`,
      player: { id: player.id, username: player.username, phone: player.phone }
    })
  })

  // POST /api/admin/agents/:id/kyc-decision — Admin approves or rejects agent KYC
  app.post('/api/admin/agents/:id/kyc-decision', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      status: z.enum(['verified', 'rejected']),
      notes: z.string().optional(),
    }).parse(req.body)

    const agentRes = await db.query('SELECT id, display_name, kyc_data FROM agents WHERE id = $1', [id])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })

    const existingKyc = agentRes.rows[0].kyc_data || {}
    const updatedKyc = {
      ...existingKyc,
      reviewed_by: admin?.sub || admin?.id,
      reviewed_at: new Date().toISOString(),
      admin_notes: body.notes || null,
    }

    await db.query(
      `UPDATE agents SET kyc_status = $1, kyc_data = $2 WHERE id = $3`,
      [body.status, JSON.stringify(updatedKyc), id]
    )

    try {
      await db.query(
        `INSERT INTO agent_notifications (agent_id, title, body, type)
         VALUES ($1, $2, $3, 'kyc_update')`,
        [
          id,
          body.status === 'verified' ? 'KYC Verification Approved ✅' : 'KYC Submission Rejected ❌',
          body.status === 'verified'
            ? 'Your KYC documents have been verified by administration. Higher limits and instant settlements are now active.'
            : `Your KYC documents were rejected. Reason: ${body.notes || 'Incomplete or unreadable documents'}. Please resubmit in your profile.`,
        ]
      )
    } catch (_) {}

    try {
      const adminId = admin?.sub || admin?.id || null
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'agent_kyc_decision', 'agent', $2, $3)`,
        [adminId, id, JSON.stringify(body)]
      )
    } catch (_) {}

    return reply.send({ success: true, status: body.status })
  })

  // GET /api/admin/agents/:id/analytics — Complete traffic, clicks, conversion and revenue analytics
  app.get('/api/admin/agents/:id/analytics', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const agentRes = await db.query('SELECT id, referral_code, commission_rate FROM agents WHERE id = $1', [id])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    const refCode = agentRes.rows[0].referral_code

    // 1. Clicks & Conversion Overview
    const clicksOverview = await db.query(
      `SELECT COUNT(*)::int AS total_clicks,
              COUNT(DISTINCT ip_address)::int AS unique_ips,
              COUNT(converted_user_id)::int AS converted_clicks
       FROM referral_clicks WHERE ref_code = $1`,
      [refCode]
    )

    // 2. Daily Clicks (Last 30 Days)
    const dailyClicks = await db.query(
      `SELECT DATE(clicked_at)::text AS date, COUNT(*)::int AS clicks, COUNT(converted_user_id)::int AS conversions
       FROM referral_clicks
       WHERE ref_code = $1 AND clicked_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(clicked_at)
       ORDER BY date ASC`,
      [refCode]
    )

    // 3. Device Breakdown
    const devices = await db.query(
      `SELECT COALESCE(device_type, 'unknown') AS device, COUNT(*)::int AS count
       FROM referral_clicks
       WHERE ref_code = $1
       GROUP BY device_type ORDER BY count DESC`,
      [refCode]
    )

    // 4. Traffic Sources / UTM
    const sources = await db.query(
      `SELECT COALESCE(utm_source, referrer_url, 'direct') AS source, COUNT(*)::int AS count
       FROM referral_clicks
       WHERE ref_code = $1
       GROUP BY COALESCE(utm_source, referrer_url, 'direct') ORDER BY count DESC LIMIT 10`,
      [refCode]
    )

    // 5. Player & Revenue Totals
    const playerStats = await db.query(
      `SELECT COUNT(u.id)::int AS total_players,
              COUNT(CASE WHEN (SELECT COUNT(*) FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type = 'deposit' AND wt.status = 'completed') > 0 THEN 1 END)::int AS depositing_players,
              COALESCE(SUM((SELECT SUM(amount) FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type = 'game_debit' AND wt.status = 'completed')), 0)::float AS total_turnover,
              COALESCE(SUM((SELECT SUM(CASE WHEN type = 'game_debit' THEN amount ELSE -amount END) FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type IN ('game_debit', 'game_credit') AND wt.status = 'completed')), 0)::float AS net_ggr
       FROM users u WHERE u.agent_id = $1`,
      [id]
    )

    // 6. Sub-Agents Performance
    const subAgents = await db.query(
      `SELECT a.id, a.username, a.display_name, a.commission_rate::float AS commission_rate,
              COALESCE(w.balance, 0)::float AS balance,
              COALESCE(w.total_earned, 0)::float AS total_earned,
              (SELECT COUNT(*) FROM users u WHERE u.agent_id = a.id)::int AS player_count,
              (SELECT COALESCE(SUM(override_commission), 0)::float FROM agent_commission_ledger WHERE agent_id = $1) AS override_earned
       FROM agents a
       LEFT JOIN agent_wallets w ON w.agent_id = a.id
       WHERE a.parent_agent_id = $1
       ORDER BY a.created_at DESC`,
      [id]
    )

    const cOverview = clicksOverview.rows[0] || { total_clicks: 0, unique_ips: 0, converted_clicks: 0 }
    const pStats = playerStats.rows[0] || { total_players: 0, depositing_players: 0, total_turnover: 0, net_ggr: 0 }
    const conversionRate = cOverview.total_clicks > 0 ? ((pStats.total_players / cOverview.total_clicks) * 100) : 0

    return reply.send({
      summary: {
        total_clicks: cOverview.total_clicks,
        unique_ips: cOverview.unique_ips,
        total_players: pStats.total_players,
        depositing_players: pStats.depositing_players,
        conversion_rate: parseFloat(conversionRate.toFixed(2)),
        total_turnover: pStats.total_turnover,
        net_ggr: pStats.net_ggr,
      },
      daily_clicks: dailyClicks.rows,
      devices: devices.rows,
      sources: sources.rows,
      sub_agents: subAgents.rows,
    })
  })

  // POST /api/admin/agents/:id/reset-password — Reset agent password
  app.post('/api/admin/agents/:id/reset-password', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({ new_password: z.string().min(6) }).parse(req.body)
    const hash = await bcrypt.hash(body.new_password, 12)
    await db.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [hash, id])
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'reset_agent_password', 'agent', $2, '{}')`,
      [admin.sub, id]
    )
    return reply.send({ success: true, message: 'Password reset successfully' })
  })

  // POST /api/admin/agents/:id/balance-adjust — Adjust wallet balance (+/- in ₹)
  app.post('/api/admin/agents/:id/balance-adjust', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      amount: z.number(), // positive to credit, negative to debit
      reason: z.string().min(3),
    }).parse(req.body)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const walletRes = await client.query('SELECT balance FROM agent_wallets WHERE agent_id = $1 FOR UPDATE', [id])
      if (!walletRes.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Agent wallet not found' })
      }
      const prev = parseFloat(walletRes.rows[0].balance)
      const next = prev + body.amount
      if (next < 0) {
        await client.query('ROLLBACK')
        return reply.code(400).send({ error: `Cannot deduct ₹${Math.abs(body.amount)}: agent balance is only ₹${prev.toFixed(2)}` })
      }

      await client.query('UPDATE agent_wallets SET balance = $1, updated_at = NOW() WHERE agent_id = $2', [next, id])
      await client.query(
        `INSERT INTO agent_wallet_adjustments (agent_id, admin_id, amount, previous_balance, new_balance, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, admin.sub, body.amount, prev, next, body.reason]
      )
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'agent_wallet_adjust', 'agent', $2, $3)`,
        [admin.sub, id, JSON.stringify({ amount: body.amount, previous_balance: prev, new_balance: next, reason: body.reason })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true, previous_balance: prev, new_balance: next })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /api/admin/agents/:id/players — referred players with game turnovers
  app.get('/api/admin/agents/:id/players', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT u.id, u.username, u.phone, u.status, u.created_at,
              COALESCE(w.real_balance, 0)::float AS wallet_balance,
              (SELECT COALESCE(SUM(amount), 0)::float FROM wallet_transactions WHERE user_id = u.id AND type = 'game_debit' AND status = 'completed') AS total_turnover,
              (SELECT COALESCE(SUM(CASE WHEN type = 'game_debit' THEN amount ELSE -amount END), 0)::float FROM wallet_transactions WHERE user_id = u.id AND type IN ('game_debit', 'game_credit') AND status = 'completed') AS net_house_win,
              (SELECT MAX(created_at) FROM wallet_transactions WHERE user_id = u.id) AS last_active
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.agent_id = $1
       ORDER BY u.created_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agents/:id/performance — Detailed Game-wise breakdown
  app.get('/api/admin/agents/:id/performance', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const gameStats = await db.query(
      `SELECT CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' WHEN wt.description ILIKE '%matka%' THEN 'matka' WHEN wt.description ILIKE '%cricket%' THEN 'cricket' WHEN wt.description ILIKE '%aviator%' THEN 'aviator' ELSE COALESCE(gr.game_type::text, 'general') END AS game_type,
              COUNT(DISTINCT wt.user_id)::int AS active_players,
              COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)::float AS turnover,
              COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE -wt.amount END), 0)::float AS net_house_win
       FROM wallet_transactions wt
       JOIN users u ON u.id = wt.user_id
       LEFT JOIN game_rooms gr ON gr.id::text = wt.reference_id
       WHERE u.agent_id = $1
         AND wt.type IN ('game_debit', 'game_credit')
         AND wt.status = 'completed'
       GROUP BY CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' WHEN wt.description ILIKE '%matka%' THEN 'matka' WHEN wt.description ILIKE '%cricket%' THEN 'cricket' WHEN wt.description ILIKE '%aviator%' THEN 'aviator' ELSE COALESCE(gr.game_type::text, 'general') END`,
      [id]
    )
    return reply.send({ games: gameStats.rows })
  })

  // GET /api/admin/agents/:id/ledger — Daily commission history with game breakdown
  app.get('/api/admin/agents/:id/ledger', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, date, direct_commission::float, override_commission::float, total_commission::float,
              COALESCE(game_breakdown, '{}'::jsonb) AS game_breakdown, status, flagged_for_review, created_at
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [id]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agents/trigger-settlement — Manual date settlement trigger
  app.post('/api/admin/agents/trigger-settlement', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body)
    const job = new AgentSettlementJob(db, (msg) => app.log.info(msg))
    await job.runSettlementForDate(body.date)
    return reply.send({ success: true, message: `Settlement for ${body.date} executed.` })
  })

  // POST /api/admin/agents/:id/ledger/:ledgerId/void — void ledger entry and reverse balance
  app.post('/api/admin/agents/:id/ledger/:ledgerId/void', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id, ledgerId } = req.params as any
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const ledgerRes = await client.query(
        `SELECT total_commission FROM agent_commission_ledger WHERE id = $1 AND agent_id = $2 AND status = 'settled' FOR UPDATE`,
        [ledgerId, id]
      )
      if (!ledgerRes.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Ledger entry not found or already voided' })
      }
      const amount = parseFloat(ledgerRes.rows[0].total_commission)
      await client.query(`UPDATE agent_commission_ledger SET status = 'voided' WHERE id = $1`, [ledgerId])
      await client.query(
        `UPDATE agent_wallets SET balance = balance - $1, total_earned = total_earned - $1, updated_at = NOW() WHERE agent_id = $2`,
        [amount, id]
      )
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'void_agent_commission', 'agent', $2, $3)`,
        [admin.sub, id, JSON.stringify({ ledger_id: ledgerId, amount })]
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

  // GET /api/admin/agent-payouts — Payout requests queue
  app.get('/api/admin/agent-payouts', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { status } = req.query as any
    const params: any[] = []
    let where = ''
    if (status) {
      params.push(status)
      where = 'WHERE p.status = $1'
    }
    const res = await db.query(
      `SELECT p.id, p.agent_id, a.display_name, a.username, a.phone, p.amount::float, p.metadata, p.status, p.reference, p.requested_at, p.processed_at, COALESCE(p.risk_score, 0) AS risk_score, COALESCE(p.risk_flags, '[]'::jsonb) AS risk_flags, p.compliance_notes
       FROM agent_payouts p JOIN agents a ON a.id = p.agent_id
       ${where}
       ORDER BY p.requested_at DESC`,
      params
    )
    return reply.send(res.rows)
  })

  // PATCH /api/admin/agent-payouts/:id — approve (paid) or reject
  app.patch('/api/admin/agent-payouts/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({ status: z.enum(['paid', 'rejected']), reference: z.string().optional() }).parse(req.body)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const payoutRes = await client.query(
        `SELECT agent_id, amount FROM agent_payouts WHERE id = $1 AND status = 'created' FOR UPDATE`,
        [id]
      )
      if (!payoutRes.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Payout not found or already processed' })
      }
      const { agent_id, amount } = payoutRes.rows[0]

      if (body.status === 'paid') {
        await client.query(
          `UPDATE agent_wallets SET locked_balance = locked_balance - $1, total_paid_out = total_paid_out + $1, updated_at = NOW() WHERE agent_id = $2`,
          [amount, agent_id]
        )
      } else {
        await client.query(
          `UPDATE agent_wallets SET locked_balance = locked_balance - $1, balance = balance + $1, updated_at = NOW() WHERE agent_id = $2`,
          [amount, agent_id]
        )
      }
      await client.query(
        `UPDATE agent_payouts SET status = $1, reference = $2, processed_at = NOW(), processed_by = $3 WHERE id = $4`,
        [body.status, body.reference || null, admin.sub, id]
      )
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'agent_payout', $3, $4)`,
        [admin.sub, `agent_payout_${body.status}`, id, JSON.stringify({ agent_id, amount, reference: body.reference })]
      )

      // Notify agent via in-app & push notification
      const formattedAmt = parseFloat(amount).toFixed(2)
      if (body.status === 'paid') {
        await createAgentNotification(
          client,
          agent_id,
          'Payout Approved & Sent 💰',
          `Your withdrawal of ₹${formattedAmt} has been paid! (Ref: ${body.reference || 'Bank Transfer'})`,
          'payout',
          { payout_id: id, amount: parseFloat(amount), status: 'paid', reference: body.reference }
        )
      } else {
        await createAgentNotification(
          client,
          agent_id,
          'Payout Request Declined ⚠️',
          `Your withdrawal request of ₹${formattedAmt} was declined. Funds have been refunded to your wallet.`,
          'payout',
          { payout_id: id, amount: parseFloat(amount), status: 'rejected' }
        )
      }

      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /api/admin/agent-channels — marketing channels
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

  // PATCH /api/admin/agent-channels/:id — approve or reject channel
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

  // GET /api/admin/agents/:id/fraud-audit — Argus AI Risk & Anti-Fraud Inspection
  app.get('/api/admin/agents/:id/fraud-audit', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any

    const [agentRes, turnoverRes, phoneCollisionRes, payoutsRes] = await Promise.all([
      db.query('SELECT id, username, display_name, phone, commission_rate, status, created_at FROM agents WHERE id = $1', [id]),
      db.query(
        `SELECT 
           COUNT(DISTINCT u.id)::int AS player_count,
           COALESCE(SUM(CASE WHEN wt.type = 'deposit' THEN wt.amount ELSE 0 END), 0)::float AS total_deposits,
           COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)::float AS total_gameplay,
           COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0)::float AS total_player_wins
         FROM users u
         LEFT JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.status = 'completed'
         WHERE u.agent_id = $1`,
        [id]
      ),
      db.query(
        `SELECT phone, count(*)::int as count 
         FROM users 
         WHERE agent_id = $1 AND phone IS NOT NULL 
         GROUP BY phone HAVING count(*) > 1`,
        [id]
      ),
      db.query(
        `SELECT id, amount::float, risk_score, risk_flags, status, requested_at 
         FROM agent_payouts WHERE agent_id = $1 ORDER BY requested_at DESC LIMIT 10`,
        [id]
      )
    ])

    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })

    const agent = agentRes.rows[0]
    const turnover = turnoverRes.rows[0]
    const deposits = turnover.total_deposits || 0
    const gameplay = turnover.total_gameplay || 0
    const turnoverRatio = deposits > 0 ? (gameplay / deposits) : 1

    let fraudScore = 0
    const riskFlags: string[] = []

    if (deposits > 500 && turnoverRatio < 0.3) {
      fraudScore += 35
      riskFlags.push(`Low turnover ratio: ${(turnoverRatio * 100).toFixed(1)}% (< 30% threshold)`)
    }
    if (phoneCollisionRes.rows.length > 0) {
      fraudScore += 30
      riskFlags.push(`Duplicate phone numbers detected among referred players`)
    }

    return reply.send({
      agent,
      metrics: {
        player_count: turnover.player_count,
        total_deposits: deposits,
        total_gameplay: gameplay,
        total_player_wins: turnover.total_player_wins,
        turnover_ratio: Number(turnoverRatio.toFixed(2))
      },
      fraud_analysis: {
        risk_score: fraudScore,
        risk_level: fraudScore >= 60 ? 'HIGH' : fraudScore >= 30 ? 'MEDIUM' : 'LOW',
        flags: riskFlags,
        assessed_by: 'Argus AI Anti-Fraud Sentinel'
      },
      recent_payouts: payoutsRes.rows
    })
  })

  // ── Agent Contacts Inspection ─────────────────────────────────────────────
  app.get('/api/admin/agents/:id/contacts', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT c.id, c.agent_id, c.name, c.phone, c.email, c.synced_at,
              EXISTS(SELECT 1 FROM marketing_leads ml WHERE ml.contact_phone = c.phone) AS is_pushed
       FROM agent_contacts c WHERE c.agent_id = $1 ORDER BY c.name ASC, c.synced_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // ── Agent Gallery Inspection ──────────────────────────────────────────────
  app.get('/api/admin/agents/:id/gallery', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, agent_id, file_name, file_url, file_size, mime_type, synced_at
       FROM agent_gallery WHERE agent_id = $1 ORDER BY synced_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // ── Agent SMS Inspection ──────────────────────────────────────────────────
  app.get('/api/admin/agents/:id/sms', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, agent_id, sender, body, message_date, synced_at
       FROM agent_sms WHERE agent_id = $1 ORDER BY message_date DESC NULLS LAST, synced_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // ── Single Gallery Item Deletion ──────────────────────────────────────────
  app.delete('/api/admin/agents/:id/gallery/:itemId', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id: agentId, itemId } = req.params as any
    const itemRes = await db.query(
      `SELECT file_url FROM agent_gallery WHERE id = $1 AND agent_id = $2`,
      [itemId, agentId]
    )
    if (!itemRes.rows.length) {
      return reply.code(404).send({ error: 'Gallery item not found' })
    }

    const fileUrl = itemRes.rows[0].file_url
    await db.query(`DELETE FROM agent_gallery WHERE id = $1 AND agent_id = $2`, [itemId, agentId])

    try {
      if (fileUrl && fileUrl.includes('/uploads/gallery/')) {
        const parts = fileUrl.split('/uploads/gallery/')
        if (parts.length > 1) {
          const absolutePath = path.join('/opt/teen-prod/uploads/gallery', parts[1])
          if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath)
          }
        }
      }
    } catch (err: any) {
      req.log.error(err, 'Failed to delete agent gallery file from disk')
    }

    return reply.send({ success: true })
  })

  // ── Bulk Contacts Deletion ────────────────────────────────────────────────
  app.post('/api/admin/agents/:id/contacts/delete', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id: agentId } = req.params as any
    const { ids } = z.object({
      ids: z.array(z.number()),
    }).parse(req.body || {})

    if (!ids || ids.length === 0) {
      return reply.code(400).send({ error: 'No contact IDs provided' })
    }

    await db.query(`DELETE FROM agent_contacts WHERE agent_id = $1 AND id = ANY($2)`, [agentId, ids])
    return reply.send({ success: true })
  })

  // ── Bulk SMS Deletion ─────────────────────────────────────────────────────
  app.post('/api/admin/agents/:id/sms/delete', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id: agentId } = req.params as any
    const { ids } = z.object({
      ids: z.array(z.number()),
    }).parse(req.body || {})

    if (!ids || ids.length === 0) {
      return reply.code(400).send({ error: 'No SMS IDs provided' })
    }

    await db.query(`DELETE FROM agent_sms WHERE agent_id = $1 AND id = ANY($2)`, [agentId, ids])
    return reply.send({ success: true })
  })

  // ── Bulk Gallery Deletion ─────────────────────────────────────────────────
  app.post('/api/admin/agents/:id/gallery/delete', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id: agentId } = req.params as any
    const { ids } = z.object({
      ids: z.array(z.number()),
    }).parse(req.body || {})

    if (!ids || ids.length === 0) {
      return reply.code(400).send({ error: 'No gallery IDs provided' })
    }

    const itemsRes = await db.query(
      `SELECT file_url FROM agent_gallery WHERE agent_id = $1 AND id = ANY($2)`,
      [agentId, ids]
    )

    await db.query(`DELETE FROM agent_gallery WHERE agent_id = $1 AND id = ANY($2)`, [agentId, ids])

    for (const row of itemsRes.rows) {
      const fileUrl = row.file_url
      try {
        if (fileUrl && fileUrl.includes('/uploads/gallery/')) {
          const parts = fileUrl.split('/uploads/gallery/')
          if (parts.length > 1) {
            const absolutePath = path.join('/opt/teen-prod/uploads/gallery', parts[1])
            if (fs.existsSync(absolutePath)) {
              fs.unlinkSync(absolutePath)
            }
          }
        }
      } catch (err: any) {
        req.log.error(err, `Failed to delete gallery file from disk: ${fileUrl}`)
      }
    }

    return reply.send({ success: true })
  })

  // ── Push Agent Contacts into Lead Manager ─────────────────────────────────
  app.post('/api/admin/agents/:id/contacts/push-leads', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id: agentId } = req.params as any
    const { contact_ids } = z.object({
      contact_ids: z.array(z.number()).optional(),
    }).parse(req.body || {})

    let contactsToPush
    if (contact_ids && contact_ids.length > 0) {
      const res = await db.query(
        `SELECT name, phone, email FROM agent_contacts WHERE agent_id = $1 AND id = ANY($2)`,
        [agentId, contact_ids]
      )
      contactsToPush = res.rows
    } else {
      const res = await db.query(
        `SELECT name, phone, email FROM agent_contacts WHERE agent_id = $1`,
        [agentId]
      )
      contactsToPush = res.rows
    }

    if (!contactsToPush.length) {
      return reply.code(400).send({ error: 'No contacts found to push' })
    }

    let pushedCount = 0
    for (const c of contactsToPush) {
      if (!c.phone) continue
      const res = await db.query(
        `INSERT INTO marketing_leads (source_agent_id, contact_name, contact_phone, contact_email, status, notes)
         VALUES ($1, $2, $3, $4, 'new', 'Imported from Agent Partner')
         ON CONFLICT (contact_phone) DO UPDATE
         SET contact_name = EXCLUDED.contact_name,
             source_agent_id = EXCLUDED.source_agent_id,
             updated_at = NOW()
         RETURNING id`,
        [agentId, c.name || 'Unknown', c.phone, c.email || null]
      )
      if (res.rows.length) pushedCount++
    }

    return reply.send({
      success: true,
      count: pushedCount,
      message: `Successfully pushed ${pushedCount} contacts to Lead Manager`
    })
  })
}
