import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { Pool } from 'pg'
import Redis from 'ioredis'

import { authPlugin } from './plugins/auth'
import { usersPlugin } from './plugins/users'
import { leaderboardPlugin } from './plugins/leaderboard'
import { notificationsPlugin } from './plugins/notifications'
import { bettingPlugin } from './plugins/betting'

const PORT = parseInt(process.env.PORT || '3001')

// Shared connection pools — one per resource, reused across all plugins
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 30,                 // total connections for all consolidated routes
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

async function start() {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' },
    trustProxy: true,
  })

  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, { origin: true })
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  // Expose authenticate hook so all plugins can use app.authenticate
  app.decorate('authenticate', async function (req: any, reply: any) {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  })

  // Register all service plugins (each gets the shared db/redis)
  await app.register(authPlugin(db, redis))
  await app.register(usersPlugin(db))
  await app.register(leaderboardPlugin(db, redis))
  await app.register(notificationsPlugin(db))
  await app.register(bettingPlugin(db))

  app.get('/health', async () => ({
    status: 'ok',
    service: 'core-api',
    services: ['auth', 'users', 'leaderboard', 'notifications', 'betting'],
  }))

  await redis.connect()
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[core-api] Running on port ${PORT} (auth+users+leaderboard+notify+betting)`)
}

start().catch(err => { console.error(err); process.exit(1) })
