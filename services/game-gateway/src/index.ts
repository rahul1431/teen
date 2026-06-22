import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { MatchmakingService } from './matchmaking'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 })
const pubClient = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
const subClient = pubClient.duplicate()

async function start() {
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })

  const httpServer = createServer(app.server)
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  })

  await Promise.all([
    pubClient.status === 'wait' ? pubClient.connect() : Promise.resolve(),
    subClient.status === 'wait' ? subClient.connect() : Promise.resolve(),
  ])
  io.adapter(createAdapter(pubClient, subClient))

  const matchmaking = new MatchmakingService(pubClient, db, io)

  // Socket.IO auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1]
      if (!token) return next(new Error('No token'))
      const payload = app.jwt.verify(token) as any
      socket.data.userId = payload.sub
      socket.data.username = payload.username
      // Map socketId → userId in Redis
      await pubClient.setex(`game:socket:${socket.id}`, 3600, payload.sub)
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} user: ${socket.data.userId}`)

    socket.on('join_matchmaking', async ({ game_type, stake }: any) => {
      console.log(`[matchmaking] join request: user=${socket.data.userId} game=${game_type} stake=${stake} socket=${socket.id}`)
      if (!game_type || !stake) return socket.emit('error', { message: 'game_type and stake required' })

      const configRes = await db.query('SELECT is_active FROM game_configs WHERE game_type = $1', [game_type])
      if (!configRes.rows.length || !configRes.rows[0].is_active) {
        console.warn(`[matchmaking] game not available: ${game_type} (rows=${configRes.rows.length})`)
        return socket.emit('error', { message: 'Game not available' })
      }

      try {
        await matchmaking.joinQueue(game_type, stake, {
          userId: socket.data.userId,
          username: socket.data.username,
          socketId: socket.id,
        })
        socket.emit('matchmaking:joined', { game_type, stake })
        console.log(`[matchmaking] ${socket.data.userId} queued for ${game_type}:${stake}`)
      } catch (err) {
        console.error(`[matchmaking] joinQueue failed for ${socket.data.userId}:`, err)
        socket.emit('error', { message: 'Failed to join matchmaking. Please try again.' })
      }
    })

    socket.on('leave_matchmaking', async ({ game_type, stake }: any) => {
      await matchmaking.leaveQueue(game_type, stake, socket.data.userId)
      socket.emit('matchmaking:left', {})
    })

    socket.on('game:action', async ({ room_id, action, amount, sequence_num }: any) => {
      const rawState = await pubClient.get(`game:room:${room_id}`)
      if (!rawState) return socket.emit('error', { message: 'Room not found' })

      const state = JSON.parse(rawState)
      const playerIdx = state.players.findIndex((p: any) => (p.userId ?? p.user_id) === socket.data.userId)
      if (playerIdx === -1) return socket.emit('error', { message: 'Not in this room' })
      if ((state.currentTurn ?? state.current_turn) !== playerIdx) return socket.emit('error', { message: 'Not your turn' })

      const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'
      try {
        const res = await fetch(`${engineUrl}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_id, user_id: socket.data.userId, action, amount: amount ?? 0, sequence_num: sequence_num ?? 0 }),
        })
        if (!res.ok) {
          const msg = await res.text()
          return socket.emit('error', { message: msg || 'Engine error' })
        }
        const data = await res.json()
        const newState = data.state ?? data

        // Update cached state (without private cards)
        await pubClient.setex(`game:room:${room_id}`, 3600, JSON.stringify({
          ...newState,
          players: newState.players?.map((p: any) => ({ ...p, cards: undefined })),
        }))

        // Broadcast to all in room (cards hidden)
        io.to(room_id).emit('game:state_update', {
          room_id,
          state: { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) },
          last_action: { user_id: socket.data.userId, action, amount },
          result: data.result ?? null,
        })

        if (newState.status === 'completed' && data.result) {
          // Credit winner
          if (data.result.winner_id) {
            fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/credit-game-win`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
              body: JSON.stringify({ user_id: data.result.winner_id, amount: data.result.prize, room_id }),
            }).catch(e => console.error('credit-game-win failed', e))
          }
          io.to(room_id).emit('game:result', {
            room_id,
            winner_id: data.result.winner_id,
            prize: data.result.prize,
            hand_rank: data.result.hand_rank,
            all_hands: data.result.all_hands ?? [],
          })
        }
      } catch (e) {
        console.error('Engine call failed', e)
        // Fallback: just broadcast so game doesn't freeze
        io.to(room_id).emit('game:action_received', { user_id: socket.data.userId, action, amount, sequence_num })
      }
    })

    socket.on('join_room', async ({ room_id }: any) => {
      socket.join(room_id)
    })

    socket.on('room:chat', ({ room_id, message, type }: any) => {
      if (!message || message.length > 200) return
      const msgType = ['text', 'emoji', 'gift'].includes(type) ? type : 'text'
      io.to(room_id).emit('room:chat', {
        user_id: socket.data.userId,
        username: socket.data.username,
        message: message.substring(0, 200),
        type: msgType,
        timestamp: Date.now(),
      })
    })

    socket.on('ping', ({ timestamp }: any) => {
      socket.emit('pong', { timestamp, server_time: Date.now() })
    })

    socket.on('disconnect', async () => {
      await pubClient.del(`game:socket:${socket.id}`)
      console.log(`Socket disconnected: ${socket.id}`)
    })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'game-gateway' }))

  const port = parseInt(process.env.PORT || '3004')
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Game gateway running on port ${port}`)
  })
}

start().catch((err) => { console.error(err); process.exit(1) })
