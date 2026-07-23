import { FastifyInstance } from 'fastify'
import { BotTrainingConfigRepository } from '../repositories/botTrainingConfigRepository'
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
}
