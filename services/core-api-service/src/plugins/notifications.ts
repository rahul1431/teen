import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
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

export function notificationsPlugin(db: Pool, redis?: Redis) {
  return async function (app: FastifyInstance) {
    initFirebase()

    // Listen for wallet updates from admin/system credits via Redis Pub/Sub
    if (redis) {
      console.error('[notifications] REDIS INSTANCE EXISTS, setting up wallet:updated subscriber')
      const walletUpdateSub = redis.duplicate()
      walletUpdateSub.subscribe('wallet:updated', async (err) => {
        if (err) console.error('[wallet:updated subscriber] subscription error:', err)
        else console.error('[wallet:updated subscriber] SUBSCRIBED SUCCESSFULLY')
      })

      walletUpdateSub.on('message', async (channel, message) => {
        if (channel !== 'wallet:updated') return
        console.error('[wallet:updated handler] RECEIVED MESSAGE:', message)
        try {
          const event = JSON.parse(message)
          const { userId, type, amount, walletType } = event

          // Fetch FCM token for this user
          const tokenRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [userId])
          if (!tokenRes.rows.length || !tokenRes.rows[0].fcm_token) return

          const fcmToken = tokenRes.rows[0].fcm_token
          let title = 'Wallet Updated'
          let body = `₹${amount} added to your ${walletType} balance`
          const data = { walletUpdated: 'true', amount: String(amount), type }

          if (type === 'manual_credit') {
            title = 'Bonus Added ✨'
            body = `₹${amount} bonus has been credited to your account`
          } else if (type === 'deposit') {
            title = 'Deposit Confirmed ✅'
            body = `Your deposit of ₹${amount} has been credited`
          } else if (type === 'referral') {
            title = 'Referral Reward Earned 🎁'
            body = `₹${amount} referral bonus has been added`
          } else if (type === 'game_credit') {
            title = 'Winnings Credited 🎉'
            body = `You won ₹${amount}!`
          }

          await sendPushNotification(fcmToken, title, body, data)
        } catch (err) {
          console.error('[wallet:updated handler] error:', err)
        }
      })

      walletUpdateSub.on('error', (err) => {
        console.error('[wallet:updated subscriber] error:', err)
      })
    }

    const internal = async (req: any, reply: any) => {
      const key = process.env.INTERNAL_SERVICE_KEY
      if (!key || req.headers['x-internal-key'] !== key) return reply.code(403).send({ error: 'Forbidden' })
    }

    app.get('/notifications/me', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const res = await db.query(`SELECT id, type, title, body, data, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [user.sub])
      return reply.send(res.rows)
    })

    app.get('/notifications/unread-count', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const res = await db.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = false', [user.sub])
      return reply.send({ count: res.rows[0].count })
    })

    app.put('/notifications/read-all', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      await db.query('UPDATE notifications SET read = true, read_at = NOW() WHERE user_id = $1 AND read = false', [user.sub])
      return reply.send({ success: true })
    })

    app.delete('/notifications/all', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      await db.query('DELETE FROM notifications WHERE user_id = $1', [user.sub])
      return reply.send({ success: true })
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
      const usersRes = await db.query(`SELECT id, fcm_token FROM users WHERE is_bot = false AND status = $1`, ['active'])
      const users = usersRes.rows
      if (users.length === 0) return reply.send({ success: true, sent: 0, total: 0 })

      // 1. Bulk insert DB notifications in batches of 1000 to stay under Postgres parameter limits
      const dbBatchSize = 1000
      for (let i = 0; i < users.length; i += dbBatchSize) {
        const batch = users.slice(i, i + dbBatchSize)
        const values: any[] = []
        let queryText = 'INSERT INTO notifications (user_id, type, title, body, data) VALUES '
        for (let j = 0; j < batch.length; j++) {
          const u = batch[j]
          const offset = j * 5
          queryText += `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`
          if (j < batch.length - 1) queryText += ', '
          values.push(u.id, type, title, body, JSON.stringify(data || {}))
        }
        await db.query(queryText, values)
      }

      // 2. Batch send push notifications using sendEach in batches of 500
      const tokens = users.map(u => u.fcm_token).filter(Boolean) as string[]
      let sent = 0
      if (tokens.length > 0) {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
          console.log(`[PUSH DEV] Broadcasted to ${tokens.length} tokens: ${title}: ${body}`)
          sent = tokens.length
        } else {
          const fcmMessages = tokens.map(token => ({
            token,
            notification: { title, body },
            data,
            android: { priority: 'high' } as any,
            apns: { payload: { aps: { sound: 'default' } } } as any
          }))
          const fcmBatchSize = 500
          for (let i = 0; i < fcmMessages.length; i += fcmBatchSize) {
            const batch = fcmMessages.slice(i, i + fcmBatchSize)
            try {
              const response = await admin.messaging().sendEach(batch)
              sent += response.successCount
            } catch (err) {
              console.error('[broadcast] FCM batch failed:', err)
            }
          }
        }
      }

      return reply.send({ success: true, sent, total: users.length })
    })
  }
}
