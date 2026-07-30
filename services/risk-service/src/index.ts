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

  const envConfig = {
    coLocationThreshold: parseInt(process.env.FRAUD_CO_LOCATION_THRESHOLD || '3'),
    winRateAnomalyThreshold: parseFloat(process.env.FRAUD_WIN_RATE_THRESHOLD || '95'),
    velocityLimitHours: parseInt(process.env.FRAUD_VELOCITY_HOURS || '1'),
    referralChainDepth: parseInt(process.env.FRAUD_REFERRAL_DEPTH || '2'),
    enabled: process.env.FRAUD_DETECTION_ENABLED !== 'false',
  }

  // Admin-saved thresholds (via the ML Configuration panel, `ml:config` key
  // in Redis) take precedence over the `.env` defaults at boot, so a value
  // saved before this process last restarted isn't silently reverted.
  let initialConfig = envConfig
  try {
    const cached = await redis.get('ml:config')
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.fraudDetection) {
        initialConfig = { ...envConfig, ...parsed.fraudDetection }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to read initial ml:config from Redis — falling back to env')
  }

  const fraudDetector = new FraudDetector(redis, pool, logger, initialConfig)

  // Health check endpoint
  app.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'risk-service',
      timestamp: new Date().toISOString(),
    })
  })

  // Note: risk-service is purely a background scoring worker — it consumes
  // game events from Redis Streams, writes verdicts to `fraud_events`, and
  // publishes `fraud:alerts`/`fraud:flagged:*`. It has no HTTP data API of
  // its own; admin-service's `/api/admin/fraud-*` and
  // `/api/admin/user/:userId/fraud-*` routes are the sole consumer-facing
  // surface for querying that data (see docs/Bugs/risk-service-http-api-orphaned-and-duplicated.md).

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
          fraudDetector.updateConfig(config.fraudDetection)
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
