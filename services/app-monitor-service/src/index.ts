// services/app-monitor-service/src/index.ts
import 'dotenv/config'
import Fastify from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import pino from 'pino'
import { MonitorIngestor } from './monitor-ingestor'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })

const app = Fastify({ logger: false })

const ingestor = new MonitorIngestor(pool, redis, logger)

app.get('/health', async (_req, reply) => {
  try {
    await pool.query('SELECT 1')
    await redis.ping()
    return reply.send({ success: true, data: { status: 'ok', service: 'app-monitor-service', timestamp: new Date().toISOString() } })
  } catch (err: any) {
    return reply.code(500).send({ success: false, error: err.message })
  }
})

app.post<{ Body: Record<string, unknown> }>('/api/monitor/events', async (req, reply) => {
  try {
    const payload = req.body as any
    if (!payload.session_id || !payload.device_id || !Array.isArray(payload.events)) {
      return reply.code(400).send({ success: false, error: 'Missing required fields: session_id, device_id, events' })
    }
    if (payload.events.length > 100) {
      return reply.code(400).send({ success: false, error: 'Batch too large: max 100 events' })
    }
    await ingestor.ingestBatch(payload)
    return reply.send({ success: true })
  } catch (err: any) {
    if (err.statusCode === 429) {
      return reply.code(429).send({ success: false, error: 'Rate limit exceeded' })
    }
    logger.error({ err }, 'Ingest error')
    return reply.code(500).send({ success: false, error: 'Ingest failed' })
  }
})

app.get('/api/monitor/stats', async (_req, reply) => {
  try {
    const data = await ingestor.getStats()
    return reply.send({ success: true, data })
  } catch (err: any) {
    logger.error({ err }, 'getStats error')
    return reply.code(500).send({ success: false, error: 'Failed to fetch stats' })
  }
})

app.get<{ Querystring: { hours?: string; limit?: string } }>(
  '/api/monitor/errors',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '24', 10)
      const limit = parseInt(req.query.limit ?? '50', 10)
      const data = await ingestor.getErrors(hours, limit)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getErrors error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch errors' })
    }
  }
)

app.get<{ Querystring: { hours?: string } }>(
  '/api/monitor/api-health',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '1', 10)
      const data = await ingestor.getApiHealth(hours)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getApiHealth error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch API health' })
    }
  }
)

app.get<{ Querystring: { hours?: string } }>(
  '/api/monitor/ws-health',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '24', 10)
      const data = await ingestor.getWsHealth(hours)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getWsHealth error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch WS health' })
    }
  }
)

app.get<{ Querystring: { limit?: string; offset?: string; active?: string } }>(
  '/api/monitor/sessions',
  async (req, reply) => {
    try {
      const limit  = parseInt(req.query.limit  ?? '10', 10)
      const offset = parseInt(req.query.offset ?? '0',  10)
      const activeOnly = req.query.active === 'true'
      const data = await ingestor.getSessions(limit, offset, activeOnly)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getSessions error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch sessions' })
    }
  }
)

app.get<{ Querystring: { hours?: string } }>(
  '/api/monitor/screen-funnel',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '24', 10)
      const data = await ingestor.getScreenFunnel(hours)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getScreenFunnel error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch screen funnel' })
    }
  }
)

async function start() {
  if (redis.status === 'wait') await redis.connect()

  const port = parseInt(process.env.PORT ?? '3015', 10)
  await app.listen({ port, host: '0.0.0.0' })
  logger.info(`app-monitor-service listening on port ${port}`)
}

start().catch(err => {
  logger.error(err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  logger.info('SIGTERM — shutting down')
  await app.close()
  await redis.quit()
  await pool.end()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await app.close()
  await redis.quit()
  await pool.end()
  process.exit(0)
})
