import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { Pool } from 'pg'
import Razorpay from 'razorpay'
import crypto from 'crypto'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import Redis from 'ioredis'
import { WalletService } from './wallet.service'

// Where uploaded deposit screenshots are stored (served by nginx at /uploads/).
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/opt/teen/uploads/deposits'

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

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : undefined
const walletSvc = new WalletService(db, redis)

// Razorpay is optional — manual UPI/bank deposits are the primary flow.
// Only construct the client when keys are configured so the service boots
// without them (online gateway routes will 503 until keys are provided).
const razorpay: Razorpay | null = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    })
  : null

async function start() {
  await app.register(helmet, { crossOriginResourcePolicy: false })
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } }) // 8MB screenshots
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })

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

  // POST /wallet/deposit/create-order
  app.post('/wallet/deposit/create-order', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({ amount: z.number().min(10).max(100000) }).parse(req.body)

    if (!razorpay) {
      return reply.code(503).send({ error: 'Online payment gateway not configured. Use manual deposit.' })
    }
    const order = await razorpay.orders.create({
      amount: body.amount * 100, // paise
      currency: 'INR',
      receipt: `dep_${user.sub}_${Date.now()}`,
    })

    await db.query(
      `INSERT INTO payment_orders (user_id, gateway, gateway_order_id, amount, type, status)
       VALUES ($1, 'razorpay', $2, $3, 'deposit', 'created')`,
      [user.sub, order.id, body.amount]
    )

    return reply.send({ order_id: order.id, amount: body.amount, key_id: process.env.RAZORPAY_KEY_ID })
  })

  // POST /wallet/deposit/verify
  app.post('/wallet/deposit/verify', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    }).parse(req.body)

    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
      .digest('hex')

    if (expectedSig !== body.razorpay_signature) {
      return reply.code(400).send({ error: 'Invalid payment signature' })
    }

    const orderRes = await db.query(
      `SELECT * FROM payment_orders WHERE gateway_order_id = $1 AND user_id = $2 AND status = 'created'`,
      [body.razorpay_order_id, user.sub]
    )
    if (!orderRes.rows.length) return reply.code(400).send({ error: 'Order not found or already processed' })
    const order = orderRes.rows[0]

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE payment_orders SET status = 'paid', gateway_payment_id = $1, updated_at = NOW() WHERE id = $2`,
        [body.razorpay_payment_id, order.id]
      )
      await walletSvc.credit({
        userId: user.sub,
        amount: parseFloat(order.amount),
        type: 'deposit',
        walletType: 'real',
        referenceId: body.razorpay_payment_id,
        idempotencyKey: `deposit_${body.razorpay_payment_id}`,
        description: `Deposit via Razorpay`,
      }, client)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    // Trigger referral reward after successful deposit (outside the payment tx)
    await tryTriggerReferralReward(user.sub, db, walletSvc)

    const balance = await walletSvc.getBalance(user.sub)
    return reply.send({ success: true, balance })
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
        if (!['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext)) {
          return reply.code(400).send({ error: 'Unsupported file type' })
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
        [ins.rows[0].id, promoRow.id, user.sub]).catch(() => {})
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
      amount: z.number().min(100).max(50000),
    }).parse(req.body)

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
      amount: z.number(),
      room_id: z.string(),
      lock_id: z.string().optional(),
    }).parse(req.body)
    const lockId = body.lock_id || crypto.randomUUID()
    await walletSvc.lockForGame(body.user_id, body.amount, body.room_id, lockId)
    return reply.send({ success: true })
  })

  // Internal: POST /internal/wallet/unlock (called by game-gateway on termination/cancel)
  app.post('/internal/wallet/unlock', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({ user_id: z.string().uuid(), amount: z.number(), room_id: z.string() }).parse(req.body)
    await walletSvc.unlockFunds(body.user_id, body.amount, body.room_id)
    return reply.send({ success: true })
  })

  // Internal: POST /internal/wallet/consume (called on withdrawal approval)
  app.post('/internal/wallet/consume', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({ user_id: z.string().uuid(), amount: z.number(), room_id: z.string() }).parse(req.body)
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
      amount: z.number(),
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
