import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import Redis from 'ioredis'
import { Pool } from 'pg'
import {
  createInitialState,
  applyRoll,
  applyMove,
  rollDie,
  chooseBotToken,
  chooseBotTokenWithReason,
  LudoState,
  ActionResult,
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

interface StartReq {
  room_id: string
  stake: number
  players: { user_id: string; username: string; seat: number; is_bot: boolean }[]
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
    const state = createInitialState(body.room_id, body.stake, body.players)
    await saveState(state)
    return state
  })

  // POST /action — process a roll or a token move from the current player.
  app.post('/action', async (req, reply) => {
    const body = req.body as ActionReq
    const state = await loadState(body.room_id)
    if (!state) return reply.code(404).send({ error: 'Room not found' })
    if (state.status === 'completed') return reply.code(409).send({ error: 'Game already over' })

    const idx = state.players.findIndex(p => p.user_id === body.user_id)
    if (idx === -1) return reply.code(403).send({ error: 'Not in this room' })
    if (idx !== state.current_turn) return reply.code(409).send({ error: 'Not your turn' })

    let result: ActionResult | null = null

    if (body.action === 'roll_dice') {
      if (state.awaiting !== 'roll') return reply.code(409).send({ error: 'Roll not expected' })
      const dice = rollDie()
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
    return { state, result }
  })

  // Convenience endpoint the gateway uses to drive bot turns. It rolls and,
  // if a move is required, picks and plays a token in one call.
  app.post('/bot-turn', async (req, reply) => {
    const body = req.body as { room_id: string; user_id: string }
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
    let decisionReason = 'no_move'

    if (state.awaiting === 'move') {
      const decision = chooseBotTokenWithReason(state, idx, dice)
      movedToken = decision.token
      decisionReason = decision.reason
      if (movedToken >= 0) {
        const r = applyMove(state, movedToken)
        result = r.result
      }
    }

    await saveState(state)
    if (result) void saveCompletedGame(state, result)

    // Log bot decision for ML training (non-blocking)
    void db.query(
      `INSERT INTO bot_decision_logs (room_id, user_id, game_type, decision_context, action_taken, outcome)
       VALUES ($1, $2, 'ludo', $3, $4, $5)`,
      [
        body.room_id,
        body.user_id,
        JSON.stringify({
          dice,
          movable_count: state.movable_tokens?.length ?? 0,
          token_positions: state.players[idx]?.tokens ?? [],
          player_count: state.players.length,
          reason: decisionReason,
        }),
        decisionReason,
        result?.winner_id === body.user_id ? 'win' : result ? 'lose' : null,
      ]
    ).catch((err: Error) => console.error('Bot log error', err))

    return { state, result, dice, moved_token: movedToken }
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

async function saveCompletedGame(state: LudoState, result: ActionResult): Promise<void> {
  try {
    await db.query(
      `UPDATE game_rooms SET status = 'completed', winner_id = $1, prize_pool = $2,
              platform_fee = $3, ended_at = NOW() WHERE id = $4`,
      [result.winner_id, result.prize, result.rake_fee, state.room_id],
    )
  } catch (err) {
    console.error('Failed to save completed ludo game', err)
  }
}

start().catch((err) => { console.error(err); process.exit(1) })
