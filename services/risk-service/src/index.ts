import Fastify from 'fastify'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { Logger } from 'pino'
import pino from 'pino'
import dotenv from 'dotenv'
import { FraudDetector, FraudEvent } from './fraud-detector'

dotenv.config()

const logger = pino()

async function start() {
  const app = Fastify({
    logger: true,
  })

  // Initialize connections
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  })

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const fraudDetector = new FraudDetector(redis, pool, logger, {
    coLocationThreshold: parseInt(process.env.FRAUD_CO_LOCATION_THRESHOLD || '3'),
    winRateAnomalyThreshold: parseFloat(process.env.FRAUD_WIN_RATE_THRESHOLD || '95'),
    velocityLimitHours: parseInt(process.env.FRAUD_VELOCITY_HOURS || '1'),
    referralChainDepth: parseInt(process.env.FRAUD_REFERRAL_DEPTH || '2'),
    enabled: process.env.FRAUD_DETECTION_ENABLED !== 'false',
  })

  // Health check endpoint
  app.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'risk-service',
      timestamp: new Date().toISOString(),
    })
  })

  // Get recent fraud alerts
  app.get<{ Querystring: { limit?: string; action?: string } }>(
    '/api/risk/alerts',
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit || '50'), 500)
        const action = request.query.action

        let query = `
          SELECT id, user_id, game_type, rule_triggered, fraud_score, confidence,
                 evidence, action, created_at
          FROM fraud_events
          WHERE created_at > NOW() - INTERVAL '24 hours'
        `
        const params: any[] = []

        if (action && ['allow', 'slow_lane', 'block'].includes(action)) {
          query += ` AND action = $${params.length + 1}`
          params.push(action)
        }

        query += ` ORDER BY fraud_score DESC, created_at DESC LIMIT $${params.length + 1}`
        params.push(limit)

        const result = await pool.query(query, params)

        return reply.send({
          success: true,
          data: {
            alerts: result.rows,
            count: result.rows.length,
            total: result.rows.length,
            timestamp: new Date().toISOString(),
          },
        })
      } catch (err) {
        logger.error({ err }, 'Failed to fetch fraud alerts')
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch fraud alerts',
        })
      }
    }
  )

  // Get fraud history for a user
  app.get<{ Params: { userId: string }; Querystring: { limit?: string } }>(
    '/api/risk/user/:userId/history',
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit || '50'), 500)
        const history = await fraudDetector.getUserFraudHistory(
          request.params.userId,
          limit
        )

        return reply.send({
          success: true,
          data: {
            userId: request.params.userId,
            events: history,
            count: history.length,
          },
        })
      } catch (err) {
        logger.error({ err }, 'Failed to fetch user fraud history')
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch user fraud history',
        })
      }
    }
  )

  // Get fraud statistics
  app.get<{ Querystring: { hours?: string } }>('/api/risk/stats', async (request, reply) => {
    try {
      const hours = Math.min(parseInt(request.query.hours || '24'), 168)

      const result = await pool.query(
        `SELECT
           COUNT(*) as total_alerts,
           COUNT(CASE WHEN action = 'block' THEN 1 END) as blocks,
           COUNT(CASE WHEN action = 'slow_lane' THEN 1 END) as slow_lanes,
           AVG(fraud_score) as avg_score,
           MAX(fraud_score) as max_score,
           COUNT(DISTINCT user_id) as unique_users,
           COUNT(DISTINCT rule_triggered) as rules_triggered
         FROM fraud_events
         WHERE created_at > NOW() - INTERVAL '${hours} hours'`,
        []
      )

      const stats = result.rows[0]

      return reply.send({
        success: true,
        data: {
          timeWindow: `${hours} hours`,
          stats: {
            totalAlerts: parseInt(stats.total_alerts || '0'),
            blocks: parseInt(stats.blocks || '0'),
            slowLanes: parseInt(stats.slow_lanes || '0'),
            avgScore: parseFloat(stats.avg_score || '0').toFixed(2),
            maxScore: parseFloat(stats.max_score || '0').toFixed(2),
            uniqueUsers: parseInt(stats.unique_users || '0'),
            rulesTriggered: parseInt(stats.rules_triggered || '0'),
          },
          timestamp: new Date().toISOString(),
        },
      })
    } catch (err) {
      logger.error({ err }, 'Failed to fetch fraud statistics')
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch fraud statistics',
      })
    }
  })

  // Manually flag a user (requires admin)
  app.post<{ Params: { userId: string }; Body: { isFlagged: boolean; reason: string } }>(
    '/api/risk/user/:userId/flag',
    {
      onRequest: [
        async (req, reply) => {
          const key = req.headers['x-internal-key']
          const expected = process.env.INTERNAL_SERVICE_KEY
          if (!expected || key !== expected) {
            return reply.code(403).send({ error: 'Forbidden' })
          }
        }
      ]
    },
    async (request, reply) => {
      try {
        const { isFlagged, reason } = request.body

        await fraudDetector.setUserFlag(request.params.userId, isFlagged, reason)

        return reply.send({
          success: true,
          data: {
            userId: request.params.userId,
            flagged: isFlagged,
            message: `User ${isFlagged ? 'flagged' : 'unflagged'} successfully`,
          },
        })
      } catch (err) {
        logger.error({ err }, 'Failed to set user flag')
        return reply.code(500).send({
          success: false,
          error: 'Failed to set user flag',
        })
      }
    }
  )

  // Subscribe to monitoring service events via Redis Streams
  const processEvents = async () => {
    let lastId = '$' // Start from new events

    try {
      while (true) {
        const events = await redis.xread(
          'COUNT',
          '10',
          'BLOCK',
          '1000', // 1 second timeout
          'STREAMS',
          'events:all',
          lastId
        )

        if (!events || events.length === 0) continue

        const [stream, messages] = events[0]

        for (const [id, fields] of messages) {
          try {
            // Parse the event data
            const eventData = fields.reduce((acc: any, val: string, idx: number) => {
              if (idx % 2 === 0) {
                acc[val] = fields[idx + 1]
              }
              return acc
            }, {})

            // Parse JSON fields
            if (eventData.data) {
              const event = JSON.parse(eventData.data)

              // Analyze event for fraud
              const fraudEvent = await fraudDetector.analyzeGameEvent(event)

              if (fraudEvent) {
                // Publish alert to admin channels
                await redis.publish('fraud:alerts', JSON.stringify(fraudEvent))

                logger.info(
                  {
                    userId: fraudEvent.user_id,
                    score: fraudEvent.fraud_score,
                    action: fraudEvent.action,
                  },
                  'Fraud event detected'
                )
              }
            }

            lastId = id
          } catch (err) {
            logger.error({ err }, 'Failed to process event')
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Event processing error')
      // Retry after delay
      setTimeout(processEvents, 5000)
    }
  }

  // Start event processing in background
  processEvents().catch((err) => logger.error({ err }, 'Event processor failed'))

  // Subscribe to configuration changes
  const redisSubscriber = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  })

  redisSubscriber.on('message', async (channel, message) => {
    if (channel === 'ml:config:change') {
      try {
        const config = JSON.parse(message)
        if (config.fraudDetection) {
          logger.info({ config: config.fraudDetection }, 'Fraud config updated')
          // Config is automatically used next time fraudDetector methods are called
        }
      } catch (err) {
        logger.error({ err }, 'Failed to parse config message')
      }
    }
  })

  await redisSubscriber.subscribe('ml:config:change')

  // Start server
  const port = parseInt(process.env.PORT || '3006')
  const host = process.env.HOST || '0.0.0.0'

  try {
    await app.listen({ port, host })
    logger.info(`Risk service started on ${host}:${port}`)
  } catch (err) {
    logger.error(err)
    process.exit(1)
  }

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM']
  signals.forEach((signal) => {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down...`)
      await app.close()
      await redis.quit()
      await redisSubscriber.quit()
      await pool.end()
      process.exit(0)
    })
  })
}

start().catch((err) => {
  logger.error(err)
  process.exit(1)
})
