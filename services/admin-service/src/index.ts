import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { Pool } from 'pg'
import Redis from 'ioredis'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { generateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { registerMLRoutes } from './ml-routes'
import { registerChurnRoutes } from './churn-routes'
import { registerBotLearningRoutes } from './bot-learning-routes'
import { registerMonitorRoutes } from './monitor-routes'

// QR images for payment methods are stored here, served by nginx at /uploads/qr/.
const QR_UPLOAD_DIR = process.env.QR_UPLOAD_DIR || '/opt/teen/uploads/qr'

// Thin wrapper to keep the call sites readable (matches the old `authenticator` API)
const totp = {
  generateSecret: () => generateSecret(),
  keyuri: (user: string, issuer: string, secret: string) =>
    generateURI({ label: `${issuer}:${user}`, issuer, secret, strategy: 'totp' }),
  verify: ({ token, secret }: { token: string; secret: string }) =>
    verifySync({ token, secret, strategy: 'totp', epochTolerance: 30 }),
}

// RBAC: role hierarchy. Higher index = more privileged.
const ROLES = ['readonly', 'support', 'finance', 'superadmin'] as const
type Role = typeof ROLES[number]
const ROLE_INDEX: Record<Role, number> = { readonly: 0, support: 1, finance: 2, superadmin: 3 }
function hasRole(actual: string | undefined, required: Role): boolean {
  if (!actual || !(actual in ROLE_INDEX)) return false
  return ROLE_INDEX[actual as Role] >= ROLE_INDEX[required]
}

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 20 })
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })

async function start() {
  await app.register(helmet, { crossOriginResourcePolicy: false })
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.ADMIN_JWT_SECRET! })
  await app.register(multipart, { limits: { fileSize: 150 * 1024 * 1024 } }) // 150MB (APK uploads)
  if (redis.status === 'wait') await redis.connect()
  fs.mkdirSync(QR_UPLOAD_DIR, { recursive: true })

  const authenticate = async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  // Role-gate factory. Use as: { onRequest: [authenticate, requireRole('finance')] }
  const requireRole = (role: Role) => async (req: any, reply: any) => {
    const r = (req.user as any)?.role
    if (!hasRole(r, role)) return reply.code(403).send({ error: `Forbidden â€” requires ${role} role` })
  }

  app.decorate('authenticate', authenticate)
  app.decorate('requireRole', requireRole)

  // Register ML routes
  await registerMLRoutes(app, redis, db, authenticate)

  // Register Churn proxy routes
  await registerChurnRoutes(app, authenticate, requireRole)

  // Register Bot Learning proxy routes
  await registerBotLearningRoutes(app, authenticate, requireRole)

  // Register Monitor proxy routes
  await registerMonitorRoutes(app, authenticate, requireRole)

  // POST /api/admin/auth/login
  // If the admin has 2FA enabled, the call must include `totp_code`. If it's
  // missing on a 2FA-enabled account, we respond with 401 + a `require_2fa`
  // flag so the UI knows to prompt for the code.
  app.post('/api/admin/auth/login', async (req, reply) => {
    const { username, password, totp_code } = z.object({
      username: z.string(),
      password: z.string(),
      totp_code: z.string().optional(),
    }).parse(req.body)
    const res = await db.query('SELECT * FROM admin_users WHERE username = $1 AND is_active = true', [username])
    if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })
    const admin = res.rows[0]
    const valid = await bcrypt.compare(password, admin.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    if (admin.totp_enabled) {
      if (!totp_code) return reply.code(401).send({ error: '2FA code required', require_2fa: true })
      const ok = totp.verify({ token: totp_code, secret: admin.totp_secret })
      if (!ok) return reply.code(401).send({ error: 'Invalid 2FA code', require_2fa: true })
    }

    await db.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [admin.id])
    const token = app.jwt.sign({ sub: admin.id, username: admin.username, role: admin.role }, { expiresIn: '8h' })
    return reply.send({
      token,
      admin: { id: admin.id, username: admin.username, role: admin.role, totp_enabled: admin.totp_enabled },
    })
  })

  // POST /api/admin/auth/2fa/setup â€” generate a fresh TOTP secret + QR for the calling admin
  app.post('/api/admin/auth/2fa/setup', { onRequest: [authenticate] }, async (req, reply) => {
    const me = req.user as any
    const secret = totp.generateSecret()
    // Stash provisionally; not enabled until /verify succeeds with a code
    await db.query('UPDATE admin_users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [secret, me.sub])
    const issuer = process.env.ADMIN_2FA_ISSUER || 'MyOnlineJoker Admin'
    const otpauth = totp.keyuri(me.username, issuer, secret)
    const qr_data_url = await QRCode.toDataURL(otpauth)
    return reply.send({ secret, otpauth, qr_data_url })
  })

  // POST /api/admin/auth/2fa/verify â€” confirm the generated secret with a live code; flips totp_enabled = true
  app.post('/api/admin/auth/2fa/verify', { onRequest: [authenticate] }, async (req, reply) => {
    const me = req.user as any
    const { code } = z.object({ code: z.string().min(6).max(8) }).parse(req.body)
    const res = await db.query('SELECT totp_secret FROM admin_users WHERE id = $1', [me.sub])
    const secret = res.rows[0]?.totp_secret
    if (!secret) return reply.code(400).send({ error: 'Call /2fa/setup first' })
    if (!totp.verify({ token: code, secret })) {
      return reply.code(401).send({ error: 'Invalid code â€” clock skew or wrong app?' })
    }
    await db.query('UPDATE admin_users SET totp_enabled = true WHERE id = $1', [me.sub])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id) VALUES ($1, '2fa_enabled', 'admin_user', $1)`, [me.sub])
    return reply.send({ success: true })
  })

  // POST /api/admin/auth/2fa/disable â€” requires a fresh code so a stolen session alone can't disable it
  app.post('/api/admin/auth/2fa/disable', { onRequest: [authenticate] }, async (req, reply) => {
    const me = req.user as any
    const { code } = z.object({ code: z.string().min(6).max(8) }).parse(req.body)
    const res = await db.query('SELECT totp_secret, totp_enabled FROM admin_users WHERE id = $1', [me.sub])
    if (!res.rows[0]?.totp_enabled) return reply.code(400).send({ error: '2FA not enabled' })
    if (!totp.verify({ token: code, secret: res.rows[0].totp_secret })) {
      return reply.code(401).send({ error: 'Invalid code' })
    }
    await db.query('UPDATE admin_users SET totp_enabled = false, totp_secret = NULL WHERE id = $1', [me.sub])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id) VALUES ($1, '2fa_disabled', 'admin_user', $1)`, [me.sub])
    return reply.send({ success: true })
  })

  // GET /api/admin/auth/me â€” current admin profile
  app.get('/api/admin/auth/me', { onRequest: [authenticate] }, async (req, reply) => {
    const me = req.user as any
    const res = await db.query(
      'SELECT id, username, email, role, is_active, totp_enabled, last_login_at, created_at FROM admin_users WHERE id = $1',
      [me.sub]
    )
    return reply.send(res.rows[0])
  })

  // ---- Admin user management (superadmin only) ----

  // GET /api/admin/admin-users
  app.get('/api/admin/admin-users', { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT a.id, a.username, a.email, a.role, a.is_active, a.totp_enabled, a.last_login_at, a.created_at,
              c.username AS created_by_username
       FROM admin_users a LEFT JOIN admin_users c ON c.id = a.created_by
       ORDER BY a.created_at DESC`
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/admin-users â€” create new admin
  app.post('/api/admin/admin-users', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const me = req.user as any
    const body = z.object({
      username: z.string().min(3).max(50),
      email: z.string().email(),
      password: z.string().min(10),
      role: z.enum(['readonly', 'support', 'finance', 'superadmin']),
    }).parse(req.body)
    const hash = await bcrypt.hash(body.password, 12)
    try {
      const res = await db.query(
        `INSERT INTO admin_users (username, email, password_hash, role, created_by) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, email, role, is_active, created_at`,
        [body.username, body.email, hash, body.role, me.sub]
      )
      await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'admin_create', 'admin_user', $2, $3)`,
        [me.sub, res.rows[0].id, JSON.stringify({ username: body.username, role: body.role })])
      return reply.send(res.rows[0])
    } catch (e: any) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Username or email already exists' })
      throw e
    }
  })

  // PATCH /api/admin/admin-users/:id â€” change role / activate / deactivate
  app.patch('/api/admin/admin-users/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const me = req.user as any
    const { id } = req.params as any
    const body = z.object({
      role: z.enum(['readonly', 'support', 'finance', 'superadmin']).optional(),
      is_active: z.boolean().optional(),
    }).parse(req.body)
    if (id === me.sub && body.is_active === false) {
      return reply.code(400).send({ error: 'Cannot deactivate yourself' })
    }
    const updates: string[] = []
    const params: any[] = []
    let idx = 1
    if (body.role !== undefined) { updates.push(`role = $${idx}`); params.push(body.role); idx++ }
    if (body.is_active !== undefined) { updates.push(`is_active = $${idx}`); params.push(body.is_active); idx++ }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' })
    updates.push(`updated_at = NOW()`)
    params.push(id)
    await db.query(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = $${idx}`, params)
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'admin_update', 'admin_user', $2, $3)`,
      [me.sub, id, JSON.stringify(body)])
    return reply.send({ success: true })
  })

  // POST /api/admin/admin-users/:id/reset-password â€” superadmin resets another admin's password
  app.post('/api/admin/admin-users/:id/reset-password', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const me = req.user as any
    const { id } = req.params as any
    const { password } = z.object({ password: z.string().min(10) }).parse(req.body)
    const hash = await bcrypt.hash(password, 12)
    await db.query('UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, id])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id) VALUES ($1, 'admin_password_reset', 'admin_user', $2)`,
      [me.sub, id])
    return reply.send({ success: true })
  })

  // POST /api/admin/auth/change-password â€” any admin changes their own password (requires current pw)
  app.post('/api/admin/auth/change-password', { onRequest: [authenticate] }, async (req, reply) => {
    const me = req.user as any
    const { current_password, new_password } = z.object({
      current_password: z.string(),
      new_password: z.string().min(10),
    }).parse(req.body)
    const res = await db.query('SELECT password_hash FROM admin_users WHERE id = $1', [me.sub])
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' })
    if (!(await bcrypt.compare(current_password, res.rows[0].password_hash))) {
      return reply.code(401).send({ error: 'Current password incorrect' })
    }
    const hash = await bcrypt.hash(new_password, 12)
    await db.query('UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, me.sub])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id) VALUES ($1, 'self_password_change', 'admin_user', $1)`, [me.sub])
    return reply.send({ success: true })
  })

  // GET /api/admin/dashboard/stats
  app.get('/api/admin/dashboard/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    const [activeUsers, activeRooms, revenueToday, pendingWithdrawals, pendingDeposits, newUsersToday] = await Promise.all([
      db.query("SELECT COUNT(*) FROM users WHERE status = 'active' AND is_bot = false"),
      db.query("SELECT COUNT(*) FROM game_rooms WHERE status = 'active'"),
      db.query("SELECT COALESCE(SUM(platform_fee_collected),0) as total FROM game_rooms WHERE ended_at >= NOW() - INTERVAL '1 day'"),
      db.query("SELECT COUNT(*) FROM payment_orders WHERE type = 'withdrawal' AND status = 'created'"),
      db.query("SELECT COUNT(*) FROM payment_orders WHERE type = 'deposit' AND status = 'created'"),
      db.query("SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '1 day' AND is_bot = false"),
    ])
    return reply.send({
      active_users: parseInt(activeUsers.rows[0].count),
      active_rooms: parseInt(activeRooms.rows[0].count),
      revenue_today: parseFloat(revenueToday.rows[0].total),
      pending_withdrawals: parseInt(pendingWithdrawals.rows[0].count),
      pending_deposits: parseInt(pendingDeposits.rows[0].count),
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
  app.patch('/api/admin/users/:id/status', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { status } = z.object({ status: z.enum(['active', 'suspended', 'banned']) }).parse(req.body)
    await db.query('UPDATE users SET status = $1 WHERE id = $2', [status, id])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'user', $3, $4)`,
      [admin.sub, `set_status_${status}`, id, JSON.stringify({ status })])
    return reply.send({ success: true })
  })

  // POST /api/admin/users/:id/credit
  app.post('/api/admin/users/:id/credit', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const { amount, description } = z.object({
      amount: z.number().min(1),
      description: z.string().optional(),
    }).parse(req.body)
    const res = await fetch(`${process.env.WALLET_SERVICE_URL}/wallet/deposit/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ user_id: id, amount, request_id: crypto.randomUUID(), description: description || 'Manual credit by admin' }),
    })
    if (!res.ok) return reply.code(res.status).send(await res.json().catch(() => ({ error: 'Wallet service error' })))
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'credit_wallet', 'user', $2, $3)`,
      [admin.sub, id, JSON.stringify({ amount, description })])
    return reply.send({ success: true })
  })

  // POST /api/admin/users/:id/debit
  app.post('/api/admin/users/:id/debit', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
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

  // GET /api/admin/users/:id/transactions â€” ledger entries
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

  // GET /api/admin/users/:id/games â€” recent rooms played
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

  // GET /api/admin/users/:id/kyc â€” kyc docs
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

  // PATCH /api/admin/users/:id/kyc â€” set overall kyc_status; optionally reject reason
  app.patch('/api/admin/users/:id/kyc', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
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

    // Push notification to user
    if (status === 'approved' || status === 'rejected') {
      const kycNotif = status === 'approved'
        ? { title: 'KYC Approved âœ…', body: 'Your KYC verification has been approved. You can now make withdrawals.', type: 'kyc_approved' }
        : { title: 'KYC Rejected âŒ', body: `Your KYC was rejected.${reason ? ` Reason: ${reason}` : ''} Please re-submit your documents.`, type: 'kyc_rejected' }
      fetch(`${process.env.NOTIFICATION_SERVICE_URL}/internal/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
        body: JSON.stringify({ user_id: id, ...kycNotif }),
      }).catch(() => null)
    }

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
  app.post('/api/admin/users/:id/notes', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
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

  // GET /api/admin/users/:id/audit â€” admin actions targeting this user
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

  // GET /api/admin/game-rooms/:id/live-state
  app.get('/api/admin/game-rooms/:id/live-state', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const ludoStateRaw = await redis.get(`game:room:${id}`)
    let state: any = null
    if (ludoStateRaw) {
      state = JSON.parse(ludoStateRaw)
    }

    const tpStateRaw = await redis.get(`tp:game:${id}`)
    if (tpStateRaw) {
      try {
        const tpState = JSON.parse(tpStateRaw)
        state = {
          ...state,
          ...tpState,
          players: tpState.players?.map((p: any) => ({
            ...p,
            userId: p.user_id ?? p.userId,
          }))
        }
      } catch (e) {
        console.error('Failed to parse tp state in live-state', e)
      }
    }

    if (!state) {
      return reply.code(404).send({ error: 'Live state not found' })
    }
    return reply.send(state)
  })

  // POST /api/admin/game-rooms/:id/force-action
  app.post('/api/admin/game-rooms/:id/force-action', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const { user_id, action, amount, token_index } = req.body as any

    const gatewayUrl = process.env.GAME_GATEWAY_URL || 'http://localhost:3004'
    const res = await fetch(`${gatewayUrl}/internal/game-rooms/${id}/force-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.INTERNAL_SERVICE_KEY!,
      },
      body: JSON.stringify({ user_id, action, amount, token_index }),
    })
    if (!res.ok) {
      const msg = await res.text()
      return reply.code(res.status).send({ error: msg || 'Failed to execute force action' })
    }
    return reply.send({ success: true })
  })

  // POST /api/admin/game-rooms/:id/kick
  app.post('/api/admin/game-rooms/:id/kick', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const { user_id } = req.body as any

    const gatewayUrl = process.env.GAME_GATEWAY_URL || 'http://localhost:3004'
    const res = await fetch(`${gatewayUrl}/internal/game-rooms/${id}/kick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.INTERNAL_SERVICE_KEY!,
      },
      body: JSON.stringify({ user_id }),
    })
    if (!res.ok) {
      const msg = await res.text()
      return reply.code(res.status).send({ error: msg || 'Failed to kick player' })
    }
    return reply.send({ success: true })
  })

  // POST /api/admin/game-rooms/:id/terminate
  app.post('/api/admin/game-rooms/:id/terminate', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as any

    const gatewayUrl = process.env.GAME_GATEWAY_URL || 'http://localhost:3004'
    const res = await fetch(`${gatewayUrl}/internal/game-rooms/${id}/terminate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.INTERNAL_SERVICE_KEY!,
      },
    })
    if (!res.ok) {
      const msg = await res.text()
      return reply.code(res.status).send({ error: msg || 'Failed to terminate game room' })
    }
    return reply.send({ success: true })
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

  // PATCH /api/admin/finance/withdrawals/:id â€” approve (paid) or reject (refunded)
  // On 'paid', stores the UTR / payment reference in metadata.
  // On 'refunded', returns the held amount to the user's wallet via the wallet service.
  app.patch('/api/admin/finance/withdrawals/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
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
      // Restore funds via unlock (real_balance += amount, locked_balance -= amount)
      // deposit/manual would credit real_balance without clearing locked_balance
      await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
        body: JSON.stringify({
          user_id: row.rows[0].user_id,
          amount: parseFloat(row.rows[0].amount),
          room_id: `withdrawal:${id}`,
        }),
      }).catch(() => null)
    }

    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'payment_order', $3, $4)`,
      [admin.sub, `withdrawal_${status}`, id, JSON.stringify({ reference, reason })])

    // Push notification to user
    const amt = parseFloat(row.rows[0].amount)
    const notifPayload = status === 'paid'
      ? { title: 'Withdrawal Processed âœ…', body: `Your withdrawal of â‚¹${amt.toFixed(2)} has been paid.${reference ? ` UTR: ${reference}` : ''}`, type: 'withdrawal_paid' }
      : { title: 'Withdrawal Rejected âŒ', body: `Your withdrawal of â‚¹${amt.toFixed(2)} was rejected.${reason ? ` Reason: ${reason}` : ''} Amount refunded to wallet.`, type: 'withdrawal_rejected' }
    fetch(`${process.env.NOTIFICATION_SERVICE_URL}/internal/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ user_id: row.rows[0].user_id, ...notifPayload }),
    }).catch(() => null)

    return reply.send({ success: true })
  })

  // GET /api/admin/finance/deposits â€” list deposit orders with filters
  app.get('/api/admin/finance/deposits', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
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

  // PATCH /api/admin/finance/deposits/:id â€” manual reconciliation of failed/stuck deposits
  // Used when a payment landed in the gateway but didn't credit the wallet (webhook failed, etc.)
  app.patch('/api/admin/finance/deposits/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
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
          request_id: crypto.randomUUID(),
          description: `Manual deposit reconciliation${reference ? ` (ref: ${reference})` : ''}`,
        }),
      })
    } else {
      await db.query(`UPDATE payment_orders SET status='failed', metadata=$1, updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(meta), id])
    }

    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'payment_order', $3, $4)`,
      [admin.sub, `deposit_${action}`, id, JSON.stringify({ reference, reason })])

    // Push notification to user
    const dAmt = parseFloat(row.rows[0].amount)
    const dNotif = action === 'mark_paid_and_credit'
      ? { title: 'Deposit Approved âœ…', body: `Your deposit of â‚¹${dAmt.toFixed(2)} has been credited to your wallet.`, type: 'deposit_approved' }
      : { title: 'Deposit Failed âŒ', body: `Your deposit of â‚¹${dAmt.toFixed(2)} could not be processed.${reason ? ` Reason: ${reason}` : ''}`, type: 'deposit_failed' }
    fetch(`${process.env.NOTIFICATION_SERVICE_URL}/internal/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({ user_id: row.rows[0].user_id, ...dNotif }),
    }).catch(() => null)

    return reply.send({ success: true })
  })

  // ---- Payment methods (manual deposit destinations: UPI / bank / QR) ----

  // POST /api/admin/uploads/qr â€” upload a QR image, returns its public URL
  app.post('/api/admin/uploads/qr', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const file = await (req as any).file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    const ext = path.extname(file.filename || '').toLowerCase().slice(0, 8) || '.png'
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      return reply.code(400).send({ error: 'Unsupported image type' })
    }
    const fname = `qr_${crypto.randomUUID()}${ext}`
    await pipeline(file.file, fs.createWriteStream(path.join(QR_UPLOAD_DIR, fname)))
    return reply.send({ url: `/uploads/qr/${fname}` })
  })

  // GET /api/admin/payment-methods â€” list all (active + inactive)
  app.get('/api/admin/payment-methods', { onRequest: [authenticate, requireRole('finance')] }, async (_req, reply) => {
    const res = await db.query(`SELECT * FROM payment_methods ORDER BY sort_order ASC, created_at ASC`)
    return reply.send(res.rows)
  })

  // POST /api/admin/payment-methods â€” create
  app.post('/api/admin/payment-methods', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const admin = req.user as any
    const b = z.object({
      method_type: z.enum(['upi', 'bank', 'qr']),
      label: z.string().min(1),
      upi_id: z.string().optional(),
      account_name: z.string().optional(),
      account_number: z.string().optional(),
      ifsc: z.string().optional(),
      bank_name: z.string().optional(),
      qr_image_url: z.string().optional(),
      instructions: z.string().optional(),
      min_amount: z.number().optional(),
      max_amount: z.number().optional(),
      is_active: z.boolean().optional(),
      sort_order: z.number().optional(),
    }).parse(req.body)
    const res = await db.query(
      `INSERT INTO payment_methods
         (method_type, label, upi_id, account_name, account_number, ifsc, bank_name,
          qr_image_url, instructions, min_amount, max_amount, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [b.method_type, b.label, b.upi_id, b.account_name, b.account_number, b.ifsc, b.bank_name,
       b.qr_image_url, b.instructions, b.min_amount ?? 100, b.max_amount ?? 100000,
       b.is_active ?? true, b.sort_order ?? 0]
    )
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id) VALUES ($1, 'payment_method_create', 'payment_method', $2)`,
      [admin.sub, res.rows[0].id])
    return reply.send(res.rows[0])
  })

  // PATCH /api/admin/payment-methods/:id â€” update any field
  app.patch('/api/admin/payment-methods/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const b = z.object({
      label: z.string().optional(),
      upi_id: z.string().optional(),
      account_name: z.string().optional(),
      account_number: z.string().optional(),
      ifsc: z.string().optional(),
      bank_name: z.string().optional(),
      qr_image_url: z.string().optional(),
      instructions: z.string().optional(),
      min_amount: z.number().optional(),
      max_amount: z.number().optional(),
      is_active: z.boolean().optional(),
      sort_order: z.number().optional(),
    }).parse(req.body)
    const updates: string[] = []
    const params: any[] = []
    let idx = 1
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) { updates.push(`${k} = $${idx}`); params.push(v); idx++ }
    }
    if (!updates.length) return reply.code(400).send({ error: 'No fields to update' })
    updates.push(`updated_at = NOW()`)
    params.push(id)
    await db.query(`UPDATE payment_methods SET ${updates.join(', ')} WHERE id = $${idx}`, params)
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id) VALUES ($1, 'payment_method_update', 'payment_method', $2)`,
      [admin.sub, id])
    return reply.send({ success: true })
  })

  // DELETE /api/admin/payment-methods/:id
  app.delete('/api/admin/payment-methods/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    await db.query(`DELETE FROM payment_methods WHERE id = $1`, [id])
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id) VALUES ($1, 'payment_method_delete', 'payment_method', $2)`,
      [admin.sub, id])
    return reply.send({ success: true })
  })

  // GET /api/admin/finance/ledger â€” global ledger view with filters
  app.get('/api/admin/finance/ledger', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
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

  // GET /api/admin/finance/reconciliation â€” daily totals broken out by gateway + type
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
  app.patch('/api/admin/game-configs/:gameType', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { gameType } = req.params as any
    const body = req.body as any
    // Merge any provided economics into special_rules (e.g. Aviator house edge,
    // max win, bet limits) without clobbering other keys.
    const existing = await db.query('SELECT special_rules FROM game_configs WHERE game_type=$1', [gameType])
    const currentRules = existing.rows[0]?.special_rules || {}
    const specialRules = body.special_rules ? { ...currentRules, ...body.special_rules } : currentRules
    await db.query(
      `UPDATE game_configs SET is_active=$1, rake_percent=$2, bot_fill_enabled=$3, bot_fill_delay_seconds=$4, max_bot_ratio=$5, bot_difficulty=$6, special_rules=$7, updated_by=$8, updated_at=NOW()
       WHERE game_type=$9`,
      [body.is_active, body.rake_percent, body.bot_fill_enabled, body.bot_fill_delay_seconds, body.max_bot_ratio, body.bot_difficulty, JSON.stringify(specialRules), admin.sub, gameType]
    )
    return reply.send({ success: true })
  })

  // POST /api/admin/notifications/broadcast
  app.post('/api/admin/notifications/broadcast', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
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
  app.post('/api/admin/notifications/send', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const body = req.body as any
    const res = await fetch(`${process.env.NOTIFICATION_SERVICE_URL}/internal/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return reply.send(data)
  })

  // ---- Risk Center / Anti-Cheat ----

  // GET /api/admin/risk/overview â€” KPI summary for Risk Center dashboard
  app.get('/api/admin/risk/overview', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const [flagged, suspendedToday, winRateAlerts, manualCredits] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM users WHERE status = 'suspicious' AND is_bot = false`),
      db.query(`SELECT COUNT(*) FROM users WHERE status = 'suspended' AND updated_at >= NOW() - INTERVAL '1 day' AND is_bot = false`),
      db.query(`
        SELECT COUNT(DISTINCT wt.user_id) FROM wallet_transactions wt
        WHERE wt.type IN ('game_credit','game_debit') AND wt.created_at > NOW() - INTERVAL '30 days'
        AND wt.user_id IN (
          SELECT user_id FROM wallet_transactions
          WHERE type IN ('game_credit','game_debit') AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY user_id
          HAVING SUM(CASE WHEN type='game_credit' THEN amount ELSE 0 END)
               > 3 * NULLIF(SUM(CASE WHEN type='game_debit' THEN amount ELSE 0 END), 0)
          AND SUM(CASE WHEN type='game_debit' THEN amount ELSE 0 END) > 500
        )
      `),
      db.query(`SELECT COUNT(*) FROM wallet_transactions WHERE type = 'manual_credit' AND created_at >= NOW() - INTERVAL '1 day'`),
    ])
    return reply.send({
      flagged_users: parseInt(flagged.rows[0].count),
      suspended_today: parseInt(suspendedToday.rows[0].count),
      win_rate_alerts: parseInt(winRateAlerts.rows[0].count),
      manual_credits_24h: parseInt(manualCredits.rows[0].count),
    })
  })

  // GET /api/admin/risk/flagged-users â€” paginated list with computed risk signals
  app.get('/api/admin/risk/flagged-users', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { page = '1', limit = '20' } = req.query as any
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const res = await db.query(`
      SELECT u.id, u.username, u.phone, u.status,
        w.total_won, w.total_deposited,
        COUNT(DISTINCT gp.room_id) AS games_played,
        ROUND(w.total_won::numeric / NULLIF(w.total_deposited, 0), 2) AS roi,
        COALESCE((
          SELECT COUNT(*) FROM wallet_transactions wt
          WHERE wt.user_id = u.id AND wt.type = 'manual_credit'
          AND wt.created_at > NOW() - INTERVAL '7 days'
        ), 0) AS manual_credits_7d,
        COALESCE((
          SELECT COUNT(*) FROM users u2
          WHERE u2.device_fingerprint = u.device_fingerprint
          AND u2.id != u.id AND u.device_fingerprint IS NOT NULL
        ), 0) AS shared_device_count
      FROM users u
      JOIN wallets w ON w.user_id = u.id
      LEFT JOIN game_participants gp ON gp.user_id = u.id AND gp.is_bot = false
      WHERE u.is_bot = false
      GROUP BY u.id, u.username, u.phone, u.status, w.total_won, w.total_deposited
      HAVING
        (w.total_won::numeric / NULLIF(w.total_deposited, 0)) > 3
        OR COALESCE((
          SELECT COUNT(*) FROM users u2
          WHERE u2.device_fingerprint = u.device_fingerprint AND u2.id != u.id AND u.device_fingerprint IS NOT NULL
        ), 0) > 0
        OR COALESCE((
          SELECT COUNT(*) FROM wallet_transactions wt
          WHERE wt.user_id = u.id AND wt.type = 'manual_credit' AND wt.created_at > NOW() - INTERVAL '7 days'
        ), 0) > 0
      ORDER BY roi DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset])
    const countRes = await db.query(`
      SELECT COUNT(*) FROM (
        SELECT u.id FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.is_bot = false
        GROUP BY u.id, w.total_won, w.total_deposited, u.device_fingerprint
        HAVING (w.total_won::numeric / NULLIF(w.total_deposited, 0)) > 3
          OR EXISTS (SELECT 1 FROM users u2 WHERE u2.device_fingerprint = u.device_fingerprint AND u2.id != u.id AND u.device_fingerprint IS NOT NULL)
      ) sub
    `)
    return reply.send({ users: res.rows, total: parseInt(countRes.rows[0].count) })
  })

  // GET /api/admin/risk/device-links â€” users sharing device fingerprints
  app.get('/api/admin/risk/device-links', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT device_fingerprint,
        COUNT(*) AS account_count,
        JSON_AGG(JSON_BUILD_OBJECT('id', id, 'username', username, 'status', status, 'created_at', created_at)
                 ORDER BY created_at) AS accounts
      FROM users
      WHERE device_fingerprint IS NOT NULL AND is_bot = false
      GROUP BY device_fingerprint
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `)
    return reply.send(res.rows)
  })

  // GET /api/admin/risk/win-rate-anomalies â€” users with >1.5x win rate vs wagered in last 30d
  app.get('/api/admin/risk/win-rate-anomalies', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(`
      WITH stats AS (
        SELECT user_id,
          SUM(CASE WHEN type='game_credit' THEN amount ELSE 0 END) AS total_won,
          SUM(CASE WHEN type='game_debit'  THEN amount ELSE 0 END) AS total_wagered,
          COUNT(CASE WHEN type='game_credit' THEN 1 END) AS win_txns,
          COUNT(CASE WHEN type='game_debit'  THEN 1 END) AS loss_txns
        FROM wallet_transactions
        WHERE type IN ('game_credit','game_debit') AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY user_id
      )
      SELECT s.user_id, u.username, u.status,
        ROUND(s.total_won::numeric, 2) AS total_won,
        ROUND(s.total_wagered::numeric, 2) AS total_wagered,
        ROUND(s.total_won::numeric / NULLIF(s.total_wagered, 0), 3) AS win_rate,
        s.win_txns, s.loss_txns
      FROM stats s JOIN users u ON u.id = s.user_id
      WHERE s.total_wagered > 500
        AND (s.total_won::numeric / NULLIF(s.total_wagered, 0)) > 1.5
        AND u.is_bot = false
      ORDER BY win_rate DESC
      LIMIT 100
    `)
    return reply.send(res.rows)
  })

  // GET /api/admin/risk/colluding-pairs â€” real players sharing 3+ game rooms
  app.get('/api/admin/risk/colluding-pairs', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT a.user_id AS user_a_id, ua.username AS user_a,
             b.user_id AS user_b_id, ub.username AS user_b,
             COUNT(DISTINCT a.room_id) AS shared_rooms
      FROM game_participants a
      JOIN game_participants b ON b.room_id = a.room_id AND b.user_id > a.user_id
      JOIN users ua ON ua.id = a.user_id
      JOIN users ub ON ub.id = b.user_id
      WHERE a.is_bot = false AND b.is_bot = false
      GROUP BY a.user_id, ua.username, b.user_id, ub.username
      HAVING COUNT(DISTINCT a.room_id) >= 3
      ORDER BY shared_rooms DESC
      LIMIT 100
    `)
    return reply.send(res.rows)
  })

  // POST /api/admin/risk/flag/:userId â€” mark user status as 'suspicious' + auto-note
  app.post('/api/admin/risk/flag/:userId', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const admin = req.user as any
    const { userId } = req.params as any
    await db.query(`UPDATE users SET status = 'suspicious' WHERE id = $1`, [userId])
    await db.query(
      `INSERT INTO user_notes (user_id, admin_id, note, is_flag) VALUES ($1, $2, $3, true)`,
      [userId, admin.sub, 'Flagged as suspicious by Risk Center automated review']
    )
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'risk_flag', 'user', $2, $3)`,
      [admin.sub, userId, JSON.stringify({ status: 'suspicious' })]
    )
    return reply.send({ success: true })
  })

  // ---- Support Helpdesk ----

  // GET /api/admin/support/tickets â€” list with optional status filter
  app.get('/api/admin/support/tickets', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { status, page = '1', limit = '20' } = req.query as any
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1
    if (status) { conditions.push(`t.status = $${idx}`); params.push(status); idx++ }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const [rows, count] = await Promise.all([
      db.query(`
        SELECT t.id, t.subject, t.category, t.status, t.priority, t.created_at, t.updated_at,
               u.username, u.phone, a.username AS assigned_to_username,
               (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) AS message_count
        FROM support_tickets t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN admin_users a ON a.id = t.assigned_to
        ${where}
        ORDER BY
          CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          t.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]),
      db.query(`SELECT COUNT(*) FROM support_tickets t ${where}`, params),
    ])
    return reply.send({ tickets: rows.rows, total: parseInt(count.rows[0].count) })
  })

  // GET /api/admin/support/tickets/:id â€” detail + messages
  app.get('/api/admin/support/tickets/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const [ticket, messages] = await Promise.all([
      db.query(`
        SELECT t.*, u.username, u.phone, u.email, a.username AS assigned_to_username
        FROM support_tickets t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN admin_users a ON a.id = t.assigned_to
        WHERE t.id = $1`, [id]),
      db.query(`
        SELECT m.id, m.sender_type, m.sender_id, m.body, m.is_internal, m.created_at,
               COALESCE(u.username, a.username) AS sender_username
        FROM support_messages m
        LEFT JOIN users u ON u.id = m.sender_id AND m.sender_type = 'user'
        LEFT JOIN admin_users a ON a.id = m.sender_id AND m.sender_type = 'admin'
        WHERE m.ticket_id = $1 ORDER BY m.created_at`, [id]),
    ])
    if (!ticket.rows.length) return reply.code(404).send({ error: 'Ticket not found' })
    return reply.send({ ticket: ticket.rows[0], messages: messages.rows })
  })

  // POST /api/admin/support/tickets/:id/messages â€” admin reply
  app.post('/api/admin/support/tickets/:id/messages', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const { id } = req.params as any
    const { body, is_internal } = z.object({
      body: z.string().min(1).max(5000),
      is_internal: z.boolean().optional(),
    }).parse(req.body)
    const res = await db.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body, is_internal) VALUES ($1, 'admin', $2, $3, $4) RETURNING id, created_at`,
      [id, me.sub, body, is_internal || false]
    )
    await db.query(`UPDATE support_tickets SET updated_at = NOW(), status = CASE WHEN status = 'open' THEN 'in_progress'::ticket_status ELSE status END WHERE id = $1`, [id])
    return reply.send({ success: true, id: res.rows[0].id, created_at: res.rows[0].created_at })
  })

  // PATCH /api/admin/support/tickets/:id â€” update status/priority/assigned_to
  app.patch('/api/admin/support/tickets/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const { id } = req.params as any
    const body = z.object({
      status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      assigned_to: z.string().uuid().nullable().optional(),
    }).parse(req.body)
    const updates: string[] = []
    const params: any[] = []
    let idx = 1
    if (body.status !== undefined) {
      updates.push(`status = $${idx}::ticket_status`); params.push(body.status); idx++
      if (body.status === 'closed' || body.status === 'resolved') {
        updates.push(`closed_at = NOW()`)
      }
    }
    if (body.priority !== undefined) { updates.push(`priority = $${idx}::ticket_priority`); params.push(body.priority); idx++ }
    if (body.assigned_to !== undefined) { updates.push(`assigned_to = $${idx}`); params.push(body.assigned_to); idx++ }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' })
    updates.push(`updated_at = NOW()`)
    params.push(id)
    await db.query(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = $${idx}`, params)
    await db.query(`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'ticket_update', 'support_ticket', $2, $3)`,
      [me.sub, id, JSON.stringify(body)])
    return reply.send({ success: true })
  })

  // ---- CMS Pages ----

  app.get('/api/admin/cms/pages', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT p.slug, p.title, p.is_published, p.created_at, p.updated_at, a.username AS updated_by_username
      FROM cms_pages p LEFT JOIN admin_users a ON a.id = p.updated_by
      ORDER BY p.updated_at DESC`)
    return reply.send(res.rows)
  })

  app.get('/api/admin/cms/pages/:slug', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { slug } = req.params as any
    const res = await db.query(`SELECT * FROM cms_pages WHERE slug = $1`, [slug])
    if (!res.rows.length) return reply.code(404).send({ error: 'Page not found' })
    return reply.send(res.rows[0])
  })

  app.post('/api/admin/cms/pages', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const body = z.object({
      slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
      title: z.string().min(1).max(200),
      body_md: z.string().max(100000),
      is_published: z.boolean().optional(),
    }).parse(req.body)
    try {
      await db.query(
        `INSERT INTO cms_pages (slug, title, body_md, is_published, updated_by) VALUES ($1, $2, $3, $4, $5)`,
        [body.slug, body.title, body.body_md, body.is_published ?? true, me.sub]
      )
      return reply.send({ success: true })
    } catch (e: any) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Slug already exists' })
      throw e
    }
  })

  app.patch('/api/admin/cms/pages/:slug', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const { slug } = req.params as any
    const body = z.object({
      title: z.string().min(1).max(200).optional(),
      body_md: z.string().max(100000).optional(),
      is_published: z.boolean().optional(),
    }).parse(req.body)
    const updates: string[] = []
    const params: any[] = []
    let idx = 1
    if (body.title !== undefined) { updates.push(`title = $${idx}`); params.push(body.title); idx++ }
    if (body.body_md !== undefined) { updates.push(`body_md = $${idx}`); params.push(body.body_md); idx++ }
    if (body.is_published !== undefined) { updates.push(`is_published = $${idx}`); params.push(body.is_published); idx++ }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' })
    updates.push(`updated_by = $${idx}`); params.push(me.sub); idx++
    updates.push(`updated_at = NOW()`)
    params.push(slug)
    await db.query(`UPDATE cms_pages SET ${updates.join(', ')} WHERE slug = $${idx}`, params)
    return reply.send({ success: true })
  })

  app.delete('/api/admin/cms/pages/:slug', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { slug } = req.params as any
    await db.query(`DELETE FROM cms_pages WHERE slug = $1`, [slug])
    return reply.send({ success: true })
  })

  // ---- CMS Banners ----

  app.get('/api/admin/cms/banners', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT b.*, a.username AS created_by_username
      FROM cms_banners b LEFT JOIN admin_users a ON a.id = b.created_by
      ORDER BY b.priority DESC, b.created_at DESC`)
    return reply.send(res.rows)
  })

  app.post('/api/admin/cms/banners', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const body = z.object({
      title: z.string().min(1).max(200),
      body: z.string().max(2000).optional(),
      image_url: z.string().url().optional().or(z.literal('')),
      cta_label: z.string().max(50).optional(),
      cta_url: z.string().max(500).optional(),
      placement: z.string().default('home'),
      is_active: z.boolean().default(true),
      starts_at: z.string().nullable().optional(),
      ends_at: z.string().nullable().optional(),
      priority: z.number().int().default(0),
    }).parse(req.body)
    const res = await db.query(
      `INSERT INTO cms_banners (title, body, image_url, cta_label, cta_url, placement, is_active, starts_at, ends_at, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [body.title, body.body || null, body.image_url || null, body.cta_label || null, body.cta_url || null,
       body.placement, body.is_active, body.starts_at || null, body.ends_at || null, body.priority, me.sub]
    )
    return reply.send({ success: true, id: res.rows[0].id })
  })

  app.patch('/api/admin/cms/banners/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const body = z.object({
      title: z.string().min(1).max(200).optional(),
      body: z.string().max(2000).nullable().optional(),
      image_url: z.string().nullable().optional(),
      cta_label: z.string().max(50).nullable().optional(),
      cta_url: z.string().max(500).nullable().optional(),
      placement: z.string().optional(),
      is_active: z.boolean().optional(),
      starts_at: z.string().nullable().optional(),
      ends_at: z.string().nullable().optional(),
      priority: z.number().int().optional(),
    }).parse(req.body)
    const updates: string[] = []
    const params: any[] = []
    let idx = 1
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) { updates.push(`${k} = $${idx}`); params.push(v); idx++ }
    }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' })
    updates.push(`updated_at = NOW()`)
    params.push(id)
    await db.query(`UPDATE cms_banners SET ${updates.join(', ')} WHERE id = $${idx}`, params)
    return reply.send({ success: true })
  })

  app.delete('/api/admin/cms/banners/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query(`DELETE FROM cms_banners WHERE id = $1`, [id])
    return reply.send({ success: true })
  })

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• BETTING GAMES (Matka / Lottery / Cricket) â•â•â•â•â•â•â•â•â•â•â•
  // The admin panel manages these here; write actions proxy to the
  // betting-service internal endpoints (which hold the result-settlement
  // logic and wallet payouts) using the shared internal key.
  const BETTING_URL = process.env.BETTING_SERVICE_URL || 'http://127.0.0.1:3012'
  const callBetting = async (path: string, body: any) => {
    const res = await fetch(`${BETTING_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  }

  // --- Matka ---
  app.get('/api/admin/betting/matka/draws', { onRequest: [authenticate] }, async (_req, reply) => {
    const rows = await db.query(
      `SELECT d.*, m.name AS market_name,
              (SELECT COUNT(*) FROM matka_bets b WHERE b.draw_id = d.id) AS bet_count,
              (SELECT COALESCE(SUM(b.amount),0) FROM matka_bets b WHERE b.draw_id = d.id) AS total_staked
       FROM matka_draws d JOIN matka_markets m ON m.id = d.market_id
       WHERE d.draw_date = CURRENT_DATE ORDER BY m.sort_order`)
    return reply.send({ draws: rows.rows })
  })

  app.post('/api/admin/betting/matka/declare', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/matka/declare', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  // --- Lottery ---
  app.get('/api/admin/betting/lottery/draws', { onRequest: [authenticate] }, async (_req, reply) => {
    const rows = await db.query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM lottery_tickets t WHERE t.draw_id = d.id) AS ticket_count
       FROM lottery_draws d ORDER BY d.draw_time DESC LIMIT 100`)
    return reply.send({ draws: rows.rows })
  })

  app.post('/api/admin/betting/lottery/create', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/lottery/create', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/lottery/draw', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/lottery/draw', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  // --- Cricket ---
  app.get('/api/admin/betting/cricket/matches', { onRequest: [authenticate] }, async (_req, reply) => {
    const matches = await db.query(`SELECT * FROM cricket_matches ORDER BY start_time DESC LIMIT 100`)
    const out = []
    for (const m of matches.rows) {
      const markets = await db.query(`SELECT * FROM cricket_markets WHERE match_id = $1`, [m.id])
      const sessions = await db.query(`SELECT * FROM cricket_sessions WHERE match_id = $1`, [m.id])
      out.push({ ...m, markets: markets.rows, sessions: sessions.rows })
    }
    return reply.send({ matches: out })
  })

  app.post('/api/admin/betting/cricket/match', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/match', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/market', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/market', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/settle', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/settle', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/session/create', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/session/create', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/session/settle', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/session/settle', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  // --- Cricket Fantasy & Live Updates ---
  app.get('/api/admin/betting/cricket/fantasy/players', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query('SELECT * FROM cricket_fantasy_players ORDER BY role ASC, name ASC')
    return reply.send({ players: res.rows })
  })

  app.post('/api/admin/betting/cricket/fantasy/players', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/fantasy/players', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/fantasy/leagues', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/fantasy/leagues', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/scores/update', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/scores/update', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/fantasy/settle', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/fantasy/settle', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/sync-api', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/sync-api', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/sync-countries', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/sync-countries', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/sync-series', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/sync-series', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/import-series-matches', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/import-series-matches', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })

  app.post('/api/admin/betting/cricket/sync-squad', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const r = await callBetting('/internal/cricket/sync-squad', req.body)
    return reply.code(r.ok ? 200 : r.status).send(r.data)
  })


  // --- Satta Matka Market Creation & Deletion ---
  app.get('/api/admin/betting/matka/markets', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query('SELECT * FROM matka_markets ORDER BY sort_order')
    return reply.send({ markets: res.rows })
  })

  app.post('/api/admin/betting/matka/markets', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const body = z.object({
      name: z.string(),
      open_time: z.string(),
      close_time: z.string(),
      sort_order: z.number().int().default(0),
    }).parse(req.body)
    const r = await db.query(
      `INSERT INTO matka_markets (name, open_time, close_time, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.name, body.open_time, body.close_time, body.sort_order]
    )
    return reply.send({ success: true, market: r.rows[0] })
  })

  app.delete('/api/admin/betting/matka/markets/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const draws = await db.query(`SELECT id FROM matka_draws WHERE market_id = $1`, [id])
    const drawIds = draws.rows.map(d => d.id)
    if (drawIds.length > 0) {
      await db.query(`DELETE FROM matka_bets WHERE draw_id = ANY($1)`, [drawIds])
      await db.query(`DELETE FROM matka_draws WHERE id = ANY($1)`, [drawIds])
    }
    await db.query(`DELETE FROM matka_markets WHERE id = $1`, [id])
    return reply.send({ success: true })
  })

  // --- Lottery Draw Deletion ---
  app.delete('/api/admin/betting/lottery/draws/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query(`DELETE FROM lottery_tickets WHERE draw_id = $1`, [id])
    await db.query(`DELETE FROM lottery_draws WHERE id = $1`, [id])
    return reply.send({ success: true })
  })

  // --- Bot Management ---
  app.post('/api/admin/bots', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const body = z.object({
      username: z.string(),
      phone: z.string().optional(),
      initial_balance: z.number().nonnegative().default(10000),
    }).parse(req.body)
    
    const phone = body.phone || `999${Math.floor(1000000 + Math.random() * 9000000)}`
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase()
    
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const userRes = await client.query(
        `INSERT INTO users (phone, username, password_hash, is_bot, status, referral_code)
         VALUES ($1, $2, $3, true, 'active', $4) RETURNING id`,
        [phone, body.username, '$2b$12$invalid_bot_hash_never_login', referralCode]
      )
      const botId = userRes.rows[0].id
      await client.query(
        `INSERT INTO wallets (user_id, real_balance, bonus_balance)
         VALUES ($1, $2, 0)`,
        [botId, body.initial_balance]
      )
      await client.query('COMMIT')
      return reply.send({ success: true, bot: { id: botId, username: body.username, phone, balance: body.initial_balance } })
    } catch (e: any) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: e.message || 'Failed to create bot' })
    } finally {
      client.release()
    }
  })

  app.delete('/api/admin/bots/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const botCheck = await db.query('SELECT is_bot FROM users WHERE id = $1', [id])
    if (!botCheck.rows.length || !botCheck.rows[0].is_bot) {
      return reply.code(400).send({ error: 'User is not a bot or does not exist' })
    }
    
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM game_participants WHERE user_id = $1', [id])
      await client.query('DELETE FROM wallets WHERE user_id = $1', [id])
      await client.query('DELETE FROM users WHERE id = $1', [id])
      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (e: any) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: e.message || 'Failed to delete bot' })
    } finally {
      client.release()
    }
  })

  // --- Leaderboard ---
  app.get('/api/admin/leaderboard/:gameType', { onRequest: [authenticate] }, async (req, reply) => {
    const { gameType } = req.params as { gameType: string }
    const { period } = req.query as { period?: string }
    const url = `${process.env.LEADERBOARD_SERVICE_URL || 'http://127.0.0.1:3006'}/leaderboard/${gameType}?period=${period || 'daily'}`
    
    try {
      const res = await fetch(url, {
        headers: {
          'x-internal-key': process.env.INTERNAL_SERVICE_KEY || ''
        }
      })
      if (!res.ok) return reply.code(res.status).send({ error: 'Failed to fetch leaderboard from service' })
      const data = await res.json()
      return reply.send(data)
    } catch (e: any) {
      return reply.code(500).send({ error: `Leaderboard fetch failed: ${e.message}` })
    }
  })

  // --- Security Audit Logs ---
  app.get('/api/admin/security/audit-logs', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { limit = 100, offset = 0 } = req.query as { limit?: number; offset?: number }
    try {
      const res = await db.query(
        `SELECT al.id, al.action, al.target_type, al.target_id, al.details, al.ip_address, al.created_at,
                a.username AS admin_username
         FROM admin_audit_log al LEFT JOIN admin_users a ON a.id = al.admin_id
         ORDER BY al.created_at DESC
         LIMIT $1 OFFSET $2`,
        [Number(limit), Number(offset)]
      )
      const countRes = await db.query(`SELECT COUNT(*) FROM admin_audit_log`)
      return reply.send({ logs: res.rows, total: parseInt(countRes.rows[0].count) })
    } catch (e: any) {
      return reply.code(500).send({ error: `Audit log query failed: ${e.message}` })
    }
  })

  // --- Changelogs & Updates ---
  app.get('/api/admin/changelogs', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await db.query('SELECT * FROM changelogs ORDER BY created_at DESC')
      return reply.send(res.rows)
    } catch (e: any) {
      return reply.code(500).send({ error: `Failed to load changelogs: ${e.message}` })
    }
  })

  app.post('/api/admin/changelogs', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const body = z.object({
      version: z.string(),
      platform: z.enum(['mobile', 'admin', 'server']),
      title: z.string(),
      description: z.string(),
    }).parse(req.body)

    try {
      const me = req.user as any
      const res = await db.query(
        `INSERT INTO changelogs (version, platform, title, description, released_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.version, body.platform, body.title, body.description, me.username]
      )
      return reply.send(res.rows[0])
    } catch (e: any) {
      return reply.code(500).send({ error: `Failed to create changelog: ${e.message}` })
    }
  })

  app.delete('/api/admin/changelogs/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      await db.query('DELETE FROM changelogs WHERE id = $1', [id])
      return reply.send({ success: true })
    } catch (e: any) {
      return reply.code(500).send({ error: `Failed to delete changelog: ${e.message}` })
    }
  })

  app.get('/api/admin/changelogs/git', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const { execSync } = require('child_process')
      const gitLog = execSync('git log -n 30 --pretty=format:"%h|%an|%ar|%s"', { encoding: 'utf8', cwd: process.cwd() })
      const commits = gitLog.split('\n').filter(Boolean).map((line: string) => {
        const [hash, author, date, message] = line.split('|')
        return { hash, author, date, message }
      })
      return reply.send({ commits })
    } catch (e: any) {
      return reply.send({ commits: [], error: `Failed to retrieve git log: ${e.message}` })
    }
  })

  // --- Fraud Detection Routes ---
  // GET /api/admin/fraud-alerts - Get recent fraud alerts
  app.get('/api/admin/fraud-alerts', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const { limit = '50', action } = req.query as any
      const limitNum = Math.min(parseInt(limit), 500)

      let query = `
        SELECT id, user_id, game_type, rule_triggered, fraud_score, confidence,
               evidence, action, resolved, created_at
        FROM fraud_events
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `
      const params: any[] = []

      if (action && ['allow', 'slow_lane', 'block'].includes(action)) {
        query += ` AND action = $${params.length + 1}`
        params.push(action)
      }

      query += ` ORDER BY fraud_score DESC, created_at DESC LIMIT $${params.length + 1}`
      params.push(limitNum)

      const result = await db.query(query, params)

      return reply.send({
        success: true,
        data: {
          alerts: result.rows,
          count: result.rows.length,
          timestamp: new Date().toISOString(),
        },
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message || 'Failed to fetch fraud alerts' })
    }
  })

  // --- Fraud Stats ---
  app.get('/api/admin/fraud-stats', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const { hours = '24' } = req.query as any
      const hoursNum = Math.min(parseInt(hours), 168)

      const result = await db.query(
        `SELECT
           COUNT(*) as total_alerts,
           COUNT(CASE WHEN action = 'block' THEN 1 END) as blocks,
           COUNT(CASE WHEN action = 'slow_lane' THEN 1 END) as slow_lanes,
           AVG(fraud_score) as avg_score,
           MAX(fraud_score) as max_score,
           COUNT(DISTINCT user_id) as unique_users
         FROM fraud_events
         WHERE created_at > NOW() - INTERVAL '${hoursNum} hours'`,
        []
      )

      const stats = result.rows[0]

      return reply.send({
        success: true,
        data: {
          timeWindow: `${hoursNum} hours`,
          stats: {
            totalAlerts: parseInt(stats.total_alerts || '0'),
            blocks: parseInt(stats.blocks || '0'),
            slowLanes: parseInt(stats.slow_lanes || '0'),
            avgScore: parseFloat(stats.avg_score || '0').toFixed(2),
            maxScore: parseFloat(stats.max_score || '0').toFixed(2),
            uniqueUsers: parseInt(stats.unique_users || '0'),
          },
          timestamp: new Date().toISOString(),
        },
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message || 'Failed to fetch fraud statistics' })
    }
  })

  // GET /api/admin/user/:userId/fraud-history - Get fraud history for a user
  app.get('/api/admin/user/:userId/fraud-history', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const { userId } = req.params as any
      const { limit = '50' } = req.query as any
      const limitNum = Math.min(parseInt(limit), 500)

      const result = await db.query(
        `SELECT id, user_id, game_type, rule_triggered, fraud_score, confidence,
                evidence, action, resolved, created_at
         FROM fraud_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limitNum]
      )

      return reply.send({
        success: true,
        data: {
          userId,
          events: result.rows,
          count: result.rows.length,
        },
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message || 'Failed to fetch fraud history' })
    }
  })

  // POST /api/admin/user/:userId/fraud-flag - Manually flag/unflag a user
  app.post('/api/admin/user/:userId/fraud-flag', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    try {
      const { userId } = req.params as any
      const { isFlagged, reason } = z.object({
        isFlagged: z.boolean(),
        reason: z.string(),
      }).parse(req.body)
      const admin = req.user as any

      if (isFlagged) {
        await db.query(
          `INSERT INTO user_fraud_flags (user_id, is_flagged, reason, flagged_by, created_at)
           VALUES ($1, true, $2, $3, NOW())
           ON CONFLICT (user_id) DO UPDATE SET is_flagged = true, reason = $2, flagged_by = $3, updated_at = NOW()`,
          [userId, reason, admin.sub]
        )

        // Cache in Redis for quick lookup
        await redis.setex(`fraud:flagged:${userId}`, 604800, JSON.stringify({ reason, flaggedAt: new Date().toISOString() }))
      } else {
        await db.query(
          `UPDATE user_fraud_flags SET is_flagged = false, updated_at = NOW() WHERE user_id = $1`,
          [userId]
        )

        // Remove from Redis cache
        await redis.del(`fraud:flagged:${userId}`)
      }

      return reply.send({
        success: true,
        data: {
          userId,
          flagged: isFlagged,
          message: `User ${isFlagged ? 'flagged' : 'unflagged'} successfully`,
        },
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message || 'Failed to update fraud flag' })
    }
  })

  // PATCH /api/admin/fraud-alerts/:alertId/resolve - Resolve a fraud alert
  app.patch('/api/admin/fraud-alerts/:alertId/resolve', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    try {
      const { alertId } = req.params as any
      const { resolved, notes } = z.object({
        resolved: z.boolean(),
        notes: z.string().optional(),
      }).parse(req.body)
      const admin = req.user as any

      const result = await db.query(
        `UPDATE fraud_events
         SET resolved = $1, resolved_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
             resolved_by = CASE WHEN $1 THEN $2 ELSE NULL END,
             resolution_notes = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING id, user_id, fraud_score, action`,
        [resolved, admin.sub, notes || null, alertId]
      )

      if (!result.rows.length) {
        return reply.code(404).send({ success: false, error: 'Alert not found' })
      }

      return reply.send({
        success: true,
        data: {
          alertId,
          resolved,
          message: `Alert ${resolved ? 'resolved' : 'reopened'}`,
        },
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message || 'Failed to resolve alert' })
    }
  })

  // â”€â”€ Emoji management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // GET /api/admin/emojis — list all emojis
  app.get('/api/admin/emojis', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT id, emoji, label, is_active, sort_order, created_at
       FROM game_emojis ORDER BY sort_order ASC, created_at ASC`
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/emojis — add new emoji
  app.post('/api/admin/emojis', { onRequest: [authenticate] }, async (req, reply) => {
    const { emoji, label = '', sort_order = 0 } = req.body as any
    if (!emoji) return reply.code(400).send({ error: 'emoji required' })
    const res = await db.query(
      `INSERT INTO game_emojis (emoji, label, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [emoji.trim(), label.trim(), parseInt(sort_order) || 0]
    )
    return reply.code(201).send(res.rows[0])
  })

  // PATCH /api/admin/emojis/:id — update (toggle active / reorder)
  app.patch('/api/admin/emojis/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const { is_active, sort_order, label } = req.body as any
    const fields: string[] = []
    const vals: unknown[] = []
    if (is_active !== undefined) { fields.push(`is_active = $${vals.push(is_active)}`); }
    if (sort_order !== undefined) { fields.push(`sort_order = $${vals.push(parseInt(sort_order))}`); }
    if (label !== undefined) { fields.push(`label = $${vals.push(label)}`); }
    if (!fields.length) return reply.code(400).send({ error: 'nothing to update' })
    vals.push(id)
    const res = await db.query(
      `UPDATE game_emojis SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' })
    return reply.send(res.rows[0])
  })

  // DELETE /api/admin/emojis/:id
  app.delete('/api/admin/emojis/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query('DELETE FROM game_emojis WHERE id = $1', [id])
    return reply.send({ success: true })
  })

  // â”€â”€ Gift management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // GET /api/admin/gifts — list all gifts
  app.get('/api/admin/gifts', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT id, icon, name, price, is_active, sort_order, created_at
       FROM game_gifts ORDER BY sort_order ASC, price ASC`
    )
    return reply.send(res.rows)
  })

  // POST /admin/gifts â€” add gift with price
  app.post('/api/admin/gifts', { onRequest: [authenticate] }, async (req, reply) => {
    const { icon, name, price, sort_order = 0 } = req.body as any
    if (!icon || !name) return reply.code(400).send({ error: 'icon and name required' })
    const numPrice = parseFloat(price)
    if (isNaN(numPrice) || numPrice < 0) return reply.code(400).send({ error: 'price must be >= 0' })
    const res = await db.query(
      `INSERT INTO game_gifts (icon, name, price, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [icon.trim(), name.trim(), numPrice, parseInt(sort_order) || 0]
    )
    return reply.code(201).send(res.rows[0])
  })

  // PATCH /admin/gifts/:id â€” update price / toggle / reorder
  app.patch('/api/admin/gifts/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const { price, is_active, sort_order, name, icon } = req.body as any
    const fields: string[] = []
    const vals: unknown[] = []
    if (price !== undefined) {
      const p = parseFloat(price)
      if (isNaN(p) || p < 0) return reply.code(400).send({ error: 'invalid price' })
      fields.push(`price = $${vals.push(p)}`)
    }
    if (is_active !== undefined) fields.push(`is_active = $${vals.push(is_active)}`)
    if (sort_order !== undefined) fields.push(`sort_order = $${vals.push(parseInt(sort_order))}`)
    if (name !== undefined) fields.push(`name = $${vals.push(name)}`)
    if (icon !== undefined) fields.push(`icon = $${vals.push(icon)}`)
    if (!fields.length) return reply.code(400).send({ error: 'nothing to update' })
    vals.push(id)
    const res = await db.query(
      `UPDATE game_gifts SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' })
    return reply.send(res.rows[0])
  })

  // DELETE /admin/gifts/:id
  app.delete('/api/admin/gifts/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query('DELETE FROM game_gifts WHERE id = $1', [id])
    return reply.send({ success: true })
  })

  // â”€â”€ Public config (emojis/gifts for mobile game) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // GET /config/emojis â€” active emojis for game use (no auth)
  app.get('/api/admin/config/emojis', async (_req, reply) => {
    const res = await db.query(
      `SELECT emoji, label FROM game_emojis WHERE is_active = true ORDER BY sort_order ASC`
    )
    return reply.send(res.rows.map((r: any) => r.emoji))
  })

  // GET /config/gifts â€” active gifts with prices for game use (no auth)
  app.get('/api/admin/config/gifts', async (_req, reply) => {
    const res = await db.query(
      `SELECT id, icon, name, price FROM game_gifts WHERE is_active = true ORDER BY sort_order ASC`
    )
    return reply.send(res.rows)
  })

  // ── Daily Login Bonus Config ──────────────────────────────────────────────────

  // GET /api/admin/bonus/login-config — fetch current day schedule
  app.get('/api/admin/bonus/login-config', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT * FROM login_bonus_config ORDER BY day_number ASC`
    )
    return reply.send(res.rows)
  })

  // PUT /api/admin/bonus/login-config — upsert one or many day configs (superadmin/finance)
  app.put('/api/admin/bonus/login-config', {
    onRequest: [app.authenticate, app.requireRole('finance')],
  }, async (req, reply) => {
    const body = z.array(z.object({
      day_number:   z.number().int().min(1).max(30),
      bonus_amount: z.number().min(0),
      bonus_type:   z.enum(['real', 'bonus']).default('real'),
      label:        z.string().max(100).optional(),
      emoji:        z.string().max(10).optional(),
      is_special:   z.boolean().default(false),
      is_active:    z.boolean().default(true),
    })).parse(req.body)

    for (const d of body) {
      await db.query(
        `INSERT INTO login_bonus_config (day_number, bonus_amount, bonus_type, label, emoji, is_special, is_active, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (day_number) DO UPDATE SET
           bonus_amount = EXCLUDED.bonus_amount,
           bonus_type   = EXCLUDED.bonus_type,
           label        = EXCLUDED.label,
           emoji        = EXCLUDED.emoji,
           is_special   = EXCLUDED.is_special,
           is_active    = EXCLUDED.is_active,
           updated_at   = NOW()`,
        [d.day_number, d.bonus_amount, d.bonus_type, d.label ?? `Day ${d.day_number}`,
         d.emoji ?? '🎁', d.is_special, d.is_active]
      )
    }
    const res = await db.query(`SELECT * FROM login_bonus_config ORDER BY day_number ASC`)
    return reply.send({ success: true, config: res.rows })
  })

  // GET /api/admin/bonus/stats — today's claim stats
  app.get('/api/admin/bonus/stats', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const todayDate = new Date().toISOString().slice(0, 10)
    const [todayRes, totalRes, streakRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*) AS claimed_today, SUM(b.amount) AS distributed_today
         FROM bonuses b WHERE b.type = 'daily_login' AND b.created_at::date = $1`, [todayDate]
      ),
      db.query(
        `SELECT COUNT(*) AS total_claims, SUM(amount) AS total_distributed
         FROM bonuses WHERE type = 'daily_login'`
      ),
      db.query(
        `SELECT MAX(current_streak) AS max_streak, AVG(current_streak) AS avg_streak,
                COUNT(*) AS active_streaks
         FROM user_login_streaks WHERE current_streak > 0`
      ),
    ])
    return reply.send({
      today: todayRes.rows[0],
      all_time: totalRes.rows[0],
      streaks: streakRes.rows[0],
    })
  })

  // ── Home Banners ──────────────────────────────────────────────────────────────
  const BANNER_UPLOAD_DIR = process.env.BANNER_UPLOAD_DIR || '/opt/teen/uploads/banners'
  fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true })

  app.get('/api/admin/banners', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const res = await db.query(`SELECT * FROM home_banners ORDER BY sort_order ASC, created_at ASC`)
    return reply.send(res.rows)
  })

  app.post('/api/admin/banners', {
    onRequest: [app.authenticate, app.requireRole('superadmin')],
  }, async (req, reply) => {
    let imageUrl = ''
    let title = '', subtitle = '', clickUrl = '', clickType = 'url'
    let sortOrder = 0, isActive = true

    const parts = (req as any).parts()
    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename || '').toLowerCase().slice(0, 8) || '.jpg'
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          return reply.code(400).send({ error: 'Only jpg/png/webp allowed' })
        }
        const fname = `banner_${crypto.randomUUID()}${ext}`
        await pipeline(part.file, fs.createWriteStream(path.join(BANNER_UPLOAD_DIR, fname)))
        imageUrl = `/uploads/banners/${fname}`
      } else {
        const v = (part.value as string)?.trim() ?? ''
        if (part.fieldname === 'title') title = v
        if (part.fieldname === 'subtitle') subtitle = v
        if (part.fieldname === 'click_url') clickUrl = v
        if (part.fieldname === 'click_type') clickType = v
        if (part.fieldname === 'sort_order') sortOrder = parseInt(v) || 0
        if (part.fieldname === 'is_active') isActive = v !== 'false'
        if (part.fieldname === 'image_url') imageUrl = imageUrl || v
      }
    }
    if (!imageUrl) return reply.code(400).send({ error: 'Image required' })

    const res = await db.query(
      `INSERT INTO home_banners (title, subtitle, image_url, click_url, click_type, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title || null, subtitle || null, imageUrl, clickUrl || null, clickType, sortOrder, isActive]
    )
    return reply.send(res.rows[0])
  })

  app.put('/api/admin/banners/:id', {
    onRequest: [app.authenticate, app.requireRole('superadmin')],
  }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const res = await db.query(
      `UPDATE home_banners SET
         title = COALESCE($1, title), subtitle = COALESCE($2, subtitle),
         click_url = $3, click_type = COALESCE($4, click_type),
         sort_order = COALESCE($5, sort_order), is_active = COALESCE($6, is_active),
         updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [body.title ?? null, body.subtitle ?? null, body.click_url ?? null,
       body.click_type ?? null, body.sort_order ?? null, body.is_active ?? null, id]
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' })
    return reply.send(res.rows[0])
  })

  app.delete('/api/admin/banners/:id', {
    onRequest: [app.authenticate, app.requireRole('superadmin')],
  }, async (req, reply) => {
    const { id } = req.params as any
    await db.query(`DELETE FROM home_banners WHERE id = $1`, [id])
    return reply.send({ ok: true })
  })

  // ── Promo Codes ───────────────────────────────────────────────────────────────
  app.get('/api/admin/promo-codes', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const res = await db.query(`SELECT * FROM promo_codes ORDER BY created_at DESC`)
    return reply.send(res.rows)
  })

  app.post('/api/admin/promo-codes', {
    onRequest: [app.authenticate, app.requireRole('finance')],
  }, async (req, reply) => {
    const body = z.object({
      code: z.string().min(3).max(50).toUpperCase(),
      description: z.string().optional(),
      discount_type: z.enum(['fixed', 'percent']),
      discount_value: z.number().positive(),
      min_deposit: z.number().min(0).default(0),
      max_discount: z.number().optional(),
      usage_limit: z.number().int().optional(),
      per_user_limit: z.number().int().default(1),
      is_active: z.boolean().default(true),
      expires_at: z.string().optional(),
    }).parse(req.body)

    const res = await db.query(
      `INSERT INTO promo_codes (code, description, discount_type, discount_value, min_deposit, max_discount,
         usage_limit, per_user_limit, is_active, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [body.code, body.description || null, body.discount_type, body.discount_value,
       body.min_deposit, body.max_discount || null, body.usage_limit || null,
       body.per_user_limit, body.is_active, body.expires_at || null]
    )
    return reply.send(res.rows[0])
  })

  app.put('/api/admin/promo-codes/:id', {
    onRequest: [app.authenticate, app.requireRole('finance')],
  }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const res = await db.query(
      `UPDATE promo_codes SET
         code = COALESCE($1, code), description = $2,
         discount_type = COALESCE($3, discount_type),
         discount_value = COALESCE($4, discount_value),
         min_deposit = COALESCE($5, min_deposit),
         max_discount = $6, usage_limit = $7,
         per_user_limit = COALESCE($8, per_user_limit),
         is_active = COALESCE($9, is_active), expires_at = $10
       WHERE id = $11 RETURNING *`,
      [body.code?.toUpperCase() ?? null, body.description ?? null, body.discount_type ?? null,
       body.discount_value ?? null, body.min_deposit ?? null, body.max_discount ?? null,
       body.usage_limit ?? null, body.per_user_limit ?? null, body.is_active ?? null,
       body.expires_at ?? null, id]
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Not found' })
    return reply.send(res.rows[0])
  })

  app.delete('/api/admin/promo-codes/:id', {
    onRequest: [app.authenticate, app.requireRole('finance')],
  }, async (req, reply) => {
    const { id } = req.params as any
    await db.query(`DELETE FROM promo_codes WHERE id = $1`, [id])
    return reply.send({ ok: true })
  })

  // ── KYC Admin ──────────────────────────────────────────────────────────────

  // GET /api/admin/kyc — list all KYC submissions with user info
  app.get('/api/admin/kyc', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { status, page = '1', limit = '20' } = req.query as any
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const whereClause = status ? `WHERE kd.status = $3` : ''
    const values: any[] = [parseInt(limit), offset]
    if (status) values.push(status)

    const res = await db.query(
      `SELECT kd.user_id, kd.doc_type, kd.status, kd.rejection_reason,
              kd.submitted_at, kd.reviewed_at,
              kd.s3_front_key AS front_url, kd.s3_back_key AS back_url,
              kd.selfie_path AS selfie_url,
              u.username, u.phone, u.email, u.kyc_status AS user_kyc_status
       FROM kyc_documents kd
       JOIN users u ON u.id = kd.user_id
       ${whereClause}
       ORDER BY kd.submitted_at DESC
       LIMIT $1 OFFSET $2`,
      values
    )
    const countRes = await db.query(
      `SELECT COUNT(*) FROM kyc_documents kd ${whereClause}`,
      status ? [status] : []
    )
    return reply.send({ submissions: res.rows, total: parseInt(countRes.rows[0].count) })
  })

  // GET /api/admin/kyc/stats — summary counts
  app.get('/api/admin/kyc/stats', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT status, COUNT(*) AS count FROM kyc_documents GROUP BY status`
    )
    const stats: Record<string, number> = { pending: 0, under_review: 0, approved: 0, rejected: 0 }
    for (const row of res.rows) stats[row.status] = parseInt(row.count)
    return reply.send(stats)
  })

  // PUT /api/admin/kyc/:userId/review — approve or reject
  app.put('/api/admin/kyc/:userId/review', {
    onRequest: [app.authenticate, app.requireRole('support')],
  }, async (req, reply) => {
    const { userId } = req.params as any
    const admin = req.user as any
    const body = z.object({
      action: z.enum(['approve', 'reject']),
      rejection_reason: z.string().optional(),
    }).parse(req.body)

    const newStatus = body.action === 'approve' ? 'approved' : 'rejected'

    await db.query(
      `UPDATE kyc_documents SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
       WHERE user_id = $4`,
      [newStatus, admin.sub, body.rejection_reason || null, userId]
    )
    await db.query(
      `UPDATE users SET kyc_status = $1 WHERE id = $2`,
      [newStatus, userId]
    )
    return reply.send({ ok: true, status: newStatus })
  })

  // ── App Version / In-App Update ──────────────────────────────────────────
  const APK_DIR = process.env.APK_DIR || '/opt/teen/downloads'
  const APK_FILENAME = 'app-release.apk'
  const APK_PUBLIC_URL = process.env.APK_PUBLIC_URL || 'https://game.myonlinejoker.com/downloads/app-release.apk'
  fs.mkdirSync(APK_DIR, { recursive: true })

  // Public: GET /api/app/version — no auth, called by the Flutter app on startup
  app.get('/api/app/version', async (_req, reply) => {
    const res = await db.query(
      'SELECT version_name, version_code, download_url, release_notes, force_update FROM app_versions ORDER BY version_code DESC LIMIT 1'
    )
    if (!res.rows.length) return reply.send({ version_code: 0, version_name: '1.0.0', force_update: false, download_url: APK_PUBLIC_URL })
    return reply.send(res.rows[0])
  })

  // Admin: POST /api/admin/app/upload — upload APK and set new version info
  app.post('/api/admin/app/upload', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const parts = (req as any).parts()
    let versionName = '', versionCode = 0, releaseNotes = '', forceUpdate = false, fileWritten = false

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'apk') {
        const dest = path.join(APK_DIR, APK_FILENAME)
        await pipeline(part.file, fs.createWriteStream(dest))
        fileWritten = true
      } else if (part.type === 'field') {
        if (part.fieldname === 'version_name') versionName = String(part.value)
        if (part.fieldname === 'version_code') versionCode = parseInt(String(part.value)) || 0
        if (part.fieldname === 'release_notes') releaseNotes = String(part.value)
        if (part.fieldname === 'force_update') forceUpdate = String(part.value) === 'true'
      }
    }

    if (!fileWritten) return reply.code(400).send({ error: 'No APK file provided' })
    if (!versionName || versionCode < 1) return reply.code(400).send({ error: 'version_name and version_code are required' })

    await db.query(
      `INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (version_code) DO UPDATE SET version_name=$1, download_url=$3, release_notes=$4, force_update=$5, created_at=NOW()`,
      [versionName, versionCode, APK_PUBLIC_URL, releaseNotes || null, forceUpdate]
    )
    return reply.send({ success: true, version_name: versionName, version_code: versionCode, download_url: APK_PUBLIC_URL })
  })

  // Admin: GET /api/admin/app/versions — list all uploaded versions
  app.get('/api/admin/app/versions', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query('SELECT * FROM app_versions ORDER BY version_code DESC LIMIT 20')
    return reply.send(res.rows)
  })

  app.get('/health', async () => ({ status: 'ok', service: 'admin' }))

  const port = parseInt(process.env.PORT || '3008')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Admin service running on port ${port}`)
}

start().catch(err => { console.error(err); process.exit(1) })

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any;
    requireRole: (role: any) => any;
  }
}

