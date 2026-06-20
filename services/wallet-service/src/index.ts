import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import { Pool } from 'pg'
import Razorpay from 'razorpay'
import crypto from 'crypto'
import { z } from 'zod'
import { WalletService } from './wallet.service'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })
const walletSvc = new WalletService(db)

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

async function start() {
  await app.register(helmet)
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })

  const authenticate = async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  const authenticateInternal = async (req: any, reply: any) => {
    const key = req.headers['x-internal-key']
    if (key !== process.env.INTERNAL_SERVICE_KEY) reply.code(403).send({ error: 'Forbidden' })
  }

  // GET /wallet/balance
  app.get('/wallet/balance', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const balance = await walletSvc.getBalance(user.sub)
    return reply.send(balance)
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

  app.get('/health', async () => ({ status: 'ok', service: 'wallet' }))

  const port = parseInt(process.env.PORT || '3003')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Wallet service running on port ${port}`)
}

start().catch((err) => { console.error(err); process.exit(1) })
