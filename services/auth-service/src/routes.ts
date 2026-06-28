import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from './db'
import { redis } from './redis'
import { sendOtp, verifyOtp } from './otp'
import crypto from 'crypto'

function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/send-otp
  app.post('/auth/send-otp', async (req, reply) => {
    const body = z.object({ phone: z.string().regex(/^\d{10}$/) }).parse(req.body)
    const devOtp = await sendOtp(body.phone)
    // devOtp is only non-null in dev mode (OTP_PROVIDER != msg91)
    return reply.send({ success: true, message: 'OTP sent', ...(devOtp ? { otp: devOtp } : {}) })
  })

  // POST /auth/register
  app.post('/auth/register', async (req, reply) => {
    const body = z.object({
      phone: z.string().regex(/^\d{10}$/),
      otp: z.string().length(6),
      username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
      password: z.string().min(6),
      referral_code: z.string().optional(),
    }).parse(req.body)

    const otpValid = await verifyOtp(body.phone, body.otp)
    if (!otpValid) return reply.code(400).send({ error: 'Invalid or expired OTP' })

    const existing = await db.query('SELECT id FROM users WHERE phone = $1 OR username = $2', [body.phone, body.username])
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Phone or username already exists' })

    const passwordHash = await bcrypt.hash(body.password, 12)
    const referralCode = generateReferralCode()

    let referredBy: string | null = null
    if (body.referral_code) {
      const ref = await db.query('SELECT id FROM users WHERE referral_code = $1', [body.referral_code])
      if (ref.rows.length > 0) referredBy = ref.rows[0].id
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const userRes = await client.query(
        `INSERT INTO users (phone, username, password_hash, referral_code, referred_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, username, referral_code`,
        [body.phone, body.username, passwordHash, referralCode, referredBy]
      )
      const user = userRes.rows[0]

      await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id])

      if (referredBy) {
        await client.query(
          `INSERT INTO referrals (referrer_id, referee_id, reward_amount) VALUES ($1, $2, $3)`,
          [referredBy, user.id, process.env.REFERRAL_BONUS_AMOUNT || 50]
        )
      }

      await client.query('COMMIT')

      const accessToken = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
      const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, {
        sign: { key: process.env.JWT_REFRESH_SECRET! },
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      } as any)

      await redis.setex(`session:${user.id}`, 30 * 24 * 60 * 60, refreshToken)

      return reply.code(201).send({ access_token: accessToken, refresh_token: refreshToken, user: { id: user.id, username: user.username, referral_code: user.referral_code } })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // POST /auth/login
  app.post('/auth/login', async (req, reply) => {
    const body = z.object({
      phone: z.string().regex(/^\d{10}$/),
      password: z.string(),
    }).parse(req.body)

    const res = await db.query('SELECT id, username, password_hash, status FROM users WHERE phone = $1 AND is_bot = false', [body.phone])
    if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })

    const user = res.rows[0]
    if (user.status !== 'active') return reply.code(403).send({ error: `Account is ${user.status}` })

    const valid = await bcrypt.compare(body.password, user.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const accessToken = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
    const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, {
      sign: { key: process.env.JWT_REFRESH_SECRET! },
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    } as any)

    await redis.setex(`session:${user.id}`, 30 * 24 * 60 * 60, refreshToken)

    return reply.send({ access_token: accessToken, refresh_token: refreshToken, user: { id: user.id, username: user.username } })
  })

  // POST /auth/refresh
  app.post('/auth/refresh', async (req, reply) => {
    const body = z.object({ refresh_token: z.string() }).parse(req.body)
    let payload: any
    try {
      payload = app.jwt.verify(body.refresh_token, { key: process.env.JWT_REFRESH_SECRET! } as any)
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' })
    }

    const stored = await redis.get(`session:${payload.sub}`)
    if (stored !== body.refresh_token) return reply.code(401).send({ error: 'Session expired' })

    const userRes = await db.query('SELECT id, username, status FROM users WHERE id = $1', [payload.sub])
    if (!userRes.rows.length || userRes.rows[0].status !== 'active') {
      return reply.code(403).send({ error: 'Account not accessible' })
    }
    const user = userRes.rows[0]

    const accessToken = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
    return reply.send({ access_token: accessToken })
  })

  // POST /auth/logout
  app.post('/auth/logout', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as any
    await redis.del(`session:${user.sub}`)
    return reply.send({ success: true })
  })

  // PUT /auth/fcm-token — register or refresh FCM push token
  app.put('/auth/fcm-token', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as any
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body)
    await db.query('UPDATE users SET fcm_token = $1, updated_at = NOW() WHERE id = $2', [token, user.sub])
    return reply.send({ success: true })
  })
}
