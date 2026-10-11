import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Pool } from 'pg'
import Redis from 'ioredis'
import crypto from 'crypto'
import { sendOtp, verifyOtp } from '../helpers/otp'
import * as admin from 'firebase-admin'

let firebaseAuthApp: admin.app.App | null = null
function getFirebaseAdmin(): admin.app.App {
  if (!firebaseAuthApp) {
    if (admin.apps.length > 0) {
      firebaseAuthApp = admin.apps[0]!
    } else {
      firebaseAuthApp = admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'teen-26cae'
      })
    }
  }
  return firebaseAuthApp
}

export async function verifyFirebaseToken(idToken: string): Promise<string> {
  const app = getFirebaseAdmin()
  const decoded = await app.auth().verifyIdToken(idToken)
  let phone = decoded.phone_number || ''
  if (phone.startsWith('+91')) {
    phone = phone.slice(3)
  } else if (phone.startsWith('+')) {
    phone = phone.slice(1)
  }
  if (!phone || phone.length !== 10) {
    throw new Error('Firebase token does not contain a valid 10-digit phone number')
  }
  return phone
}

function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

// Best-effort device-fingerprint capture, fed by the mobile app on login/register.
// Feeds risk-service's co-location fraud rule and admin-service's Risk Center
// "Device Links" tab (both join on device_fingerprints — see
// docs/Bugs/device-fingerprint-never-collected.md). Fire-and-forget: a single
// indexed upsert, never awaited by the caller and never allowed to fail the
// actual login/register response — same fire-and-forget-with-.catch pattern
// risk-service's FraudDetector uses for its own non-critical logFraudEvent write.
function recordDeviceFingerprint(db: Pool, userId: string, fingerprint: unknown, deviceInfo: unknown): void {
  if (typeof fingerprint !== 'string') return
  const trimmed = fingerprint.trim().slice(0, 255)
  if (!trimmed) return
  const info = deviceInfo && typeof deviceInfo === 'object' ? JSON.stringify(deviceInfo) : null

  db.query(
    `INSERT INTO device_fingerprints (user_id, fingerprint, device_info, last_seen)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, fingerprint)
     DO UPDATE SET
       device_info = COALESCE(EXCLUDED.device_info, device_fingerprints.device_info),
       last_seen = NOW()`,
    [userId, trimmed, info],
  ).catch((err) => {
    console.error('[auth] device fingerprint upsert failed:', err?.message || err)
  })
}

export function authPlugin(db: Pool, redis: Redis) {
  return async function (app: FastifyInstance) {
    app.post('/auth/send-otp', async (req, reply) => {
      const body = z.object({
        phone: z.string().regex(/^\d{10}$/),
        reason: z.enum(['register', 'reset']).optional()
      }).parse(req.body)
      try {
        const devOtp = await sendOtp(redis, body.phone, body.reason)
        return reply.send({ success: true, message: 'OTP sent', ...(devOtp ? { otp: devOtp } : {}) })
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Failed to send OTP' })
      }
    })

    app.post('/auth/verify-otp', async (req, reply) => {
      const body = z.object({
        phone: z.string().regex(/^\d{10}$/),
        otp: z.string().length(6).optional(),
        firebase_token: z.string().min(10).optional(),
      }).parse(req.body)

      if (body.firebase_token) {
        try {
          const verifiedPhone = await verifyFirebaseToken(body.firebase_token)
          if (verifiedPhone !== body.phone) {
            return reply.code(400).send({ error: 'Firebase phone number mismatch' })
          }
          await redis.setex(`firebase_verified:${body.phone}`, 600, '1')
          return reply.send({ success: true, message: 'Phone verified via Firebase' })
        } catch (err: any) {
          return reply.code(400).send({ error: err.message || 'Invalid Firebase token' })
        }
      }

      if (!body.otp) {
        return reply.code(400).send({ error: 'Either OTP or firebase_token is required' })
      }

      const otpValid = await verifyOtp(redis, body.phone, body.otp, false)
      if (!otpValid) return reply.code(400).send({ error: 'Invalid or expired OTP' })
      return reply.send({ success: true, message: 'OTP verified' })
    })

    app.post('/auth/register', async (req, reply) => {
      const body = z.object({
        phone: z.string().regex(/^\d{10}$/),
        otp: z.string().length(6).optional(),
        firebase_token: z.string().min(10).optional(),
        username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
        password: z.string().min(6),
        referral_code: z.string().optional(),
        campaign_id: z.string().uuid().optional(),
        utm_source: z.string().max(50).optional(),
        utm_medium: z.string().max(50).optional(),
        utm_campaign: z.string().max(50).optional(),
        device_fingerprint: z.string().min(1).max(255).optional(),
        device_info: z.record(z.any()).optional(),
      }).parse(req.body)

      let isVerified = false
      if (body.firebase_token) {
        try {
          const verifiedPhone = await verifyFirebaseToken(body.firebase_token)
          if (verifiedPhone === body.phone) {
            isVerified = true
          }
        } catch (_) {}
      }

      if (!isVerified) {
        const isFirebaseVerified = await redis.get(`firebase_verified:${body.phone}`)
        if (isFirebaseVerified) {
          isVerified = true
          await redis.del(`firebase_verified:${body.phone}`)
        }
      }

      if (!isVerified) {
        if (!body.otp) return reply.code(400).send({ error: 'Valid OTP or Firebase verification is required' })
        const otpValid = await verifyOtp(redis, body.phone, body.otp)
        if (!otpValid) return reply.code(400).send({ error: 'Invalid or expired OTP' })
      }

      const existing = await db.query('SELECT id FROM users WHERE phone = $1 OR username = $2', [body.phone, body.username])
      if (existing.rows.length > 0) return reply.code(409).send({ error: 'Phone or username already exists' })

      const passwordHash = await bcrypt.hash(body.password, 12)
      const referralCode = generateReferralCode()

      // A referral code belongs to either a player (existing one-time bonus
      // path, checked first) or an agent (recurring commission tracking,
      // Task 1's agents table) — never both. See
      // docs/superpowers/specs/2026-07-20-agent-commission-system-design.md
      let referredBy: string | null = null
      let referredByAgentId: string | null = null
      
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null
      let referralCodeToUse = body.referral_code?.trim() || null

      if (!referralCodeToUse && ip) {
        const lastClick = await db.query(
          `SELECT ref_code FROM referral_clicks 
           WHERE ip_address = $1 AND converted_user_id IS NULL AND clicked_at >= NOW() - INTERVAL '24 hours'
           ORDER BY clicked_at DESC LIMIT 1`,
          [ip]
        )
        if (lastClick.rows.length > 0) {
          referralCodeToUse = lastClick.rows[0].ref_code
        }
      }

      if (referralCodeToUse) {
        const ref = await db.query('SELECT id FROM users WHERE UPPER(referral_code) = UPPER($1)', [referralCodeToUse])
        if (ref.rows.length > 0) {
          referredBy = ref.rows[0].id
        } else {
          const agentRef = await db.query(`SELECT id FROM agents WHERE UPPER(referral_code) = UPPER($1) AND status = 'active'`, [referralCodeToUse])
          if (agentRef.rows.length > 0) referredByAgentId = agentRef.rows[0].id
        }
      }

      const client = await db.connect()
      try {
        await client.query('BEGIN')
        const userRes = await client.query(
          `INSERT INTO users (phone, username, password_hash, referral_code, referred_by, agent_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, referral_code`,
          [body.phone, body.username, passwordHash, referralCode, referredBy, referredByAgentId],
        )
        const user = userRes.rows[0]
        await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id])

        // Automatically attribute conversion in Lead Manager
        const cleanRegPhone = body.phone.replace(/\D/g, '')
        if (cleanRegPhone.length >= 10) {
          const suffix = cleanRegPhone.slice(-10)
          await client.query(
            `UPDATE marketing_leads 
             SET status = 'converted', updated_at = NOW() 
             WHERE LENGTH(REGEXP_REPLACE(contact_phone, '\\D', '', 'g')) >= 10 
               AND RIGHT(REGEXP_REPLACE(contact_phone, '\\D', '', 'g'), 10) = $1`,
            [suffix]
          )
        }

        // Link conversion attribution to referral_clicks
        if (referralCodeToUse) {
          await client.query(
            `UPDATE referral_clicks SET converted_user_id = $1
             WHERE id = (
               SELECT id FROM referral_clicks
               WHERE UPPER(ref_code) = UPPER($2) 
                 AND converted_user_id IS NULL
                 AND (ip_address = $3 OR $3 IS NULL)
               ORDER BY clicked_at DESC LIMIT 1
             )`,
            [user.id, referralCodeToUse, ip]
          )
        }
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

        recordDeviceFingerprint(db, user.id, body.device_fingerprint, body.device_info)

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
      const body = z.object({
        phone: z.string().regex(/^\d{10}$/),
        password: z.string(),
        device_fingerprint: z.string().min(1).max(255).optional(),
        device_info: z.record(z.any()).optional(),
      }).parse(req.body)
      const res = await db.query('SELECT id, username, password_hash, status FROM users WHERE phone = $1 AND is_bot = false', [body.phone])
      if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })
      const user = res.rows[0]
      if (user.status !== 'active') return reply.code(403).send({ error: `Account is ${user.status}` })
      const valid = await bcrypt.compare(body.password, user.password_hash)
      if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

      recordDeviceFingerprint(db, user.id, body.device_fingerprint, body.device_info)

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

    // Forgot password: supports both traditional OTP and Firebase Phone ID Token
    app.post('/auth/reset-password', async (req, reply) => {
      const body = z.object({
        phone: z.string().regex(/^\d{10}$/),
        otp: z.string().length(6).optional(),
        firebase_token: z.string().min(10).optional(),
        new_password: z.string().min(6),
      }).parse(req.body)

      let isVerified = false
      if (body.firebase_token) {
        try {
          const verifiedPhone = await verifyFirebaseToken(body.firebase_token)
          if (verifiedPhone === body.phone) {
            isVerified = true
          }
        } catch (_) {}
      }

      if (!isVerified) {
        const isFirebaseVerified = await redis.get(`firebase_verified:${body.phone}`)
        if (isFirebaseVerified) {
          isVerified = true
          await redis.del(`firebase_verified:${body.phone}`)
        }
      }

      if (!isVerified) {
        if (!body.otp) return reply.code(400).send({ error: 'Valid OTP or Firebase verification is required' })
        const otpValid = await verifyOtp(redis, body.phone, body.otp)
        if (!otpValid) return reply.code(400).send({ error: 'Invalid or expired OTP' })
      }

      const res = await db.query('SELECT id FROM users WHERE phone = $1 AND is_bot = false', [body.phone])
      if (!res.rows.length) return reply.code(404).send({ error: 'No account found with this mobile number' })
      const userId = res.rows[0].id

      const passwordHash = await bcrypt.hash(body.new_password, 12)
      await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId])
      // Invalidate any existing session so old refresh tokens stop working.
      await redis.del(`session:${userId}`)
      return reply.send({ success: true, message: 'Password reset successfully' })
    })

    // Firebase Phone 1-Tap Login
    app.post('/auth/firebase-login', async (req, reply) => {
      const body = z.object({
        firebase_token: z.string().min(10),
        device_fingerprint: z.string().min(1).max(255).optional(),
        device_info: z.record(z.any()).optional(),
      }).parse(req.body)

      try {
        const phone = await verifyFirebaseToken(body.firebase_token)
        const res = await db.query('SELECT id, username, status FROM users WHERE phone = $1 AND is_bot = false', [phone])
        if (!res.rows.length) {
          return reply.code(404).send({ error: 'No user registered with this phone number', phone, isNewUser: true })
        }
        const user = res.rows[0]
        if (user.status !== 'active') {
          return reply.code(403).send({ error: 'Account suspended or inactive' })
        }
        const accessToken = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
        const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' })
        await redis.setex(`session:${user.id}`, 30 * 24 * 60 * 60, refreshToken)
        recordDeviceFingerprint(db, user.id, body.device_fingerprint, body.device_info)
        return reply.send({
          user: { id: user.id, username: user.username },
          access_token: accessToken,
          refresh_token: refreshToken,
        })
      } catch (err: any) {
        return reply.code(400).send({ error: err.message || 'Firebase login failed' })
      }
    })

    app.put('/auth/fcm-token', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { token } = z.object({ token: z.string().min(1) }).parse(req.body)
      await db.query('UPDATE users SET fcm_token = $1, updated_at = NOW() WHERE id = $2', [token, user.sub])
      return reply.send({ success: true })
    })
  }
}
