import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import { Pool } from 'pg'
import { z } from 'zod'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })

async function start() {
  await app.register(helmet)
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })

  const authenticate = async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  // GET /users/me
  app.get('/users/me', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const res = await db.query(
      `SELECT u.id, u.username, u.phone, u.email, u.avatar_url, u.kyc_status, u.referral_code, u.status, u.created_at,
              w.real_balance, w.bonus_balance,
              (SELECT COUNT(*) FROM game_participants gp WHERE gp.user_id = u.id) AS total_games,
              (SELECT COALESCE(SUM(gp.prize_won),0) FROM game_participants gp WHERE gp.user_id = u.id) AS total_winnings
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.id = $1`,
      [user.sub]
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'User not found' })
    return reply.send(res.rows[0])
  })

  // PUT /users/me
  app.put('/users/me', { onRequest: [authenticate] }, async (req, reply) => {
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

    const res = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, username, avatar_url`,
      values
    )
    return reply.send(res.rows[0])
  })

  // GET /users/:id/profile (public profile)
  app.get('/users/:id/profile', async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT u.id, u.username, u.avatar_url,
              (SELECT COUNT(*) FROM game_participants gp WHERE gp.user_id = u.id AND gp.is_bot = false) AS total_games,
              (SELECT COALESCE(SUM(gp.prize_won),0) FROM game_participants gp WHERE gp.user_id = u.id) AS total_winnings
       FROM users u WHERE u.id = $1 AND u.is_bot = false`,
      [id]
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'User not found' })
    return reply.send(res.rows[0])
  })

  // GET /users/search?q=username (admin/leaderboard use)
  app.get('/users/search', { onRequest: [authenticate] }, async (req, reply) => {
    const { q } = req.query as any
    if (typeof q !== 'string' || q.trim().length < 2) {
      return reply.code(400).send({ error: 'q must be at least 2 characters' })
    }
    const res = await db.query(
      `SELECT id, username, avatar_url FROM users WHERE username ILIKE $1 AND is_bot = false LIMIT 20`,
      [`%${q.trim()}%`]
    )
    return reply.send(res.rows)
  })

  // GET /users/referrals/my-stats — full referral dashboard data (accessible via /api/users/referrals/my-stats)
  app.get('/users/referrals/my-stats', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any

    const [userRes, referralsRes] = await Promise.all([
      db.query(`SELECT referral_code FROM users WHERE id = $1`, [user.sub]),
      db.query(
        `SELECT r.id, r.status, r.reward_amount, r.created_at, r.qualified_at, r.rewarded_at,
                u.username, u.avatar_url
         FROM referrals r
         JOIN users u ON u.id = r.referee_id
         WHERE r.referrer_id = $1
         ORDER BY r.created_at DESC`,
        [user.sub]
      ),
    ])

    if (!userRes.rows.length) return reply.code(404).send({ error: 'User not found' })
    const referralCode = userRes.rows[0].referral_code
    const referralLink = `${process.env.APP_URL || 'https://game.myonlinejoker.com'}/join?ref=${referralCode}`

    const referrals = referralsRes.rows
    const totalEarned = referrals
      .filter((r: any) => r.status === 'rewarded')
      .reduce((sum: number, r: any) => sum + parseFloat(r.reward_amount), 0)

    const stats = {
      total_referred: referrals.length,
      total_earned: totalEarned,
      pending_count: referrals.filter((r: any) => r.status === 'pending').length,
      qualified_count: referrals.filter((r: any) => r.status === 'qualified').length,
      rewarded_count: referrals.filter((r: any) => r.status === 'rewarded').length,
    }

    return reply.send({ referral_code: referralCode, referral_link: referralLink, stats, referrals })
  })

  // GET /users/daily-bonus/status — streak info + today's claimable bonus
  app.get('/users/daily-bonus/status', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any

    const [streakRes, configRes] = await Promise.all([
      db.query(`SELECT * FROM user_login_streaks WHERE user_id = $1`, [user.sub]),
      db.query(`SELECT * FROM login_bonus_config WHERE is_active = true ORDER BY day_number ASC`),
    ])

    const streak = streakRes.rows[0] || {
      current_streak: 0, longest_streak: 0,
      last_claimed_date: null, total_claimed: 0, total_earned: 0,
    }
    const config = configRes.rows

    const todayDate = new Date().toISOString().slice(0, 10)
    const lastDate = streak.last_claimed_date
      ? new Date(streak.last_claimed_date).toISOString().slice(0, 10)
      : null

    const canClaim = lastDate !== todayDate
    // Cycle through 7-day config (day_number 1-7, then repeats)
    const cycleLen = config.length || 7
    const nextDay = ((streak.current_streak) % cycleLen) + 1
    const todayConfig = config.find((c: any) => c.day_number === nextDay) || config[0]

    // Was streak broken? (last claim was 2+ days ago)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    const streakBroken = lastDate && lastDate < yesterdayStr

    return reply.send({
      can_claim: canClaim,
      current_streak: streakBroken ? 0 : streak.current_streak,
      longest_streak: streak.longest_streak,
      total_claimed: streak.total_claimed,
      total_earned: streak.total_earned,
      next_day_number: streakBroken ? 1 : nextDay,
      today_bonus: todayConfig,
      schedule: config,
      last_claimed_date: lastDate,
    })
  })

  // POST /users/daily-bonus/claim — claim today's bonus (idempotent)
  app.post('/users/daily-bonus/claim', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      // Lock the streak row
      const streakRes = await client.query(
        `SELECT * FROM user_login_streaks WHERE user_id = $1 FOR UPDATE`,
        [user.sub]
      )
      const streak = streakRes.rows[0]

      const todayDate = new Date().toISOString().slice(0, 10)
      const lastDate = streak?.last_claimed_date
        ? new Date(streak.last_claimed_date).toISOString().slice(0, 10)
        : null

      if (lastDate === todayDate) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'Already claimed today' })
      }

      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().slice(0, 10)
      const streakBroken = lastDate && lastDate < yesterdayStr

      const currentStreak = streakBroken ? 0 : (streak?.current_streak || 0)

      // Fetch config
      const configRes = await client.query(
        `SELECT * FROM login_bonus_config WHERE is_active = true ORDER BY day_number ASC`
      )
      const config = configRes.rows
      const cycleLen = config.length || 7
      const dayNumber = (currentStreak % cycleLen) + 1
      const dayConfig = config.find((c: any) => c.day_number === dayNumber) || config[0]
      const bonusAmount = parseFloat(dayConfig.bonus_amount)
      const newStreak = currentStreak + 1

      // Upsert streak record
      await client.query(
        `INSERT INTO user_login_streaks (user_id, current_streak, longest_streak, last_claimed_date, total_claimed, total_earned)
         VALUES ($1, $2, $2, $3, 1, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           current_streak   = $2,
           longest_streak   = GREATEST(user_login_streaks.longest_streak, $2),
           last_claimed_date = $3,
           total_claimed    = user_login_streaks.total_claimed + 1,
           total_earned     = user_login_streaks.total_earned + $4,
           updated_at       = NOW()`,
        [user.sub, newStreak, todayDate, bonusAmount]
      )

      // Record in bonuses table
      await client.query(
        `INSERT INTO bonuses (user_id, type, amount, wagering_requirement, status, expires_at)
         VALUES ($1, 'daily_login', $2, 0, 'active', NOW() + INTERVAL '30 days')`,
        [user.sub, bonusAmount]
      )

      await client.query('COMMIT')

      // Credit wallet via internal call (outside transaction)
      const walletUrl = process.env.WALLET_SERVICE_URL || 'http://localhost:3003'
      const creditRes = await fetch(`${walletUrl}/internal/wallet/credit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '',
        },
        body: JSON.stringify({
          user_id: user.sub,
          amount: bonusAmount,
          type: dayConfig.bonus_type === 'bonus' ? 'bonus' : 'bonus',
          wallet_type: dayConfig.bonus_type === 'bonus' ? 'bonus' : 'real',
          idempotency_key: `daily_login:${user.sub}:${todayDate}`,
          description: `Daily login bonus — ${dayConfig.label || `Day ${dayNumber}`}`,
        }),
      })

      if (!creditRes.ok) {
        console.error('[daily-bonus] wallet credit failed:', await creditRes.text())
      }

      return reply.send({
        success: true,
        bonus_amount: bonusAmount,
        bonus_type: dayConfig.bonus_type,
        day_number: dayNumber,
        new_streak: newStreak,
        label: dayConfig.label,
        emoji: dayConfig.emoji,
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  app.get('/health', async () => ({ status: 'ok', service: 'user' }))

  const port = parseInt(process.env.PORT || '3002')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`User service running on port ${port}`)
}

start().catch((err) => { console.error(err); process.exit(1) })
