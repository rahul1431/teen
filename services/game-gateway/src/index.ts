import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { Pool } from 'pg'
import Redis from 'ioredis'
import { MatchmakingService } from './matchmaking'
import { RealtimeHub, Conn } from './realtime'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })

async function start() {
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })
  if (redis.status === 'wait') await redis.connect()

  const httpServer = createServer(app.server)
  const hub = new RealtimeHub()
  const matchmaking = new MatchmakingService(redis, db, hub)

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
        if (data.room_id) hub.joinConn(conn, data.room_id)
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
    if ((state.currentTurn ?? state.current_turn) !== playerIdx) return hub.send(conn, 'error', { message: 'Not your turn' })

    const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'
    try {
      const res = await fetch(`${engineUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id, user_id: conn.userId, action, amount: amount ?? 0, sequence_num: sequence_num ?? 0 }),
      })
      if (!res.ok) {
        const msg = await res.text()
        return hub.send(conn, 'error', { message: msg || 'Engine error' })
      }
      const data = await res.json() as any
      const newState = data.state ?? data

      await matchmaking.setRoomState(room_id, { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) })

      hub.sendToRoom(room_id, 'game:state_update', {
        room_id,
        state: { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) },
        last_action: { user_id: conn.userId, action, amount },
        result: data.result ?? null,
      })

      if (newState.status === 'completed' && data.result) {
        let winnerUsername = 'Unknown'
        if (data.result.winner_id) {
          const winner = newState.players?.find((p: any) => (p.userId ?? p.user_id) === data.result.winner_id)
          if (winner) winnerUsername = winner.username ?? 'Player'

          fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/credit-game-win`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({ user_id: data.result.winner_id, amount: data.result.prize, room_id }),
          }).catch(e => console.error('credit-game-win failed', e))
        }
        hub.sendToRoom(room_id, 'game:result', {
          room_id,
          winner_id: data.result.winner_id,
          winner_username: winnerUsername,
          prize: data.result.prize,
          hand_rank: data.result.hand_rank,
          all_hands: data.result.all_hands ?? [],
        })
      } else {
        const realPlayers = (newState.players ?? []).filter((p: any) => !(p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))
        const bots = (newState.players ?? []).filter((p: any) => (p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))
        matchmaking.scheduleBotTurn(room_id, newState, realPlayers, bots)
      }
    } catch (e) {
      console.error('Engine call failed', e)
      hub.sendToRoom(room_id, 'game:action_received', { user_id: conn.userId, action, amount, sequence_num })
    }
  }

  app.get('/health', async () => ({ status: 'ok', service: 'game-gateway' }))

  const port = parseInt(process.env.PORT || '3004')
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Game gateway running on port ${port} (raw WebSocket /ws)`)
  })
}

start().catch((err) => { console.error(err); process.exit(1) })
