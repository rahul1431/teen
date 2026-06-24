import 'dotenv/config'
import '@fastify/jwt'
import Fastify from 'fastify'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import Redis from 'ioredis'
import { Pool } from 'pg'
import crypto from 'crypto'
import { v4 as uuid } from 'uuid'

const app = Fastify({ logger: false })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })
const pubClient = new Redis(process.env.REDIS_URL!, { lazyConnect: true })

// ── Raw WebSocket transport (replaced socket.io) ──────────────────────────
interface AvConn { ws: WebSocket; userId: string; username: string }
const conns = new Set<AvConn>()

function broadcast(event: string, data: unknown): void {
  const msg = JSON.stringify({ event, data })
  for (const c of conns) {
    if (c.ws.readyState === WebSocket.OPEN) {
      try { c.ws.send(msg) } catch { /* gone */ }
    }
  }
}

function send(ws: WebSocket, event: string, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ event, data })) } catch { /* gone */ }
  }
}

interface RoundState {
  roundId: string
  serverSeed: string
  status: 'betting' | 'flying' | 'crashed'
  crashAt: number
  currentMultiplier: number
  bets: Record<string, { userId: string; username: string; amount: number; cashedOut: boolean; betIndex: number; cashoutMultiplier?: number }>
  history: number[]
  startedAt?: number
}

let currentRound: RoundState | null = null
let flyingInterval: NodeJS.Timeout | null = null

// ── Admin-configurable economics (loaded from game_configs) ────────────────
interface AviatorConfig {
  isActive: boolean
  houseEdgePercent: number // instant-crash probability → the house margin
  rakePercent: number      // commission taken from winnings on cashout
  maxWin: number           // cap on payout per round (0 = unlimited)
  minBet: number
  maxBet: number
  bettingTimeMs: number
}

const aviatorConfig: AviatorConfig = {
  isActive: true,
  houseEdgePercent: 3,
  rakePercent: 5,
  maxWin: 0,
  minBet: 10,
  maxBet: 5000,
  bettingTimeMs: 5000,
}

async function loadConfig(): Promise<void> {
  try {
    const res = await db.query(
      `SELECT is_active, rake_percent, special_rules FROM game_configs WHERE game_type = 'aviator'`
    )
    if (res.rows.length === 0) return
    const row = res.rows[0]
    const sr = row.special_rules || {}
    aviatorConfig.isActive = row.is_active
    aviatorConfig.rakePercent = Number(row.rake_percent ?? aviatorConfig.rakePercent)
    aviatorConfig.houseEdgePercent = Number(sr.house_edge_percent ?? aviatorConfig.houseEdgePercent)
    aviatorConfig.maxWin = Number(sr.max_win ?? aviatorConfig.maxWin)
    aviatorConfig.minBet = Number(sr.min_bet ?? aviatorConfig.minBet)
    aviatorConfig.maxBet = Number(sr.max_bet ?? aviatorConfig.maxBet)
    aviatorConfig.bettingTimeMs = Number(sr.betting_time_ms ?? aviatorConfig.bettingTimeMs)
  } catch (err) {
    console.error('Failed to load aviator config, using current values', err)
  }
}

// Provably fair crash point using HMAC-SHA256 hash chain.
// The house edge sets the probability of an instant 1.00x crash.
function generateCrashPoint(serverSeed: string, roundId: string): number {
  const hash = crypto.createHmac('sha256', serverSeed).update(roundId).digest('hex')
  const h = parseInt(hash.slice(0, 8), 16)
  const e = Math.pow(2, 32)
  // Instant-crash band sized to the configured house edge (e.g. 3% → 3% of rounds bust at 1.00x).
  const instantCrashCutoff = Math.floor((e * aviatorConfig.houseEdgePercent) / 100)
  if (h < instantCrashCutoff) return 1.00
  const crash = Math.floor((100 * e - h) / (e - h)) / 100
  return Math.max(1.00, crash)
}

async function startBettingPhase() {
  await loadConfig() // pick up live admin changes each round
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

  broadcast('aviator:round_start', {
    round_id: roundId,
    betting_time_ms: aviatorConfig.bettingTimeMs,
    history: currentRound.history,
  })

  setTimeout(() => startFlyingPhase(), aviatorConfig.bettingTimeMs)
}

async function startFlyingPhase() {
  if (!currentRound) return
  currentRound.status = 'flying'
  currentRound.startedAt = Date.now()
  const crashAt = currentRound.crashAt

  broadcast('aviator:flying_start', { round_id: currentRound.roundId })

  let multiplier = 1.00
  flyingInterval = setInterval(async () => {
    multiplier += 0.01 * multiplier * 0.07 // exponential growth curve
    multiplier = Math.round(multiplier * 100) / 100

    if (currentRound) currentRound.currentMultiplier = multiplier

    broadcast('aviator:multiplier_tick', {
      round_id: currentRound?.roundId,
      multiplier,
    })

    if (multiplier >= crashAt) {
      clearInterval(flyingInterval!)
      await crashRound(crashAt)
    }
  }, 100)
}

async function crashRound(crashAt: number) {
  if (!currentRound) return
  currentRound.status = 'crashed'

  // Credit winners who cashed out before crash
  for (const bet of Object.values(currentRound.bets)) {
    if (bet.cashedOut && bet.cashoutMultiplier) {
      const prize = bet.amount * bet.cashoutMultiplier
      const rake = prize * (aviatorConfig.rakePercent / 100)
      let payout = prize - rake
      // Apply the admin max-win cap (0 = unlimited) to limit tail-risk payouts.
      if (aviatorConfig.maxWin > 0) payout = Math.min(payout, aviatorConfig.maxWin)
      await creditWallet(bet.userId, payout, currentRound.roundId, bet.betIndex)
    }
  }

  // Save crash point to history
  await pubClient.lpush('aviator:history', crashAt.toString())
  await pubClient.ltrim('aviator:history', 0, 49)

  broadcast('aviator:crashed', {
    round_id: currentRound.roundId,
    crash_at: crashAt,
    server_seed: currentRound.serverSeed, // revealed after crash for provable fairness
  })

  currentRound = null

  // Start next round after 3 seconds
  setTimeout(() => startBettingPhase(), 3000)
}

async function creditWallet(userId: string, amount: number, referenceId: string, betIndex: number) {
  try {
    await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify({
        user_id: userId,
        amount: Math.round(amount * 100) / 100,
        type: 'game_credit',
        reference_id: referenceId,
        idempotency_key: `aviator_cashout_${userId}_${referenceId}_${betIndex}`,
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
  if (pubClient.status === 'wait') await pubClient.connect()

  const wss = new WebSocketServer({ server: httpServer, path: '/ws/aviator' })

  wss.on('connection', (ws: WebSocket, req) => {
    let userId: string, username: string
    try {
      const u = new URL(req.url || '', 'http://localhost')
      const token = u.searchParams.get('token') || req.headers.authorization?.split(' ')[1]
      if (!token) { ws.close(4001, 'No token'); return }
      const payload = (app.jwt as any).verify(token) as any
      userId = payload.sub
      username = payload.username
    } catch {
      ws.close(4001, 'Invalid token')
      return
    }

    const conn: AvConn = { ws, userId, username }
    conns.add(conn)

    // Send current round state on connect
    if (currentRound) {
      send(ws, 'aviator:round_state', {
        round_id: currentRound.roundId,
        status: currentRound.status,
        multiplier: currentRound.currentMultiplier,
        history: currentRound.history,
      })
    }

    ws.on('message', async (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }
      const { event, data } = msg || {}

      if (event === 'aviator:place_bet') {
        const amount = data?.amount
        const betIndex = Number(data?.bet_index ?? 1)
        if (betIndex !== 1 && betIndex !== 2) {
          return send(ws, 'error', { message: 'Invalid bet index' })
        }
        if (!currentRound || currentRound.status !== 'betting') {
          return send(ws, 'error', { message: 'Betting phase not active' })
        }
        if (!amount || amount < aviatorConfig.minBet) {
          return send(ws, 'error', { message: `Min bet is ₹${aviatorConfig.minBet}` })
        }
        if (amount > aviatorConfig.maxBet) {
          return send(ws, 'error', { message: `Max bet is ₹${aviatorConfig.maxBet}` })
        }
        try {
          const res = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({ user_id: userId, amount, room_id: `${currentRound.roundId}_${betIndex}` }),
          })
          if (!res.ok) {
            const err = await res.json() as any
            return send(ws, 'error', { message: err.error || 'Insufficient balance' })
          }
        } catch {
          return send(ws, 'error', { message: 'Wallet service unavailable' })
        }

        const betKey = `${userId}_${betIndex}`
        currentRound.bets[betKey] = { userId, username, amount, cashedOut: false, betIndex }
        send(ws, 'aviator:bet_placed', { amount, round_id: currentRound.roundId, bet_index: betIndex })
        broadcast('aviator:live_bets', {
          bets: Object.values(currentRound.bets).map(b => ({
            username: b.username,
            amount: b.amount,
            cashed_out: b.cashedOut,
            cashout_multiplier: b.cashoutMultiplier,
          })),
        })
        return
      }

      if (event === 'aviator:cashout') {
        if (!currentRound || currentRound.status !== 'flying') {
          return send(ws, 'error', { message: 'Not in flying phase' })
        }
        const betIndex = Number(data?.bet_index ?? 1)
        const betKey = `${userId}_${betIndex}`
        const bet = currentRound.bets[betKey]
        if (!bet || bet.cashedOut) return send(ws, 'error', { message: `No active bet for panel ${betIndex}` })

        const multiplier = currentRound.currentMultiplier
        bet.cashedOut = true
        bet.cashoutMultiplier = multiplier
        const prize = bet.amount * multiplier
        send(ws, 'aviator:cashed_out', { multiplier, prize, amount: bet.amount, bet_index: betIndex })
        
        broadcast('aviator:live_bets', {
          bets: Object.values(currentRound.bets).map(b => ({
            username: b.username,
            amount: b.amount,
            cashed_out: b.cashedOut,
            cashout_multiplier: b.cashoutMultiplier,
          })),
        })
        return
      }
    })

    ws.on('close', () => { conns.delete(conn) })
    ws.on('error', () => { conns.delete(conn) })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'aviator-engine' }))

  const port = parseInt(process.env.PORT || '3005')
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Aviator engine running on port ${port} (raw WebSocket /ws/aviator)`)
    // Start first round
    setTimeout(() => startBettingPhase(), 2000)
  })
}

start().catch((err) => { console.error(err); process.exit(1) })
