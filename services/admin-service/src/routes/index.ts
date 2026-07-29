import { FastifyInstance } from 'fastify'
import { BotTrainingConfigRepository } from '../repositories/botTrainingConfigRepository'
import { BotTrainingSessionsRepository } from '../repositories/botTrainingSessionsRepository'
import { computeEffectiveBoldness } from '../repositories/adaptiveBoldness'
import Redis from 'ioredis'
import { Database } from '../db'

export async function registerBotTrainingRoutes(
  app: FastifyInstance,
  redis: Redis,
  db: Database,
  authenticate: any,
  requireRole: any
) {
  const botTrainingConfigRepo = new BotTrainingConfigRepository(redis, db)
  const botTrainingSessionsRepo = new BotTrainingSessionsRepository(db)

  // GET /api/admin/ludo/bot-stats
  app.get('/api/admin/ludo/bot-stats', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const { page = '1', limit = '10' } = req.query as any
      const offset = (parseInt(page) - 1) * parseInt(limit)

      // A bot's opponent is always the RP in these 1-RP + 3-bot games, so
      // lifetime win rate and vs-RP win rate are the same figure here —
      // computed per bot across every game it appeared in (bot_ids), not
      // just games where it was the elected winner.
      const res = await db.query(`
        SELECT
          bot_id,
          COUNT(*) as lifetime_games,
          SUM(CASE WHEN actual_winner_id = bot_id::uuid THEN 1 ELSE 0 END) as lifetime_wins,
          SUM(CASE WHEN winner_bot_id = bot_id::uuid THEN 1 ELSE 0 END) as games_as_winner
        FROM bot_learning_sessions, jsonb_array_elements_text(bot_ids) AS bot_id
        GROUP BY bot_id
        ORDER BY lifetime_wins DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])

      const botIds = res.rows.map((row: any) => row.bot_id)
      const last10ByBot = new Map<string, string[]>()
      if (botIds.length > 0) {
        const last10Res = await db.query(`
          SELECT bot_id, actual_winner_id, created_at
          FROM bot_learning_sessions, jsonb_array_elements_text(bot_ids) AS bot_id
          WHERE bot_id::uuid = ANY($1::uuid[])
          ORDER BY bot_id, created_at DESC
        `, [botIds])
        for (const row of last10Res.rows as any[]) {
          const list = last10ByBot.get(row.bot_id) || []
          if (list.length < 10) {
            list.push(row.actual_winner_id === row.bot_id ? 'W' : 'L')
            last10ByBot.set(row.bot_id, list)
          }
        }
      }

      const countRes = await db.query(`
        SELECT COUNT(DISTINCT bot_id) as count
        FROM bot_learning_sessions, jsonb_array_elements_text(bot_ids) AS bot_id
      `)

      return reply.send({
        bots: res.rows.map((row: any) => {
          const lifetimeGames = parseInt(row.lifetime_games || 0)
          const lifetimeWins = parseInt(row.lifetime_wins || 0)
          const winRate = lifetimeGames > 0 ? (lifetimeWins / lifetimeGames) * 100 : 0
          return {
            bot_id: row.bot_id?.toString() || '',
            name: `Bot ${row.bot_id?.toString().slice(0, 8) || ''}`,
            lifetime_wins: lifetimeWins,
            win_rate: winRate,
            vs_rp_win_rate: winRate,
            last_10_games: last10ByBot.get(row.bot_id) || [],
          }
        }),
        total: parseInt(countRes.rows[0]?.count || 0),
      })
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch bot stats')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/admin/ludo/bot-training/config
  app.get('/api/admin/ludo/bot-training/config', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const config = await botTrainingConfigRepo.getConfig()
      const effectiveBoldness = config.adaptiveBoldness
        ? await computeEffectiveBoldness(db, config.winnerBotBoldness, config.targetWinRate)
        : config.winnerBotBoldness
      return reply.send({ ...config, effectiveBoldness })
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch bot training config')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // PATCH /api/admin/ludo/bot-training/config
  app.patch(
    '/api/admin/ludo/bot-training/config',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      try {
        const current = await botTrainingConfigRepo.getConfig()
        const body = req.body as any
        const updated = { ...current, ...body }

        await botTrainingConfigRepo.updateConfig(updated)
        return reply.send(updated)
      } catch (err: any) {
        app.log.error(err, 'Failed to update bot training config')
        if (err instanceof Error && err.message.includes('must be between')) {
          return reply.code(400).send({ error: err.message })
        }
        return reply.code(500).send({ error: 'Internal server error' })
      }
    }
  )

  // GET /api/admin/ludo/bot-training/sessions
  app.get('/api/admin/ludo/bot-training/sessions', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    try {
      const queryParams = req.query as any
      const query = {
        page: queryParams.page ? parseInt(queryParams.page as string) : 1,
        limit: queryParams.limit ? parseInt(queryParams.limit as string) : 20,
        startDate: queryParams.startDate as string | undefined,
        endDate: queryParams.endDate as string | undefined,
        botId: queryParams.botId as string | undefined,
        success: queryParams.success ? queryParams.success === 'true' : undefined,
      }

      const result = await botTrainingSessionsRepo.getSessions(query)
      return reply.send(result)
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch bot training sessions')
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/admin/ludo/bot-training/trend — rolling coordination success
  // rate vs. target win rate, bucketed by day, for the training dashboard chart.
  app.get('/api/admin/ludo/bot-training/trend', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    try {
      const { days = '30' } = req.query as any
      const res = await db.query(
        `SELECT
          date_trunc('day', created_at) as day,
          COUNT(*) as games,
          SUM(CASE WHEN coordination_success THEN 1 ELSE 0 END) as successes,
          AVG(target_win_rate) as target_win_rate
        FROM bot_learning_sessions
        WHERE created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC`,
        [parseInt(days)]
      )

      return reply.send({
        trend: res.rows.map((row: any) => {
          const games = parseInt(row.games || 0)
          const successes = parseInt(row.successes || 0)
          return {
            date: row.day,
            games,
            successRate: games > 0 ? successes / games : 0,
            targetWinRate: parseFloat(row.target_win_rate || 0),
          }
        }),
      })
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch bot training trend')
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
