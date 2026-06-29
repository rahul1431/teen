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

  app.get('/health', async () => ({ status: 'ok', service: 'user' }))

  const port = parseInt(process.env.PORT || '3002')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`User service running on port ${port}`)
}

start().catch((err) => { console.error(err); process.exit(1) })
