import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 20 })

async function start() {
  await app.register(helmet)
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.ADMIN_JWT_SECRET! })

  const authenticate = async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  // POST /api/admin/auth/login
  app.post('/api/admin/auth/login', async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body)
    const res = await db.query('SELECT * FROM admin_users WHERE username = $1 AND is_active = true', [username])
    if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })
    const admin = res.rows[0]
    const valid = await bcrypt.compare(password, admin.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })
    await db.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [admin.id])
    const token = app.jwt.sign({ sub: admin.id, username: admin.username, role: admin.role }, { expiresIn: '8h' })
    return reply.send({ token, admin: { id: admin.id, username: admin.username, role: admin.role } })
  })

  // GET /api/admin/dashboard/stats
  app.get('/api/admin/dashboard/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    const [activeUsers, activeRooms, revenueToday, pendingWithdrawals, newUsersToday] = await Promise.all([
      db.query("SELECT COUNT(*) FROM users WHERE status = 'active' AND is_bot = false"),
      db.query("SELECT COUNT(*) FROM game_rooms WHERE status = 'active'"),
      db.query("SELECT COALESCE(SUM(platform_fee_collected),0) as total FROM game_rooms WHERE ended_at >= NOW() - INTERVAL '1 day'"),
      db.query("SELECT COUNT(*) FROM payment_orders WHERE type = 'withdrawal' AND status = 'created'"),
      db.query("SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '1 day' AND is_bot = false"),
    ])
    return reply.send({
      active_users: parseInt(activeUsers.rows[0].count),
      active_rooms: parseInt(activeRooms.rows[0].count),
      revenue_today: parseFloat(revenueToday.rows[0].total),
      pending_withdrawals: parseInt(pendingWithdrawals.rows[0].count),
      new_users_today: parseInt(newUsersToday.rows[0].count),
      fraud_alerts: 0,
    })
  })

  // GET /api/admin/dashboard/recent-games
  app.get('/api/admin/dashboard/recent-games', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT gr.id, gr.game_type, gr.status, gr.entry_fee, gr.pot_amount, gr.platform_fee_collected, gr.started_at,
             COUNT(gp.id) as player_count,
             COUNT(gp.id) FILTER (WHERE gp.is_bot = false) as real_count,
             COUNT(gp.id) FILTER (WHERE gp.is_bot = true) as bot_count
      FROM game_rooms gr
      LEFT JOIN game_participants gp ON gp.room_id = gr.id
      GROUP BY gr.id ORDER BY gr.created_at DESC LIMIT 20
    `)
    return reply.send(res.rows)
  })

  // GET /api/admin/users
  app.get('/api/admin/users', { onRequest: [authenticate] }, async (req, reply) => {
    const { page = 1, limit = 20, search, status, is_bot = 'false' } = req.query as any
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const conditions: string[] = ['u.is_bot = $1']
    const params: any[] = [is_bot !== 'false']
    let idx = 2
    if (search) { conditions.push(`(u.username ILIKE $${idx} OR u.phone ILIKE $${idx})`); params.push(`%${search}%`); idx++ }
    if (status) { conditions.push(`u.status = $${idx}`); params.push(status); idx++ }
    const where = conditions.join(' AND ')
    const [users, countRes] = await Promise.all([
      db.query(`SELECT u.id, u.username, u.phone, u.email, u.kyc_status, u.status, u.referral_code, u.created_at,
                       w.real_balance, w.bonus_balance
                FROM users u LEFT JOIN wallets w ON w.user_id = u.id
                WHERE ${where} ORDER BY u.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]),
      db.query(`SELECT COUNT(*) FROM users u WHERE ${where}`, params),
    ])
    return reply.send({ users: users.rows, total: parseInt(countRes.rows[0].count) })
  })

  // PATCH /api/admin/users/:id/status
  app.patch('/api/admin/users/:id/status', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { status } = z.object({ status: z.enum(['active', 'suspended', 'banned']) }).parse(req.body)
    await db.query('UPDATE users SET status = $1 WHERE id = $2', [status, id])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'user', $3, $4)`,
      [admin.sub, `set_status_${status}`, id, JSON.stringify({ status })])
    return reply.send({ success: true })
  })

  // POST /api/admin/users/:id/credit
  app.post('/api/admin/users/:id/credit', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { amount, description } = z.object({
      amount: z.number().min(1),
      description: z.string().optional(),
    }).parse(req.body)
    const res = await fetch(`${process.env.WALLET_SERVICE_URL}/wallet/deposit/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ user_id: id, amount, description: description || 'Manual credit by admin' }),
    })
    if (!res.ok) return reply.code(res.status).send(await res.json().catch(() => ({ error: 'Wallet service error' })))
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'credit_wallet', 'user', $2, $3)`,
      [admin.sub, id, JSON.stringify({ amount, description })])
    return reply.send({ success: true })
  })

  // POST /api/admin/users/:id/debit
  app.post('/api/admin/users/:id/debit', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { amount, description } = z.object({
      amount: z.number().min(1),
      description: z.string().optional(),
    }).parse(req.body)
    const res = await fetch(`${process.env.WALLET_SERVICE_URL}/wallet/debit/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ user_id: id, amount, description: description || 'Manual debit by admin' }),
    })
    if (!res.ok) return reply.code(res.status).send(await res.json().catch(() => ({ error: 'Wallet service error' })))
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'debit_wallet', 'user', $2, $3)`,
      [admin.sub, id, JSON.stringify({ amount, description })])
    return reply.send({ success: true })
  })

  // GET /api/admin/users/:id/transactions — ledger entries
  app.get('/api/admin/users/:id/transactions', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const { limit = '50' } = req.query as any
    const res = await db.query(
      `SELECT id, type, wallet_type, amount, balance_before, balance_after, reference_id, status, description, created_at
       FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [id, parseInt(limit)]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/users/:id/games — recent rooms played
  app.get('/api/admin/users/:id/games', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT gr.id, gr.game_type, gr.status, gr.entry_fee, gr.pot_amount, gr.started_at, gr.ended_at,
              gp.seat_number, gp.prize_won, gp.left_at
       FROM game_participants gp
       JOIN game_rooms gr ON gr.id = gp.room_id
       WHERE gp.user_id = $1 ORDER BY gr.created_at DESC LIMIT 50`,
      [id]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/users/:id/kyc — kyc docs
  app.get('/api/admin/users/:id/kyc', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, doc_type, doc_number, s3_front_key, s3_back_key, verified_name, verified_dob,
              status, rejection_reason, created_at, reviewed_at
       FROM kyc_documents WHERE user_id = $1 ORDER BY created_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // PATCH /api/admin/users/:id/kyc — set overall kyc_status; optionally reject reason
  app.patch('/api/admin/users/:id/kyc', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { status, reason } = z.object({
      status: z.enum(['pending', 'under_review', 'approved', 'rejected']),
      reason: z.string().optional(),
    }).parse(req.body)
    await db.query('UPDATE users SET kyc_status = $1 WHERE id = $2', [status, id])
    await db.query(`UPDATE kyc_documents SET status = $1, rejection_reason = $2, reviewed_at = NOW(), reviewed_by = $3 WHERE user_id = $4`,
      [status, reason || null, admin.sub, id])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'user', $3, $4)`,
      [admin.sub, `kyc_${status}`, id, JSON.stringify({ status, reason })])
    return reply.send({ success: true })
  })

  // GET /api/admin/users/:id/notes
  app.get('/api/admin/users/:id/notes', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT n.id, n.note, n.is_flag, n.created_at, a.username AS admin_username
       FROM user_notes n LEFT JOIN admin_users a ON a.id = n.admin_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/users/:id/notes
  app.post('/api/admin/users/:id/notes', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { note, is_flag } = z.object({
      note: z.string().min(1).max(2000),
      is_flag: z.boolean().optional(),
    }).parse(req.body)
    const res = await db.query(
      `INSERT INTO user_notes (user_id, admin_id, note, is_flag) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [id, admin.sub, note, is_flag || false]
    )
    return reply.send({ success: true, id: res.rows[0].id, created_at: res.rows[0].created_at })
  })

  // GET /api/admin/users/:id/audit — admin actions targeting this user
  app.get('/api/admin/users/:id/audit', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT al.id, al.action, al.details, al.created_at, a.username AS admin_username
       FROM admin_audit_log al LEFT JOIN admin_users a ON a.id = al.admin_id
       WHERE al.target_type = 'user' AND al.target_id = $1
       ORDER BY al.created_at DESC LIMIT 100`,
      [id]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/game-rooms
  app.get('/api/admin/game-rooms', { onRequest: [authenticate] }, async (req, reply) => {
    const { status } = req.query as any
    const res = await db.query(`
      SELECT gr.*, COUNT(gp.id) as player_count,
             COUNT(gp.id) FILTER (WHERE gp.is_bot = false) as real_count,
             COUNT(gp.id) FILTER (WHERE gp.is_bot = true) as bot_count,
             JSON_AGG(JSON_BUILD_OBJECT('user_id', gp.user_id, 'username', u.username, 'seat_number', gp.seat_number, 'is_bot', gp.is_bot, 'prize_won', gp.prize_won)) as participants
      FROM game_rooms gr
      LEFT JOIN game_participants gp ON gp.room_id = gr.id
      LEFT JOIN users u ON u.id = gp.user_id
      WHERE gr.status = $1
      GROUP BY gr.id ORDER BY gr.created_at DESC LIMIT 50
    `, [status || 'active'])
    return reply.send(res.rows)
  })

  // GET /api/admin/finance/withdrawals
  app.get('/api/admin/finance/withdrawals', { onRequest: [authenticate] }, async (req, reply) => {
    const { status } = req.query as any
    const res = await db.query(`
      SELECT po.*, u.username FROM payment_orders po
      JOIN users u ON u.id = po.user_id
      WHERE po.type = 'withdrawal' AND po.status = $1
      ORDER BY po.created_at DESC LIMIT 100
    `, [status || 'created'])
    return reply.send(res.rows)
  })

  // PATCH /api/admin/finance/withdrawals/:id — approve (paid) or reject (refunded)
  // On 'paid', stores the UTR / payment reference in metadata.
  // On 'refunded', returns the held amount to the user's wallet via the wallet service.
  app.patch('/api/admin/finance/withdrawals/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { status, reference, reason } = z.object({
      status: z.enum(['paid', 'refunded']),
      reference: z.string().optional(),
      reason: z.string().optional(),
    }).parse(req.body)

    const row = await db.query(`SELECT user_id, amount, status, metadata FROM payment_orders WHERE id = $1 AND type = 'withdrawal'`, [id])
    if (!row.rows.length) return reply.code(404).send({ error: 'Withdrawal not found' })
    if (row.rows[0].status !== 'created') {
      return reply.code(400).send({ error: `Withdrawal already ${row.rows[0].status}` })
    }

    const meta = { ...(row.rows[0].metadata || {}) }
    if (status === 'paid' && reference) meta.utr = reference
    if (status === 'refunded' && reason) meta.refund_reason = reason

    await db.query('UPDATE payment_orders SET status = $1, metadata = $2, updated_at = NOW() WHERE id = $3',
      [status, JSON.stringify(meta), id])

    // Refund the held amount back to the user's wallet on reject
    if (status === 'refunded') {
      await fetch(`${process.env.WALLET_SERVICE_URL}/wallet/deposit/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
        body: JSON.stringify({
          user_id: row.rows[0].user_id,
          amount: parseFloat(row.rows[0].amount),
          description: `Withdrawal rejected: ${reason || 'no reason given'}`,
        }),
      }).catch(() => null)
    }

    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'payment_order', $3, $4)`,
      [admin.sub, `withdrawal_${status}`, id, JSON.stringify({ reference, reason })])
    return reply.send({ success: true })
  })

  // GET /api/admin/finance/deposits — list deposit orders with filters
  app.get('/api/admin/finance/deposits', { onRequest: [authenticate] }, async (req, reply) => {
    const { status, gateway, page = '1', limit = '50' } = req.query as any
    const conditions = [`po.type = 'deposit'`]
    const params: any[] = []
    let idx = 1
    if (status) { conditions.push(`po.status = $${idx}`); params.push(status); idx++ }
    if (gateway) { conditions.push(`po.gateway = $${idx}`); params.push(gateway); idx++ }
    const where = conditions.join(' AND ')
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const [rows, count] = await Promise.all([
      db.query(`SELECT po.*, u.username, u.phone FROM payment_orders po
                JOIN users u ON u.id = po.user_id
                WHERE ${where} ORDER BY po.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]),
      db.query(`SELECT COUNT(*) FROM payment_orders po WHERE ${where}`, params),
    ])
    return reply.send({ deposits: rows.rows, total: parseInt(count.rows[0].count) })
  })

  // PATCH /api/admin/finance/deposits/:id — manual reconciliation of failed/stuck deposits
  // Used when a payment landed in the gateway but didn't credit the wallet (webhook failed, etc.)
  app.patch('/api/admin/finance/deposits/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { action, reference, reason } = z.object({
      action: z.enum(['mark_paid_and_credit', 'mark_failed']),
      reference: z.string().optional(),
      reason: z.string().optional(),
    }).parse(req.body)

    const row = await db.query(`SELECT user_id, amount, status, metadata FROM payment_orders WHERE id = $1 AND type = 'deposit'`, [id])
    if (!row.rows.length) return reply.code(404).send({ error: 'Deposit not found' })

    const meta = { ...(row.rows[0].metadata || {}) }
    if (reference) meta.manual_reference = reference
    if (reason) meta.manual_reason = reason
    meta.reconciled_by = admin.username
    meta.reconciled_at = new Date().toISOString()

    if (action === 'mark_paid_and_credit') {
      if (row.rows[0].status === 'paid') {
        return reply.code(400).send({ error: 'Already paid' })
      }
      await db.query(`UPDATE payment_orders SET status='paid', metadata=$1, updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(meta), id])
      // Credit the user's wallet
      await fetch(`${process.env.WALLET_SERVICE_URL}/wallet/deposit/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
        body: JSON.stringify({
          user_id: row.rows[0].user_id,
          amount: parseFloat(row.rows[0].amount),
          description: `Manual deposit reconciliation${reference ? ` (ref: ${reference})` : ''}`,
        }),
      })
    } else {
      await db.query(`UPDATE payment_orders SET status='failed', metadata=$1, updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(meta), id])
    }

    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'payment_order', $3, $4)`,
      [admin.sub, `deposit_${action}`, id, JSON.stringify({ reference, reason })])
    return reply.send({ success: true })
  })

  // GET /api/admin/finance/ledger — global ledger view with filters
  app.get('/api/admin/finance/ledger', { onRequest: [authenticate] }, async (req, reply) => {
    const { type, wallet_type, user_id, from, to, page = '1', limit = '50' } = req.query as any
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1
    if (type) { conditions.push(`wt.type = $${idx}`); params.push(type); idx++ }
    if (wallet_type) { conditions.push(`wt.wallet_type = $${idx}`); params.push(wallet_type); idx++ }
    if (user_id) { conditions.push(`wt.user_id = $${idx}`); params.push(user_id); idx++ }
    if (from) { conditions.push(`wt.created_at >= $${idx}`); params.push(from); idx++ }
    if (to) { conditions.push(`wt.created_at <= $${idx}`); params.push(to); idx++ }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const [rows, count] = await Promise.all([
      db.query(`SELECT wt.id, wt.user_id, u.username, wt.type, wt.wallet_type, wt.amount,
                       wt.balance_after, wt.reference_id, wt.status, wt.description, wt.created_at
                FROM wallet_transactions wt LEFT JOIN users u ON u.id = wt.user_id
                ${where} ORDER BY wt.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]),
      db.query(`SELECT COUNT(*) FROM wallet_transactions wt ${where}`, params),
    ])
    return reply.send({ entries: rows.rows, total: parseInt(count.rows[0].count) })
  })

  // GET /api/admin/finance/reconciliation — daily totals broken out by gateway + type
  app.get('/api/admin/finance/reconciliation', { onRequest: [authenticate] }, async (req, reply) => {
    const { days = '7' } = req.query as any
    const d = Math.min(parseInt(days), 90)
    const [byDay, byGateway, ggr] = await Promise.all([
      db.query(`SELECT DATE_TRUNC('day', created_at) AS day,
                       type,
                       status,
                       COUNT(*) AS count,
                       COALESCE(SUM(amount), 0) AS total
                FROM payment_orders
                WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
                GROUP BY 1, 2, 3
                ORDER BY 1 DESC, 2, 3`, [d]),
      db.query(`SELECT gateway,
                       status,
                       COUNT(*) AS count,
                       COALESCE(SUM(amount), 0) AS total
                FROM payment_orders
                WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
                GROUP BY 1, 2 ORDER BY 1, 2`, [d]),
      db.query(`SELECT DATE_TRUNC('day', ended_at) AS day,
                       COALESCE(SUM(pot_amount), 0) AS pot,
                       COALESCE(SUM(platform_fee_collected), 0) AS ggr
                FROM game_rooms
                WHERE ended_at >= NOW() - ($1 || ' days')::INTERVAL
                GROUP BY 1 ORDER BY 1 DESC`, [d]),
    ])
    return reply.send({ by_day: byDay.rows, by_gateway: byGateway.rows, ggr: ggr.rows })
  })

  // GET /api/admin/finance/stats
  app.get('/api/admin/finance/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    const [today, month, deposits, withdrawals] = await Promise.all([
      db.query("SELECT COALESCE(SUM(platform_fee_collected),0) as v FROM game_rooms WHERE ended_at >= NOW() - INTERVAL '1 day'"),
      db.query("SELECT COALESCE(SUM(platform_fee_collected),0) as v FROM game_rooms WHERE ended_at >= NOW() - INTERVAL '30 days'"),
      db.query("SELECT COALESCE(SUM(amount),0) as v FROM payment_orders WHERE type = 'deposit' AND status = 'paid' AND created_at >= NOW() - INTERVAL '1 day'"),
      db.query("SELECT COALESCE(SUM(amount),0) as v FROM payment_orders WHERE type = 'withdrawal' AND status = 'paid' AND created_at >= NOW() - INTERVAL '1 day'"),
    ])
    return reply.send({ revenue_today: today.rows[0].v, revenue_month: month.rows[0].v, deposits_today: deposits.rows[0].v, withdrawals_today: withdrawals.rows[0].v })
  })

  // GET /api/admin/game-configs
  app.get('/api/admin/game-configs', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query('SELECT * FROM game_configs ORDER BY game_type')
    return reply.send(res.rows)
  })

  // PATCH /api/admin/game-configs/:gameType
  app.patch('/api/admin/game-configs/:gameType', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const { gameType } = req.params as any
    const body = req.body as any
    await db.query(
      `UPDATE game_configs SET is_active=$1, rake_percent=$2, bot_fill_enabled=$3, bot_fill_delay_seconds=$4, max_bot_ratio=$5, bot_difficulty=$6, updated_by=$7, updated_at=NOW()
       WHERE game_type=$8`,
      [body.is_active, body.rake_percent, body.bot_fill_enabled, body.bot_fill_delay_seconds, body.max_bot_ratio, body.bot_difficulty, admin.sub, gameType]
    )
    return reply.send({ success: true })
  })

  // POST /api/admin/notifications/broadcast
  app.post('/api/admin/notifications/broadcast', { onRequest: [authenticate] }, async (req, reply) => {
    const body = req.body as any
    const res = await fetch(`${process.env.NOTIFICATION_SERVICE_URL}/internal/notifications/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return reply.send(data)
  })

  // POST /api/admin/notifications/send
  app.post('/api/admin/notifications/send', { onRequest: [authenticate] }, async (req, reply) => {
    const body = req.body as any
    const res = await fetch(`${process.env.NOTIFICATION_SERVICE_URL}/internal/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return reply.send(data)
  })

  app.get('/health', async () => ({ status: 'ok', service: 'admin' }))

  const port = parseInt(process.env.PORT || '3008')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Admin service running on port ${port}`)
}

start().catch(err => { console.error(err); process.exit(1) })
