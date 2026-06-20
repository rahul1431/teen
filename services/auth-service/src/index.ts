import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { redis } from './redis'
import { db } from './db'
import { authRoutes } from './routes'

const app = Fastify({ logger: true })

async function start() {
  await app.register(helmet)
  await app.register(cors, { origin: true })
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    redis,
  })
  await app.register(jwt, {
    secret: process.env.JWT_SECRET!,
  })

  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  await app.register(authRoutes)

  app.get('/health', async () => ({ status: 'ok', service: 'auth' }))

  await redis.connect()
  await db.connect()

  const port = parseInt(process.env.PORT || '3001')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Auth service running on port ${port}`)
}

start().catch((err) => { console.error(err); process.exit(1) })
