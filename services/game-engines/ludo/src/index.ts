import 'dotenv/config'
import crypto from 'crypto'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import Redis from 'ioredis'
import { Pool } from 'pg'
import {
  createInitialState,
  applyRoll,
  applyMove,
  forfeitPlayer,
  rollDie,
  chooseBotToken,
  LudoState,
  ActionResult,
  BotDifficulty,
} from './rules'

const app = Fastify({ logger: false })
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

const KEY = (roomId: string) => `ludo:game:${roomId}`
const TTL = 2 * 60 * 60 // 2h

async function loadState(roomId: string): Promise<LudoState | null> {
  const raw = await redis.get(KEY(roomId))
  return raw ? (JSON.parse(raw) as LudoState) : null
}

async function saveState(state: LudoState): Promise<void> {
  await redis.setex(KEY(state.room_id), TTL, JSON.stringify(state))
}

// /action and /bot-turn both do load -> mutate -> save with no atomicity of
// their own. Two near-simultaneous calls for the same room (a double-tap
// racing the network, or the gateway's bot driver overlapping a human action)
// can otherwise both load the same state and the second save silently clobbers
// the first. A short-lived Redis lock per room_id serializes those calls.
const LOCK_TTL_MS = 5000
const LOCK_RETRY_MS = 100
const LOCK_MAX_WAIT_MS = 3000
const LOCK_KEY = (roomId: string) => `ludo:lock:${roomId}`

class RoomBusyError extends Error {
  constructor() { super('Room busy, try again') }
}

async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID()
  const lockKey = LOCK_KEY(roomId)
  const deadline = Date.now() + LOCK_MAX_WAIT_MS
  let acquired = false
  while (Date.now() < deadline) {
    const ok = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')
    if (ok === 'OK') { acquired = true; break }
    await new Promise(r => setTimeout(r, LOCK_RETRY_MS))
  }
  if (!acquired) throw new RoomBusyError()
  try {
    return await fn()
  } finally {
    // Best-effort release only if we still hold it (avoid deleting a lock
    // acquired by someone else after our TTL expired).
    const current = await redis.get(lockKey)
    if (current === token) await redis.del(lockKey)
  }
}

interface StartReq {
  room_id: string
  stake: number
  players: { user_id: string; username: string; seat: number; is_bot: boolean }[]
  bot_difficulty?: BotDifficulty
}

interface ActionReq {
  room_id: string
  user_id: string
  action: 'roll_dice' | 'move_token'
  token_index?: number
}

async function start() {
  await app.register(cors, { origin: true })
  if (redis.status === 'wait') await redis.connect()

  // POST /start — create a fresh game and return the initial state.
  app.post('/start', async (req, reply) => {
    const body = req.body as StartReq
    if (!body?.room_id || !body.players?.length) {
      return reply.code(400).send({ error: 'room_id and players required' })
    }
    const validDifficulties: BotDifficulty[] = ['easy', 'medium', 'hard']
    const difficulty = validDifficulties.includes(body.bot_difficulty as BotDifficulty)
      ? (body.bot_difficulty as BotDifficulty)
      : 'medium'
    const state = createInitialState(body.room_id, body.stake, body.players, difficulty)
    await saveState(state)
    return state
  })

  // POST /action — process a roll or a token move from the current player.
  app.post('/action', async (req, reply) => {
    const body = req.body as ActionReq
    try {
      return await withRoomLock(body.room_id, async () => {
        const state = await loadState(body.room_id)
        if (!state) return reply.code(404).send({ error: 'Room not found' })
        if (state.status === 'completed') return reply.code(409).send({ error: 'Game already over' })

        const idx = state.players.findIndex(p => p.user_id === body.user_id)
        if (idx === -1) return reply.code(403).send({ error: 'Not in this room' })
        if (idx !== state.current_turn) return reply.code(409).send({ error: 'Not your turn' })

        let result: ActionResult | null = null
        // Preserved separately from state.dice: applyRoll() calls passTurn()
        // internally (via rules.ts) whenever no legal move exists, which clears
        // state.dice back to null before this handler returns. Without this,
        // the gateway/client have no way to know what was actually rolled in
        // that (very common — needing a 6 to leave base) case, so the roll
        // toast and dice-face UI would silently show nothing for it.
        let rolledDice: number | null = null

        if (body.action === 'roll_dice') {
          if (state.awaiting !== 'roll') return reply.code(409).send({ error: 'Roll not expected' })
          const dice = rollDie()
          rolledDice = dice
          applyRoll(state, dice)
        } else if (body.action === 'move_token') {
          if (state.awaiting !== 'move') return reply.code(409).send({ error: 'Move not expected' })
          const tokenIndex = body.token_index ?? -1
          if (!state.movable_tokens.includes(tokenIndex)) {
            return reply.code(409).send({ error: 'Illegal move' })
          }
          const r = applyMove(state, tokenIndex)
          result = r.result
        } else {
          return reply.code(400).send({ error: 'Unknown action' })
        }

        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result, dice: rolledDice }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  // Convenience endpoint the gateway uses to drive bot turns. It rolls and,
  // if a move is required, picks and plays a token in one call.
  app.post('/bot-turn', async (req, reply) => {
    const body = req.body as { room_id: string; user_id: string }
    try {
      return await withRoomLock(body.room_id, async () => {
        const state = await loadState(body.room_id)
        if (!state) return reply.code(404).send({ error: 'Room not found' })
        if (state.status === 'completed') return reply.code(409).send({ error: 'Game already over' })
        const idx = state.players.findIndex(p => p.user_id === body.user_id)
        if (idx === -1 || idx !== state.current_turn) {
          return reply.code(409).send({ error: 'Not bot turn' })
        }

        const dice = rollDie()
        applyRoll(state, dice)
        let result: ActionResult | null = null
        let movedToken = -1

        if (state.awaiting === 'move') {
          movedToken = chooseBotToken(state, idx, dice, state.bot_difficulty)
          if (movedToken >= 0) {
            const r = applyMove(state, movedToken)
            result = r.result
          }
        }

        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result, dice, moved_token: movedToken }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  // POST /leave — a real player deliberately left the table (forfeit). Marks
  // them disconnected, sends their tokens home, and either ends the game or
  // lets it continue with whoever remains. Idempotent: leaving twice, or when
  // already completed, is a no-op result.
  app.post('/leave', async (req, reply) => {
    const body = req.body as { room_id: string; user_id: string }
    if (!body?.room_id || !body?.user_id) {
      return reply.code(400).send({ error: 'room_id and user_id required' })
    }
    try {
      return await withRoomLock(body.room_id, async () => {
        const state = await loadState(body.room_id)
        if (!state) return reply.code(404).send({ error: 'Room not found' })
        if (state.status === 'completed') return { state, result: null }

        const r = forfeitPlayer(state, body.user_id)
        await saveState(state)
        if (r.result) void saveCompletedGame(state, r.result)
        return { state, result: r.result }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  app.get('/state', async (req, reply) => {
    const roomId = (req.query as any)?.room_id
    const state = await loadState(roomId)
    if (!state) return reply.code(404).send({ error: 'Room not found' })
    return state
  })

  app.get('/health', async () => ({ status: 'ok', service: 'ludo-engine' }))

  const port = parseInt(process.env.PORT || '3011')
  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1) }
    console.log(`Ludo engine running on port ${port}`)
  })
}

// Retries a few times before giving up — a transient DB blip here previously
// left game_rooms permanently out of sync with the wallet ledger (wallet
// settlement in the gateway proceeds regardless of whether this succeeds)
// with no retry or record of the failure.
async function saveCompletedGame(state: LudoState, result: ActionResult): Promise<void> {
  const attempts = 3
  // game_rooms has no winner_id/prize_pool/platform_fee columns (the winner is
  // recorded per-participant by the wallet ledger); the real columns are
  // pot_amount + platform_fee_collected. The previous UPDATE referenced
  // nonexistent columns and failed on every completed game, so Ludo rooms'
  // pot/rake were never persisted and admin GGR reporting under-counted Ludo.
  const pot = Math.round(state.stake * state.players.length * 100) / 100
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.query(
        `UPDATE game_rooms SET status = 'completed', pot_amount = $1,
                platform_fee_collected = $2, ended_at = NOW() WHERE id = $3`,
        [pot, result.rake_fee, state.room_id],
      )
      return
    } catch (err) {
      console.error(`Failed to save completed ludo game (attempt ${i}/${attempts})`, err)
      if (i < attempts) await new Promise(r => setTimeout(r, 1000 * i))
    }
  }
  // All attempts failed. game_rooms.status/winner_id/prize_pool are now out of
  // sync with the wallet ledger for this room — record it durably so it can
  // be reconciled instead of silently vanishing into a log line.
  try {
    await redis.rpush('ludo:reconcile:failed', JSON.stringify({
      room_id: state.room_id,
      winner_id: result.winner_id,
      prize: result.prize,
      rake_fee: result.rake_fee,
      failed_at: Date.now(),
      reason: 'saveCompletedGame: game_rooms UPDATE failed after retries',
    }))
  } catch (redisErr) {
    console.error(`[RECONCILE-NEEDED] Could not even record the reconciliation failure for room=${state.room_id}`, redisErr)
  }
}

start().catch((err) => { console.error(err); process.exit(1) })
