import 'dotenv/config'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { Pool } from 'pg'
import pino from 'pino'
import cron from 'node-cron'
import axios from 'axios'
import { ChurnScorer, ChurnConfig } from './churn-scorer'

const logger = pino()

const CHURN_ML_SERVICE_URL = process.env.CHURN_ML_SERVICE_URL || 'http://127.0.0.1:3020'

// admin-service's ml:config `churnPrediction.retrainFrequency` — translates the
// admin-facing daily/weekly/monthly choice into a cron expression. Unrecognized
// values fall back to daily rather than leaving the model never retraining.
function retrainCronExpr(frequency: string | undefined): string {
  if (frequency === 'weekly') return '0 3 * * 0'   // Sundays 03:00
  if (frequency === 'monthly') return '0 3 1 * *'  // 1st of month 03:00
  return '0 3 * * *'                                 // daily 03:00
}

async function start() {
  const app = Fastify({ logger: true })

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
  if (redis.status === 'wait') await redis.connect()

  const scorer = new ChurnScorer(pool, redis, logger, {
    notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3001',
    walletServiceUrl: process.env.WALLET_SERVICE_URL || 'http://localhost:3002',
  })

  // Hourly cron (runs at minute 0 of every hour)
  // I2: cfg is now fully typed — no `as any` needed since ChurnConfig includes cron_interval_minutes
  const cfg = await scorer.getConfig().catch((): ChurnConfig => ({
    cron_interval_minutes: 60,
    low_threshold_days: 3,
    medium_threshold_days: 7,
    high_threshold_days: 14,
    high_bonus_amount: 50,
    action_cooldown_days: 7,
    grace_period_days: 3,
  }))
  const cronExpr = `0 */${Math.max(1, Math.floor(cfg.cron_interval_minutes / 60))} * * *`
  cron.schedule(cronExpr, () => {
    scorer.runScoringCycle().catch(err => logger.error({ err }, 'Cron scoring failed'))
  })
  logger.info({ cronExpr }, 'Churn scoring cron scheduled')

  // Retrain scheduler: reads churnPrediction from admin-service's ml:config
  // (Redis key, POST /api/admin/ml/config) and calls churn-ml-service's /train
  // on the admin-configured cadence — previously nothing did this at all, see
  // docs/Bugs/ai-control-center-churn-prediction-config-unused.md.
  let currentRetrainFrequency = 'daily'
  let currentDaysSinceLastPlay = 7
  try {
    const raw = await redis.get('ml:config')
    const churnPrediction = raw ? JSON.parse(raw)?.churnPrediction : null
    if (churnPrediction?.retrainFrequency) currentRetrainFrequency = churnPrediction.retrainFrequency
    if (typeof churnPrediction?.daysSinceLastPlay === 'number') currentDaysSinceLastPlay = churnPrediction.daysSinceLastPlay
  } catch (err) {
    logger.warn({ err }, 'Failed to read ml:config for retrain scheduling — defaulting to daily/7')
  }

  const triggerRetrain = () => {
    axios.post(`${CHURN_ML_SERVICE_URL}/train`, null, { params: { days_since_last_play: currentDaysSinceLastPlay }, timeout: 120_000 })
      .then(res => logger.info({ result: res.data }, 'Scheduled churn model retrain completed'))
      .catch(err => logger.error({ err: err.message }, 'Scheduled churn model retrain failed'))
  }

  let retrainTask = cron.schedule(retrainCronExpr(currentRetrainFrequency), triggerRetrain)
  logger.info({ cronExpr: retrainCronExpr(currentRetrainFrequency), currentDaysSinceLastPlay }, 'Churn model retrain cron scheduled')

  // React to admin panel saves (POST /api/admin/ml/config publishes here) without
  // needing a restart — a separate connection because ioredis can't issue normal
  // commands on a connection that's in subscribe mode.
  const mlConfigSubscriber = new Redis(process.env.REDIS_URL!)
  mlConfigSubscriber.on('message', (channel, message) => {
    if (channel !== 'ml:config:change') return
    try {
      const churnPrediction = JSON.parse(message)?.churnPrediction
      if (!churnPrediction) return
      if (typeof churnPrediction.daysSinceLastPlay === 'number') currentDaysSinceLastPlay = churnPrediction.daysSinceLastPlay
      if (churnPrediction.retrainFrequency && churnPrediction.retrainFrequency !== currentRetrainFrequency) {
        currentRetrainFrequency = churnPrediction.retrainFrequency
        retrainTask.stop()
        retrainTask = cron.schedule(retrainCronExpr(currentRetrainFrequency), triggerRetrain)
        logger.info({ cronExpr: retrainCronExpr(currentRetrainFrequency) }, 'Churn model retrain cron rescheduled')
      }
    } catch (err) {
      logger.error({ err }, 'Failed to parse ml:config:change message')
    }
  })
  await mlConfigSubscriber.subscribe('ml:config:change')

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
    await mlConfigSubscriber.quit()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch(err => { logger.error(err); process.exit(1) })
