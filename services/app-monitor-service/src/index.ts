// services/app-monitor-service/src/index.ts
import 'dotenv/config'
import Fastify from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import pino from 'pino'
import os from 'os'
import { execSync } from 'child_process'
import { MonitorIngestor } from './monitor-ingestor'
import { parseClientIp, GeoLookup } from './geo'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })

const app = Fastify({ logger: false })

const ingestor = new MonitorIngestor(pool, redis, logger)
const geoLookup = new GeoLookup(process.env.GEOLITE2_CITY_PATH)

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
    // Validate shared secret (skip check when env var not configured — dev only)
    const expectedKey = process.env.INGEST_SECRET_KEY
    if (expectedKey) {
      const providedKey = req.headers['x-monitor-key']
      if (providedKey !== expectedKey) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' })
      }
    }
    const ip = parseClientIp(req.headers as any, req.socket?.remoteAddress)
    const geo = geoLookup.lookup(ip)
    await ingestor.ingestBatch(payload, geo, ip)
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

app.get('/api/monitor/uptime', async (_req, reply) => {
  try {
    const filePath = '/opt/teen/uptime-status.json'
    if (!require('fs').existsSync(filePath)) {
      return reply.send({ success: true, data: null })
    }
    const raw = require('fs').readFileSync(filePath, 'utf-8')
    return reply.send({ success: true, data: JSON.parse(raw) })
  } catch (err: any) {
    logger.error({ err }, 'uptime error')
    return reply.code(500).send({ success: false, error: 'Failed to fetch uptime status' })
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

app.get('/api/monitor/server-health', async (_req, reply) => {
  try {
    // PM2 process list
    let processes: object[] = []
    try {
      const raw = execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString()
      const list: any[] = JSON.parse(raw)
      processes = list.map(p => ({
        name:        p.name,
        status:      p.pm2_env?.status ?? 'unknown',
        memory_mb:   Math.round((p.monit?.memory ?? 0) / 1024 / 1024),
        cpu_pct:     p.monit?.cpu ?? 0,
        restarts:    p.pm2_env?.restart_time ?? 0,
        uptime_ms:   p.pm2_env?.pm_uptime ? (Date.now() - p.pm2_env.pm_uptime) : 0,
        pid:         p.pid ?? null,
      }))
    } catch { /* PM2 not available in this env — skip */ }

    // System memory via OS module
    const totalMem  = Math.round(os.totalmem()  / 1024 / 1024)
    const freeMem   = Math.round(os.freemem()   / 1024 / 1024)
    const usedMem   = totalMem - freeMem
    const loadAvg   = os.loadavg()

    // Docker containers
    let containers: object[] = []
    try {
      const raw = execSync(
        'docker ps --format "{{.Names}}|{{.Status}}|{{.State}}" 2>/dev/null', { timeout: 5000 }
      ).toString().trim()
      if (raw) {
        containers = raw.split('\n').map(line => {
          const [name, status, state] = line.split('|')
          const healthy = status?.includes('(healthy)') ? 'healthy'
            : status?.includes('(unhealthy)') ? 'unhealthy'
            : 'no-healthcheck'
          return { name, state, health: healthy }
        })
      }
    } catch { /* Docker not available */ }

    return reply.send({
      success: true,
      data: {
        processes,
        system: {
          total_ram_mb: totalMem,
          used_ram_mb:  usedMem,
          free_ram_mb:  freeMem,
          load_avg_1m:  Math.round(loadAvg[0] * 100) / 100,
          load_avg_5m:  Math.round(loadAvg[1] * 100) / 100,
          cpu_count:    os.cpus().length,
        },
        docker: containers,
        checked_at: new Date().toISOString(),
      }
    })
  } catch (err: any) {
    logger.error({ err }, 'server-health error')
    return reply.code(500).send({ success: false, error: err.message })
  }
})

app.get('/api/monitor/live-players', async (_req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getLivePlayers() }) }
  catch (err: any) { logger.error({ err }, 'live-players'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})
app.get<{ Params: { userId: string } }>('/api/monitor/player/:userId', async (req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getPlayerDetail(req.params.userId) }) }
  catch (err: any) { logger.error({ err }, 'player detail'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})
app.get('/api/monitor/geo-distribution', async (_req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getGeoDistribution() }) }
  catch (err: any) { logger.error({ err }, 'geo-distribution'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})
app.get<{ Querystring: { hours?: string } }>('/api/monitor/engagement', async (req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getEngagement(parseInt(req.query.hours ?? '24', 10)) }) }
  catch (err: any) { logger.error({ err }, 'engagement'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})

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
