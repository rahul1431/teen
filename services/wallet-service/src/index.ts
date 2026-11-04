import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { Pool } from 'pg'
import crypto from 'crypto'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import Redis from 'ioredis'
import { WalletService } from './wallet.service'

// Where uploaded deposit screenshots are stored (served by nginx at /uploads/).
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/opt/teen-prod/uploads/deposits'

// Platform-wide deposit/withdrawal amount limits — configurable via .env
// (see services/wallet-service/.env.example) rather than hardcoded.
const MIN_DEPOSIT_AMOUNT = parseFloat(process.env.MIN_DEPOSIT_AMOUNT || '10')
const MAX_DEPOSIT_AMOUNT = parseFloat(process.env.MAX_DEPOSIT_AMOUNT || '100000')
const MIN_WITHDRAWAL_AMOUNT = parseFloat(process.env.MIN_WITHDRAWAL_AMOUNT || '100')
const MAX_WITHDRAWAL_AMOUNT = parseFloat(process.env.MAX_WITHDRAWAL_AMOUNT || '50000')

// Withdrawal window: 10 AM - 9 PM India time. Mirrors the client-side gate in
// wallet_page.dart's _withdrawOpen, but enforced here against server/IST
// time rather than the device's (spoofable) local clock — see
// docs/Bugs/withdrawal-hours-restriction-is-client-side-only.md.
const WITHDRAWAL_WINDOW_START_HOUR = 10
const WITHDRAWAL_WINDOW_END_HOUR = 21

function isWithdrawalWindowOpen(): boolean {
  const istHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()),
    10
  )
  return istHour >= WITHDRAWAL_WINDOW_START_HOUR && istHour < WITHDRAWAL_WINDOW_END_HOUR
}

// Credit the referrer when their referee makes their first deposit.
// Idempotency key `referral_reward:<referral_id>` guarantees exactly-once credit.
async function tryTriggerReferralReward(userId: string, db: Pool, walletSvc: any): Promise<void> {
  try {
    const ref = await db.query(
      `SELECT * FROM referrals WHERE referee_id = $1 AND status = 'pending' LIMIT 1`,
      [userId]
    )
    if (!ref.rows.length) return

    const referral = ref.rows[0]
    const ikey = `referral_reward:${referral.id}`

    // Mark qualified + rewarded atomically in one transaction, then credit outside it
    const client = await db.connect()
    let shouldCredit = false
    try {
      await client.query('BEGIN')
      const lock = await client.query(
        `SELECT id FROM referrals WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [referral.id]
      )
      if (!lock.rows.length) { await client.query('ROLLBACK'); return } // already processed

      await client.query(
        `UPDATE referrals SET status = 'rewarded', qualified_at = NOW(), rewarded_at = NOW() WHERE id = $1`,
        [referral.id]
      )
      await client.query('COMMIT')
      shouldCredit = true
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    if (shouldCredit) {
      await walletSvc.credit({
        userId: referral.referrer_id,
        amount: parseFloat(referral.reward_amount),
        type: 'referral',
        walletType: 'bonus', // promotional money is never withdrawable
        referenceId: referral.id,
        idempotencyKey: ikey,
        description: 'Referral bonus — friend made first deposit',
      })
      const coreApiUrl = process.env.CORE_API_SERVICE_URL || 'http://127.0.0.1:3001'
      const key = process.env.INTERNAL_SERVICE_KEY || ''
      fetch(`${coreApiUrl}/internal/notifications/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': key,
        },
        body: JSON.stringify({
          user_id: referral.referrer_id,
          title: 'Referral Reward Earned 🎁',
          body: `Your friend made their first deposit! You have been credited a referral bonus of ₹${parseFloat(referral.reward_amount).toFixed(2)}.`,
          type: 'referral_reward',
        }),
      }).catch(err => console.error('[referral-reward] notification trigger failed:', err?.message))
    }
  } catch (err) {
    // Non-fatal: log and continue so the deposit itself doesn't fail
    console.error('[referral-reward] failed:', err)
  }
}

const app = Fastify({
  logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' },
  trustProxy: true,
})
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : undefined
const walletSvc = new WalletService(db, redis)

// Online deposits are handled sovereignly via YouPI-PG (Instant UPI QR/Intent) and Manual Transfers.

const ALLOWED_ORIGINS = new Set([
  'https://game.myonlinejoker.com',
  'https://myonlinejoker.com',
  'https://dev.myonlinejoker.com',
])

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true
  if (ALLOWED_ORIGINS.has(origin)) return true
  if (process.env.NODE_ENV !== 'production') {
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true
  }
  return false
}

async function start() {
  await app.register(helmet as any, { crossOriginResourcePolicy: false })
  await app.register(cors as any, {
    origin: (origin: string | undefined, cb: any) => {
      if (isAllowedOrigin(origin)) {
        cb(null, true)
      } else {
        cb(new Error('CORS policy: origin not allowed'), false)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key', 'x-youpi-secret', 'X-Requested-With', 'Accept'],
  })
  await app.register(jwt as any, { secret: process.env.JWT_SECRET! })
  await app.register(multipart as any, { limits: { fileSize: 8 * 1024 * 1024 } }) // 8MB screenshots
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })

  // Production-safe error handler
  app.setErrorHandler((error: any, req, reply) => {
    req.log.error(error)
    if (error.validation) {
      return reply.code(400).send({ error: 'Validation failed', message: error.message })
    }
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
    const clientMessage = statusCode === 500 ? 'An internal error occurred. Please try again.' : error.message
    return reply.code(statusCode).send({ error: clientMessage })
  })

  const authenticate = async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  const authenticateInternal = async (req: any, reply: any) => {
    const key = req.headers['x-internal-key']
    const expected = process.env.INTERNAL_SERVICE_KEY
    if (!expected || key !== expected) return reply.code(403).send({ error: 'Forbidden' })
  }

  // GET /wallet/balance
  app.get('/wallet/balance', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const balance = await walletSvc.getBalance(user.sub)
    return reply.send(balance)
  })

  // GET /wallet/game-history?game_type=teen_patti&limit=20&offset=0
  app.get('/wallet/game-history', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const { game_type, limit = '20', offset = '0' } = req.query as any
    const lim = Math.min(parseInt(limit) || 20, 100)
    const off = parseInt(offset) || 0
    const params: unknown[] = [user.sub, lim, off]
    const gameFilter = game_type && game_type !== 'all'
      ? `AND gr.game_type = $${params.push(game_type)}`
      : ''
    const res = await db.query(
      `SELECT gp.id, gr.id AS room_id, gr.game_type, gr.entry_fee,
              gp.entry_fee_deducted, gp.prize_won, gp.final_rank,
              COALESCE(gp.prize_won,0) - COALESCE(gp.entry_fee_deducted,0) AS net_result,
              gr.started_at, gr.ended_at
       FROM game_participants gp
       JOIN game_rooms gr ON gr.id = gp.room_id
       WHERE gp.user_id = $1 AND gp.is_bot = false AND gr.status = 'completed'
             ${gameFilter}
       ORDER BY gr.ended_at DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      params
    )
    return reply.send(res.rows)
  })

  // GET /wallet/transactions
  app.get('/wallet/transactions', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const { limit = 20, offset = 0 } = req.query as any
    const txns = await walletSvc.getTransactions(user.sub, parseInt(limit), parseInt(offset))
    return reply.send(txns)
  })

  // POST /wallet/deposit/manual (admin only — identified by internal key)
  // request_id must be a stable ID from the admin panel (e.g. UUID generated on form submit)
  // so that retrying the same approval doesn't double-credit.
  app.post('/wallet/deposit/manual', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number().min(1),
      request_id: z.string().min(1),
      description: z.string().optional(),
    }).parse(req.body)

    await walletSvc.credit({
      userId: body.user_id,
      amount: body.amount,
      type: 'manual_credit',
      walletType: 'real',
      idempotencyKey: `manual_credit:${body.request_id}`,
      description: body.description || 'Manual credit by admin',
    })

    // Trigger referral reward for the depositing user (idempotent — no-ops if already rewarded)
    await tryTriggerReferralReward(body.user_id, db, walletSvc)

    const balance = await walletSvc.getBalance(body.user_id)
    return reply.send({ success: true, balance })
  })

  // ---- Manual deposit (UPI / bank / QR) — user-facing ----

  // GET /wallet/deposit/methods — active payment destinations the user can pay to
  app.get('/wallet/deposit/methods', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT id, method_type, label, upi_id, account_name, account_number, ifsc,
              bank_name, qr_image_url, instructions, min_amount, max_amount
       FROM payment_methods WHERE is_active = true ORDER BY sort_order ASC, created_at ASC`
    )
    return reply.send(res.rows)
  })

  // POST /wallet/promo/validate — check if a promo code is valid for given amount
  app.post('/wallet/promo/validate', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({
      code: z.string().min(1),
      amount: z.number().positive(),
    }).parse(req.body)

    const code = body.code.trim().toUpperCase()
    const promo = await db.query(
      `SELECT * FROM promo_codes WHERE code = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (usage_limit IS NULL OR used_count < usage_limit)`,
      [code]
    )
    if (!promo.rows.length) return reply.code(404).send({ error: 'Invalid or expired promo code' })
    const p = promo.rows[0]

    if (body.amount < parseFloat(p.min_deposit)) {
      return reply.code(400).send({ error: `Minimum deposit of ₹${p.min_deposit} required for this code` })
    }

    const usage = await db.query(
      `SELECT COUNT(*) as cnt FROM promo_code_usages WHERE promo_id = $1 AND user_id = $2`,
      [p.id, user.sub]
    )
    if (parseInt(usage.rows[0].cnt) >= p.per_user_limit) {
      return reply.code(400).send({ error: 'You have already used this promo code' })
    }

    let discount = p.discount_type === 'percent'
      ? (body.amount * parseFloat(p.discount_value)) / 100
      : parseFloat(p.discount_value)
    if (p.max_discount) discount = Math.min(discount, parseFloat(p.max_discount))
    discount = Math.round(discount * 100) / 100

    return reply.send({
      valid: true,
      promo_id: p.id,
      code: p.code,
      description: p.description,
      discount_type: p.discount_type,
      discount_value: parseFloat(p.discount_value),
      discount_amount: discount,
      bonus_amount: discount,
    })
  })

  // POST /wallet/deposit/submit — multipart: amount, payment_method_id, reference_number, screenshot
  // Creates a PENDING deposit order with proof. Admin approves it to credit the wallet.
  app.post('/wallet/deposit/submit', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    let amount = 0
    let methodId: string | null = null
    let referenceNumber = ''
    let screenshotUrl: string | null = null

    let promoCode: string | null = null
    const parts = (req as any).parts()
    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename || '').toLowerCase().slice(0, 8) || '.jpg'
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp']
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp']
        if (!allowedExts.includes(ext) || !allowedMimes.includes(part.mimetype)) {
          return reply.code(400).send({ error: 'Only valid JPG, PNG, or WebP screenshot images are allowed' })
        }
        const fname = `${user.sub}_${crypto.randomUUID()}${ext}`
        await pipeline(part.file, fs.createWriteStream(path.join(UPLOAD_DIR, fname)))
        screenshotUrl = `/uploads/deposits/${fname}`
      } else {
        if (part.fieldname === 'amount') amount = parseFloat(part.value as string)
        if (part.fieldname === 'payment_method_id') methodId = part.value as string
        if (part.fieldname === 'reference_number') referenceNumber = (part.value as string).trim()
        if (part.fieldname === 'promo_code') promoCode = (part.value as string)?.trim().toUpperCase() || null
      }
    }

    if (!amount || amount < 1) return reply.code(400).send({ error: 'Invalid amount' })
    if (!referenceNumber) return reply.code(400).send({ error: 'Reference / UTR number required' })

    // Validate against the chosen method's limits (if provided).
    if (methodId) {
      const m = await db.query(`SELECT min_amount, max_amount FROM payment_methods WHERE id = $1 AND is_active = true`, [methodId])
      if (!m.rows.length) return reply.code(400).send({ error: 'Payment method unavailable' })
      const { min_amount, max_amount } = m.rows[0]
      if (amount < parseFloat(min_amount) || amount > parseFloat(max_amount)) {
        return reply.code(400).send({ error: `Amount must be between ₹${min_amount} and ₹${max_amount}` })
      }
    }

    // Validate promo code if provided. The usage row is reserved with
    // INSERT ... ON CONFLICT DO NOTHING inside a transaction *before* the
    // bonus is computed/stored — this is what makes it race-safe: only the
    // request that actually inserts the (promo_id, user_id) row (the DB's
    // UNIQUE constraint is the single source of truth) gets to claim a
    // bonus and increment used_count. A losing racer sees zero rows
    // affected and silently gets no bonus, instead of both racers reading
    // "eligible" before either has committed.
    let promoRow: any = null
    let promoBonus = 0
    if (promoCode) {
      const pr = await db.query(
        `SELECT * FROM promo_codes WHERE code = $1 AND is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (usage_limit IS NULL OR used_count < usage_limit)`,
        [promoCode]
      )
      if (pr.rows.length) {
        promoRow = pr.rows[0]
        if (amount >= parseFloat(promoRow.min_deposit)) {
          const client = await db.connect()
          try {
            await client.query('BEGIN')
            const used = await client.query(
              `SELECT COUNT(*) as cnt FROM promo_code_usages WHERE promo_id = $1 AND user_id = $2`,
              [promoRow.id, user.sub]
            )
            if (parseInt(used.rows[0].cnt) < promoRow.per_user_limit) {
              const reserved = await client.query(
                `INSERT INTO promo_code_usages (promo_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`,
                [promoRow.id, user.sub]
              )
              if (reserved.rows.length) {
                promoBonus = promoRow.discount_type === 'percent'
                  ? (amount * parseFloat(promoRow.discount_value)) / 100
                  : parseFloat(promoRow.discount_value)
                if (promoRow.max_discount) promoBonus = Math.min(promoBonus, parseFloat(promoRow.max_discount))
                promoBonus = Math.round(promoBonus * 100) / 100
                await client.query(`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1`, [promoRow.id])
              }
            }
            await client.query('COMMIT')
          } catch (e) {
            await client.query('ROLLBACK')
            throw e
          } finally {
            client.release()
          }
        }
      }
    }

    const ins = await db.query(
      `INSERT INTO payment_orders
         (user_id, gateway, amount, type, status, reference_number, screenshot_url, payment_method_id, metadata)
       VALUES ($1, 'manual', $2, 'deposit', 'created', $3, $4, $5, $6)
       RETURNING id`,
      [user.sub, amount, referenceNumber, screenshotUrl, methodId,
      JSON.stringify({ submitted_at: new Date().toISOString(), promo_code: promoCode, promo_bonus: promoBonus })]
    )

    if (promoRow && promoBonus > 0) {
      await db.query(`UPDATE promo_code_usages SET deposit_id = $1 WHERE promo_id = $2 AND user_id = $3`,
        [ins.rows[0].id, promoRow.id, user.sub]).catch(() => { })
    }

    return reply.send({
      success: true,
      order_id: ins.rows[0].id,
      promo_bonus: promoBonus,
      message: promoBonus > 0
        ? `Deposit submitted! ₹${promoBonus} bonus will be added on approval.`
        : 'Deposit submitted for review. Your balance updates once an admin approves it.',
    })
  })

  // =========================================================================
  // YouPI-PG Sovereign UPI Gateway (0% Fees, Direct NPCI Intent & Auto-Credit)
  // =========================================================================

  async function getYouPiConfig(): Promise<{
    enabled: boolean
    vpa: string
    merchantName: string
    webhookSecret: string
    minDeposit: number
    maxDeposit: number
    autoCreditUtr: boolean
    autoCreditMaxAmount: number
  }> {
    const res = await db.query(
      `SELECT key, value FROM system_settings WHERE key LIKE 'youpi_%'`
    )
    const cfg: Record<string, string> = {
      youpi_enabled: 'true',
      youpi_vpa: 'Q918286633@ybl',
      youpi_merchant_name: 'MY ONLINE JOKER',
      youpi_webhook_secret: 'youpi_sec_moj_2026_prod',
      youpi_min_deposit: '100',
      youpi_max_deposit: '50000',
      youpi_auto_credit_utr: 'true',
      youpi_auto_credit_max: '50000',
    }
    for (const row of res.rows) {
      cfg[row.key] = row.value
    }
    return {
      enabled: cfg.youpi_enabled !== 'false',
      vpa: cfg.youpi_vpa || 'Q918286633@ybl',
      merchantName: cfg.youpi_merchant_name || 'MY ONLINE JOKER',
      webhookSecret: cfg.youpi_webhook_secret || 'youpi_sec_moj_2026_prod',
      minDeposit: parseFloat(cfg.youpi_min_deposit || '100'),
      maxDeposit: parseFloat(cfg.youpi_max_deposit || '50000'),
      autoCreditUtr: cfg.youpi_auto_credit_utr !== 'false',
      autoCreditMaxAmount: parseFloat(cfg.youpi_auto_credit_max || '50000'),
    }
  }

  function parseUpiNotification(body: any): {
    amount?: number
    utr?: string
    orderId?: string
    payerVpa?: string
    rawText: string
  } {
    const rawParts = [
      body.title,
      body.message,
      body.text,
      body.body,
      body.content,
      body.raw_sms,
      body.rawText,
      body.notification
    ].filter(v => typeof v === 'string' && v.trim().length > 0)

    const rawText = rawParts.length > 0
      ? rawParts.join(' ')
      : (typeof body === 'string' ? body : JSON.stringify(body)).toString()

    let amount: number | undefined
    if (body.amount !== undefined && !isNaN(parseFloat(body.amount))) {
      amount = parseFloat(body.amount)
    } else if (body.amountPaise !== undefined && !isNaN(parseFloat(body.amountPaise))) {
      amount = parseFloat(body.amountPaise) / 100
    } else {
      const amtMatch =
        rawText.match(/(?:credited\s*(?:by|with)?\s*(?:rs\.?|inr|₹)?\s*|rec(?:eive)?d\s*(?:rs\.?|inr|₹)?\s*|payment\s*(?:of)?\s*(?:rs\.?|inr|₹)?\s*|(?:rs\.?|inr|₹)\s*)([0-9]+(?:\.[0-9]{1,2})?)/i) ||
        rawText.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)?\s*(?:credited|received)/i) ||
        rawText.match(/(?:rs\.?|inr|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)/i)
      if (amtMatch && amtMatch[1]) {
        amount = parseFloat(amtMatch[1])
      }
    }

    let utr: string | undefined
    if (body.utr && typeof body.utr === 'string' && body.utr.trim().length >= 10) {
      utr = body.utr.trim()
    } else if (body.paymentId && typeof body.paymentId === 'string' && body.paymentId.trim().length >= 10) {
      utr = body.paymentId.trim()
    } else if (body.rrn && typeof body.rrn === 'string' && body.rrn.trim().length >= 10) {
      utr = body.rrn.trim()
    } else if (body.transactionId && typeof body.transactionId === 'string' && body.transactionId.trim().length >= 10) {
      utr = body.transactionId.trim()
    } else {
      const utrMatch = rawText.match(
        /(?:upi\/(?:ref\s*)?|rrn\s*[:\s]?|ref\s*(?:no\.?)?[:\s]?|utr\s*[:\s]?|txn\s*(?:id)?\s*[:\s]?)(\d{12})/i
      ) || rawText.match(/\b\d{12}\b/)
      if (utrMatch && utrMatch[1]) {
        utr = utrMatch[1]
      } else if (utrMatch && utrMatch[0]) {
        utr = utrMatch[0]
      }
    }

    let orderId: string | undefined
    if (body.order_id && typeof body.order_id === 'string') {
      orderId = body.order_id.trim()
    } else if (body.orderId && typeof body.orderId === 'string') {
      orderId = body.orderId.trim()
    } else {
      const orderMatch = rawText.match(/\b(MOJ[A-Z0-9]{6,16})\b/i)
      if (orderMatch && orderMatch[1]) {
        orderId = orderMatch[1].toUpperCase()
      }
    }

    let payerVpa: string | undefined
    if (body.payer_vpa && typeof body.payer_vpa === 'string') {
      payerVpa = body.payer_vpa.trim()
    } else if (body.payerVpa && typeof body.payerVpa === 'string') {
      payerVpa = body.payerVpa.trim()
    } else {
      const vpaMatch = rawText.match(/\b([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32})\b/)
      if (vpaMatch && vpaMatch[1]) {
        payerVpa = vpaMatch[1].toLowerCase()
      }
    }

    return { amount, utr, orderId, payerVpa, rawText }
  }

  // 1. POST /wallet/youpi/create-order (Client app initiates an instant UPI deposit)
  app.post('/wallet/youpi/create-order', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({
      amount: z.number().positive(),
      promo_code: z.string().optional(),
    }).parse(req.body)

    const cfg = await getYouPiConfig()
    if (!cfg.enabled) {
      return reply.code(503).send({ error: 'Instant UPI gateway is currently undergoing maintenance. Please use manual deposit.' })
    }

    if (body.amount < cfg.minDeposit || body.amount > cfg.maxDeposit) {
      return reply.code(400).send({
        error: `Deposit amount must be between ₹${cfg.minDeposit} and ₹${cfg.maxDeposit}`
      })
    }

    // Unique order ID e.g. MOJ + timestamp slice + random 3-digit
    const orderId = `MOJ${Date.now().toString().slice(-7)}${Math.floor(100 + Math.random() * 900)}`

    // NPCI UPI Intent URI standard (no 'tr' for retail merchant VPAs to prevent bank switch validation errors)
    const params = new URLSearchParams()
    params.set('pa', cfg.vpa.trim())
    params.set('pn', cfg.merchantName.trim())
    params.set('am', body.amount.toFixed(2))
    params.set('cu', 'INR')
    params.set('tn', orderId)
    const upiIntentUrl = `upi://pay?${params.toString()}`

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000) // 20 mins validity

    // 2. Register session in YouPI Gateway Core (http://127.0.0.1:6100)
    let checkoutUrl = `https://wallet.myonlinejoker.com/checkout/${orderId}`
    let youpiPaymentId: string | null = null
    try {
      const youpiApiRes = await fetch('http://127.0.0.1:6100/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          amount: body.amount,
          currency: 'INR',
          autoActivate: true,
          customer: {
            mobileNumber: user.phone || '9999999999',
            email: user.email || `${user.sub}@myonlinejoker.com`,
            name: user.name || 'Player'
          }
        })
      })
      if (youpiApiRes.ok) {
        const youpiData = await youpiApiRes.json() as any
        if (youpiData && youpiData.paymentId) {
          youpiPaymentId = youpiData.paymentId
          checkoutUrl = youpiData.checkoutUrl || `https://wallet.myonlinejoker.com/checkout/${youpiData.paymentId}`
        }
      }
    } catch (apiErr: any) {
      req.log.warn({ err: apiErr.message }, '[youpi-gateway] Could not pre-register session in YouPI engine')
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      // Insert YouPI order record
      const youpiRes = await client.query(
        `INSERT INTO youpi_orders (user_id, order_id, amount, vpa, merchant_name, upi_intent_url, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
         RETURNING id`,
        [user.sub, orderId, body.amount, cfg.vpa, cfg.merchantName, upiIntentUrl, expiresAt.toISOString()]
      )

      // Insert matching payment_orders record for global ledger / reconciliation
      await client.query(
        `INSERT INTO payment_orders (user_id, gateway, gateway_order_id, amount, type, status, metadata)
         VALUES ($1, 'youpi', $2, $3, 'deposit', 'created', $4)`,
        [user.sub, orderId, body.amount, JSON.stringify({
          youpi_id: youpiRes.rows[0].id,
          youpi_payment_id: youpiPaymentId,
          vpa: cfg.vpa,
          promo_code: body.promo_code || null,
        })]
      )

      await client.query('COMMIT')

      return reply.send({
        success: true,
        order_id: orderId,
        payment_id: youpiPaymentId,
        amount: body.amount,
        vpa: cfg.vpa,
        merchant_name: cfg.merchantName,
        upi_intent_url: upiIntentUrl,
        qr_data: upiIntentUrl,
        checkout_url: checkoutUrl,
        expires_at: expiresAt.toISOString(),
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // 2. GET /wallet/youpi/order/:orderId/status (Client app polls or checks payment progress)
  app.get('/wallet/youpi/order/:orderId/status', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const { orderId } = req.params as any

    const res = await db.query(
      `SELECT order_id, amount, vpa, merchant_name, status, utr, paid_at, expires_at, created_at
       FROM youpi_orders
       WHERE order_id = $1 AND user_id = $2`,
      [orderId, user.sub]
    )

    if (!res.rows.length) {
      return reply.code(404).send({ error: 'Order not found' })
    }

    const order = res.rows[0]
    // Check auto-expiry
    if (order.status === 'PENDING' && new Date(order.expires_at).getTime() < Date.now()) {
      await db.query(`UPDATE youpi_orders SET status = 'EXPIRED' WHERE order_id = $1`, [orderId])
      order.status = 'EXPIRED'
    }

    return reply.send({
      success: true,
      order_id: order.order_id,
      amount: parseFloat(order.amount),
      status: order.status,
      utr: order.utr,
      paid_at: order.paid_at,
      expires_at: order.expires_at,
      created_at: order.created_at,
    })
  })

  // 3. POST /wallet/youpi/order/:orderId/verify-utr (Player manually submits 12-digit UTR if bank SMS was delayed)
  app.post('/wallet/youpi/order/:orderId/verify-utr', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const { orderId } = req.params as any
    const body = z.object({
      utr: z.string().regex(/^\d{12}$/, 'UTR must be exactly 12 digits'),
    }).parse(req.body)

    const orderRes = await db.query(
      `SELECT * FROM youpi_orders WHERE order_id = $1 AND user_id = $2`,
      [orderId, user.sub]
    )
    if (!orderRes.rows.length) {
      return reply.code(404).send({ error: 'Order not found' })
    }
    const order = orderRes.rows[0]

    if (order.status === 'SUCCESS') {
      return reply.send({ success: true, status: 'SUCCESS', message: 'Order is already paid and credited.' })
    }

    // Check if UTR is already credited on another order
    const dupeCheck = await db.query(
      `SELECT id, order_id, status FROM youpi_orders WHERE utr = $1 AND status = 'SUCCESS'`,
      [body.utr]
    )
    if (dupeCheck.rows.length) {
      return reply.code(400).send({ error: 'This UTR has already been claimed on another transaction.' })
    }

    // Check if an UNMATCHED bank webhook already recorded this UTR!
    const unmatchedCheck = await db.query(
      `SELECT * FROM youpi_orders WHERE utr = $1 AND status = 'UNMATCHED'`,
      [body.utr]
    )

    if (unmatchedCheck.rows.length) {
      // Auto-match and credit immediately!
      const unmatched = unmatchedCheck.rows[0]
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `UPDATE youpi_orders SET status = 'SUCCESS', utr = $1, paid_at = NOW(), raw_sms = $2 WHERE id = $3`,
          [body.utr, unmatched.raw_sms, order.id]
        )
        // Delete the temporary unmatched row
        await client.query(`DELETE FROM youpi_orders WHERE id = $1`, [unmatched.id])
        await client.query(
          `UPDATE payment_orders SET status = 'paid', gateway_payment_id = $1, updated_at = NOW() WHERE gateway_order_id = $2`,
          [body.utr, order.order_id]
        )
        await walletSvc.credit({
          userId: user.sub,
          amount: parseFloat(order.amount),
          type: 'deposit',
          walletType: 'real',
          referenceId: order.order_id,
          idempotencyKey: `youpi_utr_${body.utr}`,
          description: `Instant UPI Auto-Credit (UTR: ${body.utr})`,
        }, client)

        await client.query('COMMIT')

        await tryTriggerReferralReward(user.sub, db, walletSvc)

        return reply.send({
          success: true,
          status: 'SUCCESS',
          credited: true,
          amount: parseFloat(order.amount),
          message: 'Payment verified and wallet credited!'
        })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }

    // If bank SMS hasn't arrived yet, check if Auto-Credit on valid UTR is active
    const cfg = await getYouPiConfig()
    const autoCreditEnabled = cfg.autoCreditUtr && parseFloat(order.amount) <= cfg.autoCreditMaxAmount

    if (autoCreditEnabled) {
      const client = await db.connect()
      try {
        await client.query('BEGIN')

        // Lock row to prevent concurrent race conditions
        const lockRes = await client.query(
          `SELECT * FROM youpi_orders WHERE id = $1 FOR UPDATE`,
          [order.id]
        )
        if (!lockRes.rows.length) {
          await client.query('ROLLBACK')
          return reply.code(404).send({ error: 'Order not found' })
        }
        const currentOrder = lockRes.rows[0]
        if (currentOrder.status === 'SUCCESS') {
          await client.query('ROLLBACK')
          return reply.send({ success: true, status: 'SUCCESS', credited: true, message: 'Order is already paid and credited.' })
        }

        await client.query(
          `UPDATE youpi_orders 
           SET status = 'SUCCESS', utr = $1, paid_at = NOW(), updated_at = NOW() 
           WHERE id = $2`,
          [body.utr, currentOrder.id]
        )

        await client.query(
          `UPDATE payment_orders 
           SET status = 'paid', gateway_payment_id = $1, updated_at = NOW() 
           WHERE gateway_order_id = $2`,
          [body.utr, currentOrder.order_id]
        )

        await walletSvc.credit({
          userId: user.sub,
          amount: parseFloat(currentOrder.amount),
          type: 'deposit',
          walletType: 'real',
          referenceId: currentOrder.order_id,
          idempotencyKey: `youpi_utr_${body.utr}`,
          description: `Instant UPI Auto-Credit (UTR: ${body.utr})`,
        }, client)

        await client.query('COMMIT')

        await tryTriggerReferralReward(user.sub, db, walletSvc)

        const coreApiUrl = process.env.CORE_API_SERVICE_URL || 'http://127.0.0.1:3001'
        const key = process.env.INTERNAL_SERVICE_KEY || ''
        fetch(`${coreApiUrl}/internal/notifications/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
          body: JSON.stringify({
            user_id: user.sub,
            title: 'Deposit Successful ⚡',
            body: `₹${parseFloat(currentOrder.amount).toFixed(2)} credited to your wallet instantly via UPI!`,
            type: 'deposit_success',
          }),
        }).catch(() => {})

        // Notify YouPI-PG core engine if session is active
        try {
          fetch('http://127.0.0.1:6100/api/v1/pollers/events', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer youpi_observer_moj_2026_secure_token'
            },
            body: JSON.stringify({
              receivingAccountId: '613b50dd-5634-4dd6-ba67-53e9d3d4f28c',
              source: 'DIRECT_APP_UTR',
              amountPaise: Math.round(parseFloat(currentOrder.amount) * 100),
              utr: body.utr,
              bankReferenceNumber: body.utr,
              paymentSessionId: currentOrder.order_id,
              rawText: `Direct App UPI Payment of Rs ${currentOrder.amount} UTR ${body.utr} to 9849495032-3@ybl`
            })
          }).catch(() => {})
        } catch {}

        return reply.send({
          success: true,
          status: 'SUCCESS',
          credited: true,
          amount: parseFloat(currentOrder.amount),
          message: `Payment verified and ₹${parseFloat(currentOrder.amount).toFixed(2)} credited to your wallet!`
        })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }

    // Fallback: If auto-credit is disabled by admin, save UTR and await manual approval
    await db.query(`UPDATE youpi_orders SET utr = $1 WHERE id = $2`, [body.utr, order.id])

    return reply.send({
      success: true,
      status: 'PENDING',
      message: 'UTR registered and queued for review. Balance will update shortly.',
    })
  })

  // 4. GET /wallet/youpi/webhook (Health check / status)
  app.get('/wallet/youpi/webhook', async (_req, reply) => {
    return reply.send({
      status: 'active',
      service: 'YouPI Webhook Listener',
      method: 'POST required for event dispatch',
      time: new Date().toISOString()
    })
  })

  // POST /wallet/youpi/webhook (Observer app / SMS forwarder endpoint)
  app.post('/wallet/youpi/webhook', async (req, reply) => {
    const cfg = await getYouPiConfig()
    const query = req.query as any
    const body = (req.body || {}) as any
    const sigHeader = (req.headers['x-gateway-signature'] || '') as string
    const secret = req.headers['x-youpi-secret'] || query.secret || body.secret

    let isAuthorized = false
    if (secret && secret === cfg.webhookSecret) {
      isAuthorized = true
    } else if (sigHeader && sigHeader.startsWith('sha256=')) {
      const signature = sigHeader.slice(7).trim()
      const rawPayload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      const expectedSig = crypto.createHmac('sha256', cfg.webhookSecret).update(rawPayload).digest('hex')
      if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        isAuthorized = true
      }
    }

    if (!isAuthorized) {
      req.log.warn({ ip: req.ip }, '[youpi-webhook] Unauthorized webhook attempt')
      return reply.code(401).send({ error: 'Unauthorized: Invalid secret or signature' })
    }

    const { amount, utr, orderId, payerVpa, rawText } = parseUpiNotification(body)

    if (!amount || amount <= 0) {
      req.log.info({ rawText }, '[youpi-webhook] Ignored: No credit amount found in notification')
      return reply.send({ success: false, message: 'No valid credit amount detected' })
    }

    // Check duplicate UTR
    if (utr) {
      const dupe = await db.query(
        `SELECT id, order_id, user_id, amount FROM youpi_orders WHERE utr = $1 AND status = 'SUCCESS'`,
        [utr]
      )
      if (dupe.rows.length) {
        return reply.send({ success: true, message: 'Payment already credited', duplicate: true, utr })
      }
    }

    // Attempt to match pending order:
    // Strategy 1: Match by exact orderId (e.g. MOJ1234567)
    // Strategy 2: Match by exact UTR if user pre-submitted it in verify-utr
    // Strategy 3: Match by exact amount in the last 25 minutes
    let matchedOrder: any = null

    if (orderId) {
      const oRes = await db.query(
        `SELECT * FROM youpi_orders WHERE order_id = $1 AND status = 'PENDING'`,
        [orderId]
      )
      if (oRes.rows.length) matchedOrder = oRes.rows[0]
    }

    if (!matchedOrder && utr) {
      const uRes = await db.query(
        `SELECT * FROM youpi_orders WHERE utr = $1 AND status = 'PENDING'`,
        [utr]
      )
      if (uRes.rows.length) matchedOrder = uRes.rows[0]
    }

    if (!matchedOrder) {
      // Amount match in last 25 mins
      const aRes = await db.query(
        `SELECT * FROM youpi_orders 
         WHERE amount = $1 AND status = 'PENDING' AND created_at >= NOW() - INTERVAL '25 minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [amount]
      )
      if (aRes.rows.length) matchedOrder = aRes.rows[0]
    }

    if (matchedOrder) {
      const client = await db.connect()
      try {
        await client.query('BEGIN')

        await client.query(
          `UPDATE youpi_orders
           SET status = 'SUCCESS',
               utr = COALESCE($1, utr),
               payer_vpa = COALESCE($2, payer_vpa),
               raw_sms = $3,
               paid_at = NOW(),
               updated_at = NOW()
           WHERE id = $4`,
          [utr || null, payerVpa || null, rawText, matchedOrder.id]
        )

        await client.query(
          `UPDATE payment_orders
           SET status = 'paid',
               gateway_payment_id = COALESCE($1, gateway_order_id),
               updated_at = NOW()
           WHERE gateway_order_id = $2`,
          [utr || null, matchedOrder.order_id]
        )

        const idemKey = utr ? `youpi_utr_${utr}` : `youpi_order_${matchedOrder.order_id}`
        await walletSvc.credit({
          userId: matchedOrder.user_id,
          amount: parseFloat(matchedOrder.amount),
          type: 'deposit',
          walletType: 'real',
          referenceId: matchedOrder.order_id,
          idempotencyKey: idemKey,
          description: `Instant UPI Auto-Credit (UTR: ${utr || 'Direct'})`,
        }, client)

        await client.query('COMMIT')

        // Trigger referral rewards & push notification
        await tryTriggerReferralReward(matchedOrder.user_id, db, walletSvc)

        const coreApiUrl = process.env.CORE_API_SERVICE_URL || 'http://127.0.0.1:3001'
        const key = process.env.INTERNAL_SERVICE_KEY || ''
        fetch(`${coreApiUrl}/internal/notifications/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
          body: JSON.stringify({
            user_id: matchedOrder.user_id,
            title: 'Deposit Successful ⚡',
            body: `₹${parseFloat(matchedOrder.amount).toFixed(2)} credited to your wallet instantly via UPI!`,
            type: 'deposit_success',
          }),
        }).catch(() => { })

        return reply.send({
          success: true,
          matched: true,
          order_id: matchedOrder.order_id,
          amount,
          utr,
        })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    } else {
      // Payment arrived at bank, but couldn't be auto-matched to an active pending order.
      // Save as UNMATCHED so admin can review and link with 1-click on the dashboard!
      const unmatchedOrderId = `UNMATCHED_${Date.now()}`
      await db.query(
        `INSERT INTO youpi_orders (order_id, amount, vpa, merchant_name, upi_intent_url, utr, payer_vpa, raw_sms, status, expires_at)
         VALUES ($1, $2, $3, $4, '', $5, $6, $7, 'UNMATCHED', NOW() + INTERVAL '7 days')`,
        [unmatchedOrderId, amount, cfg.vpa, cfg.merchantName, utr || null, payerVpa || null, rawText]
      )

      return reply.send({
        success: true,
        matched: false,
        message: 'Bank payment received and recorded for admin reconciliation',
        amount,
        utr,
      })
    }
  })

  // 5. Admin / Internal: GET /wallet/youpi/admin/orders
  app.get('/wallet/youpi/admin/orders', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const { status, limit = '50', offset = '0', search } = req.query as any
    const conditions: string[] = []
    const params: any[] = []
    let pIdx = 1

    if (status && status !== 'all') {
      conditions.push(`yo.status = $${pIdx++}`)
      params.push(status)
    }

    if (search) {
      conditions.push(`(yo.order_id ILIKE $${pIdx} OR yo.utr ILIKE $${pIdx} OR u.username ILIKE $${pIdx} OR u.phone ILIKE $${pIdx})`)
      params.push(`%${search}%`)
      pIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const lim = Math.min(parseInt(limit) || 50, 100)
    const off = parseInt(offset) || 0

    const [rows, count] = await Promise.all([
      db.query(
        `SELECT yo.*, u.username, u.phone
         FROM youpi_orders yo
         LEFT JOIN users u ON u.id = yo.user_id
         ${where}
         ORDER BY yo.created_at DESC
         LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, lim, off]
      ),
      db.query(`SELECT COUNT(*) FROM youpi_orders yo LEFT JOIN users u ON u.id = yo.user_id ${where}`, params),
    ])

    return reply.send({
      orders: rows.rows,
      total: parseInt(count.rows[0].count),
    })
  })

  // 6. Admin / Internal: POST /wallet/youpi/admin/orders/:orderId/manual-credit
  app.post('/wallet/youpi/admin/orders/:orderId/manual-credit', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const { orderId } = req.params as any
    const body = z.object({
      user_id: z.string().uuid().optional(),
      utr: z.string().optional(),
      admin_note: z.string().optional(),
    }).parse(req.body)

    const orderRes = await db.query(`SELECT * FROM youpi_orders WHERE order_id = $1`, [orderId])
    if (!orderRes.rows.length) return reply.code(404).send({ error: 'Order not found' })

    const order = orderRes.rows[0]
    if (order.status === 'SUCCESS') {
      return reply.code(400).send({ error: 'Order is already credited and marked SUCCESS' })
    }

    const targetUserId = order.user_id || body.user_id
    if (!targetUserId) {
      return reply.code(400).send({ error: 'User ID is required to credit this unmatched order' })
    }

    const finalUtr = body.utr || order.utr || `MANUAL_${Date.now()}`

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE youpi_orders
         SET user_id = $1, status = 'SUCCESS', utr = $2, paid_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [targetUserId, finalUtr, order.id]
      )

      await client.query(
        `UPDATE payment_orders
         SET status = 'paid', gateway_payment_id = $1, updated_at = NOW()
         WHERE gateway_order_id = $2`,
        [finalUtr, order.order_id]
      )

      await walletSvc.credit({
        userId: targetUserId,
        amount: parseFloat(order.amount),
        type: 'deposit',
        walletType: 'real',
        referenceId: order.order_id,
        idempotencyKey: `youpi_manual_admin_${order.id}`,
        description: `YouPI Manual Credit by Admin${body.admin_note ? `: ${body.admin_note}` : ''}`,
      }, client)

      await client.query('COMMIT')

      await tryTriggerReferralReward(targetUserId, db, walletSvc)

      return reply.send({ success: true, message: `Credited ₹${order.amount} to user successfully!` })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // 7. Admin / Internal: GET /wallet/youpi/admin/settings
  app.get('/wallet/youpi/admin/settings', { onRequest: [authenticateInternal] }, async (_req, reply) => {
    const cfg = await getYouPiConfig()
    return reply.send({
      ...cfg,
      webhook_url: 'https://game.myonlinejoker.com/api/wallet/youpi/webhook',
    })
  })

  // 8. Admin / Internal: POST /wallet/youpi/admin/settings
  app.post('/wallet/youpi/admin/settings', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      youpi_enabled: z.boolean().optional(),
      youpi_vpa: z.string().min(3).optional(),
      youpi_merchant_name: z.string().min(2).optional(),
      youpi_webhook_secret: z.string().min(6).optional(),
      youpi_min_deposit: z.number().min(1).optional(),
      youpi_max_deposit: z.number().min(100).optional(),
      youpi_auto_credit_utr: z.boolean().optional(),
      youpi_auto_credit_max: z.number().min(1).optional(),
    }).parse(req.body)

    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) {
        await db.query(
          `INSERT INTO system_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [k, String(v)]
        )
      }
    }

    const cfg = await getYouPiConfig()
    return reply.send({ success: true, settings: cfg })
  })

  // POST /wallet/debit/manual (admin only — identified by internal key)
  // request_id must be a stable ID from the admin panel to prevent double-debit on retry.
  app.post('/wallet/debit/manual', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number().min(1),
      request_id: z.string().min(1),
      description: z.string().optional(),
    }).parse(req.body)

    try {
      await walletSvc.debit({
        userId: body.user_id,
        amount: body.amount,
        type: 'manual_debit',
        walletType: 'real',
        idempotencyKey: `manual_debit:${body.request_id}`,
        description: body.description || 'Manual debit by admin',
      })
    } catch (err: any) {
      if (err?.message === 'Insufficient balance') {
        return reply.code(400).send({ error: 'Insufficient balance' })
      }
      throw err
    }
    const balance = await walletSvc.getBalance(body.user_id)
    return reply.send({ success: true, balance })
  })

  // POST /wallet/withdraw/request
  // Locks the withdrawal amount immediately so the user can't spend it while pending.
  app.post('/wallet/withdraw/request', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({
      amount: z.number().min(MIN_WITHDRAWAL_AMOUNT).max(MAX_WITHDRAWAL_AMOUNT),
    }).parse(req.body)

    if (!isWithdrawalWindowOpen()) {
      return reply.code(403).send({ error: `Withdrawals are open ${WITHDRAWAL_WINDOW_START_HOUR}:00 AM - ${WITHDRAWAL_WINDOW_END_HOUR - 12}:00 PM IST` })
    }

    // KYC check first
    const kycRes = await db.query('SELECT kyc_status FROM users WHERE id = $1', [user.sub])
    if (kycRes.rows[0]?.kyc_status !== 'approved') {
      return reply.code(403).send({ error: 'KYC verification required before withdrawal' })
    }

    // risk-service sets fraud:flagged:<userId> (auto, 24h TTL, on a 'block'
    // verdict; or manually via admin, 7d TTL) but nothing previously read it
    // back anywhere — the entire fraud-detection pipeline was observational
    // only. Withdrawal is the highest-leverage, lowest-collateral-damage
    // enforcement point: it holds real money movement without preventing
    // the user from playing or contesting the flag, and the key self-expires
    // (or an admin can clear it via risk-service's setUserFlag). See
    // docs/Bugs/fraud-action-never-enforced.md.
    if (redis) {
      const flagged = await redis.exists(`fraud:flagged:${user.sub}`)
      if (flagged) {
        return reply.code(403).send({ error: 'Withdrawals are on hold pending a security review. Contact support if you believe this is a mistake.' })
      }
    }

    // Payout destination must be the user's own admin-verified bank account —
    // never trust client-supplied account details for where money is sent.
    const bankRes = await db.query(
      `SELECT holder_name, bank_name, account_number, ifsc_code, upi_id, verified
       FROM bank_details WHERE user_id = $1`,
      [user.sub]
    )
    const bank = bankRes.rows[0]
    if (!bank || bank.verified !== true) {
      return reply.code(400).send({ error: 'Add and verify your bank details before withdrawing' })
    }

    // Lock the amount in a transaction so balance + order creation are atomic
    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const walletRes = await client.query(
        'SELECT real_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [user.sub]
      )
      const realBalance = parseFloat(walletRes.rows[0]?.real_balance ?? '0')
      if (realBalance < body.amount) {
        await client.query('ROLLBACK')
        return reply.code(400).send({ error: 'Insufficient balance' })
      }

      // Move amount to locked_balance so it can't be spent during review
      await client.query(
        'UPDATE wallets SET real_balance = real_balance - $1, locked_balance = locked_balance + $1 WHERE user_id = $2',
        [body.amount, user.sub]
      )

      const orderRes = await client.query(
        `INSERT INTO payment_orders (user_id, gateway, amount, type, status, metadata)
         VALUES ($1, 'manual', $2, 'withdrawal', 'created', $3) RETURNING id`,
        [user.sub, body.amount, JSON.stringify({
          holder_name: bank.holder_name,
          bank_name: bank.bank_name,
          account_number: bank.account_number,
          ifsc_code: bank.ifsc_code,
          upi_id: bank.upi_id,
        })]
      )

      // Log the lock
      await client.query(
        `INSERT INTO wallet_transactions
           (user_id, type, wallet_type, amount, balance_before, balance_after, reference_id, idempotency_key, status, description)
         VALUES ($1, 'withdrawal', 'real', $2, $3, $4, $5, $6, 'pending', 'Withdrawal pending admin approval')`,
        [user.sub, body.amount, realBalance, realBalance - body.amount,
        orderRes.rows[0].id, `withdraw:${orderRes.rows[0].id}`]
      )

      await client.query('COMMIT')
      return reply.send({ success: true, order_id: orderRes.rows[0].id, message: 'Withdrawal request submitted. Processed within 24 hours.' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Internal: POST /internal/wallet/lock (called by game-gateway)
  // lock_id must be a unique ID per individual lock call so retries are safe
  // but different bets in the same room each succeed.
  app.post('/internal/wallet/lock', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number().positive(),
      room_id: z.string(),
      lock_id: z.string().optional(),
    }).parse(req.body)
    const lockId = body.lock_id || crypto.randomUUID()
    await walletSvc.lockForGame(body.user_id, body.amount, body.room_id, lockId)
    return reply.send({ success: true })
  })

  // Internal: POST /internal/wallet/unlock (called by game-gateway on termination/cancel)
  app.post('/internal/wallet/unlock', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({ user_id: z.string().uuid(), amount: z.number().positive(), room_id: z.string() }).parse(req.body)
    await walletSvc.unlockFunds(body.user_id, body.amount, body.room_id)
    return reply.send({ success: true })
  })

  // Internal: POST /internal/wallet/consume (called on withdrawal approval)
  app.post('/internal/wallet/consume', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({ user_id: z.string().uuid(), amount: z.number().positive(), room_id: z.string() }).parse(req.body)
    await walletSvc.consumeLockedFunds(body.user_id, body.amount, undefined, body.room_id)
    return reply.send({ success: true })
  })


  // Internal: POST /internal/wallet/settle-game (called by game-gateway at game end)
  // Each player's fund consumption is independent so one player's issue doesn't
  // block the winner from being credited. The winner credit is the critical path.
  app.post('/internal/wallet/settle-game', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      room_id: z.string(),
      winner_id: z.string().uuid().nullable(),
      prize: z.number().nonnegative(),
      players: z.array(z.object({
        user_id: z.string().uuid(),
        entry_fee: z.number().nonnegative()
      }))
    }).parse(req.body)

    // Step 1: Consume each player's locked funds independently.
    // If one player's consumption fails (edge case), log and continue — don't
    // block the rest of settlement. consumeLockedFunds is idempotent so any
    // failed ones can be retried later.
    const consumeErrors: string[] = []
    for (const p of body.players) {
      try {
        await walletSvc.consumeLockedFunds(p.user_id, p.entry_fee, undefined, body.room_id)
      } catch (err: any) {
        console.error(`[wallet] settle-game consume failed user=${p.user_id} room=${body.room_id}: ${err?.message}`)
        consumeErrors.push(p.user_id)
      }
    }

    // Step 2: Credit winner in its own transaction (most critical step).
    if (body.winner_id && body.prize > 0) {
      await walletSvc.credit({
        userId: body.winner_id,
        amount: body.prize,
        type: 'game_credit',
        walletType: 'real',
        referenceId: body.room_id,
        idempotencyKey: `win:${body.room_id}:${body.winner_id}`,
        description: `Game win: room ${body.room_id}`,
      })
    }

    return reply.send({ success: true, consume_errors: consumeErrors.length ? consumeErrors : undefined })
  })

  // Internal: POST /internal/wallet/credit (called by game-gateway after game result or manually on status change)
  app.post('/internal/wallet/credit', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number().positive(),
      type: z.enum(['game_credit', 'bonus', 'referral', 'manual_credit']),
      reference_id: z.string().optional(),
      idempotency_key: z.string(),
      description: z.string().optional(),
    }).parse(req.body)

    // Promotional credits (daily bonus, promo codes, referrals) always land in
    // the bonus wallet — bonus money is never withdrawable. Game winnings and
    // manual admin credits go to the real (withdrawable) wallet.
    const walletType = body.type === 'bonus' || body.type === 'referral' ? 'bonus' : 'real'

    await walletSvc.credit({
      userId: body.user_id,
      amount: body.amount,
      type: body.type,
      walletType,
      referenceId: body.reference_id,
      idempotencyKey: body.idempotency_key,
      description: body.description
        || (body.type === 'manual_credit' ? `Manual credit: ${body.reference_id || ''}` : `Game prize: ${body.reference_id}`),
    })
    return reply.send({ success: true })
  })

  // Internal: POST /internal/wallet/debit (called by betting-service to take a
  // stake when a user places a Matka/Lottery/Cricket bet). Idempotent.
  app.post('/internal/wallet/debit', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number().positive(),
      reference_id: z.string().optional(),
      idempotency_key: z.string(),
      description: z.string().optional(),
    }).parse(req.body)
    try {
      await walletSvc.debit({
        userId: body.user_id,
        amount: body.amount,
        type: 'game_debit',
        walletType: 'real',
        referenceId: body.reference_id,
        idempotencyKey: body.idempotency_key,
        description: body.description || `Bet stake: ${body.reference_id}`,
      })
      return reply.send({ success: true })
    } catch (err: any) {
      const msg = err?.message === 'Insufficient balance' ? 'Insufficient balance' : 'Debit failed'
      return reply.code(400).send({ error: msg })
    }
  })


  app.get('/health', async () => ({ status: 'ok', service: 'wallet' }))

  const port = parseInt(process.env.PORT || '3003')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Wallet service running on port ${port}`)
}

start().catch((err) => { console.error(err); process.exit(1) })
