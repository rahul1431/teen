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
import { supportPlugin } from './plugins/support'
import { seoMarketingPlugin } from './plugins/seo-marketing'
import { FantasyScoringPoller } from './helpers/fantasy-scoring-poller'
import { MatchStatusPoller } from './helpers/match-status-poller'

const PORT = parseInt(process.env.PORT || '3001')

// Two pools: auth/users/leaderboard/notifications need fast connections (<3s timeout).
// Betting can run heavier settlement queries so gets its own pool with more headroom.
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,   // fail fast — don't let slow bets block auth
})

const bettingDb = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
})

// ioredis auto-reconnects by default. Don't use lazyConnect — if Redis is
// down on startup, we want the process to keep retrying rather than crashing.
const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,        // queue commands while reconnecting
  retryStrategy: (times) => Math.min(times * 200, 5000),  // backoff up to 5s
  reconnectOnError: (err) => err.message.includes('READONLY'),
})

redis.on('error', (err) => {
  // Log but don't crash — ioredis will reconnect automatically
  console.error('[redis] connection error:', err.message)
})

redis.on('reconnecting', () => console.log('[redis] reconnecting...'))
redis.on('ready', () => console.log('[redis] ready'))

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

  app.decorate('authenticate', async function (req: any, reply: any) {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  })

  await app.register(authPlugin(db, redis))
  await app.register(usersPlugin(db))
  await app.register(leaderboardPlugin(db, redis))
  await app.register(notificationsPlugin(db, redis))
  await app.register(supportPlugin(db))
  await app.register(seoMarketingPlugin(db))
  await app.register(bettingPlugin(bettingDb))   // isolated pool — heavy queries don't starve auth

  app.get('/health', async () => ({
    status: 'ok',
    service: 'core-api',
    services: ['auth', 'users', 'leaderboard', 'notifications', 'betting', 'support', 'seo-marketing'],
  }))

  new FantasyScoringPoller(bettingDb).start()
  new MatchStatusPoller(bettingDb).start()

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[core-api] Running on port ${PORT} (auth+users+leaderboard+notify+betting)`)
}

start().catch(err => { console.error(err); process.exit(1) })
