import { FastifyInstance } from 'fastify'
import { BotTrainingConfigRepository } from '../repositories/botTrainingConfigRepository'
import { BotTrainingSessionsRepository } from '../repositories/botTrainingSessionsRepository'
import { computeEffectiveBoldness } from '../repositories/adaptiveBoldness'
import Redis from 'ioredis'
import { Database } from '../db'

const SUPPORTED_GAME_TYPES = ['teen_patti', 'ludo'] as const
type SupportedGameType = (typeof SUPPORTED_GAME_TYPES)[number]

function parseGameType(req: any, reply: any): SupportedGameType | null {
  const gameType = (req.params as any)?.gameType
  if (!SUPPORTED_GAME_TYPES.includes(gameType)) {
    reply.code(400).send({ error: `gameType must be one of: ${SUPPORTED_GAME_TYPES.join(', ')}` })
    return null
  }
  return gameType
}

export async function registerBotTrainingRoutes(
  app: FastifyInstance,
  redis: Redis,
  db: Database,
  authenticate: any,
  requireRole: any
) {
  const botTrainingConfigRepo = new BotTrainingConfigRepository(redis, db)
  const botTrainingSessionsRepo = new BotTrainingSessionsRepository(db)

  // GET /api/admin/:gameType/bot-stats
  app.get('/api/admin/:gameType/bot-stats', { onRequest: [authenticate] }, async (req, reply) => {
    const gameType = parseGameType(req, reply)
    if (!gameType) return
    try {
      const { page = '1', limit = '10' } = req.query as any
      const offset = (parseInt(page) - 1) * parseInt(limit)

      // A bot's opponent is always the RP in these 1-RP + 3-bot games, so
      // lifetime win rate and vs-RP win rate are the same figure here —
      // computed per bot across every game of this type it appeared in
      // (bot_ids), not just games where it was the elected winner.
      const res = await db.query(`
        SELECT
          bot_id,
          COUNT(*) as lifetime_games,
          SUM(CASE WHEN actual_winner_id = bot_id::uuid THEN 1 ELSE 0 END) as lifetime_wins,
          SUM(CASE WHEN winner_bot_id = bot_id::uuid THEN 1 ELSE 0 END) as games_as_winner
        FROM bot_learning_sessions, jsonb_array_elements_text(bot_ids) AS bot_id
        WHERE game_type = $1
        GROUP BY bot_id
        ORDER BY lifetime_wins DESC
        LIMIT $2 OFFSET $3
      `, [gameType, parseInt(limit), offset])

      const botIds = res.rows.map((row: any) => row.bot_id)
      const last10ByBot = new Map<string, string[]>()
      if (botIds.length > 0) {
        const last10Res = await db.query(`
          SELECT bot_id, actual_winner_id, created_at
          FROM bot_learning_sessions, jsonb_array_elements_text(bot_ids) AS bot_id
          WHERE game_type = $1 AND bot_id::uuid = ANY($2::uuid[])
          ORDER BY bot_id, created_at DESC
        `, [gameType, botIds])
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
        WHERE game_type = $1
      `, [gameType])

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

  // GET /api/admin/:gameType/bot-training/config
  app.get('/api/admin/:gameType/bot-training/config', { onRequest: [authenticate] }, async (req, reply) => {
    const gameType = parseGameType(req, reply)
    if (!gameType) return
    try {
      const config = await botTrainingConfigRepo.getConfig(gameType)
      const effectiveBoldness = config.adaptiveBoldness
        ? await computeEffectiveBoldness(db, config.winnerBotBoldness, config.targetWinRate)
        : config.winnerBotBoldness
      return reply.send({ ...config, effectiveBoldness })
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch bot training config')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // PATCH /api/admin/:gameType/bot-training/config
  app.patch(
    '/api/admin/:gameType/bot-training/config',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const gameType = parseGameType(req, reply)
      if (!gameType) return
      try {
        const current = await botTrainingConfigRepo.getConfig(gameType)
        const body = req.body as any
        const updated = { ...current, ...body }

        await botTrainingConfigRepo.updateConfig(gameType, updated)
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

  // GET /api/admin/:gameType/bot-training/sessions
  app.get('/api/admin/:gameType/bot-training/sessions', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const gameType = parseGameType(req, reply)
    if (!gameType) return
    try {
      const queryParams = req.query as any
      const query = {
        gameType,
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

  // GET /api/admin/:gameType/bot-training/trend — rolling coordination
  // success rate vs. target win rate, bucketed by day, for the training
  // dashboard chart.
  app.get('/api/admin/:gameType/bot-training/trend', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const gameType = parseGameType(req, reply)
    if (!gameType) return
    try {
      const { days = '30' } = req.query as any
      const res = await db.query(
        `SELECT
          date_trunc('day', created_at) as day,
          COUNT(*) as games,
          SUM(CASE WHEN coordination_success THEN 1 ELSE 0 END) as successes,
          AVG(target_win_rate) as target_win_rate
        FROM bot_learning_sessions
        WHERE game_type = $1 AND created_at >= NOW() - ($2 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC`,
        [gameType, parseInt(days)]
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
