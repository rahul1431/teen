import 'dotenv/config'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { Pool } from 'pg'
import pino from 'pino'
import cron from 'node-cron'
import { RummyTrainer, GAME_TYPE, DIFFICULTIES } from './trainer'

export { RummyTrainer }

const logger = pino()

async function start() {
  const app = Fastify({ logger: true })

  const authenticateInternal = async (req: any, reply: any) => {
    const key = req.headers['x-internal-key']
    const expected = process.env.INTERNAL_SERVICE_KEY
    if (!expected || key !== expected) return reply.code(403).send({ error: 'Forbidden' })
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
  if (redis.status === 'wait') await redis.connect()

  const trainer = new RummyTrainer(pool, redis, logger)

  // Nightly rebuild at 2 AM IST
  const cfg = await trainer.getConfig().catch(() => ({ rebuild_hour: 2 }))
  cron.schedule(
    `0 ${cfg.rebuild_hour} * * *`,
    () => { trainer.runRebuild().catch(err => logger.error({ err }, 'Nightly rebuild failed')) },
    { timezone: 'Asia/Kolkata' }
  )
  logger.info({ hour: cfg.rebuild_hour }, 'Rummy bot rebuild cron scheduled (IST)')

  app.get('/health', async () => ({ status: 'ok', service: 'rummy-bot-training', game: GAME_TYPE }))

  app.get<{ Querystring: { difficulty?: string } }>(
    '/api/bot/profile',
    { onRequest: [authenticateInternal] },
    async (request, reply) => {
      const difficulty = request.query.difficulty
      if (!difficulty || !DIFFICULTIES.includes(difficulty as any)) {
        return reply.code(400).send({ success: false, error: 'difficulty must be easy, medium, or hard' })
      }
      const profile = await trainer.getProfile(difficulty as any)
      if (!profile) return reply.code(404).send({ success: false, error: 'Profile not found' })
      return reply.send({ success: true, data: profile })
    }
  )

  app.get('/api/bot/profiles', { onRequest: [authenticateInternal] }, async (_req, reply) =>
    reply.send({ success: true, data: await trainer.getProfiles() })
  )

  app.patch<{ Params: { difficulty: string }; Body: Record<string, any> }>(
    '/api/bot/profiles/:difficulty',
    { onRequest: [authenticateInternal] },
    async (request, reply) => {
      if (!DIFFICULTIES.includes(request.params.difficulty as any)) {
        return reply.code(400).send({ success: false, error: 'Unknown difficulty' })
      }
      try {
        await trainer.overrideProfile(request.params.difficulty as any, request.body)
        return reply.send({ success: true, data: await trainer.getProfile(request.params.difficulty as any) })
      } catch (err) {
        logger.error({ err }, 'Profile override failed')
        return reply.code(500).send({ success: false, error: 'Override failed' })
      }
    }
  )

  app.get('/api/bot/config', { onRequest: [authenticateInternal] }, async (_req, reply) =>
    reply.send({ success: true, data: await trainer.getConfig() })
  )

  app.patch<{ Body: Record<string, string> }>(
    '/api/bot/config',
    { onRequest: [authenticateInternal] },
    async (request, reply) => {
      try {
        await trainer.updateConfig(request.body)
        return reply.send({ success: true, data: await trainer.getConfig() })
      } catch (err) {
        logger.error({ err }, 'Config update failed')
        return reply.code(500).send({ success: false, error: 'Update failed' })
      }
    }
  )

  // Behavioral Cloning: Imitation Learning from Top 5% Human Winners
  app.post<{ Body: { topPercentile?: number; applyUpdates?: boolean } }>(
    '/internal/bot/clone-elite-humans',
    { onRequest: [authenticateInternal] },
    async (request, reply) => {
      const topPercentile = request.body?.topPercentile ? parseFloat(String(request.body.topPercentile)) : 5
      const applyUpdates = request.body?.applyUpdates !== false
      try {
        const result = await trainer.runBehavioralCloning(topPercentile, applyUpdates)
        return reply.send({ success: true, data: result })
      } catch (err) {
        logger.error({ err }, 'Rummy behavioral cloning failed')
        return reply.code(500).send({ success: false, error: (err as Error).message })
      }
    }
  )

  app.post<{ Body: { games?: number; applyUpdates?: boolean } }>(
    '/internal/bot/train-self-play',
    { onRequest: [authenticateInternal] },
    async (request, reply) => {
      const games = request.body?.games ? parseInt(String(request.body.games), 10) : 100
      const applyUpdates = request.body?.applyUpdates !== false
      try {
        const result = await trainer.runSelfPlayTraining(games, applyUpdates, 'admin_api')
        return reply.send({ success: true, data: result })
      } catch (err) {
        logger.error({ err }, 'Rummy self-play training failed')
        return reply.code(500).send({ success: false, error: (err as Error).message })
      }
    }
  )

  app.post('/api/bot/rebuild', { onRequest: [authenticateInternal] }, async (_req, reply) => {
    try {
      const result = await trainer.runRebuild()
      return reply.send({ success: true, data: result })
    } catch (err) {
      logger.error({ err }, 'Manual rebuild failed')
      return reply.code(500).send({ success: false, error: 'Rebuild failed' })
    }
  })

  const port = parseInt(process.env.PORT || '3025', 10)
  await app.listen({ port, host: '0.0.0.0' })
  logger.info({ port }, 'Rummy Bot Training service listening')
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start Rummy Bot Training service')
  process.exit(1)
})
