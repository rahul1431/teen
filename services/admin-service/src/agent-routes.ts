// services/admin-service/src/agent-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { validateNewAgentParent, validateRateAssignment } from './agent-hierarchy'

// Superadmin-only CRUD for the agent/sub-agent commission system. See
// docs/superpowers/specs/2026-07-20-agent-commission-system-design.md
export async function registerAgentRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  function generateAgentReferralCode(): string {
    return 'AG' + crypto.randomBytes(4).toString('hex').toUpperCase()
  }

  // GET /api/admin/agents — full hierarchy, flat list with parent ids (client builds the tree)
  app.get('/api/admin/agents', { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT a.id, a.username, a.display_name, a.phone, a.status, a.parent_agent_id,
              a.commission_rate, a.referral_code, a.created_at,
              COALESCE(w.balance, 0)::float AS balance,
              COALESCE(w.total_earned, 0)::float AS total_earned,
              (SELECT COUNT(*) FROM users u WHERE u.agent_id = a.id)::int AS player_count
       FROM agents a
       LEFT JOIN agent_wallets w ON w.agent_id = a.id
       ORDER BY a.created_at DESC`
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agents — create
  app.post('/api/admin/agents', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const body = z.object({
      username: z.string().min(3).max(50),
      password: z.string().min(6),
      display_name: z.string().min(1).max(100),
      phone: z.string().optional(),
      parent_agent_id: z.string().uuid().nullable().optional(),
      commission_rate: z.number().min(0).max(100),
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
    // Extremely unlikely collision (4 random bytes) — retry once if it happens.
    const collision = await db.query('SELECT 1 FROM agents WHERE referral_code = $1', [referralCode])
    if (collision.rows.length > 0) referralCode = generateAgentReferralCode()

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const res = await client.query(
        `INSERT INTO agents (username, password_hash, display_name, phone, parent_agent_id, commission_rate, referral_code, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [body.username, passwordHash, body.display_name, body.phone || null, parentAgentId, body.commission_rate, referralCode, admin.sub]
      )
      const agentId = res.rows[0].id
      await client.query('INSERT INTO agent_wallets (agent_id) VALUES ($1)', [agentId])
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'create_agent', 'agent', $2, $3)`,
        [admin.sub, agentId, JSON.stringify({ username: body.username, commission_rate: body.commission_rate, parent_agent_id: parentAgentId })]
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

  // PATCH /api/admin/agents/:id — edit rate/status/display_name/phone
  app.patch('/api/admin/agents/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      display_name: z.string().min(1).max(100).optional(),
      phone: z.string().optional(),
      status: z.enum(['active', 'suspended']).optional(),
      commission_rate: z.number().min(0).max(100).optional(),
    }).parse(req.body)

    const existingRes = await db.query('SELECT id, parent_agent_id FROM agents WHERE id = $1', [id])
    if (!existingRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })

    if (body.commission_rate !== undefined) {
      const allAgentsRes = await db.query('SELECT id, parent_agent_id, commission_rate FROM agents')
      const allAgents = allAgentsRes.rows.map(r => ({ id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate) }))
      const rateCheck = validateRateAssignment(allAgents, id, existingRes.rows[0].parent_agent_id, body.commission_rate)
      if (!rateCheck.ok) return reply.code(400).send({ error: rateCheck.error })
    }

    const sets: string[] = []
    const params: any[] = []
    for (const [key, col] of [['display_name', 'display_name'], ['phone', 'phone'], ['status', 'status'], ['commission_rate', 'commission_rate']] as const) {
      const val = (body as any)[key]
      if (val !== undefined) { params.push(val); sets.push(`${col} = $${params.length}`) }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' })
    params.push(id)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(`UPDATE agents SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
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

  // GET /api/admin/agents/:id/players
  app.get('/api/admin/agents/:id/players', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, username, phone, status, created_at,
              (SELECT MAX(created_at) FROM wallet_transactions WHERE user_id = users.id) AS last_active
       FROM users WHERE agent_id = $1 ORDER BY created_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agents/:id/ledger
  app.get('/api/admin/agents/:id/ledger', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, date, direct_commission::float, override_commission::float, total_commission::float, status, flagged_for_review, created_at
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [id]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agents/:id/ledger/:ledgerId/void — fraud/error correction
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

  // GET /api/admin/agent-payouts — pending/all payout requests, for finance review
  app.get('/api/admin/agent-payouts', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { status } = req.query as any
    const res = await db.query(
      `SELECT p.id, p.agent_id, a.display_name, a.username, p.amount::float, p.metadata, p.status, p.reference, p.requested_at, p.processed_at
       FROM agent_payouts p JOIN agents a ON a.id = p.agent_id
       WHERE p.status = $1 ORDER BY p.requested_at DESC`,
      [status || 'created']
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
