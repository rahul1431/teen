import Fastify from 'fastify'
import '@fastify/jwt'
import { WebSocketServer, WebSocket } from 'ws'
import { Pool } from 'pg'
import 'dotenv/config'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })

app.get('/health', async () => ({ status: 'ok', service: 'bingo-engine' }))

type BingoConn = { ws: WebSocket; userId: string; drawId: string }
const conns = new Set<BingoConn>()

function send(ws: WebSocket, event: string, data: any) {
  if (ws.readyState !== WebSocket.OPEN) return
  try { ws.send(JSON.stringify({ event, data })) } catch { /* connection closing */ }
}

function broadcastToDraw(drawId: string, event: string, data: any) {
  for (const c of conns) {
    if (c.drawId === drawId) send(c.ws, event, data)
  }
}

async function start() {
  await app.register(require('@fastify/jwt'), { secret: process.env.JWT_SECRET! })
  await app.register(require('@fastify/cors'), { origin: true })

  const httpServer = app.server
  await app.ready()

  const wss = new WebSocketServer({ server: httpServer, path: '/ws/bingo' })

  wss.on('connection', (ws: WebSocket, req) => {
    let userId: string, drawId: string
    try {
      const u = new URL(req.url || '', 'http://localhost')
      const token = u.searchParams.get('token') || req.headers.authorization?.split(' ')[1]
      drawId = u.searchParams.get('draw_id') || ''
      if (!token || !drawId) { ws.close(4001, 'Missing token or draw_id'); return }
      const payload = (app.jwt as any).verify(token) as any
      userId = payload.sub
    } catch {
      ws.close(4001, 'Invalid token')
      return
    }

    const conn: BingoConn = { ws, userId, drawId }
    conns.add(conn)

    db.query('SELECT status, called_numbers FROM lottery_bingo_draws WHERE id = $1', [drawId])
      .then(res => {
        if (res.rows.length) {
          send(ws, 'bingo:draw_state', { status: res.rows[0].status, called_numbers: res.rows[0].called_numbers })
        }
      })
      .catch(() => {})

    ws.on('close', () => conns.delete(conn))
  })

  const port = Number(process.env.PORT || 3006)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[bingo-engine] listening on ${port}`)
}

start().catch(err => {
  console.error('[bingo-engine] failed to start', err)
  process.exit(1)
})

export { broadcastToDraw }
