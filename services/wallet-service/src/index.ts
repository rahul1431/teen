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
import { WalletService } from './wallet.service'

// Where uploaded deposit screenshots are stored (served by nginx at /uploads/).
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/opt/teen/uploads/deposits'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })
const walletSvc = new WalletService(db)

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
    if (key !== process.env.INTERNAL_SERVICE_KEY) return reply.code(403).send({ error: 'Forbidden' })
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

    const balance = await walletSvc.getBalance(user.sub)
    return reply.send({ success: true, balance })
  })

  // POST /wallet/deposit/manual (admin only — identified by internal key)
  app.post('/wallet/deposit/manual', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number().min(1),
      description: z.string().optional(),
    }).parse(req.body)

    await walletSvc.credit({
      userId: body.user_id,
      amount: body.amount,
      type: 'manual_credit',
      walletType: 'real',
      idempotencyKey: `manual_${body.user_id}_${Date.now()}`,
      description: body.description || 'Manual credit by admin',
    })
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

  // POST /wallet/deposit/submit — multipart: amount, payment_method_id, reference_number, screenshot
  // Creates a PENDING deposit order with proof. Admin approves it to credit the wallet.
  app.post('/wallet/deposit/submit', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    let amount = 0
    let methodId: string | null = null
    let referenceNumber = ''
    let screenshotUrl: string | null = null

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

    const ins = await db.query(
      `INSERT INTO payment_orders
         (user_id, gateway, amount, type, status, reference_number, screenshot_url, payment_method_id, metadata)
       VALUES ($1, 'manual', $2, 'deposit', 'created', $3, $4, $5, $6)
       RETURNING id`,
      [user.sub, amount, referenceNumber, screenshotUrl, methodId,
       JSON.stringify({ submitted_at: new Date().toISOString() })]
    )

    return reply.send({
      success: true,
      order_id: ins.rows[0].id,
      message: 'Deposit submitted for review. Your balance updates once an admin approves it.',
    })
  })

  // POST /wallet/debit/manual (admin only — identified by internal key)
  app.post('/wallet/debit/manual', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number().min(1),
      description: z.string().optional(),
    }).parse(req.body)

    const bal = await walletSvc.getBalance(body.user_id)
    if (parseFloat(bal.real_balance) < body.amount) {
      return reply.code(400).send({ error: 'Insufficient balance' })
    }

    await walletSvc.debit({
      userId: body.user_id,
      amount: body.amount,
      type: 'manual_debit',
      walletType: 'real',
      idempotencyKey: `manual_debit_${body.user_id}_${Date.now()}`,
      description: body.description || 'Manual debit by admin',
    })
    const balance = await walletSvc.getBalance(body.user_id)
    return reply.send({ success: true, balance })
  })

  // POST /wallet/withdraw/request
  app.post('/wallet/withdraw/request', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({
      amount: z.number().min(100).max(50000),
      bank_account: z.string().optional(),
      upi_id: z.string().optional(),
    }).parse(req.body)

    const balance = await walletSvc.getBalance(user.sub)
    if (parseFloat(balance.real_balance) < body.amount) {
      return reply.code(400).send({ error: 'Insufficient balance' })
    }

    // KYC check
    const kycRes = await db.query("SELECT kyc_status FROM users WHERE id = $1", [user.sub])
    if (kycRes.rows[0]?.kyc_status !== 'approved') {
      return reply.code(403).send({ error: 'KYC verification required before withdrawal' })
    }

    await db.query(
      `INSERT INTO payment_orders (user_id, gateway, amount, type, status, metadata)
       VALUES ($1, 'manual', $2, 'withdrawal', 'created', $3)`,
      [user.sub, body.amount, JSON.stringify({ bank_account: body.bank_account, upi_id: body.upi_id })]
    )

    return reply.send({ success: true, message: 'Withdrawal request submitted. Processed within 24 hours.' })
  })

  // Internal: POST /internal/wallet/lock (called by game-gateway)
  app.post('/internal/wallet/lock', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({ user_id: z.string().uuid(), amount: z.number(), room_id: z.string() }).parse(req.body)
    await walletSvc.lockForGame(body.user_id, body.amount, body.room_id)
    return reply.send({ success: true })
  })

  // Internal: POST /internal/wallet/unlock (called by game-gateway on termination/cancel)
  app.post('/internal/wallet/unlock', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({ user_id: z.string().uuid(), amount: z.number() }).parse(req.body)
    await walletSvc.unlockFunds(body.user_id, body.amount)
    return reply.send({ success: true })
  })

  // Internal: POST /internal/wallet/settle-game (called by game-gateway at game end)
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

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      
      // 1. Consume locked funds for all participants
      for (const p of body.players) {
        await walletSvc.consumeLockedFunds(p.user_id, p.entry_fee, client)
      }

      // 2. If there is a winner, credit the prize to their real wallet
      if (body.winner_id && body.prize > 0) {
        await walletSvc.credit({
          userId: body.winner_id,
          amount: body.prize,
          type: 'game_credit',
          walletType: 'real',
          referenceId: body.room_id,
          idempotencyKey: `win:${body.room_id}:${body.winner_id}`,
          description: `Game win: room ${body.room_id}`,
        }, client)
      }

      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Internal: POST /internal/wallet/credit (called by game-gateway after game result)
  app.post('/internal/wallet/credit', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const body = z.object({
      user_id: z.string().uuid(),
      amount: z.number(),
      type: z.enum(['game_credit', 'bonus', 'referral']),
      reference_id: z.string().optional(),
      idempotency_key: z.string(),
    }).parse(req.body)

    await walletSvc.credit({
      userId: body.user_id,
      amount: body.amount,
      type: body.type,
      walletType: 'real',
      referenceId: body.reference_id,
      idempotencyKey: body.idempotency_key,
      description: `Game prize: ${body.reference_id}`,
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

  // Alias used by game-gateway: POST /internal/wallet/credit-game-win
  app.post('/internal/wallet/credit-game-win', { onRequest: [authenticateInternal] }, async (req, reply) => {
    const { user_id, amount, room_id } = req.body as any
    if (!user_id || amount == null) return reply.code(400).send({ error: 'user_id and amount required' })
    const numAmount = Number(amount)
    if (isNaN(numAmount) || numAmount <= 0) return reply.code(400).send({ error: 'amount must be a positive number' })
    await walletSvc.credit({
      userId: user_id,
      amount: numAmount,
      type: 'game_credit',
      walletType: 'real',
      referenceId: room_id,
      idempotencyKey: `win:${room_id}:${user_id}`,
      description: `Teen Patti win: room ${room_id}`,
    })
    return reply.send({ success: true })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'wallet' }))

  const port = parseInt(process.env.PORT || '3003')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Wallet service running on port ${port}`)
}

start().catch((err) => { console.error(err); process.exit(1) })
