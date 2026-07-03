import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { Pool } from 'pg'
import Redis from 'ioredis'
import crypto from 'crypto'
import { MatchmakingService } from './matchmaking'
import { RealtimeHub, Conn } from './realtime'
import { monitorEmitter } from './monitor-emitter'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })
const redisOpts = {
  retryStrategy: (times: number) => Math.min(times * 500, 5000),
  maxRetriesPerRequest: null,
}
const redis = new Redis(process.env.REDIS_URL!, redisOpts)
redis.on('error', (err) => console.error('[redis] pub error', err.message))

async function start() {
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })

  const httpServer = app.server
  const hub = new RealtimeHub()
  hub.setRedisPub(redis)

  const redisSub = new Redis(process.env.REDIS_URL!, redisOpts)
  redisSub.on('error', (err) => console.error('[redis] sub error', err.message))
  await redisSub.subscribe('gateway:broadcast')
  redisSub.on('message', (channel, message) => {
    if (channel !== 'gateway:broadcast') return
    try {
      const msg = JSON.parse(message)
      if (msg.sender === hub.processId) return
      
      if (msg.type === 'room') {
        hub.sendToRoom(msg.target, msg.event, msg.data, msg.sender)
      } else if (msg.type === 'user') {
        hub.sendToUser(msg.target, msg.event, msg.data, msg.sender)
      }
    } catch (e) {
      console.error('[redis-sub] Error processing cluster message', e)
    }
  })

  const matchmaking = new MatchmakingService(redis, db, hub)
  monitorEmitter.start()

  // Raw WebSocket transport (replaces socket.io). Path /ws; token via the
  // ?token= query param or the Authorization header.
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', (ws: WebSocket, req) => {
    // --- Authenticate the handshake ---
    let userId: string, username: string
    try {
      const url = new URL(req.url || '', 'http://localhost')
      const token = url.searchParams.get('token') || req.headers.authorization?.split(' ')[1]
      console.log(`[ws] connection from ${req.socket.remoteAddress} hasToken=${!!token}`)
      if (!token) { ws.close(4001, 'No token'); return }
      const payload = app.jwt.verify(token) as any
      userId = payload.sub
      username = payload.username
    } catch (err) {
      console.warn('[ws] rejected: invalid token —', (err as Error).message)
      ws.close(4001, 'Invalid token')
      return
    }

    const conn: Conn = { ws, userId, username, rooms: new Set(), isAlive: true }
    hub.add(conn)
    console.log(`[ws] connected: user=${userId}`)

    // Heartbeat — mark alive on pong; a sweep below culls dead links.
    ;(ws as any).isAlive = true
    ws.on('pong', () => { (ws as any).isAlive = true })

    ws.on('message', async (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }
      const { event, data } = msg || {}
      if (!event) return
      try {
        await handleEvent(event, data ?? {}, conn)
      } catch (err) {
        console.error(`[ws] handler error for ${event}:`, err)
        hub.send(conn, 'error', { message: 'Internal error' })
      }
    })

    ws.on('close', () => {
      hub.remove(conn)
      console.log(`[ws] disconnected: user=${userId}`)
    })

    ws.on('error', (e) => console.warn(`[ws] socket error user=${userId}:`, e.message))
  })

  // Drop connections that stopped responding to pings.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const anyWs = ws as any
      if (anyWs.isAlive === false) { ws.terminate(); return }
      anyWs.isAlive = false
      ws.ping()
    })
  }, 30000)
  wss.on('close', () => clearInterval(heartbeat))

  // --- Event router (ports the former socket.io handlers) ---
  async function handleEvent(event: string, data: any, conn: Conn): Promise<void> {
    switch (event) {
      case 'join_matchmaking': {
        const { game_type, stake } = data
        console.log(`[matchmaking] join request: user=${conn.userId} game=${game_type} stake=${stake}`)
        if (!game_type || !stake) return hub.send(conn, 'error', { message: 'game_type and stake required' })

        const configRes = await db.query('SELECT is_active FROM game_configs WHERE game_type = $1', [game_type])
        if (!configRes.rows.length || !configRes.rows[0].is_active) {
          console.warn(`[matchmaking] game not available: ${game_type} (rows=${configRes.rows.length})`)
          return hub.send(conn, 'error', { message: 'Game not available' })
        }
        try {
          await matchmaking.joinQueue(game_type, stake, { userId: conn.userId, username: conn.username })
          hub.send(conn, 'matchmaking:joined', { game_type, stake })
          monitorEmitter.emit('join_matchmaking', { game_type, user_id: conn.userId, stake })
          console.log(`[matchmaking] ${conn.userId} queued for ${game_type}:${stake}`)
        } catch (err) {
          console.error(`[matchmaking] joinQueue failed for ${conn.userId}:`, err)
          hub.send(conn, 'error', { message: 'Failed to join matchmaking. Please try again.' })
        }
        return
      }

      case 'leave_matchmaking': {
        const { game_type, stake } = data
        await matchmaking.leaveQueue(game_type, stake, conn.userId)
        hub.send(conn, 'matchmaking:left', {})
        monitorEmitter.emit('leave_matchmaking', { game_type, user_id: conn.userId })
        return
      }

      case 'game:action': {
        const rawState = await matchmaking.getRoomState(data.room_id)
        if (rawState && (rawState.gameType === 'ludo' || rawState.game_type === 'ludo')) {
          return handleLudoAction(conn, data.room_id, data)
        }
        const { room_id, action, amount, sequence_num } = data
        return handleGameAction(conn, room_id, action, amount, sequence_num)
      }

      case 'join_room': {
        const { room_id } = data
        if (!room_id) return
        hub.joinConn(conn, room_id)

        // Fetch current game state to sync the client
        const rawState = await matchmaking.getRoomState(room_id)
        if (rawState) {
          let myCards: any[] = []
          
          if (rawState.gameType === 'teen_patti' || rawState.game_type === 'teen_patti') {
            // Fetch full state with cards from Redis
            const fullStateRaw = await redis.get(`tp:game:${room_id}`)
            if (fullStateRaw) {
              try {
                const fullState = JSON.parse(fullStateRaw)
                const me = fullState.players?.find((p: any) => (p.user_id ?? p.userId) === conn.userId)
                if (me) {
                  myCards = me.cards ?? []
                }
              } catch (e) {
                console.error('Failed to parse full tp state', e)
              }
            }
          }

          // Send room:joined event to sync this connection
          hub.send(conn, 'room:joined', {
            room_id,
            players: rawState.players?.map((p: any) => ({
              ...p,
              userId: p.userId ?? p.user_id,
              cards: undefined, // ensure opponents' cards hidden
            })),
            my_cards: myCards,
            your_seat: rawState.players?.findIndex((p: any) => (p.userId ?? p.user_id) === conn.userId) + 1,
            game_type: rawState.gameType ?? rawState.game_type,
            stake: rawState.stake,
            pot: rawState.pot,
            current_turn: rawState.currentTurn ?? rawState.current_turn ?? 0,
            dealer_id: rawState.dealer_id ?? rawState.DealerID,
            min_bet: rawState.minBet ?? rawState.min_bet ?? rawState.stake,
          })

          // Bot recovery: if it's currently a bot's turn, trigger/drive the bot
          const currentIdx = rawState.currentTurn ?? rawState.current_turn ?? 0
          const currentPlayer = rawState.players?.[currentIdx]
          if (currentPlayer && (currentPlayer.isBot || currentPlayer.is_bot)) {
            console.log(`[ws] join_room bot recovery: driving bot turn for room=${room_id} turn=${currentIdx}`)
            if (rawState.gameType === 'ludo' || rawState.game_type === 'ludo') {
              void matchmaking.driveLudoBots(room_id)
            } else {
              const realPlayers = (rawState.players ?? []).filter((p: any) => !(p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))
              const bots = (rawState.players ?? []).filter((p: any) => (p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))
              matchmaking.scheduleBotTurn(room_id, rawState, realPlayers, bots)
            }
          }
        }
        return
      }

      case 'room:chat': {
        const { room_id, message, type } = data
        if (!message || message.length > 200) return
        const msgType = ['text', 'emoji', 'gift'].includes(type) ? type : 'text'
        hub.sendToRoom(room_id, 'room:chat', {
          user_id: conn.userId,
          username: conn.username,
          message: message.substring(0, 200),
          type: msgType,
          timestamp: Date.now(),
        })
        monitorEmitter.emit('room_chat', { room_id, user_id: conn.userId })
        return
      }

      case 'ping': {
        hub.send(conn, 'pong', { timestamp: data.timestamp, server_time: Date.now() })
        return
      }

      default:
        console.warn(`[ws] unknown event: ${event}`)
    }
  }

  // Ludo: forward roll_dice / move_token to the Ludo engine, broadcast the new
  // board to the room, then either finish or hand off to the bot driver.
  async function handleLudoAction(conn: Conn, room_id: string, data: any): Promise<void> {
    const engineUrl = process.env.LUDO_ENGINE_URL || 'http://127.0.0.1:3011'
    try {
      const res = await fetch(`${engineUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id,
          user_id: conn.userId,
          action: data.action,
          token_index: data.token_index,
        }),
      })
      if (!res.ok) {
        const msg = await res.text()
        return hub.send(conn, 'error', { message: msg || 'Engine error' })
      }
      const out = await res.json() as any
      const newState = out.state
      monitorEmitter.emit('game_action', {
        game_type: 'ludo',
        room_id,
        user_id: conn.userId,
        action: data.action,
        amount: 0,
      })
      await matchmaking.setRoomState(room_id, { ...newState, gameType: 'ludo' })
      hub.sendToRoom(room_id, 'game:state_update', {
        room_id,
        state: newState,
        last_action: { user_id: conn.userId, action: data.action, dice: newState.dice, token_index: data.token_index },
        result: out.result ?? null,
      })
      if (out.result) {
        await matchmaking.handleLudoEnd(room_id, out.result)
      } else {
        void matchmaking.driveLudoBots(room_id)
      }
    } catch (e) {
      console.error('Ludo action failed', e)
      hub.send(conn, 'error', { message: 'Engine unavailable' })
    }
  }

  async function handleGameAction(conn: Conn, room_id: string, action: string, amount: number, sequence_num: number): Promise<void> {
    const rawState = await matchmaking.getRoomState(room_id)
    if (!rawState) return hub.send(conn, 'error', { message: 'Room not found' })

    const state = rawState
    const playerIdx = state.players.findIndex((p: any) => (p.userId ?? p.user_id) === conn.userId)
    if (playerIdx === -1) return hub.send(conn, 'error', { message: 'Not in this room' })
    // 'see' is always out-of-turn; sideshow accept/reject is answered by the
    // target player, whose turn it is not — the engine validates they're the
    // actual target of the pending request.
    const outOfTurnOk = action === 'see' || action === 'sideshow_accept' || action === 'sideshow_reject'
    if (!outOfTurnOk && (state.currentTurn ?? state.current_turn) !== playerIdx) {
      return hub.send(conn, 'error', { message: 'Not your turn' })
    }

    // In-game bet locking
    let extraBet = 0
    const player = state.players[playerIdx]
    const isBot = player.isBot || player.is_bot || false
    if (!isBot) {
      const isSeen = player.isSeen || player.is_seen || false
      const minBet = state.minBet ?? state.min_bet ?? state.stake ?? 0
      if (action === 'call') {
        extraBet = isSeen ? minBet * 2 : minBet
      } else if (action === 'raise') {
        extraBet = amount
      } else if (action === 'show') {
        extraBet = isSeen ? minBet * 2 : minBet
      } else if (action === 'sideshow') {
        // Engine charges a seen chaal for the request (requester must be seen)
        extraBet = minBet * 2
      }
    }

    let locked = false
    const lockId = crypto.randomUUID()
    if (extraBet > 0) {
      try {
        const lockRes = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
          body: JSON.stringify({ user_id: conn.userId, amount: extraBet, room_id, lock_id: lockId }),
        })
        if (!lockRes.ok) {
          const msg = await lockRes.text()
          return hub.send(conn, 'error', { message: `Insufficient balance: ${msg}` })
        }
        locked = true
      } catch (err) {
        console.error('[gateway] Wallet lock failed', err)
        return hub.send(conn, 'error', { message: 'Wallet service unavailable' })
      }
    }

    const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'
    try {
      const res = await fetch(`${engineUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id, user_id: conn.userId, action, amount: amount ?? 0, sequence_num: sequence_num ?? 0 }),
      })
      if (!res.ok) {
        if (locked) {
          await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({ user_id: conn.userId, amount: extraBet, room_id }),
          }).catch(e => console.error('[gateway] unlock rollback failed', e))
        }
        const msg = await res.text()
        return hub.send(conn, 'error', { message: msg || 'Engine error' })
      }

      const data = await res.json() as any
      const newState = data.state ?? data

      monitorEmitter.emit('game_action', {
        game_type: state.gameType ?? state.game_type ?? 'teen_patti',
        room_id,
        user_id: conn.userId,
        action,
        amount: extraBet > 0 ? extraBet : (amount ?? 0),
      })

      if (locked) {
        await db.query(
          'UPDATE game_participants SET entry_fee_deducted = entry_fee_deducted + $1 WHERE room_id = $2 AND user_id = $3',
          [extraBet, room_id, conn.userId]
        ).catch(e => console.error('[gateway] Failed to update entry_fee_deducted in DB', e))
      }

      await matchmaking.setRoomState(room_id, { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) })

      hub.sendToRoom(room_id, 'game:state_update', {
        room_id,
        state: { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) },
        last_action: { user_id: conn.userId, action, amount },
        result: data.result ?? null,
      })

      dispatchSideshowEvents(room_id, data, newState)

      const realPlayers = (newState.players ?? []).filter((p: any) => !(p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))

      if (newState.status === 'completed' && data.result) {
        await matchmaking.handleGameEnd(room_id, data.result, realPlayers, newState)
      } else {
        const bots = (newState.players ?? []).filter((p: any) => (p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))
        matchmaking.scheduleBotTurn(room_id, newState, realPlayers, bots)
      }
    } catch (e) {
      console.error('Engine call failed', e)
      if (locked) {
        await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
          body: JSON.stringify({ user_id: conn.userId, amount: extraBet, room_id }),
        }).catch(err => console.error('[gateway] unlock rollback failed on catch', err))
      }
      hub.sendToRoom(room_id, 'game:action_received', { user_id: conn.userId, action, amount, sequence_num })
    }
  }

  // Route the engine's sideshow payloads to the right sockets: the target
  // gets a private accept/reject prompt, the reveal (with cards) goes only to
  // the two players involved, and the room sees card-free outcome events.
  // When the target is a bot, answer for it after a human-feeling delay.
  function dispatchSideshowEvents(room_id: string, data: any, newState: any): void {
    if (data.sideshow_request) {
      const sr = data.sideshow_request
      hub.sendToRoom(room_id, 'game:sideshow_requested', { room_id, ...sr })
      hub.sendToUser(sr.target_id, 'game:sideshow_prompt', { room_id, ...sr })

      const target = (newState.players ?? []).find((p: any) => (p.userId ?? p.user_id) === sr.target_id)
      if (target && (target.isBot || target.is_bot)) {
        const accept = Math.random() < 0.6
        const delayMs = 1500 + Math.floor(Math.random() * 2000)
        setTimeout(() => {
          botAnswerSideshow(room_id, sr.target_id, accept).catch(e =>
            console.error('[gateway] bot sideshow answer failed', e))
        }, delayMs)
      }
    }

    if (data.sideshow_reveal) {
      const rv = data.sideshow_reveal
      const privatePayload = { room_id, ...rv }
      hub.sendToUser(rv.requester_id, 'game:sideshow_reveal', privatePayload)
      hub.sendToUser(rv.target_id, 'game:sideshow_reveal', privatePayload)
      hub.sendToRoom(room_id, 'game:sideshow_result', {
        room_id,
        accepted: true,
        requester_id: rv.requester_id,
        target_id: rv.target_id,
      })
    }

    if (data.sideshow_rejected) {
      hub.sendToRoom(room_id, 'game:sideshow_result', {
        room_id,
        accepted: false,
        ...data.sideshow_rejected,
      })
    }
  }

  async function botAnswerSideshow(room_id: string, botUserId: string, accept: boolean): Promise<void> {
    const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'
    const res = await fetch(`${engineUrl}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id,
        user_id: botUserId,
        action: accept ? 'sideshow_accept' : 'sideshow_reject',
        amount: 0,
        sequence_num: 0,
      }),
    })
    if (!res.ok) {
      console.error(`[gateway] bot sideshow ${accept ? 'accept' : 'reject'} rejected by engine:`, await res.text())
      return
    }
    const data = await res.json() as any
    const newState = data.state ?? data
    await matchmaking.setRoomState(room_id, { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) })
    hub.sendToRoom(room_id, 'game:state_update', {
      room_id,
      state: { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) },
      last_action: { user_id: botUserId, action: accept ? 'sideshow_accept' : 'sideshow_reject', amount: 0 },
      result: data.result ?? null,
    })
    dispatchSideshowEvents(room_id, data, newState)
  }

  // --- Internal Admin API Endpoints ---

  app.post('/internal/game-rooms/:roomId/force-action', async (req, reply) => {
    const key = process.env.INTERNAL_SERVICE_KEY
    if (!key || req.headers['x-internal-key'] !== key) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const { roomId } = req.params as any
    const { user_id, action, amount, token_index } = req.body as any

    const rawState = await matchmaking.getRoomState(roomId)
    if (!rawState) return reply.code(404).send({ error: 'Room not found' })

    const mockConn: Conn = {
      ws: { readyState: 3 } as any, // CLOSED state to prevent crash in rawSend
      userId: user_id,
      username: 'Admin',
      rooms: new Set(),
      isAlive: true
    }

    if (rawState.gameType === 'ludo' || rawState.game_type === 'ludo') {
      await handleLudoAction(mockConn, roomId, { action, token_index })
    } else {
      await handleGameAction(mockConn, roomId, action, amount, 0)
    }
    return reply.send({ success: true })
  })

  app.post('/internal/game-rooms/:roomId/kick', async (req, reply) => {
    const key = process.env.INTERNAL_SERVICE_KEY
    if (!key || req.headers['x-internal-key'] !== key) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const { roomId } = req.params as any
    const { user_id } = req.body as any

    // 1. Update database
    await db.query(
      `UPDATE game_participants SET is_bot = true WHERE room_id = $1 AND user_id = $2`,
      [roomId, user_id]
    )

    // 2. Fetch and update Redis state
    let isLudo = false
    const ludoStateRaw = await redis.get(`game:room:${roomId}`)
    if (ludoStateRaw) {
      try {
        const state = JSON.parse(ludoStateRaw)
        if (state.gameType === 'ludo' || state.game_type === 'ludo') {
          isLudo = true
          const p = state.players?.find((pl: any) => pl.user_id === user_id)
          if (p) {
            p.is_bot = true
            p.isBot = true
          }
          await redis.setex(`game:room:${roomId}`, 3600, JSON.stringify(state))
          
          // Broadcast update
          hub.sendToRoom(roomId, 'game:state_update', { room_id: roomId, state })
          
          // Drive bots if it is currently this player's turn
          const currentIdx = state.current_turn ?? 0
          if (state.players?.[currentIdx]?.user_id === user_id) {
            void matchmaking.driveLudoBots(roomId)
          }
        }
      } catch (e) {
        console.error('Failed to parse ludo state in kick', e)
      }
    }

    if (!isLudo) {
      // Must be Teen Patti
      const tpStateRaw = await redis.get(`tp:game:${roomId}`)
      if (tpStateRaw) {
        try {
          const state = JSON.parse(tpStateRaw)
          const p = state.players?.find((pl: any) => (pl.user_id ?? pl.userId) === user_id)
          if (p) {
            p.is_bot = true
            p.isBot = true
          }
          // Also update shared cached state (which opponents see)
          const sharedRaw = await redis.get(`game:room:${roomId}`)
          if (sharedRaw) {
            const shared = JSON.parse(sharedRaw)
            const sp = shared.players?.find((pl: any) => (pl.userId ?? pl.user_id) === user_id)
            if (sp) {
              sp.is_bot = true
              sp.isBot = true
            }
            await redis.setex(`game:room:${roomId}`, 3600, JSON.stringify(shared))
          }
          
          await redis.setex(`tp:game:${roomId}`, 3600, JSON.stringify(state))

          // Broadcast update
          hub.sendToRoom(roomId, 'game:state_update', {
            room_id: roomId,
            state: { ...state, players: state.players?.map((ep: any) => ({ ...ep, cards: undefined })) }
          })

          // Drive bot if it is currently this player's turn
          const currentIdx = state.current_turn ?? 0
          if ((state.players?.[currentIdx]?.user_id ?? state.players?.[currentIdx]?.userId) === user_id) {
            const realPlayers = state.players.filter((pl: any) => !pl.is_bot).map((pl: any) => ({ userId: pl.user_id ?? pl.userId, username: pl.username }))
            const bots = state.players.filter((pl: any) => pl.is_bot).map((pl: any) => ({ userId: pl.user_id ?? pl.userId, username: pl.username }))
            matchmaking.scheduleBotTurn(roomId, state, realPlayers, bots)
          }
        } catch (e) {
          console.error('Failed to parse tp state in kick', e)
        }
      }
    }

    // 3. Send a kick socket signal to force client logout/leave
    hub.sendToUser(user_id, 'game:kicked', { room_id: roomId })

    return reply.send({ success: true })
  })

  app.post('/internal/game-rooms/:roomId/terminate', async (req, reply) => {
    const key = process.env.INTERNAL_SERVICE_KEY
    if (!key || req.headers['x-internal-key'] !== key) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const { roomId } = req.params as any

    // 1. Fetch participants to refund stakes
    const parts = await db.query(
      `SELECT user_id, entry_fee_deducted FROM game_participants WHERE room_id = $1 AND is_bot = false`,
      [roomId]
    )

    for (const row of parts.rows) {
      const amount = parseFloat(row.entry_fee_deducted)
      if (amount > 0) {
        try {
          await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({
              user_id: row.user_id,
              amount,
              room_id: roomId,
            }),
          })
          console.log(`Refunded user=${row.user_id} amount=${amount} for terminated room=${roomId}`)
        } catch (e) {
          console.error(`Refund failed for user=${row.user_id} room=${roomId}`, e)
        }
      }
    }

    // 2. Mark game room as completed/terminated in database
    await db.query(
      `UPDATE game_rooms SET status = 'completed', ended_at = NOW() WHERE id = $1`,
      [roomId]
    )

    // 3. Delete states from Redis
    await redis.del(`game:room:${roomId}`)
    await redis.del(`tp:game:${roomId}`)

    // 4. Broadcast termination event to players in the room
    hub.sendToRoom(roomId, 'game:terminated', { message: 'Game terminated by administrator. Stake refunded.' })

    return reply.send({ success: true })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'game-gateway' }))

  const port = parseInt(process.env.PORT || '3004')
  await app.ready()
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Game gateway running on port ${port} (raw WebSocket /ws)`)
  })
}

start().catch((err) => { console.error(err); process.exit(1) })
