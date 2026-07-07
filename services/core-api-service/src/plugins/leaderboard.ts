import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'

const VALID_GAME_TYPES = ['teen_patti', 'rummy', 'ludo', 'aviator', 'matka', 'lottery']

function getLeaderboardKey(gameType: string, period: string): string {
  const now = new Date()
  if (period === 'daily') return `leaderboard:daily:${gameType}:${now.toISOString().slice(0, 10)}`
  const week = Math.ceil(now.getDate() / 7)
  return `leaderboard:weekly:${gameType}:${now.getFullYear()}-W${week}`
}

export function leaderboardPlugin(db: Pool, redis: Redis) {
  return async function (app: FastifyInstance) {
    const authOrInternal = async (req: any, reply: any) => {
      const internalKey = req.headers['x-internal-key']
      if (internalKey && internalKey === process.env.INTERNAL_SERVICE_KEY) return
      try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
    }

    // Leaderboards are computed straight from Postgres: game engines already
    // persist wins (game_participants.prize_won / wallet_transactions), while
    // nothing feeds the legacy Redis sorted sets.
    app.get('/leaderboard/:gameType', { onRequest: [authOrInternal] }, async (req, reply) => {
      const { gameType } = req.params as any
      const { period = 'daily', limit = 50 } = req.query as any
      if (!VALID_GAME_TYPES.includes(gameType)) return reply.code(400).send({ error: 'Invalid game type' })
      const max = Math.min(parseInt(limit) || 50, 100)
      const since = period === 'weekly' ? "NOW() - INTERVAL '7 days'" : "date_trunc('day', NOW())"

      let rows
      if (gameType === 'aviator') {
        // Aviator has no room/participant rows — wins are wallet credits from cashouts.
        rows = (await db.query(
          `SELECT u.id AS user_id, u.username, u.avatar_url, SUM(wt.amount)::float AS score
           FROM wallet_transactions wt
           JOIN users u ON u.id = wt.user_id
           WHERE wt.type = 'game_credit'
             AND wt.status = 'completed'
             AND wt.idempotency_key LIKE 'aviator_cashout_%'
             AND wt.created_at >= ${since}
             AND u.is_bot = false
           GROUP BY u.id, u.username, u.avatar_url
           ORDER BY score DESC
           LIMIT $1`,
          [max]
        )).rows
      } else {
        rows = (await db.query(
          `SELECT u.id AS user_id, u.username, u.avatar_url, SUM(gp.prize_won)::float AS score
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           JOIN users u ON u.id = gp.user_id
           WHERE gr.game_type = $1
             AND gr.ended_at >= ${since}
             AND gp.prize_won > 0
             AND gp.is_bot = false
             AND u.is_bot = false
           GROUP BY u.id, u.username, u.avatar_url
           ORDER BY score DESC
           LIMIT $2`,
          [gameType, max]
        )).rows
      }

      const entries = rows.map((r: any, i: number) => ({
        rank: i + 1,
        user_id: r.user_id,
        username: r.username,
        avatar_url: r.avatar_url,
        score: r.score,
      }))
      return reply.send({ period, game_type: gameType, entries })
    })

    app.post('/internal/leaderboard/update', async (req, reply) => {
      const key = process.env.INTERNAL_SERVICE_KEY
      if (!key || req.headers['x-internal-key'] !== key) return reply.code(403).send({ error: 'Forbidden' })
      const { user_id, game_type, score } = req.body as any
      const dailyKey = getLeaderboardKey(game_type, 'daily')
      const weeklyKey = getLeaderboardKey(game_type, 'weekly')
      await redis.zincrby(dailyKey, score, user_id)
      await redis.expire(dailyKey, 86400 * 2)
      await redis.zincrby(weeklyKey, score, user_id)
      await redis.expire(weeklyKey, 86400 * 9)
      return reply.send({ success: true })
    })
  }
}
