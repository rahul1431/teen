import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Redis from 'ioredis'
import { Pool } from 'pg'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })
const redis = new Redis(process.env.REDIS_URL!)

function getLeaderboardKey(gameType: string, period: string): string {
  const now = new Date()
  if (period === 'daily') {
    return `leaderboard:daily:${gameType}:${now.toISOString().slice(0, 10)}`
  }
  const week = Math.ceil(now.getDate() / 7)
  return `leaderboard:weekly:${gameType}:${now.getFullYear()}-W${week}`
}

async function start() {
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })

  const authenticate = async (req: any, reply: any) => {
    const internalKey = req.headers['x-internal-key']
    if (internalKey && internalKey === process.env.INTERNAL_SERVICE_KEY) return
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  // GET /leaderboard/:gameType?period=daily|weekly
  app.get('/leaderboard/:gameType', { onRequest: [authenticate] }, async (req, reply) => {
    const { gameType } = req.params as any
    const { period = 'daily', limit = 50 } = req.query as any

    const key = getLeaderboardKey(gameType, period)
    const entries = await redis.zrevrange(key, 0, parseInt(limit) - 1, 'WITHSCORES')

    const result = []
    for (let i = 0; i < entries.length; i += 2) {
      const userId = entries[i]
      const score = parseFloat(entries[i + 1])
      const userRes = await db.query('SELECT username, avatar_url FROM users WHERE id = $1', [userId])
      if (userRes.rows.length) {
        result.push({ rank: i / 2 + 1, user_id: userId, username: userRes.rows[0].username, avatar_url: userRes.rows[0].avatar_url, score })
      }
    }
    return reply.send({ period, game_type: gameType, entries: result })
  })

  // Internal: POST /internal/leaderboard/update (called after game result)
  app.post('/internal/leaderboard/update', async (req, reply) => {
    const key = req.headers['x-internal-key']
    if (key !== process.env.INTERNAL_SERVICE_KEY) return reply.code(403).send({ error: 'Forbidden' })

    const { user_id, game_type, score } = req.body as any
    const dailyKey = getLeaderboardKey(game_type, 'daily')
    const weeklyKey = getLeaderboardKey(game_type, 'weekly')

    await redis.zincrby(dailyKey, score, user_id)
    await redis.expire(dailyKey, 86400 * 2)
    await redis.zincrby(weeklyKey, score, user_id)
    await redis.expire(weeklyKey, 86400 * 9)

    return reply.send({ success: true })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'leaderboard' }))

  const port = parseInt(process.env.PORT || '3006')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Leaderboard service running on port ${port}`)
}

start().catch(err => { console.error(err); process.exit(1) })
