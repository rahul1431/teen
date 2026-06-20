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
    const { id } = req.params as any
    const { amount } = z.object({ amount: z.number().min(1) }).parse(req.body)
    await fetch(`${process.env.WALLET_SERVICE_URL}/wallet/deposit/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ user_id: id, amount, description: 'Manual credit by admin' }),
    })
    return reply.send({ success: true })
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

  // PATCH /api/admin/finance/withdrawals/:id
  app.patch('/api/admin/finance/withdrawals/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const { status } = z.object({ status: z.enum(['paid', 'refunded']) }).parse(req.body)
    await db.query('UPDATE payment_orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, id])
    return reply.send({ success: true })
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
