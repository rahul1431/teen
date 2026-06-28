import 'dotenv/config'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { Pool } from 'pg'
import pino from 'pino'
import cron from 'node-cron'
import { ChurnScorer } from './churn-scorer'

const logger = pino()

async function start() {
  const app = Fastify({ logger: true })

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
  if (redis.status === 'wait') await redis.connect()

  const scorer = new ChurnScorer(pool, redis, logger, {
    notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3007',
    walletServiceUrl: process.env.WALLET_SERVICE_URL || 'http://localhost:3002',
  })

  // Hourly cron (runs at minute 0 of every hour)
  const cfg = await scorer.getConfig().catch(() => ({ cron_interval_minutes: 60 })) as any
  const cronExpr = `0 */${Math.max(1, Math.floor((cfg.cron_interval_minutes ?? 60) / 60))} * * *`
  cron.schedule(cronExpr, () => {
    scorer.runScoringCycle().catch(err => logger.error({ err }, 'Cron scoring failed'))
  })
  logger.info({ cronExpr }, 'Churn scoring cron scheduled')

  // Health
  app.get('/health', async (_req, reply) => {
    return reply.send({ success: true, data: { status: 'ok', service: 'churn-service', timestamp: new Date().toISOString() } })
  })

  // GET /api/churn/users
  app.get<{ Querystring: { risk_level?: string; limit?: string; offset?: string } }>(
    '/api/churn/users',
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit ?? '50'), 200)
        const offset = parseInt(request.query.offset ?? '0')
        const riskLevel = request.query.risk_level

        const validLevels = ['low', 'medium', 'high']
        const params: any[] = []
        let where = ''
        if (riskLevel && validLevels.includes(riskLevel)) {
          where = 'WHERE ucs.risk_level = $1'
          params.push(riskLevel)
        }

        const res = await pool.query(
          `SELECT
             u.id, u.username, u.phone,
             ucs.score, ucs.risk_level, ucs.days_since_deposit,
             ucs.last_deposit_at, ucs.action_taken, ucs.action_taken_at, ucs.updated_at
           FROM user_churn_scores ucs
           JOIN users u ON u.id = ucs.user_id
           ${where}
           ORDER BY ucs.score DESC
           LIMIT ${limit} OFFSET ${offset}`,
          params
        )
        return reply.send({ success: true, data: { users: res.rows, count: res.rows.length } })
      } catch (err) {
        logger.error({ err }, 'Failed to fetch churn users')
        return reply.code(500).send({ success: false, error: 'Failed to fetch churn users' })
      }
    }
  )

  // GET /api/churn/stats
  app.get('/api/churn/stats', async (_req, reply) => {
    try {
      const stats = await scorer.getStats()
      return reply.send({ success: true, data: stats })
    } catch (err) {
      logger.error({ err }, 'Failed to fetch churn stats')
      return reply.code(500).send({ success: false, error: 'Failed to fetch churn stats' })
    }
  })

  // POST /api/churn/re-engage/:userId
  app.post<{
    Params: { userId: string }
    Body: { send_bonus?: boolean; send_notification?: boolean }
  }>('/api/churn/re-engage/:userId', async (request, reply) => {
    try {
      const { send_bonus = false, send_notification = true } = request.body ?? {}
      await scorer.reEngageUser(request.params.userId, send_bonus, send_notification)
      return reply.send({ success: true, data: { userId: request.params.userId, message: 'Re-engagement triggered' } })
    } catch (err) {
      logger.error({ err }, 'Failed to re-engage user')
      return reply.code(500).send({ success: false, error: 'Failed to re-engage user' })
    }
  })

  // GET /api/churn/config
  app.get('/api/churn/config', async (_req, reply) => {
    try {
      const config = await scorer.getConfig()
      return reply.send({ success: true, data: config })
    } catch (err) {
      logger.error({ err }, 'Failed to fetch churn config')
      return reply.code(500).send({ success: false, error: 'Failed to fetch churn config' })
    }
  })

  // PATCH /api/churn/config
  app.patch<{ Body: Record<string, string> }>('/api/churn/config', async (request, reply) => {
    try {
      await scorer.updateConfig(request.body)
      const updated = await scorer.getConfig()
      return reply.send({ success: true, data: updated })
    } catch (err) {
      logger.error({ err }, 'Failed to update churn config')
      return reply.code(500).send({ success: false, error: 'Failed to update churn config' })
    }
  })

  const port = parseInt(process.env.PORT ?? '3013')
  await app.listen({ port, host: '0.0.0.0' })
  logger.info(`Churn service started on :${port}`)

  // Run first cycle on startup (non-blocking)
  scorer.runScoringCycle().catch(err => logger.error({ err }, 'Initial scoring cycle failed'))

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
