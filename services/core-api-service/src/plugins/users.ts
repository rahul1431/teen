import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import crypto from 'crypto'

const AVATAR_UPLOAD_DIR = process.env.AVATAR_UPLOAD_DIR || '/opt/teen/uploads/avatars'
const KYC_UPLOAD_DIR = process.env.KYC_UPLOAD_DIR || '/opt/teen/uploads/kyc'
const APP_URL = process.env.APP_URL || 'https://game.myonlinejoker.com'

export function usersPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true })
    fs.mkdirSync(KYC_UPLOAD_DIR, { recursive: true })

    app.get('/users/me', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const res = await db.query(
        `SELECT u.id, u.username, u.phone, u.email, u.avatar_url, u.kyc_status, u.referral_code, u.status, u.created_at,
                w.real_balance, w.bonus_balance,
                (SELECT COUNT(*) FROM game_participants gp WHERE gp.user_id = u.id) AS total_games,
                (SELECT COALESCE(SUM(gp.prize_won),0) FROM game_participants gp WHERE gp.user_id = u.id) AS total_winnings
         FROM users u LEFT JOIN wallets w ON w.user_id = u.id WHERE u.id = $1`,
        [user.sub],
      )
      if (!res.rows.length) return reply.code(404).send({ error: 'User not found' })
      return reply.send(res.rows[0])
    })

    app.put('/users/me', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const body = z.object({
        username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
        avatar_url: z.string().url().optional(),
        fcm_token: z.string().optional(),
      }).parse(req.body)

      if (body.username) {
        const existing = await db.query('SELECT id FROM users WHERE username = $1 AND id != $2', [body.username, user.sub])
        if (existing.rows.length) return reply.code(409).send({ error: 'Username taken' })
      }

      const fields: string[] = []
      const values: any[] = []
      let idx = 1
      if (body.username) { fields.push(`username = $${idx++}`); values.push(body.username) }
      if (body.avatar_url) { fields.push(`avatar_url = $${idx++}`); values.push(body.avatar_url) }
      if (body.fcm_token) { fields.push(`fcm_token = $${idx++}`); values.push(body.fcm_token) }
      fields.push(`updated_at = NOW()`)
      values.push(user.sub)

      const res = await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, username, avatar_url`, values)
      return reply.send(res.rows[0])
    })

    app.get('/users/:id/profile', async (req, reply) => {
      const { id } = req.params as any
      const res = await db.query(
        `SELECT u.id, u.username, u.avatar_url,
                (SELECT COUNT(*) FROM game_participants gp WHERE gp.user_id = u.id AND gp.is_bot = false) AS total_games,
                (SELECT COALESCE(SUM(gp.prize_won),0) FROM game_participants gp WHERE gp.user_id = u.id) AS total_winnings
         FROM users u WHERE u.id = $1 AND u.is_bot = false`,
        [id],
      )
      if (!res.rows.length) return reply.code(404).send({ error: 'User not found' })
      return reply.send(res.rows[0])
    })

    app.get('/users/search', { onRequest: [app.authenticate] }, async (req, reply) => {
      const { q } = req.query as any
      if (typeof q !== 'string' || q.trim().length < 2) return reply.code(400).send({ error: 'q must be at least 2 characters' })
      const res = await db.query(`SELECT id, username, avatar_url FROM users WHERE username ILIKE $1 AND is_bot = false LIMIT 20`, [`%${q.trim()}%`])
      return reply.send(res.rows)
    })

    app.get('/users/referrals/my-stats', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const [userRes, referralsRes] = await Promise.all([
        db.query(`SELECT referral_code FROM users WHERE id = $1`, [user.sub]),
        db.query(
          `SELECT r.id, r.status, r.reward_amount, r.created_at, r.qualified_at, r.rewarded_at,
                  u.username, u.avatar_url
           FROM referrals r JOIN users u ON u.id = r.referee_id
           WHERE r.referrer_id = $1 ORDER BY r.created_at DESC`,
          [user.sub],
        ),
      ])
      if (!userRes.rows.length) return reply.code(404).send({ error: 'User not found' })
      const referralCode = userRes.rows[0].referral_code
      const referralLink = `${APP_URL}/join?ref=${referralCode}`
      const referrals = referralsRes.rows
      const totalEarned = referrals.filter((r: any) => r.status === 'rewarded').reduce((s: number, r: any) => s + parseFloat(r.reward_amount), 0)
      return reply.send({
        referral_code: referralCode, referral_link: referralLink,
        stats: { total_referred: referrals.length, total_earned: totalEarned, pending_count: referrals.filter((r: any) => r.status === 'pending').length, qualified_count: referrals.filter((r: any) => r.status === 'qualified').length, rewarded_count: referrals.filter((r: any) => r.status === 'rewarded').length },
        referrals,
      })
    })

    app.get('/users/daily-bonus/status', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const [streakRes, configRes] = await Promise.all([
        db.query(`SELECT * FROM user_login_streaks WHERE user_id = $1`, [user.sub]),
        db.query(`SELECT * FROM login_bonus_config WHERE is_active = true ORDER BY day_number ASC`),
      ])
      const streak = streakRes.rows[0] || { current_streak: 0, longest_streak: 0, last_claimed_date: null, total_claimed: 0, total_earned: 0 }
      const config = configRes.rows
      const todayDate = new Date().toISOString().slice(0, 10)
      const lastDate = streak.last_claimed_date ? new Date(streak.last_claimed_date).toISOString().slice(0, 10) : null
      const canClaim = lastDate !== todayDate
      const cycleLen = config.length || 7
      const nextDay = ((streak.current_streak) % cycleLen) + 1
      const todayConfig = config.find((c: any) => c.day_number === nextDay) || config[0]
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().slice(0, 10)
      const streakBroken = lastDate && lastDate < yesterdayStr
      return reply.send({ can_claim: canClaim, current_streak: streakBroken ? 0 : streak.current_streak, longest_streak: streak.longest_streak, total_claimed: streak.total_claimed, total_earned: streak.total_earned, next_day_number: streakBroken ? 1 : nextDay, today_bonus: todayConfig, schedule: config, last_claimed_date: lastDate })
    })

    app.post('/users/daily-bonus/claim', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        const streakRes = await client.query(`SELECT * FROM user_login_streaks WHERE user_id = $1 FOR UPDATE`, [user.sub])
        const streak = streakRes.rows[0]
        const todayDate = new Date().toISOString().slice(0, 10)
        const lastDate = streak?.last_claimed_date ? new Date(streak.last_claimed_date).toISOString().slice(0, 10) : null
        if (lastDate === todayDate) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Already claimed today' }) }
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().slice(0, 10)
        const streakBroken = lastDate && lastDate < yesterdayStr
        const currentStreak = streakBroken ? 0 : (streak?.current_streak || 0)
        const configRes = await client.query(`SELECT * FROM login_bonus_config WHERE is_active = true ORDER BY day_number ASC`)
        const config = configRes.rows
        const cycleLen = config.length || 7
        const dayNumber = (currentStreak % cycleLen) + 1
        const dayConfig = config.find((c: any) => c.day_number === dayNumber) || config[0]
        const bonusAmount = parseFloat(dayConfig.bonus_amount)
        const newStreak = currentStreak + 1
        await client.query(
          `INSERT INTO user_login_streaks (user_id, current_streak, longest_streak, last_claimed_date, total_claimed, total_earned)
           VALUES ($1, $2, $2, $3, 1, $4)
           ON CONFLICT (user_id) DO UPDATE SET current_streak = $2, longest_streak = GREATEST(user_login_streaks.longest_streak, $2), last_claimed_date = $3, total_claimed = user_login_streaks.total_claimed + 1, total_earned = user_login_streaks.total_earned + $4, updated_at = NOW()`,
          [user.sub, newStreak, todayDate, bonusAmount],
        )
        await client.query(`INSERT INTO bonuses (user_id, type, amount, wagering_requirement, status, expires_at) VALUES ($1, 'daily_login', $2, 0, 'active', NOW() + INTERVAL '30 days')`, [user.sub, bonusAmount])
        await client.query('COMMIT')
        const walletUrl = process.env.WALLET_SERVICE_URL || 'http://localhost:3003'
        await fetch(`${walletUrl}/internal/wallet/credit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' },
          body: JSON.stringify({ user_id: user.sub, amount: bonusAmount, type: 'bonus', wallet_type: 'bonus', idempotency_key: `daily_login:${user.sub}:${todayDate}`, description: `Daily login bonus — Day ${dayNumber}` }),
        }).catch(err => console.error('[daily-bonus] wallet credit failed:', err))
        return reply.send({ success: true, bonus_amount: bonusAmount, bonus_type: dayConfig.bonus_type, day_number: dayNumber, new_streak: newStreak, label: dayConfig.label, emoji: dayConfig.emoji })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    })

    app.get('/users/banners', async (_req, reply) => {
      const now = new Date().toISOString()
      const res = await db.query(
        `SELECT id, title, subtitle, image_url, click_url, click_type, sort_order FROM home_banners
         WHERE is_active = true AND (starts_at IS NULL OR starts_at <= $1) AND (ends_at IS NULL OR ends_at >= $1) ORDER BY sort_order ASC, created_at ASC`,
        [now],
      )
      return reply.send(res.rows)
    })

    app.post('/users/me/avatar', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const data = await (req as any).file()
      if (!data) return reply.code(400).send({ error: 'No file uploaded' })
      const ext = path.extname(data.filename || '.jpg').toLowerCase()
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return reply.code(400).send({ error: 'Only jpg/png/webp allowed' })
      const filename = `${user.sub}_${crypto.randomBytes(6).toString('hex')}${ext}`
      const filePath = path.join(AVATAR_UPLOAD_DIR, filename)
      await pipeline(data.file, fs.createWriteStream(filePath))
      const avatar_url = `${APP_URL}/uploads/avatars/${filename}`
      await db.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatar_url, user.sub])
      return reply.send({ avatar_url })
    })

    app.post('/users/kyc/submit', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const userDir = path.join(KYC_UPLOAD_DIR, user.sub)
      fs.mkdirSync(userDir, { recursive: true })
      const files: Record<string, string> = {}
      const parts = (req as any).parts()
      for await (const part of parts) {
        if (part.type !== 'file') continue
        const key = part.fieldname
        if (!['aadhaar_front', 'aadhaar_back', 'selfie'].includes(key)) continue
        const ext = path.extname(part.filename || '.jpg').toLowerCase()
        await pipeline(part.file, fs.createWriteStream(path.join(userDir, `${key}${ext}`)))
        files[key] = `${APP_URL}/uploads/kyc/${user.sub}/${key}${ext}`
      }
      if (!files['aadhaar_front'] || !files['aadhaar_back'] || !files['selfie']) {
        return reply.code(400).send({ error: 'Please upload aadhaar_front, aadhaar_back, and selfie' })
      }
      await db.query(
        `INSERT INTO kyc_documents (user_id, doc_type, s3_front_key, s3_back_key, selfie_path, status, submitted_at) VALUES ($1, 'aadhaar', $2, $3, $4, 'under_review', NOW())
         ON CONFLICT (user_id) DO UPDATE SET s3_front_key = EXCLUDED.s3_front_key, s3_back_key = EXCLUDED.s3_back_key, selfie_path = EXCLUDED.selfie_path, status = 'under_review', submitted_at = NOW(), rejection_reason = NULL`,
        [user.sub, files['aadhaar_front'], files['aadhaar_back'], files['selfie']],
      )
      await db.query(`UPDATE users SET kyc_status = 'under_review' WHERE id = $1`, [user.sub])
      return reply.send({ success: true, status: 'under_review' })
    })

    app.get('/users/kyc/status', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const [userRes, kycRes] = await Promise.all([
        db.query(`SELECT kyc_status FROM users WHERE id = $1`, [user.sub]),
        db.query(`SELECT doc_type, status, rejection_reason, submitted_at, reviewed_at, s3_front_key AS front_url, s3_back_key AS back_url, selfie_path AS selfie_url FROM kyc_documents WHERE user_id = $1`, [user.sub]),
      ])
      return reply.send({ kyc_status: userRes.rows[0]?.kyc_status || 'pending', document: kycRes.rows[0] || null })
    })

    // ── Bank Details ──────────────────────────────────────────────────────────
    app.get('/users/me/bank', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const res = await db.query(
        `SELECT id, holder_name, bank_name, account_number, ifsc_code, upi_id, verified, updated_at
         FROM bank_details WHERE user_id = $1`,
        [user.sub],
      )
      return reply.send({ bank: res.rows[0] || null })
    })

    app.put('/users/me/bank', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const body = z.object({
        holder_name:    z.string().min(2).max(100),
        bank_name:      z.string().min(2).max(100),
        account_number: z.string().min(6).max(20).regex(/^\d+$/, 'Must be digits only'),
        ifsc_code:      z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format'),
        upi_id:         z.string().max(50).optional(),
      }).parse(req.body)

      await db.query(
        `INSERT INTO bank_details (user_id, holder_name, bank_name, account_number, ifsc_code, upi_id, verified)
         VALUES ($1, $2, $3, $4, $5, $6, false)
         ON CONFLICT (user_id) DO UPDATE SET
           holder_name = EXCLUDED.holder_name,
           bank_name = EXCLUDED.bank_name,
           account_number = EXCLUDED.account_number,
           ifsc_code = EXCLUDED.ifsc_code,
           upi_id = EXCLUDED.upi_id,
           verified = false,
           updated_at = NOW()`,
        [user.sub, body.holder_name, body.bank_name, body.account_number, body.ifsc_code, body.upi_id || null],
      )
      return reply.send({ success: true, message: 'Bank details saved. Pending admin verification.' })
    })

    // ── Transaction History ───────────────────────────────────────────────────
    app.get('/users/me/transactions', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { page = 1, limit = 30, type } = req.query as any
      const offset = (Number(page) - 1) * Number(limit)

      const whereType = type ? `AND wt.type = $4` : ''
      const params: any[] = type
        ? [user.sub, Number(limit), offset, type]
        : [user.sub, Number(limit), offset]

      const res = await db.query(
        `SELECT wt.id, wt.type, wt.amount, wt.wallet_type, wt.description, wt.status, wt.created_at,
                wt.reference_id, wt.reference_type
         FROM wallet_transactions wt
         WHERE wt.user_id = $1 ${whereType}
         ORDER BY wt.created_at DESC
         LIMIT $2 OFFSET $3`,
        params,
      )
      const countRes = await db.query(
        `SELECT COUNT(*) FROM wallet_transactions WHERE user_id = $1 ${type ? 'AND type = $2' : ''}`,
        type ? [user.sub, type] : [user.sub],
      )

      return reply.send({
        transactions: res.rows,
        total: parseInt(countRes.rows[0].count),
        page: Number(page),
      })
    })

    // ── Admin: Bank Details ───────────────────────────────────────────────────
    app.get('/admin/bank-details', async (_req, reply) => {
      const res = await db.query(
        `SELECT bd.*, u.username, u.phone, u.email
         FROM bank_details bd
         JOIN users u ON u.id = bd.user_id
         ORDER BY bd.updated_at DESC`,
      )
      return reply.send({ bank_details: res.rows })
    })

    app.patch('/admin/bank-details/:userId/verify', async (req, reply) => {
      const { userId } = req.params as any
      const { verified } = req.body as any
      await db.query(
        `UPDATE bank_details SET verified = $1, verified_at = $2, updated_at = NOW() WHERE user_id = $3`,
        [verified, verified ? new Date() : null, userId],
      )
      return reply.send({ success: true })
    })
  }
}

