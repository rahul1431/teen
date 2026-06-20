import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { Pool } from 'pg'
import * as admin from 'firebase-admin'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  })
}

async function sendPushNotification(fcmToken: string, title: string, body: string, data?: Record<string, string>) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log(`[PUSH DEV] To: ${fcmToken?.slice(0, 20)}... | ${title}: ${body}`)
    return
  }
  await admin.messaging().send({
    token: fcmToken,
    notification: { title, body },
    data,
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  })
}

async function start() {
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })

  const authenticate = async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  const authenticateInternal = async (req: any, reply: any) => {
    if (req.headers['x-internal-key'] !== process.env.INTERNAL_SERVICE_KEY) {
      reply.code(403).send({ error: 'Forbidden' })
    }
  }

  // GET /notifications/me
  app.get('/notifications/me', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const res = await db.query(
      `SELECT id, type, title, body, data, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [user.sub]
    )
    return reply.send(res.rows)
  })

  // PUT /notifications/read/:id
  app.put('/notifications/read/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const { id } = req.params as any
    await db.query('UPDATE notifications SET read = true, read_at = NOW() WHERE id = $1 AND user_id = $2', [id, user.sub])
    return reply.send({ success: true })
  })

  // Internal: POST /internal/notifications/send
  app.post('/internal/notifications/send', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const { user_id, title, body, type = 'general', data } = req.body as any

    // Store in DB
    await db.query(
      'INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)',
      [user_id, type, title, body, JSON.stringify(data || {})]
    )

    // Get FCM token
    const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [user_id])
    if (userRes.rows[0]?.fcm_token) {
      await sendPushNotification(userRes.rows[0].fcm_token, title, body, data)
    }

    return reply.send({ success: true })
  })

  // Internal: POST /internal/notifications/broadcast (send to all users)
  app.post('/internal/notifications/broadcast', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const { title, body, type = 'broadcast', data, filter } = req.body as any

    let query = 'SELECT id, fcm_token FROM users WHERE is_bot = false AND status = $1 AND fcm_token IS NOT NULL'
    const params: any[] = ['active']

    const users = await db.query(query, params)
    let sent = 0

    for (const user of users.rows) {
      await db.query(
        'INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)',
        [user.id, type, title, body, JSON.stringify(data || {})]
      )
      if (user.fcm_token) {
        try {
          await sendPushNotification(user.fcm_token, title, body, data)
          sent++
        } catch { /* Invalid token, skip */ }
      }
    }

    return reply.send({ success: true, sent, total: users.rows.length })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'notification' }))

  const port = parseInt(process.env.PORT || '3007')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Notification service running on port ${port}`)
}

start().catch(err => { console.error(err); process.exit(1) })
