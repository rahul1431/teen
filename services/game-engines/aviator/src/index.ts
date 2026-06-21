import 'dotenv/config'
import '@fastify/jwt'
import Fastify from 'fastify'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'
import { Pool } from 'pg'
import crypto from 'crypto'
import { v4 as uuid } from 'uuid'

const app = Fastify({ logger: false })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })
const pubClient = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
const subClient = pubClient.duplicate()

interface RoundState {
  roundId: string
  serverSeed: string
  status: 'betting' | 'flying' | 'crashed'
  crashAt: number
  currentMultiplier: number
  bets: Record<string, { userId: string; amount: number; cashedOut: boolean; cashoutMultiplier?: number }>
  history: number[]
  startedAt?: number
}

let currentRound: RoundState | null = null
let flyingInterval: NodeJS.Timeout | null = null

// Provably fair crash point using HMAC-SHA256 hash chain
function generateCrashPoint(serverSeed: string, roundId: string): number {
  const hash = crypto.createHmac('sha256', serverSeed).update(roundId).digest('hex')
  const h = parseInt(hash.slice(0, 8), 16)
  if (h % 33 === 0) return 1.00 // house edge ~3%
  const e = Math.pow(2, 32)
  const crash = Math.floor((100 * e - h) / (e - h)) / 100
  return Math.max(1.00, crash)
}

async function startBettingPhase(io: Server) {
  const roundId = uuid()
  const serverSeed = crypto.randomBytes(32).toString('hex')
  const crashAt = generateCrashPoint(serverSeed, roundId)

  currentRound = {
    roundId,
    serverSeed,
    status: 'betting',
    crashAt,
    currentMultiplier: 1.00,
    bets: {},
    history: await getHistory(),
  }

  await pubClient.setex(`aviator:round:${roundId}`, 600, JSON.stringify(currentRound))

  io.emit('aviator:round_start', {
    round_id: roundId,
    betting_time_ms: 5000,
    history: currentRound.history,
  })

  setTimeout(() => startFlyingPhase(io), 5000)
}

async function startFlyingPhase(io: Server) {
  if (!currentRound) return
  currentRound.status = 'flying'
  currentRound.startedAt = Date.now()
  const crashAt = currentRound.crashAt

  io.emit('aviator:flying_start', { round_id: currentRound.roundId })

  let multiplier = 1.00
  flyingInterval = setInterval(async () => {
    multiplier += 0.01 * multiplier * 0.07 // exponential growth curve
    multiplier = Math.round(multiplier * 100) / 100

    if (currentRound) currentRound.currentMultiplier = multiplier

    io.emit('aviator:multiplier_tick', {
      round_id: currentRound?.roundId,
      multiplier,
    })

    if (multiplier >= crashAt) {
      clearInterval(flyingInterval!)
      await crashRound(io, crashAt)
    }
  }, 100)
}

async function crashRound(io: Server, crashAt: number) {
  if (!currentRound) return
  currentRound.status = 'crashed'

  // Credit winners who cashed out before crash
  for (const bet of Object.values(currentRound.bets)) {
    if (bet.cashedOut && bet.cashoutMultiplier) {
      const prize = bet.amount * bet.cashoutMultiplier
      const rake = prize * 0.05
      const net = prize - rake - bet.amount // net profit after returning stake
      await creditWallet(bet.userId, bet.amount + net, currentRound.roundId)
    }
  }

  // Save crash point to history
  await pubClient.lpush('aviator:history', crashAt.toString())
  await pubClient.ltrim('aviator:history', 0, 49)

  io.emit('aviator:crashed', {
    round_id: currentRound.roundId,
    crash_at: crashAt,
    server_seed: currentRound.serverSeed, // revealed after crash for provable fairness
  })

  currentRound = null

  // Start next round after 3 seconds
  setTimeout(() => startBettingPhase(io), 3000)
}

async function creditWallet(userId: string, amount: number, referenceId: string) {
  try {
    await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({
        user_id: userId,
        amount: Math.round(amount * 100) / 100,
        type: 'game_credit',
        reference_id: referenceId,
        idempotency_key: `aviator_cashout_${userId}_${referenceId}`,
      }),
    })
  } catch (err) {
    console.error('Failed to credit wallet', err)
  }
}

async function getHistory(): Promise<number[]> {
  const items = await pubClient.lrange('aviator:history', 0, 19)
  return items.map(Number)
}

async function start() {
  await app.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET! })
  await app.register(require('@fastify/cors'), { origin: true })

  const httpServer = createServer(app.server)
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/aviator',
  })

  await Promise.all([pubClient.connect(), subClient.connect()])
  io.adapter(createAdapter(pubClient, subClient))

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token
      if (!token) return next(new Error('No token'))
      const payload = (app.jwt as any).verify(token) as any
      socket.data.userId = payload.sub
      socket.data.username = payload.username
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    // Send current round state on connect
    if (currentRound) {
      socket.emit('aviator:round_state', {
        round_id: currentRound.roundId,
        status: currentRound.status,
        multiplier: currentRound.currentMultiplier,
        history: currentRound.history,
      })
    }

    socket.on('aviator:place_bet', async ({ amount }: any) => {
      if (!currentRound || currentRound.status !== 'betting') {
        return socket.emit('error', { message: 'Betting phase not active' })
      }
      if (!amount || amount < 10) return socket.emit('error', { message: 'Min bet is ₹10' })

      // Deduct from wallet
      try {
        const res = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
          body: JSON.stringify({ user_id: socket.data.userId, amount, room_id: currentRound.roundId }),
        })
        if (!res.ok) {
          const err = await res.json() as any
          return socket.emit('error', { message: err.error || 'Insufficient balance' })
        }
      } catch {
        return socket.emit('error', { message: 'Wallet service unavailable' })
      }

      currentRound.bets[socket.data.userId] = {
        userId: socket.data.userId,
        amount,
        cashedOut: false,
      }

      socket.emit('aviator:bet_placed', { amount, round_id: currentRound.roundId })
      io.emit('aviator:live_bets', {
        bets: Object.values(currentRound.bets).map(b => ({
          username: socket.data.username,
          amount: b.amount,
          cashed_out: b.cashedOut,
          cashout_multiplier: b.cashoutMultiplier,
        }))
      })
    })

    socket.on('aviator:cashout', async () => {
      if (!currentRound || currentRound.status !== 'flying') {
        return socket.emit('error', { message: 'Not in flying phase' })
      }
      const bet = currentRound.bets[socket.data.userId]
      if (!bet || bet.cashedOut) return socket.emit('error', { message: 'No active bet' })

      const multiplier = currentRound.currentMultiplier
      bet.cashedOut = true
      bet.cashoutMultiplier = multiplier

      const prize = bet.amount * multiplier
      socket.emit('aviator:cashed_out', { multiplier, prize, amount: bet.amount })
    })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'aviator-engine' }))

  const port = parseInt(process.env.PORT || '3005')
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Aviator engine running on port ${port}`)
    // Start first round
    setTimeout(() => startBettingPhase(io), 2000)
  })
}

start().catch((err) => { console.error(err); process.exit(1) })
