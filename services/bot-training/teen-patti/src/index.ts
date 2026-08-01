import 'dotenv/config'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { Pool } from 'pg'
import pino from 'pino'
import cron from 'node-cron'
import { TeenPattiTrainer, GAME_TYPE, DIFFICULTIES } from './trainer'

export { TeenPattiTrainer }

const logger = pino()

async function start() {
  const app = Fastify({ logger: true })

  // Every route here drives real-money bot behaviour (win-rate targets,
  // fold/call/raise probabilities) or triggers a full rebuild, so it mirrors
  // wallet-service/risk-service's INTERNAL_SERVICE_KEY check rather than
  // trusting anything that can reach the port.
  const authenticateInternal = async (req: any, reply: any) => {
    const key = req.headers['x-internal-key']
    const expected = process.env.INTERNAL_SERVICE_KEY
    if (!expected || key !== expected) return reply.code(403).send({ error: 'Forbidden' })
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
  if (redis.status === 'wait') await redis.connect()

  const trainer = new TeenPattiTrainer(pool, redis, logger)

  // Nightly rebuild. The timezone is explicit and deliberate: the VPS clock is
  // UTC, so an unqualified "2 AM" would fire at 07:30 IST, in the middle of the
  // day's first traffic rather than the quiet window.
  const cfg = await trainer.getConfig().catch(() => ({ rebuild_hour: 2 }))
  cron.schedule(
    `0 ${cfg.rebuild_hour} * * *`,
    () => { trainer.runRebuild().catch(err => logger.error({ err }, 'Nightly rebuild failed')) },
    { timezone: 'Asia/Kolkata' }
  )
  logger.info({ hour: cfg.rebuild_hour }, 'Teen Patti bot rebuild cron scheduled (IST)')

  app.get('/health', async () => ({ status: 'ok', service: 'teen-patti-bot-training', game: GAME_TYPE }))

  // GET /api/bot/profile?difficulty=medium — the gateway's hot path.
  app.get<{ Querystring: { difficulty?: string } }>(
    '/api/bot/profile',
    { onRequest: [authenticateInternal] },
    async (request, reply) => {
      const difficulty = request.query.difficulty
      if (!difficulty || !DIFFICULTIES.includes(difficulty as any)) {
        return reply.code(400).send({ success: false, error: 'difficulty must be easy, medium, or hard' })
      }
      const profile = await trainer.getProfile(difficulty)
      if (!profile) return reply.code(404).send({ success: false, error: 'Profile not found' })
      return reply.send({ success: true, data: profile })
    }
  )

  app.get('/api/bot/profiles', { onRequest: [authenticateInternal] }, async (_req, reply) =>
    reply.send({ success: true, data: await trainer.getProfiles() })
  )

  app.patch<{ Params: { difficulty: string }; Body: Record<string, number> }>(
    '/api/bot/profiles/:difficulty',
    { onRequest: [authenticateInternal] },
    async (request, reply) => {
      if (!DIFFICULTIES.includes(request.params.difficulty as any)) {
        return reply.code(400).send({ success: false, error: 'Unknown difficulty' })
      }
      try {
        await trainer.overrideProfile(request.params.difficulty, request.body)
        return reply.send({ success: true, data: await trainer.getProfile(request.params.difficulty) })
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
        return reply.code(400).send({ success: false, error: (err as Error).message })
      }
    }
  )

  // Rebuilds can take tens of seconds on a large history; kick off and return
  // rather than holding the admin request open.
  app.post('/internal/bot/rebuild', { onRequest: [authenticateInternal] }, async (_req, reply) => {
    trainer.runRebuild().catch(err => logger.error({ err }, 'Manual rebuild failed'))
    return reply.send({ success: true, data: { status: 'started', game_type: GAME_TYPE } })
  })

  // Loopback-only: no legitimate caller reaches this from off-host. Defence in
  // depth on top of the x-internal-key check.
  const port = parseInt(process.env.PORT ?? '3023')
  await app.listen({ port, host: '127.0.0.1' })
  logger.info(`Teen Patti bot training service started on :${port}`)

  const shutdown = async () => {
    logger.info('Shutting down Teen Patti bot training service')
    await app.close()
    await redis.quit()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch(err => { logger.error(err); process.exit(1) })
