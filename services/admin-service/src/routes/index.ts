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
