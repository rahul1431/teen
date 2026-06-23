import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { Pool } from 'pg'
import { z } from 'zod'
import { debitStake } from './wallet'
import {
  MATKA_MULTIPLIERS,
  validateMatkaBet,
  settleMatkaSession,
} from './matka'
import { settleLottery } from './lottery'
import { settleCricketMarket } from './cricket'

const app = Fastify({ logger: true })
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

function uid(req: any): string {
  return (req.user as any)?.sub
}

async function start() {
  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })

  const auth = async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }
  const internal = async (req: any, reply: any) => {
    if (req.headers['x-internal-key'] !== process.env.INTERNAL_SERVICE_KEY) {
      reply.code(403).send({ error: 'Forbidden' })
    }
  }

  // Get (or lazily create) today's draw for a Matka market.
  async function todayDraw(marketId: string) {
    const today = new Date().toISOString().slice(0, 10)
    const existing = await db.query(
      'SELECT * FROM matka_draws WHERE market_id = $1 AND draw_date = $2',
      [marketId, today],
    )
    if (existing.rows.length) return existing.rows[0]
    const created = await db.query(
      `INSERT INTO matka_draws (market_id, draw_date, status) VALUES ($1, $2, 'open') RETURNING *`,
      [marketId, today],
    )
    return created.rows[0]
  }

  // ════════════════════════════ MATKA ════════════════════════════
  app.get('/matka/markets', { onRequest: [auth] }, async () => {
    const markets = await db.query(
      'SELECT * FROM matka_markets WHERE is_active = true ORDER BY sort_order',
    )
    const out = []
    for (const m of markets.rows) {
      const draw = await todayDraw(m.id)
      out.push({
        id: m.id,
        name: m.name,
        open_time: m.open_time,
        close_time: m.close_time,
        draw_id: draw.id,
        status: draw.status,
        open_panna: draw.open_panna,
        open_digit: draw.open_digit,
        close_panna: draw.close_panna,
        close_digit: draw.close_digit,
        jodi: draw.jodi,
      })
    }
    return { markets: out, multipliers: MATKA_MULTIPLIERS }
  })

  app.post('/matka/bet', { onRequest: [auth] }, async (req, reply) => {
    const body = z.object({
      market_id: z.string().uuid(),
      bet_type: z.string(),
      session: z.enum(['open', 'close']).default('open'),
      number: z.string(),
      amount: z.number().positive(),
    }).parse(req.body)

    const err = validateMatkaBet(body.bet_type, body.number)
    if (err) return reply.code(400).send({ error: err })

    const draw = await todayDraw(body.market_id)
    if (draw.status === 'settled') return reply.code(409).send({ error: 'Market closed for today' })
    if (body.session === 'open' && draw.open_panna) {
      return reply.code(409).send({ error: 'Open session already declared' })
    }

    const multiplier = MATKA_MULTIPLIERS[body.bet_type]
    const potential = Math.round(body.amount * multiplier * 100) / 100

    const inserted = await db.query(
      `INSERT INTO matka_bets (user_id, draw_id, bet_type, session, number, amount, multiplier, potential_payout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid(req), draw.id, body.bet_type, body.session, body.number, body.amount, multiplier, potential],
    )
    const betId = inserted.rows[0].id

    const debit = await debitStake({
      userId: uid(req), amount: body.amount, referenceId: betId,
      idempotencyKey: `matka_stake_${betId}`, description: 'Matka bet',
    })
    if (!debit.ok) {
      await db.query('DELETE FROM matka_bets WHERE id = $1', [betId])
      return reply.code(400).send({ error: debit.error })
    }
    return { success: true, bet_id: betId, potential_payout: potential }
  })

  app.get('/matka/my-bets', { onRequest: [auth] }, async (req) => {
    const rows = await db.query(
      `SELECT b.*, m.name AS market_name FROM matka_bets b
       JOIN matka_draws d ON d.id = b.draw_id
       JOIN matka_markets m ON m.id = d.market_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
      [uid(req)],
    )
    return { bets: rows.rows }
  })

  // ════════════════════════════ LOTTERY ═══════════════════════════
  app.get('/lottery/draws', { onRequest: [auth] }, async () => {
    const rows = await db.query(
      `SELECT * FROM lottery_draws WHERE status = 'open' AND draw_time > NOW() ORDER BY draw_time ASC`,
    )
    return { draws: rows.rows }
  })

  app.post('/lottery/buy', { onRequest: [auth] }, async (req, reply) => {
    const body = z.object({
      draw_id: z.string().uuid(),
      ticket_number: z.string(),
    }).parse(req.body)

    const drawRes = await db.query(
      `SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
    if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open' })
    const draw = drawRes.rows[0]
    if (!new RegExp(`^[0-9]{${draw.digits}}$`).test(body.ticket_number)) {
      return reply.code(400).send({ error: `Ticket must be ${draw.digits} digits` })
    }

    const inserted = await db.query(
      `INSERT INTO lottery_tickets (draw_id, user_id, ticket_number, amount)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [body.draw_id, uid(req), body.ticket_number, draw.ticket_price],
    )
    const ticketId = inserted.rows[0].id

    const debit = await debitStake({
      userId: uid(req), amount: Number(draw.ticket_price), referenceId: ticketId,
      idempotencyKey: `lottery_buy_${ticketId}`, description: `Lottery: ${draw.name}`,
    })
    if (!debit.ok) {
      await db.query('DELETE FROM lottery_tickets WHERE id = $1', [ticketId])
      return reply.code(400).send({ error: debit.error })
    }
    return { success: true, ticket_id: ticketId }
  })

  app.get('/lottery/my-tickets', { onRequest: [auth] }, async (req) => {
    const rows = await db.query(
      `SELECT t.*, d.name AS draw_name, d.winning_number, d.draw_time, d.status AS draw_status
       FROM lottery_tickets t JOIN lottery_draws d ON d.id = t.draw_id
       WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
      [uid(req)],
    )
    return { tickets: rows.rows }
  })

  // ════════════════════════════ CRICKET ═══════════════════════════
  app.get('/cricket/matches', { onRequest: [auth] }, async () => {
    const matches = await db.query(
      `SELECT * FROM cricket_matches WHERE status IN ('upcoming','live') ORDER BY start_time ASC`,
    )
    const out = []
    for (const m of matches.rows) {
      const markets = await db.query(
        `SELECT id, market_type, label, options, status FROM cricket_markets
         WHERE match_id = $1 AND status = 'open'`, [m.id])
      out.push({ ...m, markets: markets.rows })
    }
    return { matches: out }
  })

  app.post('/cricket/bet', { onRequest: [auth] }, async (req, reply) => {
    const body = z.object({
      market_id: z.string().uuid(),
      option_key: z.string(),
      amount: z.number().positive(),
    }).parse(req.body)

    const mRes = await db.query(
      `SELECT mk.*, mt.status AS match_status FROM cricket_markets mk
       JOIN cricket_matches mt ON mt.id = mk.match_id
       WHERE mk.id = $1`, [body.market_id])
    if (!mRes.rows.length) return reply.code(404).send({ error: 'Market not found' })
    const market = mRes.rows[0]
    if (market.status !== 'open' || market.match_status === 'settled' || market.match_status === 'closed') {
      return reply.code(409).send({ error: 'Market is closed' })
    }

    const option = (market.options as any[]).find(o => o.key === body.option_key)
    if (!option) return reply.code(400).send({ error: 'Invalid option' })
    const odds = Number(option.odds)
    const potential = Math.round(body.amount * odds * 100) / 100

    const inserted = await db.query(
      `INSERT INTO cricket_bets (user_id, match_id, market_id, option_key, option_label, odds, amount, potential_payout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid(req), market.match_id, market.id, option.key, option.label, odds, body.amount, potential],
    )
    const betId = inserted.rows[0].id

    const debit = await debitStake({
      userId: uid(req), amount: body.amount, referenceId: betId,
      idempotencyKey: `cricket_stake_${betId}`, description: 'Cricket bet',
    })
    if (!debit.ok) {
      await db.query('DELETE FROM cricket_bets WHERE id = $1', [betId])
      return reply.code(400).send({ error: debit.error })
    }
    return { success: true, bet_id: betId, odds, potential_payout: potential }
  })

  app.get('/cricket/my-bets', { onRequest: [auth] }, async (req) => {
    const rows = await db.query(
      `SELECT b.*, mt.team_a, mt.team_b, mt.series, mk.label AS market_label
       FROM cricket_bets b
       JOIN cricket_matches mt ON mt.id = b.match_id
       JOIN cricket_markets mk ON mk.id = b.market_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
      [uid(req)],
    )
    return { bets: rows.rows }
  })

  // ═══════════════════════ ADMIN / INTERNAL ═══════════════════════
  // Declare a Matka session result. session 'open' or 'close'.
  app.post('/internal/matka/declare', { onRequest: [internal] }, async (req, reply) => {
    const body = z.object({
      draw_id: z.string().uuid(),
      session: z.enum(['open', 'close']),
      panna: z.string().regex(/^[0-9]{3}$/),
    }).parse(req.body)
    const res = await settleMatkaSession(db, body.draw_id, body.session, body.panna)
    return { success: true, ...res }
  })

  app.post('/internal/lottery/create', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      name: z.string(),
      ticket_price: z.number().positive(),
      draw_time: z.string(),
      digits: z.number().int().min(1).max(8).default(4),
      prize_multiplier: z.number().positive().default(1000),
    }).parse(req.body)
    const r = await db.query(
      `INSERT INTO lottery_draws (name, ticket_price, draw_time, digits, prize_multiplier)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.name, body.ticket_price, body.draw_time, body.digits, body.prize_multiplier],
    )
    return { success: true, draw: r.rows[0] }
  })

  app.post('/internal/lottery/draw', { onRequest: [internal] }, async (req, reply) => {
    const body = z.object({
      draw_id: z.string().uuid(),
      winning_number: z.string(),
    }).parse(req.body)
    const res = await settleLottery(db, body.draw_id, body.winning_number)
    return { success: true, ...res }
  })

  app.post('/internal/cricket/match', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      series: z.string(),
      format: z.string(),
      team_a: z.string(),
      team_b: z.string(),
      team_a_short: z.string().optional(),
      team_b_short: z.string().optional(),
      start_time: z.string(),
    }).parse(req.body)
    const r = await db.query(
      `INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [body.series, body.format, body.team_a, body.team_b, body.team_a_short, body.team_b_short, body.start_time],
    )
    return { success: true, match: r.rows[0] }
  })

  app.post('/internal/cricket/market', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      match_id: z.string().uuid(),
      market_type: z.string(),
      label: z.string(),
      options: z.array(z.object({ key: z.string(), label: z.string(), odds: z.number() })),
    }).parse(req.body)
    const r = await db.query(
      `INSERT INTO cricket_markets (match_id, market_type, label, options)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.match_id, body.market_type, body.label, JSON.stringify(body.options)],
    )
    return { success: true, market: r.rows[0] }
  })

  app.post('/internal/cricket/settle', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      market_id: z.string().uuid(),
      result_key: z.string().nullable(),
    }).parse(req.body)
    const res = await settleCricketMarket(db, body.market_id, body.result_key)
    return { success: true, ...res }
  })

  app.get('/health', async () => ({ status: 'ok', service: 'betting' }))

  const port = parseInt(process.env.PORT || '3012')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Betting service (matka/lottery/cricket) running on port ${port}`)
}

start().catch(err => { console.error(err); process.exit(1) })
