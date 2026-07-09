import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Pool } from 'pg'
import Redis from 'ioredis'
import crypto from 'crypto'
import { sendOtp, verifyOtp } from '../helpers/otp'

function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

export function authPlugin(db: Pool, redis: Redis) {
  return async function (app: FastifyInstance) {
    app.post('/auth/send-otp', async (req, reply) => {
      const body = z.object({ phone: z.string().regex(/^\d{10}$/) }).parse(req.body)
      const devOtp = await sendOtp(redis, body.phone)
      return reply.send({ success: true, message: 'OTP sent', ...(devOtp ? { otp: devOtp } : {}) })
    })

    app.post('/auth/register', async (req, reply) => {
      const body = z.object({
        phone: z.string().regex(/^\d{10}$/),
        otp: z.string().length(6),
        username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
        password: z.string().min(6),
        referral_code: z.string().optional(),
        campaign_id: z.string().uuid().optional(),
        utm_source: z.string().max(50).optional(),
        utm_medium: z.string().max(50).optional(),
        utm_campaign: z.string().max(50).optional(),
      }).parse(req.body)

      const otpValid = await verifyOtp(redis, body.phone, body.otp)
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
          `INSERT INTO users (phone, username, password_hash, referral_code, referred_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, referral_code`,
          [body.phone, body.username, passwordHash, referralCode, referredBy],
        )
        const user = userRes.rows[0]
        await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id])
        if (referredBy) {
          await client.query(
            `INSERT INTO referrals (referrer_id, referee_id, reward_amount) VALUES ($1, $2, $3)`,
            [referredBy, user.id, process.env.REFERRAL_BONUS_AMOUNT || 50],
          )
        }

        // Campaign Attribution
        if (body.campaign_id) {
          const campaignRes = await client.query('SELECT utm_source, utm_medium, utm_campaign FROM marketing_campaigns WHERE id = $1 AND is_active = true', [body.campaign_id])
          if (campaignRes.rows.length > 0) {
            const camp = campaignRes.rows[0]
            await client.query(
              `INSERT INTO user_campaign_attribution (user_id, campaign_id, utm_source, utm_medium, utm_campaign)
               VALUES ($1, $2, $3, $4, $5)`,
              [user.id, body.campaign_id, camp.utm_source, camp.utm_medium, camp.utm_campaign]
            )
          }
        } else if (body.utm_source) {
          const campaignRes = await client.query(
            `SELECT id FROM marketing_campaigns
             WHERE utm_source = $1
               AND COALESCE(utm_medium, '') = COALESCE($2, '')
               AND COALESCE(utm_campaign, '') = COALESCE($3, '')
               AND is_active = true`,
            [body.utm_source, body.utm_medium || null, body.utm_campaign || null]
          )
          const campId = campaignRes.rows.length > 0 ? campaignRes.rows[0].id : null
          await client.query(
            `INSERT INTO user_campaign_attribution (user_id, campaign_id, utm_source, utm_medium, utm_campaign)
             VALUES ($1, $2, $3, $4, $5)`,
            [user.id, campId, body.utm_source, body.utm_medium || null, body.utm_campaign || null]
          )
        }

        await client.query('COMMIT')

        const accessToken = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
        const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' })
        await redis.setex(`session:${user.id}`, 30 * 24 * 60 * 60, refreshToken)
        return reply.code(201).send({ access_token: accessToken, refresh_token: refreshToken, user: { id: user.id, username: user.username, referral_code: user.referral_code } })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    })

    app.post('/auth/login', async (req, reply) => {
      const body = z.object({ phone: z.string().regex(/^\d{10}$/), password: z.string() }).parse(req.body)
      const res = await db.query('SELECT id, username, password_hash, status FROM users WHERE phone = $1 AND is_bot = false', [body.phone])
      if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })
      const user = res.rows[0]
      if (user.status !== 'active') return reply.code(403).send({ error: `Account is ${user.status}` })
      const valid = await bcrypt.compare(body.password, user.password_hash)
      if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

      const accessToken = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
      const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' })
      await redis.setex(`session:${user.id}`, 30 * 24 * 60 * 60, refreshToken)
      return reply.send({ access_token: accessToken, refresh_token: refreshToken, user: { id: user.id, username: user.username } })
    })

    app.post('/auth/refresh', async (req, reply) => {
      const body = z.object({ refresh_token: z.string() }).parse(req.body)
      let payload: any
      try {
        payload = app.jwt.verify(body.refresh_token)
      } catch {
        return reply.code(401).send({ error: 'Invalid refresh token' })
      }
      if (payload.type !== 'refresh') {
        return reply.code(401).send({ error: 'Invalid refresh token' })
      }
      const stored = await redis.get(`session:${payload.sub}`)
      if (stored !== body.refresh_token) return reply.code(401).send({ error: 'Session expired' })
      const userRes = await db.query('SELECT id, username, status FROM users WHERE id = $1', [payload.sub])
      if (!userRes.rows.length || userRes.rows[0].status !== 'active') return reply.code(403).send({ error: 'Account not accessible' })
      const user = userRes.rows[0]
      const accessToken = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
      return reply.send({ access_token: accessToken })
    })

    app.post('/auth/logout', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      await redis.del(`session:${user.sub}`)
      return reply.send({ success: true })
    })

    // Forgot password: reuses /auth/send-otp for delivery (same OTP store, keyed by
    // phone), then this verifies the OTP and swaps the password. No existence check
    // on send — checking here only would let callers enumerate registered numbers.
    app.post('/auth/reset-password', async (req, reply) => {
      const body = z.object({
        phone: z.string().regex(/^\d{10}$/),
        otp: z.string().length(6),
        new_password: z.string().min(6),
      }).parse(req.body)

      const otpValid = await verifyOtp(redis, body.phone, body.otp)
      if (!otpValid) return reply.code(400).send({ error: 'Invalid or expired OTP' })

      const res = await db.query('SELECT id FROM users WHERE phone = $1 AND is_bot = false', [body.phone])
      if (!res.rows.length) return reply.code(404).send({ error: 'No account found with this mobile number' })
      const userId = res.rows[0].id

      const passwordHash = await bcrypt.hash(body.new_password, 12)
      await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId])
      // Invalidate any existing session so old refresh tokens stop working.
      await redis.del(`session:${userId}`)
      return reply.send({ success: true, message: 'Password reset successfully' })
    })

    app.put('/auth/fcm-token', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { token } = z.object({ token: z.string().min(1) }).parse(req.body)
      await db.query('UPDATE users SET fcm_token = $1, updated_at = NOW() WHERE id = $2', [token, user.sub])
      return reply.send({ success: true })
    })
  }
}
