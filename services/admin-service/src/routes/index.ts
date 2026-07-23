import { FastifyInstance } from 'fastify'
import { BotTrainingConfigRepository } from '../repositories/botTrainingConfigRepository'
import { BotTrainingSessionsRepository } from '../repositories/botTrainingSessionsRepository'
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

      // Query bot stats from bot_learning_sessions table
      const res = await db.query(`
        SELECT
          winner_bot_id as bot_id,
          COUNT(*) as lifetime_wins,
          (COUNT(*) FILTER (WHERE coordination_success = true)::float / NULLIF(COUNT(*), 0) * 100) as win_rate,
          0 as vs_rp_win_rate,
          '[]'::jsonb as last_10_games
        FROM bot_learning_sessions
        WHERE winner_bot_id IS NOT NULL
        GROUP BY winner_bot_id
        ORDER BY lifetime_wins DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])

      const countRes = await db.query(`
        SELECT COUNT(DISTINCT winner_bot_id) as count FROM bot_learning_sessions
      `)

      return reply.send({
        bots: res.rows.map((row: any) => ({
          bot_id: row.bot_id?.toString() || '',
          name: `Bot ${row.bot_id?.toString().slice(0, 8) || ''}`,
          lifetime_wins: parseInt(row.lifetime_wins || 0),
          win_rate: parseFloat(row.win_rate || 0),
          vs_rp_win_rate: parseFloat(row.vs_rp_win_rate || 0),
          last_10_games: [],
        })),
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
      return reply.send(config)
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
        botId: queryParams.botId ? BigInt(queryParams.botId as string) : undefined,
        success: queryParams.success ? queryParams.success === 'true' : undefined,
      }

      const result = await botTrainingSessionsRepo.getSessions(query)
      return reply.send(result)
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch bot training sessions')
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
