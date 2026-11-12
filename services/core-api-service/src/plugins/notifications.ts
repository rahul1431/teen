import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'

let firebaseInitialized = false

function initFirebase() {
  if (firebaseInitialized) return
  try {
    let sa: any = null
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(__dirname, '../../firebase-service-account.json')
    if (fs.existsSync(keyPath)) {
      sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim()
      if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
        raw = raw.slice(1, -1)
      }
      sa = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (typeof sa === 'string') sa = JSON.parse(sa)
    }

    if (!sa) return

    if (sa.private_key) {
      sa.private_key = sa.private_key.replace(/\\n/g, '\n')
    }
    admin.initializeApp({ credential: admin.credential.cert(sa) })
    firebaseInitialized = true
    console.log('[notifications] Firebase initialized successfully with project:', sa.project_id)
  } catch (err: any) {
    console.error('[notifications] Failed to initialize Firebase:', err.message || err)
  }
}

function resolveNotificationChannel(type: string): string {
  if (type === 'wallet' || type === 'deposit_recovery' || type === 'payout') {
    return 'myonlinejoker_cashier_v1'
  }
  if (type === 'promotion' || type === 'reengagement' || type === 'churn_winback' || type === 'bonus') {
    return 'myonlinejoker_promotions_v1'
  }
  if (type === 'game_result' || type === 'game_invite') {
    return 'myonlinejoker_game_alerts_v1'
  }
  return 'myonlinejoker_notifications_v2'
}

function sanitizePushData(data?: Record<string, any>): Record<string, string> {
  if (!data) return {}
  const sanitized: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue
    sanitized[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return sanitized
}

async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  imageUrl?: string,
  channelId?: string
) {
  if (!firebaseInitialized) {
    console.log(`[PUSH DEV] To: ${fcmToken?.slice(0, 20)}... | ${title}: ${body} | Image: ${imageUrl}`)
    return
  }
  const resolvedChannel = channelId || 'myonlinejoker_notifications_v2'
  const sanitizedData = sanitizePushData({
    title,
    body,
    channel_id: resolvedChannel,
    ...(data || {}),
  })
  const payload: any = {
    token: fcmToken,
    notification: { title, body },
    data: sanitizedData,
    android: {
      priority: 'high',
      notification: {
        channelId: resolvedChannel,
        sound: 'default',
        priority: 'high',
        defaultVibrateTimings: true,
      }
    },
    apns: { payload: { aps: { sound: 'default' } } }
  }
  if (imageUrl) {
    payload.notification.imageUrl = imageUrl
  }
  await admin.messaging().send(payload)
}

/**
 * Checks if current time is within Indian Standard Time (IST = UTC+5:30) Quiet Hours.
 * Quiet hours: 10:00 PM (22:00) to 8:30 AM IST.
 */
function isIstQuietHours(): boolean {
  const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  const hours = istDate.getUTCHours()
  const minutes = istDate.getUTCMinutes()
  if (hours >= 22 || hours < 8) return true
  if (hours === 8 && minutes < 30) return true
  return false
}

/**
 * Dynamic message personalization helper for templates
 */
function applyTemplate(template: string, user: { username?: string; balance?: number | string }): string {
  if (!template) return ''
  return template
    .replace(/\{\{username\}\}/gi, user.username || 'Player')
    .replace(/\{\{balance\}\}/gi, `₹${parseFloat(String(user.balance || 0)).toFixed(0)}`)
}

/**
 * Omnichannel Cascade Fallback Dispatcher (Phase 3):
 * Automatically cascades to WhatsApp (Zender Gateway) or SMS Gateway when push is undelivered or offline.
 */
async function dispatchOmnichannelFallback(
  phone: string,
  title: string,
  body: string,
  actionUrl?: string
): Promise<{ channel: 'whatsapp' | 'sms' | null; success: boolean }> {
  if (!phone) return { channel: null, success: false }

  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone

  const fullText = actionUrl
    ? `*${title}*\n\n${body}\n\n👉 Click here: ${actionUrl}`
    : `*${title}*\n\n${body}`

  // 1. Try WhatsApp via Zender Gateway if available
  const zenderUrl = process.env.WHATSAPP_GATEWAY_URL || 'https://whatsapp.myonlinejoker.com/api/send/whatsapp'
  const zenderSecret = process.env.ZENDER_API_SECRET || '35e911f903cb05fd1f5204c42194ce93953c572e'
  const zenderAccount = process.env.ZENDER_ACCOUNT_HASH || ''

  if (zenderAccount) {
    try {
      const formData = new URLSearchParams()
      formData.append('secret', zenderSecret)
      formData.append('account', zenderAccount)
      formData.append('recipient', formattedPhone)
      formData.append('type', 'text')
      formData.append('message', fullText)
      formData.append('priority', '1')

      const res = await fetch(zenderUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      })
      if (res.ok) {
        console.log(`[Omnichannel] WhatsApp cascaded successfully to ${formattedPhone}`)
        return { channel: 'whatsapp', success: true }
      }
    } catch (e: any) {
      console.warn(`[Omnichannel] WhatsApp cascade error: ${e.message}`)
    }
  }

  // 2. Try SMS Gateway fallback
  const smsUrl = process.env.SMS_GATEWAY_URL || 'https://whatsapp.myonlinejoker.com/api/send/sms'
  const smsDevice = process.env.SMS_GATEWAY_DEVICE_ID || ''
  const smsSecret = process.env.SMS_GATEWAY_SECRET || ''

  if (smsDevice && smsSecret) {
    try {
      const formData = new URLSearchParams()
      formData.append('secret', smsSecret)
      formData.append('mode', 'devices')
      formData.append('device', smsDevice)
      formData.append('phone', formattedPhone)
      formData.append('message', `${title}: ${body}`)
      formData.append('sim', '1')
      formData.append('priority', '1')

      const res = await fetch(smsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      })
      if (res.ok) {
        console.log(`[Omnichannel] SMS cascaded successfully to ${formattedPhone}`)
        return { channel: 'sms', success: true }
      }
    } catch (e: any) {
      console.warn(`[Omnichannel] SMS cascade error: ${e.message}`)
    }
  }

  return { channel: null, success: false }
}

/**
 * Daily Frequency Capping & Anti-Fatigue Engine (Phase 2):
 * Limits promotional pushes to maxDaily per user per day (default 3) to protect retention.
 * Transactional alerts (wallet, payout, security) always bypass the cap.
 */
async function isEligibleForPromotionalPush(
  userId: string,
  type: string,
  urgent: boolean,
  redisClient?: Redis,
  maxDaily: number = 3
): Promise<boolean> {
  const transactionalTypes = new Set(['wallet', 'payout', 'security', 'otp', 'kyc', 'system', 'agent_alert', 'deposit_recovery'])
  if (urgent || transactionalTypes.has(type)) {
    return true
  }
  if (!redisClient) return true

  try {
    const todayStr = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const key = `push:fatigue:${userId}:${todayStr}`
    const current = await redisClient.incr(key)
    if (current === 1) {
      await redisClient.expire(key, 86400 * 2) // 48 hours TTL
    }
    return current <= maxDaily
  } catch (err: any) {
    console.warn('[fatigue-engine] Redis error:', err.message)
    return true
  }
}

/**
 * Automated Abandoned Cashier Recovery Worker
 * Identifies users who opened the deposit sheet / intent 15-360 mins ago but didn't finish.
 */
let cashierWorkerRunning = false
function startAbandonedCashierWorker(db: Pool) {
  if (cashierWorkerRunning) return
  cashierWorkerRunning = true

  setInterval(async () => {
    try {
      // Don't send during quiet hours unless urgent
      if (isIstQuietHours()) return

      const pendingEvents = await db.query(
        `SELECT e.id, e.user_id, e.amount, e.promo_code, e.created_at,
                u.username, u.fcm_token
         FROM abandoned_cashier_events e
         JOIN users u ON u.id = e.user_id
         WHERE e.completed = false
           AND e.notified = false
           AND e.created_at <= NOW() - INTERVAL '15 minutes'
           AND e.created_at >= NOW() - INTERVAL '6 hours'
         ORDER BY e.created_at ASC
         LIMIT 25`
      )

      for (const event of pendingEvents.rows) {
        // Verify if user actually completed any deposit since event creation
        const hasDeposited = await db.query(
          `SELECT 1 FROM deposits 
           WHERE user_id = $1 AND status = 'completed' AND created_at >= $2 
           LIMIT 1`,
          [event.user_id, event.created_at]
        )

        if (hasDeposited.rows.length > 0) {
          await db.query(
            `UPDATE abandoned_cashier_events SET completed = true, updated_at = NOW() WHERE id = $1`,
            [event.id]
          )
          continue
        }

        const amtStr = Math.round(Number(event.amount) || 0)
        const title = `₹${amtStr} Deposit Pending ⏳`
        const body = `Hey ${event.username || 'Player'}! Complete your deposit now & claim extra bonus chips instantly!`
        const pushActions = [
          { id: 'action_claim', title: `Deposit ₹${amtStr} 💰`, route: '/wallet' },
          { id: 'action_play', title: 'Play Games 🃏', route: '/home' }
        ]
        const pushData = {
          route: '/wallet',
          type: 'deposit_recovery',
          amount: String(amtStr),
          intent_id: String(event.id),
          action_url: '/wallet',
          actions: JSON.stringify(pushActions),
        }

        // 1. In-app notification with interactive actions
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, data, action_url, action_buttons, channel_id)
           VALUES ($1, 'wallet', $2, $3, $4, '/wallet', $5, 'myonlinejoker_cashier_v1')`,
          [event.user_id, title, body, JSON.stringify(pushData), JSON.stringify(pushActions)]
        )

        // 2. High-priority push notification with Cashier channel
        if (event.fcm_token) {
          try {
            await sendPushNotification(event.fcm_token, title, body, pushData, undefined, 'myonlinejoker_cashier_v1')
          } catch (err: any) {
            console.warn('[abandoned-cashier] FCM send error:', err.message)
          }
        }

        // 3. Mark event as notified
        await db.query(
          `UPDATE abandoned_cashier_events SET notified = true, updated_at = NOW() WHERE id = $1`,
          [event.id]
        )
      }

      // 4. Omnichannel Fallback (Phase 3): VIP / High intent (amount >= 500) abandoned deposits
      // If after 30 minutes user has not completed deposit, and whatsapp_fallback_sent = false
      const vipPendingEvents = await db.query(
        `SELECT e.id, e.user_id, e.amount, u.username, u.phone
         FROM abandoned_cashier_events e
         JOIN users u ON u.id = e.user_id
         WHERE e.completed = false
           AND e.whatsapp_fallback_sent = false
           AND e.amount >= 500
           AND e.created_at <= NOW() - INTERVAL '30 minutes'
           AND e.created_at >= NOW() - INTERVAL '12 hours'
         ORDER BY e.created_at ASC
         LIMIT 15`
      )

      for (const vip of vipPendingEvents.rows) {
        if (vip.phone) {
          const amt = Math.round(Number(vip.amount) || 0)
          const fallbackMsg = `Hey ${vip.username || 'Player'}! We noticed your ₹${amt} deposit was left pending. Complete it now on MyOnlineJoker to get an exclusive bonus boost! 🚀`
          const res = await dispatchOmnichannelFallback(vip.phone, 'Complete Your Deposit 💰', fallbackMsg, 'https://game.myonlinejoker.com/#/wallet')
          if (res.success) {
            await db.query(
              `UPDATE abandoned_cashier_events SET whatsapp_fallback_sent = true, whatsapp_fallback_sent_at = NOW() WHERE id = $1`,
              [vip.id]
            )
          }
        }
      }
    } catch (err: any) {
      console.error('[abandoned-cashier-worker] error:', err.message)
    }
  }, 3 * 60 * 1000) // Run every 3 minutes
  console.log('[notifications] Abandoned Cashier Recovery worker initialized')
}

export function notificationsPlugin(db: Pool, redis?: Redis) {
  return async function (app: FastifyInstance) {
    initFirebase()
    startAbandonedCashierWorker(db)

    // Listen for wallet updates from admin/system credits via Redis Pub/Sub
    if (redis) {
      const walletUpdateSub = redis.duplicate()
      walletUpdateSub.subscribe('wallet:updated', async (err) => {
        if (err) console.error('[wallet:updated subscriber] subscription error:', err)
      })

      walletUpdateSub.on('message', async (channel, message) => {
        if (channel !== 'wallet:updated') return
        try {
          const event = JSON.parse(message)
          const { userId, type, amount, walletType } = event

          // Fetch FCM token for this user
          const tokenRes = await db.query('SELECT fcm_token FROM users WHERE id = $1', [userId])
          if (!tokenRes.rows.length || !tokenRes.rows[0].fcm_token) return

          const fcmToken = tokenRes.rows[0].fcm_token
          let title = 'Wallet Updated'
          let body = `₹${amount} added to your ${walletType} balance`
          const data = { walletUpdated: 'true', amount: String(amount), type, route: '/wallet' }

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

          await sendPushNotification(fcmToken, title, body, data, undefined, 'myonlinejoker_cashier_v1')
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
      const { category, limit = 50, offset = 0, unread_only } = (req.query || {}) as any
      
      let filter = 'WHERE user_id = $1 AND deleted_at IS NULL'
      const params: any[] = [user.sub]

      if (category === 'cashier') {
        filter += " AND (channel_id = 'myonlinejoker_cashier_v1' OR type IN ('deposit', 'withdrawal', 'wallet', 'deposit_recovery'))"
      } else if (category === 'promotions') {
        filter += " AND (channel_id = 'myonlinejoker_promotions_v1' OR type IN ('bonus', 'broadcast', 'promotion', 'reengagement', 'churn_winback'))"
      } else if (category === 'game_alerts') {
        filter += " AND (channel_id = 'myonlinejoker_game_alerts_v1' OR type IN ('win', 'turn', 'invite', 'table', 'game_result', 'game_invite', 'game_credit'))"
      } else if (category === 'system') {
        filter += " AND (channel_id = 'myonlinejoker_notifications_v2' OR type IN ('system', 'kyc', 'security', 'general'))"
      }

      if (unread_only === 'true' || unread_only === true) {
        filter += ' AND read = false'
      }

      params.push(Math.min(parseInt(String(limit), 10) || 50, 100))
      params.push(Math.max(parseInt(String(offset), 10) || 0, 0))

      const res = await db.query(
        `SELECT id, type, title, body, data, read, clicked, created_at, image_url, action_url, action_buttons, channel_id, delivery_channel 
         FROM notifications 
         ${filter} 
         ORDER BY created_at DESC 
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )
      return reply.send(res.rows)
    })

    app.get('/notifications/unread-count', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const res = await db.query(
        `SELECT 
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE channel_id = 'myonlinejoker_cashier_v1' OR type IN ('deposit', 'withdrawal', 'wallet', 'deposit_recovery'))::int AS cashier,
           COUNT(*) FILTER (WHERE channel_id = 'myonlinejoker_promotions_v1' OR type IN ('bonus', 'broadcast', 'promotion', 'reengagement', 'churn_winback'))::int AS promotions,
           COUNT(*) FILTER (WHERE channel_id = 'myonlinejoker_game_alerts_v1' OR type IN ('win', 'turn', 'invite', 'table', 'game_result', 'game_invite', 'game_credit'))::int AS game_alerts,
           COUNT(*) FILTER (WHERE channel_id = 'myonlinejoker_notifications_v2' OR type IN ('system', 'kyc', 'security', 'general'))::int AS system
         FROM notifications 
         WHERE user_id = $1 AND read = false AND deleted_at IS NULL`,
        [user.sub]
      )
      const row = res.rows[0] || { total: 0, cashier: 0, promotions: 0, game_alerts: 0, system: 0 }
      return reply.send({
        count: row.total,
        by_category: {
          all: row.total,
          cashier: row.cashier,
          promotions: row.promotions,
          game_alerts: row.game_alerts,
          system: row.system
        }
      })
    })

    app.put('/notifications/read-all', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { category } = (req.query || {}) as any
      let categoryFilter = ''
      if (category === 'cashier') {
        categoryFilter = " AND (channel_id = 'myonlinejoker_cashier_v1' OR type IN ('deposit', 'withdrawal', 'wallet', 'deposit_recovery'))"
      } else if (category === 'promotions') {
        categoryFilter = " AND (channel_id = 'myonlinejoker_promotions_v1' OR type IN ('bonus', 'broadcast', 'promotion', 'reengagement', 'churn_winback'))"
      } else if (category === 'game_alerts') {
        categoryFilter = " AND (channel_id = 'myonlinejoker_game_alerts_v1' OR type IN ('win', 'turn', 'invite', 'table', 'game_result', 'game_invite', 'game_credit'))"
      } else if (category === 'system') {
        categoryFilter = " AND (channel_id = 'myonlinejoker_notifications_v2' OR type IN ('system', 'kyc', 'security', 'general'))"
      }

      await db.query(
        `UPDATE notifications SET read = true, read_at = NOW() WHERE user_id = $1 AND read = false AND deleted_at IS NULL${categoryFilter}`,
        [user.sub]
      )
      return reply.send({ success: true })
    })

    app.delete('/notifications/all', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      await db.query('UPDATE notifications SET deleted_at = NOW() WHERE user_id = $1 AND deleted_at IS NULL', [user.sub])
      return reply.send({ success: true })
    })

    app.delete('/notifications/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as any
      await db.query('UPDATE notifications SET deleted_at = NOW() WHERE id = $1 AND user_id = $2', [id, user.sub])
      return reply.send({ success: true })
    })

    app.put('/notifications/read/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as any
      await db.query('UPDATE notifications SET read = true, read_at = NOW() WHERE id = $1 AND user_id = $2', [id, user.sub])
      return reply.send({ success: true })
    })

    // Click tracking for notifications (Conversion & Attribution engine)
    app.put('/notifications/click/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as any
      const notifRes = await db.query(
        `UPDATE notifications 
         SET clicked = true, clicked_at = NOW(), read = true, read_at = COALESCE(read_at, NOW()) 
         WHERE id = $1 AND user_id = $2
         RETURNING campaign_id, action_url`,
        [id, user.sub]
      )
      if (notifRes.rows.length && notifRes.rows[0].campaign_id) {
        const campaignId = notifRes.rows[0].campaign_id
        await db.query(
          `UPDATE notification_campaigns 
           SET clicked_count = COALESCE(clicked_count, 0) + 1 
           WHERE id = $1`,
          [campaignId]
        )
      }
      return reply.send({ success: true, action_url: notifRes.rows[0]?.action_url })
    })

    // Marks the CALLING user's own notification(s) for a campaign as read
    app.put('/notifications/read-by-campaign/:campaignId', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { campaignId } = req.params as any
      await db.query(
        'UPDATE notifications SET read = true, read_at = NOW() WHERE campaign_id = $1 AND user_id = $2 AND read = false',
        [campaignId, user.sub],
      )
      return reply.send({ success: true })
    })

    // User push send (Internal)
    app.post('/internal/notifications/send', { onRequest: [internal] }, async (req, reply) => {
      const {
        user_id,
        title,
        body,
        type = 'general',
        data,
        campaign_id,
        image_url,
        action_url,
        action_buttons,
        urgent = false,
        delivery_channels = 'push',
      } = req.body as any

      // Resolve recipient details for dynamic personalization & fallback
      const userRes = await db.query(
        `SELECT u.username, u.fcm_token, u.phone,
                COALESCE(w.real_balance + w.bonus_balance, 0)::numeric(12,2) AS balance
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         WHERE u.id = $1`,
        [user_id]
      )
      const u = userRes.rows[0] || {}

      const personalizedTitle = applyTemplate(title, u)
      const personalizedBody = applyTemplate(body, u)
      const pushData = {
        ...(data || {}),
        ...(campaign_id ? { campaign_id: String(campaign_id) } : {}),
        ...(action_buttons ? { actions: typeof action_buttons === 'string' ? action_buttons : JSON.stringify(action_buttons) } : {}),
      }
      const channelId = resolveNotificationChannel(type)

      const insertRes = await db.query(
        `INSERT INTO notifications (user_id, type, title, body, data, campaign_id, image_url, action_url, action_buttons, channel_id, delivery_channel) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          user_id,
          type,
          personalizedTitle,
          personalizedBody,
          JSON.stringify(pushData),
          campaign_id || null,
          image_url || null,
          action_url || pushData.route || null,
          JSON.stringify(action_buttons || []),
          channelId,
          'push',
        ],
      )
      
      const notifId = insertRes.rows[0]?.id
      if (notifId) {
        pushData.notification_id = String(notifId)
      }

      // Check Daily Frequency Cap for Promotional Push
      const eligible = await isEligibleForPromotionalPush(user_id, type, urgent, redis, 3)
      let delivered = 0
      let fallbackUsed: 'whatsapp' | 'sms' | null = null

      if (eligible && u.fcm_token) {
        try {
          await sendPushNotification(u.fcm_token, personalizedTitle, personalizedBody, pushData, image_url, channelId)
          delivered = 1
        } catch (err: any) {
          console.warn(`[send] FCM failed for user ${user_id}:`, err.message)
        }
      }

      // Omnichannel Fallback if Push was undelivered or user had no FCM token
      if (delivered === 0 && (delivery_channels === 'omnichannel_cascade' || urgent || type === 'payout' || type === 'wallet')) {
        if (u.phone) {
          const fallbackRes = await dispatchOmnichannelFallback(u.phone, personalizedTitle, personalizedBody, action_url || pushData.route)
          if (fallbackRes.success) {
            fallbackUsed = fallbackRes.channel
            delivered = 1
            if (notifId && fallbackUsed) {
              await db.query(`UPDATE notifications SET delivery_channel = $1 WHERE id = $2`, [fallbackUsed, notifId])
            }
          }
        }
      }

      return reply.send({ success: true, delivered, fallback: fallbackUsed, fatigue_capped: !eligible, notification_id: notifId })
    })

    // Agent push send (Internal)
    app.post('/internal/notifications/send-agent', { onRequest: [internal] }, async (req, reply) => {
      const { agent_id, title, body, data, image_url, action_buttons, action_url } = req.body as any
      const agentRes = await db.query('SELECT fcm_token, phone_number FROM agents WHERE id = $1', [agent_id])
      const agent = agentRes.rows[0]
      let delivered = 0

      // Record in agent_notifications
      const insertRes = await db.query(
        `INSERT INTO agent_notifications (agent_id, title, body, type, metadata, image_url, action_url, action_buttons, delivery_channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          agent_id,
          title,
          body,
          data?.type || 'system',
          JSON.stringify(data || {}),
          image_url || null,
          action_url || data?.route || null,
          JSON.stringify(action_buttons || []),
          'push',
        ]
      )

      if (agent?.fcm_token) {
        try {
          await sendPushNotification(agent.fcm_token, title, body, data, image_url, 'joker_agent_notifications_v1')
          delivered = 1
        } catch (err: any) {
          console.warn(`[send-agent] Push failed for agent ${agent_id}:`, err.message)
        }
      }

      // Fallback to WhatsApp for Agent if high-value alert (e.g. payout, commission settlement)
      if (delivered === 0 && agent?.phone_number && (data?.type === 'payout' || data?.type === 'commission')) {
        const fb = await dispatchOmnichannelFallback(agent.phone_number, title, body, action_url)
        if (fb.success && insertRes.rows[0]?.id && fb.channel) {
          delivered = 1
          await db.query(`UPDATE agent_notifications SET delivery_channel = $1 WHERE id = $2`, [fb.channel, insertRes.rows[0].id])
        }
      }

      return reply.send({ success: true, delivered })
    })

    // Direct token push send (Internal)
    app.post('/internal/notifications/send-direct', { onRequest: [internal] }, async (req, reply) => {
      const { token, title, body, data, image_url, channel_id } = req.body as any
      if (!token) return reply.code(400).send({ error: 'Token is required' })
      await sendPushNotification(token, title, body, data, image_url, channel_id)
      return reply.send({ success: true, delivered: 1 })
    })

    // Broadcast push send with Quiet Hours, Anti-Fatigue Capping, Omnichannel Cascade & Personalization (Internal)
    app.post('/internal/notifications/broadcast', { onRequest: [internal] }, async (req, reply) => {
      const {
        title,
        body,
        type = 'broadcast',
        data,
        campaign_id,
        image_url,
        segment_type = 'all',
        quiet_hours_enabled = true,
        urgent = false,
        frequency_cap = 3,
        action_buttons,
        delivery_channels = 'push',
      } = req.body as any

      // Enforce Quiet Hours if active and not marked urgent
      if (quiet_hours_enabled && !urgent && isIstQuietHours()) {
        console.log('[notifications] Quiet hours active (10 PM - 8:30 AM IST). Non-urgent broadcast deferred.')
        return reply.send({
          success: false,
          quiet_hours: true,
          message: 'Broadcast deferred: Indian Quiet Hours active (10:00 PM - 8:30 AM IST). Protects user retention and notification fatigue.',
          sent: 0,
          skipped_fatigue: 0,
          total: 0,
        })
      }

      const channelId = resolveNotificationChannel(type)
      const pushData = {
        ...(data || {}),
        ...(campaign_id ? { campaign_id: String(campaign_id) } : {}),
        ...(action_buttons ? { actions: typeof action_buttons === 'string' ? action_buttons : JSON.stringify(action_buttons) } : {}),
      }
      
      // Determine segment query including phone and wallet balance for dynamic personalization
      let userQuery = `
        SELECT u.id, u.username, u.phone, u.fcm_token,
               COALESCE(w.real_balance + w.bonus_balance, 0)::numeric(12,2) AS balance
        FROM users u
        LEFT JOIN wallets w ON w.user_id = u.id
        WHERE u.is_bot = false AND u.status = $1
      `
      const userParams: any[] = ['active']

      if (segment_type === 'active_7d') {
        userQuery += ` AND u.last_login_at >= NOW() - INTERVAL '7 days'`
      } else if (segment_type === 'inactive_7d') {
        userQuery += ` AND (u.last_login_at IS NULL OR u.last_login_at < NOW() - INTERVAL '7 days')`
      } else if (segment_type === 'low_balance') {
        userQuery += ` AND (w.real_balance + w.bonus_balance) < 100`
      }

      const usersRes = await db.query(userQuery, userParams)
      const users = usersRes.rows
      if (users.length === 0) return reply.send({ success: true, sent: 0, skipped_fatigue: 0, total: 0 })

      // 1. Bulk insert DB notifications with dynamic personalization in batches of 1000
      const dbBatchSize = 1000
      for (let i = 0; i < users.length; i += dbBatchSize) {
        const batch = users.slice(i, i + dbBatchSize)
        const values: any[] = []
        let queryText = 'INSERT INTO notifications (user_id, type, title, body, data, campaign_id, image_url, action_url, action_buttons, channel_id, delivery_channel) VALUES '
        for (let j = 0; j < batch.length; j++) {
          const u = batch[j]
          const offset = j * 11
          queryText += `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
          if (j < batch.length - 1) queryText += ', '
          
          const personalizedTitle = applyTemplate(title, u)
          const personalizedBody = applyTemplate(body, u)
          values.push(
            u.id,
            type,
            personalizedTitle,
            personalizedBody,
            JSON.stringify(pushData),
            campaign_id || null,
            image_url || null,
            pushData.route || null,
            JSON.stringify(action_buttons || []),
            channelId,
            'push',
          )
        }
        await db.query(queryText, values)
      }

      // 2. Frequency Capping & Anti-Fatigue Filtering
      const usersWithTokens = users.filter(u => Boolean(u.fcm_token))
      let sent = 0
      let skippedFatigue = 0
      const eligibleUsers: typeof users = []

      for (const u of usersWithTokens) {
        const eligible = await isEligibleForPromotionalPush(u.id, type, urgent, redis, frequency_cap)
        if (eligible) {
          eligibleUsers.push(u)
        } else {
          skippedFatigue++
        }
      }

      // 3. Batch send push notifications using sendEach in batches of 500
      if (eligibleUsers.length > 0) {
        if (!firebaseInitialized) {
          console.log(`[PUSH DEV] Broadcasted to ${eligibleUsers.length} tokens: ${title}: ${body} | Channel: ${channelId}`)
          sent = eligibleUsers.length
        } else {
          const fcmMessages = eligibleUsers.map(u => {
            const personalizedTitle = applyTemplate(title, u)
            const personalizedBody = applyTemplate(body, u)
            const pPushData = sanitizePushData({
              title: personalizedTitle,
              body: personalizedBody,
              channel_id: channelId,
              ...pushData,
            })
            const msg: any = {
              token: u.fcm_token,
              notification: { title: personalizedTitle, body: personalizedBody },
              data: pPushData,
              android: {
                priority: 'high',
                notification: {
                  channelId,
                  sound: 'default',
                  priority: 'high',
                  defaultVibrateTimings: true,
                }
              } as any,
              apns: { payload: { aps: { sound: 'default' } } } as any,
            }
            if (image_url) {
              msg.notification.imageUrl = image_url
            }
            return msg
          })

          const fcmBatchSize = 500
          for (let i = 0; i < fcmMessages.length; i += fcmBatchSize) {
            const batch = fcmMessages.slice(i, i + fcmBatchSize)
            try {
              const response = await admin.messaging().sendEach(batch)
              sent += response.successCount
            } catch (err: any) {
              console.error('[broadcast] FCM batch failed:', err.message || err)
            }
          }
        }
      }

      // 4. Omnichannel Cascade Fallback (Phase 3)
      let whatsappSent = 0
      let smsSent = 0
      if (delivery_channels === 'omnichannel_cascade') {
        const usersWithoutTokens = users.filter(u => !u.fcm_token && Boolean(u.phone)).slice(0, 50)
        for (const u of usersWithoutTokens) {
          const pTitle = applyTemplate(title, u)
          const pBody = applyTemplate(body, u)
          const fb = await dispatchOmnichannelFallback(u.phone, pTitle, pBody, pushData.route)
          if (fb.success) {
            if (fb.channel === 'whatsapp') whatsappSent++
            if (fb.channel === 'sms') smsSent++
          }
        }
      }

      // Update campaign with skipped_fatigue_count & omnichannel metrics if campaign_id present
      if (campaign_id) {
        await db.query(
          `UPDATE notification_campaigns 
           SET skipped_fatigue_count = $1, delivered_count = $2, 
               whatsapp_sent_count = COALESCE(whatsapp_sent_count, 0) + $3,
               sms_sent_count = COALESCE(sms_sent_count, 0) + $4,
               fallback_triggered_count = COALESCE(fallback_triggered_count, 0) + $5
           WHERE id = $6`,
          [skippedFatigue, sent, whatsappSent, smsSent, (whatsappSent + smsSent), campaign_id]
        )
      }

      return reply.send({
        success: true,
        sent,
        whatsapp_sent: whatsappSent,
        sms_sent: smsSent,
        skipped_fatigue: skippedFatigue,
        total: users.length,
      })
    })
  }
}
