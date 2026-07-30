import 'dotenv/config'
import crypto from 'crypto'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import Redis from 'ioredis'
import { Pool } from 'pg'
import {
  createInitialState,
  drawFromClosed,
  drawFromOpen,
  discardCard,
  attemptDeclare,
  dropPlayer,
  forfeitPlayer,
  RummyState,
  ActionResult,
  BotDifficulty,
} from './rules'
import { chooseBotDraw, chooseBotDiscard, tryBotDeclare } from './coordination'

const app = Fastify({ logger: false })
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

const KEY = (roomId: string) => `rummy:game:${roomId}`
const TTL = 2 * 60 * 60 // 2h

async function loadState(roomId: string): Promise<RummyState | null> {
  const raw = await redis.get(KEY(roomId))
  return raw ? (JSON.parse(raw) as RummyState) : null
}

async function saveState(state: RummyState): Promise<void> {
  await redis.setex(KEY(state.room_id), TTL, JSON.stringify(state))
}

// Same room-lock pattern as the Ludo engine — /action and /bot-turn both do
// load -> mutate -> save with no atomicity of their own; a short-lived Redis
// lock per room_id serializes concurrent calls for the same room.
const LOCK_TTL_MS = 5000
const LOCK_RETRY_MS = 100
const LOCK_MAX_WAIT_MS = 3000
const LOCK_KEY = (roomId: string) => `rummy:lock:${roomId}`

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
    const current = await redis.get(lockKey)
    if (current === token) await redis.del(lockKey)
  }
}

interface StartReq {
  room_id: string
  stake: number
  rake_percent: number
  deck_count: number
  turn_timeout_seconds: number
  bot_difficulty?: BotDifficulty
  players: { user_id: string; username: string; seat: number; is_bot: boolean; bot_difficulty?: BotDifficulty }[]
}

interface ActionReq {
  room_id: string
  user_id: string
  action: 'draw_closed' | 'draw_open' | 'discard' | 'declare' | 'drop'
  card_id?: string
  groups?: string[][]
}

async function start() {
  await app.register(cors, { origin: true })
  if (redis.status === 'wait') await redis.connect()

  app.post('/start', async (req, reply) => {
    const body = req.body as StartReq
    if (!body?.room_id || !body.players?.length) {
      return reply.code(400).send({ error: 'room_id and players required' })
    }
    const validDifficulties: BotDifficulty[] = ['easy', 'medium', 'hard']
    const difficulty = validDifficulties.includes(body.bot_difficulty as BotDifficulty)
      ? (body.bot_difficulty as BotDifficulty)
      : 'medium'
    const state = createInitialState(
      body.room_id,
      body.stake,
      body.players,
      difficulty,
      body.deck_count || 2,
      body.turn_timeout_seconds || 30,
      body.rake_percent ?? 5,
    )
    await saveState(state)
    return state
  })

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
        let declareRejectedReason: string | null = null

        try {
          if (body.action === 'draw_closed') {
            drawFromClosed(state, idx)
          } else if (body.action === 'draw_open') {
            drawFromOpen(state, idx)
          } else if (body.action === 'discard') {
            if (!body.card_id) return reply.code(400).send({ error: 'card_id required' })
            discardCard(state, idx, body.card_id)
          } else if (body.action === 'declare') {
            if (!body.groups) return reply.code(400).send({ error: 'groups required' })
            const { outcome, result: declareResult } = attemptDeclare(state, idx, body.groups)
            if (!outcome.valid) declareRejectedReason = outcome.reason ?? 'Invalid declare'
            result = declareResult
          } else if (body.action === 'drop') {
            result = dropPlayer(state, idx)
          } else {
            return reply.code(400).send({ error: 'Unknown action' })
          }
        } catch (e: any) {
          return reply.code(409).send({ error: e.message })
        }

        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result, declare_rejected_reason: declareRejectedReason }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  // Convenience endpoint the gateway uses to drive a full bot turn: pick a
  // draw source, try to declare, otherwise discard.
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

        const drawChoice = chooseBotDraw(state, idx)
        if (drawChoice === 'open') drawFromOpen(state, idx)
        else drawFromClosed(state, idx)

        let result: ActionResult | null = null
        const declareGroups = tryBotDeclare(state, idx)
        if (declareGroups) {
          const { result: declareResult } = attemptDeclare(state, idx, declareGroups)
          result = declareResult
        } else {
          const discardId = chooseBotDiscard(state, idx)
          discardCard(state, idx, discardId)
        }

        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result }
      })
    } catch (e) {
      if (e instanceof RoomBusyError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

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

        const result = forfeitPlayer(state, body.user_id)
        await saveState(state)
        if (result) void saveCompletedGame(state, result)
        return { state, result }
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

  app.get('/health', async () => ({ status: 'ok', service: 'rummy-engine' }))

  const port = parseInt(process.env.PORT || '3012')
  app.listen({ port, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1) }
    console.log(`Rummy engine running on port ${port}`)
  })
}

async function saveCompletedGame(state: RummyState, result: ActionResult): Promise<void> {
  const attempts = 3
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
      console.error(`Failed to save completed rummy game (attempt ${i}/${attempts})`, err)
      if (i < attempts) await new Promise(r => setTimeout(r, 1000 * i))
    }
  }
  try {
    await redis.rpush('rummy:reconcile:failed', JSON.stringify({
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
