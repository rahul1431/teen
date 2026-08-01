import 'dotenv/config'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { Pool } from 'pg'
import pino from 'pino'
import cron from 'node-cron'
import { LudoTrainer, GAME_TYPE, DIFFICULTIES } from './trainer'

export { LudoTrainer }

const logger = pino()

async function start() {
  const app = Fastify({ logger: true })

  // Every route here drives real-money bot behaviour or triggers a full
  // rebuild, so it mirrors wallet-service/risk-service's INTERNAL_SERVICE_KEY
  // check rather than trusting anything that can reach the port.
  const authenticateInternal = async (req: any, reply: any) => {
    const key = req.headers['x-internal-key']
    const expected = process.env.INTERNAL_SERVICE_KEY
    if (!expected || key !== expected) return reply.code(403).send({ error: 'Forbidden' })
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
  if (redis.status === 'wait') await redis.connect()

  const trainer = new LudoTrainer(pool, redis, logger)

  // Explicit IST: the VPS clock is UTC, so an unqualified "2 AM" would fire at
  // 07:30 IST, during the day's first traffic rather than the quiet window.
  const cfg = await trainer.getConfig().catch(() => ({ rebuild_hour: 2 }))
  cron.schedule(
    `0 ${cfg.rebuild_hour} * * *`,
    () => { trainer.runRebuild().catch(err => logger.error({ err }, 'Nightly rebuild failed')) },
    { timezone: 'Asia/Kolkata' }
  )
  logger.info({ hour: cfg.rebuild_hour }, 'Ludo bot rebuild cron scheduled (IST)')

  app.get('/health', async () => ({ status: 'ok', service: 'ludo-bot-training', game: GAME_TYPE }))

  // GET /api/bot/profile?difficulty=medium — the Ludo engine's hot path.
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

  app.patch<{ Params: { difficulty: string }; Body: Record<string, number | null> }>(
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
        return reply.code(400).send({ success: false, error: (err as Error).message })
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

  // Training-readiness for the admin panel: how many human decisions have been
  // logged, and whether that clears the configured threshold.
  app.get('/api/bot/training-status', { onRequest: [authenticateInternal] }, async (_req, reply) => {
    const trainingCfg = await trainer.getConfig()
    const res = await pool.query(
      `SELECT COUNT(*)::int AS decisions,
              COUNT(DISTINCT user_id)::int AS players
       FROM ludo_move_decisions
       WHERE created_at > NOW() - INTERVAL '${parseInt(String(trainingCfg.stream_lookback_days), 10)} days'`
    )
    const row = res.rows[0]
    return reply.send({
      success: true,
      data: {
        decisions_logged: row.decisions,
        distinct_players: row.players,
        min_sample_size: trainingCfg.min_sample_size,
        training_ready: row.players >= trainingCfg.min_sample_size,
      },
    })
  })

  app.post('/internal/bot/rebuild', { onRequest: [authenticateInternal] }, async (_req, reply) => {
    trainer.runRebuild().catch(err => logger.error({ err }, 'Manual rebuild failed'))
    return reply.send({ success: true, data: { status: 'started', game_type: GAME_TYPE } })
  })

  // Loopback-only: defence in depth on top of the x-internal-key check.
  const port = parseInt(process.env.PORT ?? '3024')
  await app.listen({ port, host: '127.0.0.1' })
  logger.info(`Ludo bot training service started on :${port}`)

  const shutdown = async () => {
    logger.info('Shutting down Ludo bot training service')
    await app.close()
    await redis.quit()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch(err => { logger.error(err); process.exit(1) })
