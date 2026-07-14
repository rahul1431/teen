import Fastify from 'fastify'
import '@fastify/jwt'
import { WebSocketServer, WebSocket } from 'ws'
import { Pool } from 'pg'
import 'dotenv/config'
import { generateBingoCard, checkNewTiers, BingoTier } from './bingo-logic'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL!, max: 10 })

const CALL_INTERVAL_MS = 3500
const SCHEDULER_POLL_MS = 10_000
const WALLET_URL = process.env.WALLET_SERVICE_URL || 'http://127.0.0.1:3003'
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || ''

async function creditPrize(userId: string, amount: number, referenceId: string, idempotencyKey: string) {
  if (amount <= 0) return
  try {
    await fetch(`${WALLET_URL}/internal/wallet/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify({ user_id: userId, amount, type: 'game_credit', reference_id: referenceId, idempotency_key: idempotencyKey }),
    })
  } catch (e) {
    console.error(`[bingo-engine] credit failed for ticket ${referenceId}`, e)
  }
}

// One entry per draw currently in the 'calling' phase in this process.
type ActiveDraw = { sequence: number[]; calledCount: number; timer: NodeJS.Timeout }
const activeDraws = new Map<string, ActiveDraw>()

function shuffle90(): number[] {
  const nums = Array.from({ length: 90 }, (_, i) => i + 1)
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[nums[i], nums[j]] = [nums[j], nums[i]]
  }
  return nums
}

async function startCalling(drawId: string) {
  const sequence = shuffle90()
  await db.query(`UPDATE lottery_bingo_draws SET status = 'calling' WHERE id = $1`, [drawId])
  broadcastToDraw(drawId, 'bingo:draw_state', { status: 'calling', called_numbers: [] })

  const entry: ActiveDraw = {
    sequence,
    calledCount: 0,
    timer: setInterval(() => callNext(drawId), CALL_INTERVAL_MS),
  }
  activeDraws.set(drawId, entry)
}

async function callNext(drawId: string) {
  const entry = activeDraws.get(drawId)
  if (!entry) return

  const number = entry.sequence[entry.calledCount]
  entry.calledCount++
  const calledSoFar = entry.sequence.slice(0, entry.calledCount)

  await db.query(`UPDATE lottery_bingo_draws SET called_numbers = $1 WHERE id = $2`, [JSON.stringify(calledSoFar), drawId])
  broadcastToDraw(drawId, 'bingo:number_called', { number, called_numbers: calledSoFar })

  const ticketsRes = await db.query(`SELECT * FROM lottery_bingo_tickets WHERE draw_id = $1`, [drawId])
  for (const t of ticketsRes.rows) {
    const alreadyWon: BingoTier[] = t.tiers_won || []
    const newTiers = checkNewTiers(t.card, calledSoFar, alreadyWon)
    if (newTiers.length) {
      const updatedTiers = [...alreadyWon, ...newTiers]
      await db.query(`UPDATE lottery_bingo_tickets SET tiers_won = $1 WHERE id = $2`, [JSON.stringify(updatedTiers), t.id])
      broadcastToDraw(drawId, 'bingo:tier_won', { ticket_id: t.id, user_id: t.user_id, new_tiers: newTiers })
    }
  }

  if (entry.calledCount >= 90) {
    clearInterval(entry.timer)
    activeDraws.delete(drawId)
    await settleDraw(drawId)
  }
}

async function settleDraw(drawId: string) {
  const drawRes = await db.query(`SELECT * FROM lottery_bingo_draws WHERE id = $1`, [drawId])
  const draw = drawRes.rows[0]
  const tiers: { match_type: BingoTier; multiplier: number }[] = draw.prize_tiers || []
  const ticketPrice = Number(draw.ticket_price)

  const ticketsRes = await db.query(`SELECT * FROM lottery_bingo_tickets WHERE draw_id = $1`, [drawId])
  for (const t of ticketsRes.rows) {
    const tiersWon: BingoTier[] = t.tiers_won || []
    let prize = 0
    for (const matchType of tiersWon) {
      const tier = tiers.find(x => x.match_type === matchType)
      if (tier) prize += ticketPrice * Number(tier.multiplier)
    }
    if (prize > 0) {
      await db.query(`UPDATE lottery_bingo_tickets SET prize = $1 WHERE id = $2`, [prize, t.id])
      await creditPrize(t.user_id, prize, t.id, `bingo_payout_${t.id}`)
    }
  }

  await db.query(`UPDATE lottery_bingo_draws SET status = 'settled' WHERE id = $1`, [drawId])
  broadcastToDraw(drawId, 'bingo:draw_complete', { draw_id: drawId })
}

async function scheduleSweep() {
  try {
    const dueRes = await db.query(
      `SELECT id FROM lottery_bingo_draws WHERE status = 'open' AND draw_time <= NOW()`,
    )
    for (const row of dueRes.rows) {
      if (!activeDraws.has(row.id)) await startCalling(row.id)
    }
  } catch (e) {
    console.error('[bingo-engine] scheduler sweep failed', e)
  }
}

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

  setInterval(scheduleSweep, SCHEDULER_POLL_MS)
  scheduleSweep()

  const port = Number(process.env.PORT || 3006)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[bingo-engine] listening on ${port}`)
}

start().catch(err => {
  console.error('[bingo-engine] failed to start', err)
  process.exit(1)
})

export { broadcastToDraw }
