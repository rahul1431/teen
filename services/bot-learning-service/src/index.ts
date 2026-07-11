import 'dotenv/config'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { Pool } from 'pg'
import pino from 'pino'
import cron from 'node-cron'
import { ProfileBuilder } from './profile-builder'
import { AuditLogger } from './audit-logger'
import { DriftDetector } from './drift-detector'
import { SlackNotifier } from './slack-notifier'
import { MetricsAggregator } from './metrics-aggregator'
import { AdaptiveThresholds } from './adaptive-thresholds'

export { ProfileBuilder, AuditLogger, DriftDetector, SlackNotifier, MetricsAggregator, AdaptiveThresholds }

const logger = pino()

async function start() {
  const app = Fastify({ logger: true })

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
  if (redis.status === 'wait') await redis.connect()

  const auditLogger = new AuditLogger(pool, logger)
  const builder = new ProfileBuilder(pool, redis, logger, undefined, auditLogger)
  const slackNotifier = new SlackNotifier(logger)
  const driftDetector = new DriftDetector(pool, redis, logger, slackNotifier)
  const metricsAggregator = new MetricsAggregator(pool, logger)
  const adaptiveThresholds = new AdaptiveThresholds(pool, redis, logger)

  // Schedule nightly rebuild at 2 AM (or configured hour)
  const cfg = await builder.getConfig().catch(() => ({ rebuild_hour: 2 }))
  cron.schedule(`0 ${cfg.rebuild_hour} * * *`, () => {
    builder.runRebuild().catch(err => logger.error({ err }, 'Nightly rebuild failed'))
  })
  logger.info({ hour: cfg.rebuild_hour }, 'Bot profile rebuild cron scheduled')

  // Schedule cohort target recalculation at 02:15 UTC (15 mins after nightly rebuild at 02:00)
  cron.schedule('15 2 * * *', () => {
    adaptiveThresholds.recalculateCohortTargetsDaily().catch(err => logger.error({ err }, 'Cohort target recalculation failed'))
  })
  logger.info('Cohort target recalculation cron scheduled (daily at 02:15 UTC)')

  // Schedule 6-hourly incremental rebuild at 00:00, 06:00, 12:00, 18:00 UTC
  cron.schedule('0 0,6,12,18 * * *', () => {
    (async () => {
      try {
        logger.info('Starting 6-hourly incremental profile rebuild')
        for (const gameType of ['teen_patti', 'ludo', 'aviator']) {
          for (const difficulty of ['easy', 'medium', 'hard']) {
            try {
              await builder.rebuildProfilesIncremental(gameType, difficulty)
            } catch (err) {
              logger.error({ err, gameType, difficulty }, 'Incremental rebuild failed for profile')
            }
          }
        }
        logger.info('6-hourly incremental rebuild batch complete')
      } catch (err) {
        logger.error({ err }, '6-hourly incremental rebuild batch failed')
      }
    })()
  })
  logger.info('6-hourly incremental profile rebuild cron scheduled (at 00:00, 06:00, 12:00, 18:00 UTC)')

  // Schedule hourly metrics aggregation at :00
  cron.schedule('0 * * * *', () => {
    metricsAggregator.aggregateHourlyMetrics().catch(err => logger.error({ err }, 'Hourly metrics aggregation failed'))
  })
  logger.info('Hourly metrics aggregation cron scheduled (every hour at :00)')

  // Schedule hourly drift detection at :05 (after Task 10 aggregation completes at :00)
  cron.schedule('5 * * * *', () => {
    driftDetector.run().catch(err => logger.error({ err }, 'Drift detection failed'))
  })
  logger.info('Drift detection cron scheduled (hourly at :05)')

  // Health
  app.get('/health', async (_req, reply) => {
    return reply.send({ success: true, data: { status: 'ok', service: 'bot-learning-service', timestamp: new Date().toISOString() } })
  })

  // GET /api/bots/profile?game_type=&difficulty=
  app.get<{ Querystring: { game_type?: string; difficulty?: string } }>(
    '/api/bots/profile',
    async (request, reply) => {
      const { game_type, difficulty } = request.query
      if (!game_type || !difficulty) {
        return reply.code(400).send({ success: false, error: 'game_type and difficulty are required' })
      }
      try {
        const profile = await builder.getProfile(game_type, difficulty)
        if (!profile) return reply.code(404).send({ success: false, error: 'Profile not found' })
        return reply.send({ success: true, data: profile })
      } catch (err) {
        logger.error({ err }, 'Failed to fetch bot profile')
        return reply.code(500).send({ success: false, error: 'Failed to fetch bot profile' })
      }
    }
  )

  // GET /api/bots/profiles
  app.get('/api/bots/profiles', async (_req, reply) => {
    try {
      const profiles = await builder.getProfiles()
      return reply.send({ success: true, data: { profiles, count: profiles.length } })
    } catch (err) {
      logger.error({ err }, 'Failed to fetch profiles')
      return reply.code(500).send({ success: false, error: 'Failed to fetch profiles' })
    }
  })

  // POST /api/bots/rebuild
  app.post('/api/bots/rebuild', async (_req, reply) => {
    // Non-blocking: start rebuild in background, return immediately
    builder.runRebuild().catch(err => logger.error({ err }, 'Manual rebuild failed'))
    return reply.send({ success: true, data: { status: 'started', game_types: ['teen_patti', 'ludo', 'aviator'] } })
  })

  // GET /api/bots/config
  app.get('/api/bots/config', async (_req, reply) => {
    try {
      const config = await builder.getConfig()
      return reply.send({ success: true, data: config })
    } catch (err) {
      logger.error({ err }, 'Failed to fetch bot config')
      return reply.code(500).send({ success: false, error: 'Failed to fetch bot config' })
    }
  })

  // PATCH /api/bots/config
  app.patch<{ Body: Record<string, string> }>('/api/bots/config', async (request, reply) => {
    try {
      await builder.updateConfig(request.body)
      const updated = await builder.getConfig()
      return reply.send({ success: true, data: updated })
    } catch (err) {
      logger.error({ err }, 'Failed to update bot config')
      return reply.code(500).send({ success: false, error: 'Failed to update bot config' })
    }
  })

  // PATCH /api/bots/profiles/:gameType/:difficulty
  app.patch<{
    Params: { gameType: string; difficulty: string }
    Body: Record<string, number>
  }>('/api/bots/profiles/:gameType/:difficulty', async (request, reply) => {
    try {
      await builder.overrideProfile(request.params.gameType, request.params.difficulty, request.body)
      const profile = await builder.getProfile(request.params.gameType, request.params.difficulty)
      return reply.send({ success: true, data: profile })
    } catch (err) {
      logger.error({ err }, 'Failed to override bot profile')
      return reply.code(500).send({ success: false, error: 'Failed to override profile' })
    }
  })

  // POST /internal/metrics/aggregate (called by cron or admin)
  app.post('/internal/metrics/aggregate', async (_req, reply) => {
    try {
      const results = await metricsAggregator.aggregateHourlyMetrics()
      return reply.send({
        success: true,
        data: {
          status: 'completed',
          metricsInserted: results.length,
          timestamp: new Date().toISOString(),
        },
      })
    } catch (err) {
      logger.error({ err }, 'Metrics aggregation endpoint failed')
      return reply.code(500).send({ success: false, error: 'Metrics aggregation failed' })
    }
  })

  const port = parseInt(process.env.PORT ?? '3014')
  await app.listen({ port, host: '0.0.0.0' })
  logger.info(`Bot learning service started on :${port}`)

  // Run initial rebuild on startup (non-blocking)
  builder.runRebuild().catch(err => logger.error({ err }, 'Initial rebuild failed'))

  const shutdown = async () => {
    await app.close()
    await redis.quit()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch(err => { logger.error(err); process.exit(1) })
