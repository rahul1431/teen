import 'dotenv/config'
import '@fastify/jwt'
import Fastify from 'fastify'
import { WebSocketServer, WebSocket } from 'ws'
import Redis from 'ioredis'
import { Pool } from 'pg'
import crypto from 'crypto'
import { v4 as uuid } from 'uuid'

const app = Fastify({ logger: false })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })
const pubClient = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 3000),
  lazyConnect: false,
})

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

// Notify every open connection a user has (multi-device).
function sendToUser(userId: string, event: string, data: unknown): void {
  for (const c of conns) {
    if (c.userId === userId) send(c.ws, event, data)
  }
}

interface AvBet {
  userId: string
  username: string
  amount: number
  cashedOut: boolean
  betIndex: number
  cashoutMultiplier?: number
  autoCashout?: number   // server-side auto-cashout target
  payout: number         // final payout (rake + maxWin applied), 0 until cashout
  settled: boolean       // wallet consume/credit done or durably queued
}

interface RoundState {
  roundId: string
  serverSeed: string
  seedHash: string       // published at round start — commitment for provable fairness
  status: 'betting' | 'flying' | 'crashed'
  crashAt: number
  currentMultiplier: number
  bets: Record<string, AvBet>
  history: number[]
  startedAt?: number
}

let currentRound: RoundState | null = null
let flyingInterval: NodeJS.Timeout | null = null

// ── Admin-configurable economics (loaded from game_configs) ────────────────
interface AviatorConfig {
  isActive: boolean
  houseEdgePercent: number // instant-crash probability → the house margin
  rakePercent: number      // commission taken from PROFIT (not stake) on cashout
  maxWin: number           // cap on payout per round (0 = unlimited)
  minBet: number
  maxBet: number
  bettingTimeMs: number
  maxAutoCashout: number   // highest allowed auto-cashout target
}

const aviatorConfig: AviatorConfig = {
  isActive: true,
  houseEdgePercent: 3,
  rakePercent: 5,
  maxWin: 0,
  minBet: 10,
  maxBet: 5000,
  bettingTimeMs: 5000,
  maxAutoCashout: 100,
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
    aviatorConfig.maxAutoCashout = Number(sr.max_auto_cashout ?? aviatorConfig.maxAutoCashout)
  } catch (err) {
    console.error('Failed to load aviator config, using current values', err)
  }
}

// ── Wallet calls with durable retry ────────────────────────────────────────
// All wallet endpoints used here are idempotent (consume/unlock are keyed by
// room+user, credit by idempotency_key), so a retry can never double-move money.
// If the wallet service is down after the retries, the op is pushed to a Redis
// queue and drained on an interval / at startup — a payout is never just lost.
const PENDING_OPS_KEY = 'aviator:pending_wallet_ops'

async function walletPost(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.WALLET_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

async function walletCallDurable(path: string, body: unknown): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await walletPost(path, body)) return
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
  }
  console.error(`[aviator] wallet call failed after retries, queueing: ${path}`)
  try {
    await pubClient.rpush(PENDING_OPS_KEY, JSON.stringify({ path, body }))
  } catch (err) {
    console.error('[aviator] FAILED to queue wallet op — manual reconciliation needed:', path, JSON.stringify(body), err)
  }
}

async function drainPendingWalletOps(): Promise<void> {
  try {
    const count = await pubClient.llen(PENDING_OPS_KEY)
    for (let i = 0; i < count; i++) {
      const raw = await pubClient.lpop(PENDING_OPS_KEY)
      if (!raw) break
      const op = JSON.parse(raw) as { path: string; body: unknown }
      if (!(await walletPost(op.path, op.body))) {
        await pubClient.rpush(PENDING_OPS_KEY, raw) // still failing — back of the queue
      }
    }
  } catch (err) {
    console.error('[aviator] drainPendingWalletOps error:', err)
  }
}

// ── Crash-recovery snapshot ────────────────────────────────────────────────
// Persist just what recovery needs (roundId + bets). The server seed and crash
// point deliberately never touch Redis — nothing outside this process can read
// the outcome before the reveal.
const ACTIVE_ROUND_KEY = 'aviator:active_round'

function persistRound(): void {
  if (!currentRound) return
  const snapshot = { roundId: currentRound.roundId, bets: currentRound.bets }
  pubClient.setex(ACTIVE_ROUND_KEY, 600, JSON.stringify(snapshot)).catch((err) => {
    console.error('[aviator] persistRound failed:', err)
  })
}

// If the process died mid-round, refund every unsettled stake. A cashed-out
// bet that never got credited also gets its stake back (logged) — conservative
// but the player is never left out of pocket.
async function recoverOrphanedRound(): Promise<void> {
  try {
    const raw = await pubClient.get(ACTIVE_ROUND_KEY)
    if (!raw) return
    const snapshot = JSON.parse(raw) as { roundId: string; bets: Record<string, AvBet> }
    const bets = Object.values(snapshot.bets || {})
    console.warn(`[aviator] recovering orphaned round ${snapshot.roundId} with ${bets.length} bet(s) — refunding stakes`)
    for (const bet of bets) {
      if (bet.settled) continue
      if (bet.cashedOut) {
        console.warn(`[aviator] recovery: user=${bet.userId} had cashed out (payout ₹${bet.payout}) but was not settled — refunding stake ₹${bet.amount} instead`)
      }
      await walletCallDurable('/internal/wallet/unlock', {
        user_id: bet.userId,
        amount: bet.amount,
        room_id: `${snapshot.roundId}_${bet.betIndex}`,
      })
    }
    await pubClient.del(ACTIVE_ROUND_KEY)
  } catch (err) {
    console.error('[aviator] recoverOrphanedRound failed:', err)
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

// Final payout for a cashout: stake + profit after rake, capped by maxWin.
// Computed (and shown to the player) at cashout time so the number they see
// is exactly what lands in the wallet at settlement.
function computePayout(amount: number, multiplier: number): number {
  const prize = amount * multiplier
  const profit = Math.max(0, prize - amount)
  let payout = amount + profit * (1 - aviatorConfig.rakePercent / 100)
  if (aviatorConfig.maxWin > 0) payout = Math.min(payout, aviatorConfig.maxWin)
  return Math.round(payout * 100) / 100
}

function liveBetsPayload() {
  return {
    bets: Object.values(currentRound?.bets ?? {}).map(b => ({
      username: b.username,
      amount: b.amount,
      cashed_out: b.cashedOut,
      cashout_multiplier: b.cashoutMultiplier,
    })),
  }
}

async function startBettingPhase() {
  try {
    await loadConfig() // pick up live admin changes each round

    // Admin kill-switch: no new rounds while the game is disabled.
    if (!aviatorConfig.isActive) {
      broadcast('aviator:maintenance', { message: 'Aviator is temporarily unavailable' })
      setTimeout(() => {
        startBettingPhase().catch((err) => console.error('[aviator] maintenance retry failed:', err))
      }, 15000)
      return
    }

    const roundId = uuid()
    const serverSeed = crypto.randomBytes(32).toString('hex')
    const seedHash = crypto.createHash('sha256').update(serverSeed).digest('hex')
    const crashAt = generateCrashPoint(serverSeed, roundId)

    currentRound = {
      roundId,
      serverSeed,
      seedHash,
      status: 'betting',
      crashAt,
      currentMultiplier: 1.00,
      bets: {},
      history: await getHistory(),
    }

    persistRound()

    broadcast('aviator:round_start', {
      round_id: roundId,
      betting_time_ms: aviatorConfig.bettingTimeMs,
      history: currentRound.history,
      seed_hash: seedHash, // commitment: hash published before any bet, seed revealed after crash
      min_bet: aviatorConfig.minBet,
      max_bet: aviatorConfig.maxBet,
    })

    setTimeout(() => startBettingPhaseNext(), aviatorConfig.bettingTimeMs)
  } catch (err) {
    console.error('[aviator] startBettingPhase failed, retrying in 5s:', err)
    currentRound = null
    setTimeout(() => startBettingPhase(), 5000)
  }
}

// Wrapper to ensure startFlyingPhase errors don't propagate unhandled
function startBettingPhaseNext() {
  startFlyingPhase().catch((err) => {
    console.error('[aviator] startFlyingPhase failed, restarting in 5s:', err)
    if (flyingInterval) { clearInterval(flyingInterval); flyingInterval = null }
    currentRound = null
    setTimeout(() => startBettingPhase(), 5000)
  })
}

// Cash a bet out at the given multiplier (manual or auto). Pure in-memory —
// money moves once, at settlement. Returns the payout.
function cashOutBet(bet: AvBet, multiplier: number): number {
  bet.cashedOut = true
  bet.cashoutMultiplier = multiplier
  bet.payout = computePayout(bet.amount, multiplier)
  sendToUser(bet.userId, 'aviator:cashed_out', {
    multiplier,
    prize: bet.payout,
    amount: bet.amount,
    bet_index: bet.betIndex,
    auto: false,
  })
  return bet.payout
}

async function startFlyingPhase() {
  if (!currentRound) return
  currentRound.status = 'flying'
  currentRound.startedAt = Date.now()
  const crashAt = currentRound.crashAt

  broadcast('aviator:flying_start', { round_id: currentRound.roundId })

  let rawMultiplier = 1.00
  flyingInterval = setInterval(() => {
    rawMultiplier += 0.012 * rawMultiplier // exponential growth curve
    const multiplier = Math.round(rawMultiplier * 100) / 100

    if (currentRound) currentRound.currentMultiplier = multiplier

    // Server-side auto-cashout: executes at the exact target on the
    // authoritative tick, immune to client latency. A target at or above the
    // crash point loses — the plane is gone before it triggers.
    if (currentRound) {
      let anyAuto = false
      for (const bet of Object.values(currentRound.bets)) {
        if (bet.cashedOut || !bet.autoCashout) continue
        if (bet.autoCashout <= multiplier && bet.autoCashout < crashAt) {
          bet.cashedOut = true
          bet.cashoutMultiplier = bet.autoCashout
          bet.payout = computePayout(bet.amount, bet.autoCashout)
          sendToUser(bet.userId, 'aviator:cashed_out', {
            multiplier: bet.autoCashout,
            prize: bet.payout,
            amount: bet.amount,
            bet_index: bet.betIndex,
            auto: true,
          })
          anyAuto = true
        }
      }
      if (anyAuto) {
        persistRound()
        broadcast('aviator:live_bets', liveBetsPayload())
      }
    }

    broadcast('aviator:multiplier_tick', {
      round_id: currentRound?.roundId,
      multiplier,
    })

    if (multiplier >= crashAt) {
      clearInterval(flyingInterval!)
      flyingInterval = null
      crashRound(crashAt).catch((err) => {
        console.error('[aviator] crashRound failed, restarting in 5s:', err)
        currentRound = null
        setTimeout(() => startBettingPhase(), 5000)
      })
    }
  }, 100)
}

async function crashRound(crashAt: number) {
  if (!currentRound) return
  currentRound.status = 'crashed'
  const round = currentRound

  // Settle every bet: consume the locked stake (losers AND winners pay their
  // stake), then credit winners their payout. Both calls are idempotent and
  // durably retried, so a wallet-service blip cannot lose money or pay twice.
  for (const bet of Object.values(round.bets)) {
    const roomId = `${round.roundId}_${bet.betIndex}`
    await walletCallDurable('/internal/wallet/consume', {
      user_id: bet.userId,
      amount: bet.amount,
      room_id: roomId,
    })
    if (bet.cashedOut && bet.payout > 0) {
      await walletCallDurable('/internal/wallet/credit', {
        user_id: bet.userId,
        amount: bet.payout,
        type: 'game_credit',
        reference_id: round.roundId,
        idempotency_key: `aviator_cashout_${bet.userId}_${round.roundId}_${bet.betIndex}`,
      })
    }
    bet.settled = true
    persistRound()
  }

  // Per-user bet history (best effort — gameplay never blocks on it).
  try {
    for (const bet of Object.values(round.bets)) {
      await db.query(
        `INSERT INTO aviator_bets (round_id, user_id, bet_index, amount, cashout_multiplier, payout, crash_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (round_id, user_id, bet_index) DO NOTHING`,
        [round.roundId, bet.userId, bet.betIndex, bet.amount, bet.cashoutMultiplier ?? null, bet.payout, crashAt]
      )
    }
  } catch (err) {
    console.error('[aviator] failed to save bet history:', err)
  }

  // Save crash point to history
  await pubClient.lpush('aviator:history', crashAt.toString())
  await pubClient.ltrim('aviator:history', 0, 49)
  await pubClient.del(ACTIVE_ROUND_KEY)

  broadcast('aviator:crashed', {
    round_id: round.roundId,
    crash_at: crashAt,
    server_seed: round.serverSeed, // revealed after crash; sha256(seed) must equal the round_start seed_hash
    seed_hash: round.seedHash,
  })

  currentRound = null

  // Start next round after 3 seconds
  setTimeout(() => {
    startBettingPhase().catch((err) => console.error('[aviator] round restart failed:', err))
  }, 3000)
}

async function getHistory(): Promise<number[]> {
  const items = await pubClient.lrange('aviator:history', 0, 19)
  return items.map(Number)
}

async function start() {
  await app.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET! })
  await app.register(require('@fastify/cors'), { origin: true })

  const httpServer = app.server
  // pubClient connects automatically (lazyConnect:false); wait for it to be ready
  await new Promise<void>((resolve) => {
    if (pubClient.status === 'ready') { resolve(); return }
    pubClient.once('ready', resolve)
    pubClient.once('error', () => resolve()) // proceed even if Redis is temporarily down
  })

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
        seed_hash: currentRound.seedHash,
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
        if (!aviatorConfig.isActive) {
          return send(ws, 'error', { message: 'Aviator is temporarily unavailable' })
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
        const betKey = `${userId}_${betIndex}`
        if (currentRound.bets[betKey]) {
          return send(ws, 'error', { message: 'Bet already placed for this panel' })
        }

        // Optional server-side auto-cashout target, executed on the engine tick.
        let autoCashout: number | undefined
        const rawTarget = Number(data?.auto_cashout)
        if (Number.isFinite(rawTarget) && rawTarget > 1) {
          autoCashout = Math.min(Math.max(rawTarget, 1.01), aviatorConfig.maxAutoCashout)
        }

        const lockedRoundId = currentRound.roundId
        try {
          const res = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({ user_id: userId, amount, room_id: `${lockedRoundId}_${betIndex}`, lock_id: `aviator_${lockedRoundId}_${betIndex}_${userId}` }),
          })
          if (!res.ok) {
            const err = await res.json() as any
            return send(ws, 'error', { message: err.error || 'Insufficient balance' })
          }
        } catch {
          return send(ws, 'error', { message: 'Wallet service unavailable' })
        }

        // Re-check the round: it may have moved past betting (or rolled over)
        // while the wallet lock was in flight. Refund rather than accept late.
        if (!currentRound || currentRound.roundId !== lockedRoundId || currentRound.status !== 'betting') {
          await walletCallDurable('/internal/wallet/unlock', { user_id: userId, amount, room_id: `${lockedRoundId}_${betIndex}` })
          return send(ws, 'error', { message: 'Betting phase ended — stake refunded' })
        }

        currentRound.bets[betKey] = { userId, username, amount, cashedOut: false, betIndex, autoCashout, payout: 0, settled: false }
        persistRound()
        send(ws, 'aviator:bet_placed', { amount, round_id: currentRound.roundId, bet_index: betIndex, auto_cashout: autoCashout })
        broadcast('aviator:live_bets', liveBetsPayload())
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

        cashOutBet(bet, currentRound.currentMultiplier)
        persistRound()
        broadcast('aviator:live_bets', liveBetsPayload())
        return
      }

      if (event === 'aviator:get_history') {
        try {
          const res = await db.query(
            `SELECT round_id, bet_index, amount, cashout_multiplier, payout, crash_at, created_at
             FROM aviator_bets WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 30`,
            [userId]
          )
          send(ws, 'aviator:my_history', {
            bets: res.rows.map((r: any) => ({
              round_id: r.round_id,
              bet_index: r.bet_index,
              amount: Number(r.amount),
              cashout_multiplier: r.cashout_multiplier === null ? null : Number(r.cashout_multiplier),
              payout: Number(r.payout),
              crash_at: Number(r.crash_at),
              created_at: r.created_at,
            })),
          })
        } catch (err) {
          console.error('[aviator] get_history failed:', err)
          send(ws, 'aviator:my_history', { bets: [] })
        }
        return
      }
    })

    ws.on('close', () => { conns.delete(conn) })
    ws.on('error', () => { conns.delete(conn) })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'aviator-engine' }))

  const port = parseInt(process.env.PORT || '3005')
  await app.ready()
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Aviator engine running on port ${port} (raw WebSocket /ws/aviator)`)
    // Refund any round orphaned by a restart, drain queued wallet ops, then start.
    setTimeout(async () => {
      await recoverOrphanedRound()
      await drainPendingWalletOps()
      setInterval(() => { drainPendingWalletOps() }, 60000)
      startBettingPhase().catch((err) => console.error('[aviator] initial round start failed:', err))
    }, 2000)
  })
}

start().catch((err) => { console.error(err); process.exit(1) })
