import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import * as admin from 'firebase-admin'

let firebaseInitialized = false

function initFirebase() {
  if (firebaseInitialized || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) })
  firebaseInitialized = true
}

async function sendPushNotification(fcmToken: string, title: string, body: string, data?: Record<string, string>) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log(`[PUSH DEV] To: ${fcmToken?.slice(0, 20)}... | ${title}: ${body}`)
    return
  }
  await admin.messaging().send({ token: fcmToken, notification: { title, body }, data, android: { priority: 'high' }, apns: { payload: { aps: { sound: 'default' } } } })
}

export function notificationsPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    initFirebase()

    const internal = async (req: any, reply: any) => {
      if (req.headers['x-internal-key'] !== process.env.INTERNAL_SERVICE_KEY) return reply.code(403).send({ error: 'Forbidden' })
    }

    app.get('/notifications/me', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const res = await db.query(`SELECT id, type, title, body, data, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [user.sub])
      return reply.send(res.rows)
    })

    app.put('/notifications/read/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as any
      await db.query('UPDATE notifications SET read = true, read_at = NOW() WHERE id = $1 AND user_id = $2', [id, user.sub])
      return reply.send({ success: true })
    })

    app.post('/internal/notifications/send', { onRequest: [internal] }, async (req, reply) => {
      const { user_id, title, body, type = 'general', data } = req.body as any
      await db.query('INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)', [user_id, type, title, body, JSON.stringify(data || {})])
      const userRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [user_id])
      if (userRes.rows[0]?.fcm_token) await sendPushNotification(userRes.rows[0].fcm_token, title, body, data)
      return reply.send({ success: true })
    })

    app.post('/internal/notifications/broadcast', { onRequest: [internal] }, async (req, reply) => {
      const { title, body, type = 'broadcast', data } = req.body as any
      const users = await db.query(`SELECT id, fcm_token FROM users WHERE is_bot = false AND status = $1 AND fcm_token IS NOT NULL`, ['active'])
      let sent = 0
      for (const user of users.rows) {
        await db.query('INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)', [user.id, type, title, body, JSON.stringify(data || {})])
        if (user.fcm_token) {
          try { await sendPushNotification(user.fcm_token, title, body, data); sent++ } catch { }
        }
      }
      return reply.send({ success: true, sent, total: users.rows.length })
    })
  }
}
