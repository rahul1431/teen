import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { Aggregator } from './aggregator'

const app = Fastify({ logger: false })
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })

async function start() {
  await app.register(cors, { origin: true })
  if (redis.status === 'wait') await redis.connect()

  const agg = new Aggregator(db, redis)

  // Hourly rollup job — fires on startup and then every hour
  async function runRollup() {
    const now = new Date()
    const lastHour = new Date(now)
    lastHour.setMinutes(0, 0, 0)
    lastHour.setHours(lastHour.getHours() - 1)
    try {
      await agg.rollupHour(lastHour)
      console.log('Hourly rollup completed for', lastHour.toISOString())
    } catch (err) {
      console.error('Rollup failed:', err)
    }
  }

  await runRollup()
  setInterval(runRollup, 60 * 60 * 1000) // every hour

  // GET /summary — live dashboard summary
  app.get('/summary', async (_req, reply) => {
    try {
      const summary = await agg.getLiveSummary()
      return reply.send({ success: true, data: summary })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // GET /ggr?days=7 — GGR trend by day
  app.get('/ggr', async (req, reply) => {
    const days = parseInt((req.query as any).days || '7')
    try {
      const data = await agg.getGGRTrend(Math.min(days, 90))
      return reply.send({ success: true, data })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // GET /breakdown — per-game GGR breakdown for today
  app.get('/breakdown', async (_req, reply) => {
    try {
      const data = await agg.getGameBreakdown()
      return reply.send({ success: true, data })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // GET /churn?limit=20 — churn risk users
  app.get('/churn', async (req, reply) => {
    const limit = parseInt((req.query as any).limit || '20')
    try {
      const data = await agg.getChurnRisk(Math.min(limit, 100))
      return reply.send({ success: true, data })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // GET /hourly?game_type=teen_patti — 24h hourly trend
  app.get('/hourly', async (req, reply) => {
    const gameType = (req.query as any).game_type
    try {
      const data = await agg.getHourlyTrend(gameType)
      return reply.send({ success: true, data })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  app.get('/health', async () => ({ status: 'ok', service: 'analytics-service' }))

  const port = parseInt(process.env.PORT || '3013')
  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1) }
    console.log(`Analytics service running on port ${port}`)
  })
}

const shutdown = async () => {
  await app.close()
  await redis.quit()
  await db.end()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

start().catch((err) => { console.error(err); process.exit(1) })
