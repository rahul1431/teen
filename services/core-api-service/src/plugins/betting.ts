import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import crypto from 'crypto'
import { debitStake, creditPrize } from '../helpers/wallet-client'
import { rebalanceWeeklyMonthlyBotTickets } from '../helpers/lottery-bot-fill'
import { MATKA_MULTIPLIERS, validateMatkaBet, settleMatkaSession } from '../helpers/matka'
import { settleLottery, generateWinningNumber } from '../helpers/lottery'
import { rollOutcome } from '../helpers/scratch'
import { settleCricketSession } from '../helpers/cricket'
import { cricApiFetch } from '../helpers/cricapi-client'
import { syncCurrentMatches } from '../helpers/cricket-sync'
import { finalizeMatch } from '../helpers/cricket-finalize'
import { syncMatchOdds } from '../helpers/odds-api-client'
import { initPool } from '../db/pool'
import { startCricketAutomationScheduler } from '../modules/cricket/scheduler'
import { settleColorPredictionRound, getColorFromNumber, getSizeFromNumber, calculateBetPayout } from '../helpers/color-prediction'

export function bettingPlugin(db: Pool) {
  // Initialize the shared pool for lottery/betting modules
  initPool(db)
  startCricketAutomationScheduler()

  return async function (app: FastifyInstance) {

    const auth = app.authenticate
    const internal = async (req: any, reply: any) => {
      const key = process.env.INTERNAL_SERVICE_KEY
      if (!key || req.headers['x-internal-key'] !== key) return reply.code(403).send({ error: 'Forbidden' })
    }

    function uid(req: any): string { return (req.user as any)?.sub }

    async function todayDraw(marketId: string) {
      const today = new Date().toISOString().slice(0, 10)
      const existing = await db.query('SELECT * FROM matka_draws WHERE market_id = $1 AND draw_date = $2', [marketId, today])
      if (existing.rows.length) return existing.rows[0]
      const created = await db.query(`INSERT INTO matka_draws (market_id, draw_date, status) VALUES ($1, $2, 'open') RETURNING *`, [marketId, today])
      return created.rows[0]
    }

    // ══ MATKA ══
    app.get('/matka/markets', { onRequest: [auth] }, async () => {
      const markets = await db.query('SELECT * FROM matka_markets WHERE is_active = true ORDER BY sort_order')
      const out = []
      for (const m of markets.rows) {
        const draw = await todayDraw(m.id)
        out.push({ id: m.id, name: m.name, open_time: m.open_time, close_time: m.close_time, draw_id: draw.id, status: draw.status, open_panna: draw.open_panna, open_digit: draw.open_digit, close_panna: draw.close_panna, close_digit: draw.close_digit, jodi: draw.jodi })
      }
      return { markets: out, multipliers: MATKA_MULTIPLIERS }
    })

    app.post('/matka/bet', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ market_id: z.string().uuid(), bet_type: z.string(), session: z.enum(['open', 'close']).default('open'), number: z.string(), amount: z.number().positive() }).parse(req.body)
      const err = validateMatkaBet(body.bet_type, body.number)
      if (err) return reply.code(400).send({ error: err })
      const matkaCfg = await db.query(`SELECT is_active FROM game_configs WHERE game_type = 'matka'`)
      if (matkaCfg.rows.length && matkaCfg.rows[0].is_active === false) return reply.code(403).send({ error: 'Matka betting is currently disabled' })
      const draw = await todayDraw(body.market_id)
      if (draw.status === 'settled') return reply.code(409).send({ error: 'Market closed for today' })
      
      // Sangam bets always depend on close results
      const resolvedSession = body.bet_type.includes('sangam') ? 'close' : body.session
      if (resolvedSession === 'open' && draw.open_panna) return reply.code(409).send({ error: 'Open session already declared' })
      if (resolvedSession === 'close' && draw.close_panna) return reply.code(409).send({ error: 'Close session already declared' })
      
      // Enforce the market's posted betting windows (times are IST). Open bets
      // are accepted until the open cutoff, close bets until the close cutoff.
      const mkt = await db.query(
        `SELECT open_time, close_time, (NOW() AT TIME ZONE 'Asia/Kolkata')::time AS now_ist
         FROM matka_markets WHERE id = $1`,
        [body.market_id],
      )
      if (mkt.rows.length) {
        const { open_time, close_time, now_ist } = mkt.rows[0]
        if (resolvedSession === 'open' && now_ist > open_time) return reply.code(409).send({ error: 'Open betting has closed for today' })
        if (resolvedSession === 'close' && now_ist > close_time) return reply.code(409).send({ error: 'Close betting has closed for today' })
      }
      const multiplier = MATKA_MULTIPLIERS[body.bet_type]
      const potential = Math.round(body.amount * multiplier * 100) / 100
      const betId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: body.amount, referenceId: betId, idempotencyKey: `matka_stake_${betId}`, description: 'Matka bet' })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })
      await db.query(`INSERT INTO matka_bets (id, user_id, draw_id, bet_type, session, number, amount, multiplier, potential_payout) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [betId, uid(req), draw.id, body.bet_type, resolvedSession, body.number, body.amount, multiplier, potential])
      return { success: true, bet_id: betId, potential_payout: potential }
    })

    app.get('/matka/my-bets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(`SELECT b.*, m.name AS market_name FROM matka_bets b JOIN matka_draws d ON d.id = b.draw_id JOIN matka_markets m ON m.id = d.market_id WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 100`, [uid(req)])
      return { bets: rows.rows }
    })

    function getMonday(dStr: string) {
      const parts = dStr.split('-').map(Number)
      const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
      const day = d.getUTCDay()
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
      const mon = new Date(Date.UTC(parts[0], parts[1] - 1, diff))
      return mon.toISOString().slice(0, 10)
    }

    app.get('/matka/markets/:id/chart', { onRequest: [auth] }, async (req) => {
      const { id } = req.params as { id: string }
      const draws = await db.query(
        `SELECT to_char(draw_date, 'YYYY-MM-DD') AS draw_date, 
                open_panna, open_digit, close_panna, close_digit, jodi, status 
         FROM matka_draws 
         WHERE market_id = $1 
         ORDER BY draw_date DESC LIMIT 150`,
        [id],
      )

      const daily = draws.rows.map(row => {
        const parts = row.draw_date.split('-')
        const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        return {
          date: row.draw_date,
          day_name: days[d.getUTCDay()],
          open_panna: row.open_panna ?? '***',
          open_digit: row.open_digit !== null ? String(row.open_digit) : '*',
          jodi: row.jodi ?? '**',
          close_digit: row.close_digit !== null ? String(row.close_digit) : '*',
          close_panna: row.close_panna ?? '***',
          status: row.status
        }
      })

      const weeks: Record<string, any> = {}
      for (const row of draws.rows) {
        const dStr = row.draw_date
        const mondayStr = getMonday(dStr)
        if (!weeks[mondayStr]) {
          weeks[mondayStr] = {
            week_start: mondayStr,
            mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null
          }
        }
        const parts = dStr.split('-').map(Number)
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const dayKey = days[d.getUTCDay()]
        weeks[mondayStr][dayKey] = {
          date: dStr,
          open_panna: row.open_panna ?? '***',
          close_panna: row.close_panna ?? '***',
          jodi: row.jodi ?? '**',
          open_digit: row.open_digit !== null ? String(row.open_digit) : '*',
          close_digit: row.close_digit !== null ? String(row.close_digit) : '*'
        }
      }
      return { 
        chart: Object.values(weeks).sort((a, b) => b.week_start.localeCompare(a.week_start)),
        daily: daily
      }
    })

    // ══ LOTTERY ══
    app.get('/lottery/draws', { onRequest: [auth] }, async () => {
      const rows = await db.query(`
        SELECT d.*, 
               COALESCE((SELECT json_agg(t.ticket_number) FROM lottery_tickets t WHERE t.draw_id = d.id), '[]'::json) AS reserved_tickets,
               COUNT(t.id)::int AS ticket_count
        FROM lottery_draws d
        LEFT JOIN lottery_tickets t ON t.draw_id = d.id
        WHERE d.status = 'open' AND d.draw_time > NOW()
        GROUP BY d.id
        ORDER BY d.draw_time ASC
      `)
      return { draws: rows.rows }
    })

    app.post('/lottery/buy', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid(), ticket_number: z.string() }).parse(req.body)
      const ticketNumClean = body.ticket_number.trim()
      const drawRes = await db.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open' })
      const draw = drawRes.rows[0]
      if (!/^[0-9]{4}$/.test(ticketNumClean)) return reply.code(400).send({ error: 'Ticket number must be exactly 4 digits.' })
      const lotteryCfg = await db.query(`SELECT is_active FROM game_configs WHERE game_type = 'lottery'`)
      if (lotteryCfg.rows.length && lotteryCfg.rows[0].is_active === false) return reply.code(403).send({ error: 'Lottery is currently disabled' })
      
      const checkRes = await db.query(`SELECT 1 FROM lottery_tickets WHERE draw_id = $1 AND ticket_number = $2`, [body.draw_id, ticketNumClean])
      if (checkRes.rows.length > 0) return reply.code(409).send({ error: 'Ticket number is already reserved by another player' })
      
      const ticketId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: Number(draw.ticket_price), referenceId: ticketId, idempotencyKey: `lottery_buy_${ticketId}`, description: `Lottery: ${draw.name}` })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })
      
      try {
        await db.query(`INSERT INTO lottery_tickets (id, draw_id, user_id, ticket_number, amount) VALUES ($1,$2,$3,$4,$5)`, [ticketId, body.draw_id, uid(req), ticketNumClean, draw.ticket_price])
      } catch (err: any) {
        await creditPrize({ userId: uid(req), amount: Number(draw.ticket_price), referenceId: ticketId, idempotencyKey: `lottery_buy_refund_${ticketId}` })
        if (err.code === '23505') {
          return reply.code(409).send({ error: 'Ticket number is already reserved' })
        }
        throw err
      }

      try {
        await rebalanceWeeklyMonthlyBotTickets(body.draw_id)
      } catch (err: any) {
        console.error(`[lottery] rebalanceWeeklyMonthlyBotTickets failed for draw ${body.draw_id}:`, err?.message || err)
      }

      return { success: true, ticket_id: ticketId }
    })

    app.get('/lottery/my-tickets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(`SELECT t.*, d.name AS draw_name, d.winning_number, d.draw_time, d.status AS draw_status, d.category AS draw_category FROM lottery_tickets t JOIN lottery_draws d ON d.id = t.draw_id WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`, [uid(req)])
      return { tickets: rows.rows }
    })

    app.get('/lottery/results', { onRequest: [auth] }, async () => {
      const rows = await db.query(`
        SELECT d.*,
          (SELECT json_agg(json_build_object('ticket_number', t.ticket_number, 'prize', t.prize)) 
           FROM lottery_tickets t WHERE t.draw_id = d.id AND t.is_winner = true) AS winners,
          COUNT(t.id)::int AS total_tickets,
          COUNT(t.id) FILTER (WHERE t.is_winner = true)::int AS winner_count,
          COALESCE(SUM(t.prize) FILTER (WHERE t.is_winner = true), 0) AS total_paid
        FROM lottery_draws d
        LEFT JOIN lottery_tickets t ON t.draw_id = d.id
        WHERE d.status = 'settled'
        GROUP BY d.id
        ORDER BY d.draw_time DESC
        LIMIT 20
      `)
      return { draws: rows.rows }
    })

    // ══ LOTTERY — INSTANT (SCRATCH CARD) ══
    app.get('/lottery/scratch/products', { onRequest: [auth] }, async () => {
      const rows = await db.query(`SELECT * FROM lottery_scratch_products WHERE is_active = true ORDER BY price ASC`)
      return { products: rows.rows }
    })

    app.post('/lottery/scratch/buy', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ product_id: z.string().uuid() }).parse(req.body)
      const productRes = await db.query(`SELECT * FROM lottery_scratch_products WHERE id = $1 AND is_active = true`, [body.product_id])
      if (!productRes.rows.length) return reply.code(409).send({ error: 'Product not available' })
      const product = productRes.rows[0]

      const ticketId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: Number(product.price), referenceId: ticketId, idempotencyKey: `scratch_buy_${ticketId}`, description: `Scratch Card: ${product.name}` })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })

      const result = rollOutcome(product.payouts)

      try {
        await db.query(
          `INSERT INTO lottery_scratch_tickets (id, product_id, user_id, outcome, amount, promo_code_id) VALUES ($1,$2,$3,$4,$5,$6)`,
          [ticketId, body.product_id, uid(req), result.outcome, result.amount, result.promo_code_id],
        )
      } catch (err) {
        await creditPrize({ userId: uid(req), amount: Number(product.price), referenceId: ticketId, idempotencyKey: `scratch_buy_refund_${ticketId}` })
        return reply.code(500).send({ error: 'Purchase failed, your stake has been refunded' })
      }

      if (result.outcome === 'cash' && result.amount > 0) {
        await creditPrize({
          userId: uid(req),
          amount: result.amount,
          referenceId: ticketId,
          idempotencyKey: `scratch_payout_${ticketId}`,
          notification: { title: 'Scratch Card Win! 🎉', body: `You won ₹${result.amount.toFixed(2)} on ${product.name}!` },
        })
      }

      let promoCode: string | null = null
      if (result.outcome === 'coupon' && result.promo_code_id) {
        const promoRes = await db.query(`SELECT code FROM promo_codes WHERE id = $1`, [result.promo_code_id])
        promoCode = promoRes.rows[0]?.code || null
      }

      return { success: true, ticket_id: ticketId, outcome: result.outcome, amount: result.amount, promo_code: promoCode }
    })

    app.get('/lottery/scratch/my-tickets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(
        `SELECT t.*, p.name AS product_name, p.price AS product_price, pc.code AS promo_code
         FROM lottery_scratch_tickets t
         JOIN lottery_scratch_products p ON p.id = t.product_id
         LEFT JOIN promo_codes pc ON pc.id = t.promo_code_id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
        [uid(req)],
      )
      return { tickets: rows.rows }
    })

    // ══ CRICKET (Dream11-style fantasy contests, plus session/fancy
    // betting — match-odds betting stays archived; see archived_cricket_{
    // bets,markets}) ══
    app.get('/cricket/matches', { onRequest: [auth] }, async () => {
      const matches = await db.query(`SELECT * FROM cricket_matches WHERE status IN ('upcoming','live') ORDER BY start_time ASC`)
      const out = []
      for (const m of matches.rows) {
        const sessions = await db.query(`SELECT id, label, min_runs, max_runs, odds_yes, odds_no, status, result_runs FROM cricket_sessions WHERE match_id = $1 AND status = 'open'`, [m.id])
        const markets = await db.query(`SELECT id, market_type, label, options, status FROM cricket_markets WHERE match_id = $1 AND status = 'open'`, [m.id])
        out.push({ ...m, sessions: sessions.rows, markets: markets.rows })
      }
      return { matches: out }
    })

    app.post('/cricket/session/bet', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ session_id: z.string().uuid(), selection: z.enum(['yes', 'no']), amount: z.number().positive() }).parse(req.body)
      const sRes = await db.query(`SELECT s.*, mt.status AS match_status FROM cricket_sessions s JOIN cricket_matches mt ON mt.id = s.match_id WHERE s.id = $1`, [body.session_id])
      if (!sRes.rows.length) return reply.code(404).send({ error: 'Session not found' })
      const session = sRes.rows[0]
      if (session.status !== 'open' || session.match_status === 'settled' || session.match_status === 'closed') return reply.code(409).send({ error: 'Session is closed' })
      const odds = body.selection === 'yes' ? Number(session.odds_yes) : Number(session.odds_no)
      const bracket = body.selection === 'yes' ? session.max_runs : session.min_runs
      const potential = Math.round(body.amount * odds * 100) / 100
      const betId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: body.amount, referenceId: betId, idempotencyKey: `cricket_session_stake_${betId}`, description: 'Cricket session bet' })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })
      await db.query(`INSERT INTO cricket_session_bets (id, user_id, match_id, session_id, selection, runs_bracket, amount, potential_payout) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [betId, uid(req), session.match_id, session.id, body.selection, bracket, body.amount, potential])
      return { success: true, bet_id: betId, potential_payout: potential }
    })

    app.get('/cricket/session/my-bets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(`SELECT b.*, mt.team_a, mt.team_b, mt.series, s.label AS session_label FROM cricket_session_bets b JOIN cricket_matches mt ON mt.id = b.match_id JOIN cricket_sessions s ON s.id = b.session_id WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 100`, [uid(req)])
      return { bets: rows.rows }
    })

    app.get('/cricket/odds/markets', { onRequest: [auth] }, async (req) => {
      const { match_id } = req.query as { match_id?: string }
      let query = "SELECT m.*, mt.team_a, mt.team_b, mt.series, mt.start_time FROM cricket_markets m JOIN cricket_matches mt ON mt.id = m.match_id WHERE m.status = 'open'"
      const params: any[] = []
      if (match_id) {
        query += " AND m.match_id = $1"
        params.push(match_id)
      }
      const res = await db.query(query, params)
      return { markets: res.rows }
    })

    app.post('/cricket/odds/bet', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({
        market_id: z.string().uuid(),
        option_key: z.string(),
        amount: z.number().positive()
      }).parse(req.body)

      const marketRes = await db.query(
        `SELECT m.*, mt.status AS match_status, mt.start_time 
         FROM cricket_markets m 
         JOIN cricket_matches mt ON mt.id = m.match_id 
         WHERE m.id = $1`,
        [body.market_id]
      )
      if (!marketRes.rows.length) return reply.code(404).send({ error: 'Market not found' })
      const market = marketRes.rows[0]

      if (market.status !== 'open' || ['closed', 'settled'].includes(market.match_status)) {
        return reply.code(409).send({ error: 'Market is closed' })
      }

      if (new Date() >= new Date(market.start_time)) {
        return reply.code(409).send({ error: 'Match has already started' })
      }

      const options = typeof market.options === 'string' ? JSON.parse(market.options) : market.options || []
      const option = options.find((o: any) => o.key === body.option_key)
      if (!option) return reply.code(400).send({ error: 'Invalid option key selected' })

      const odds = Number(option.odds)
      const potential = Math.round(body.amount * odds * 100) / 100
      const betId = crypto.randomUUID()

      const debit = await debitStake({
        userId: uid(req),
        amount: body.amount,
        referenceId: betId,
        idempotencyKey: `cricket_odds_stake_${betId}`,
        description: `Cricket odds bet: ${option.label}`
      })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })

      await db.query(
        `INSERT INTO cricket_bets (id, user_id, match_id, market_id, option_key, option_label, odds, amount, potential_payout) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [betId, uid(req), market.match_id, market.id, body.option_key, option.label, odds, body.amount, potential]
      )

      return { success: true, bet_id: betId, potential_payout: potential }
    })

    app.get('/cricket/odds/my-bets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(
        `SELECT b.*, mt.team_a, mt.team_b, mt.series, m.label AS market_label 
         FROM cricket_bets b 
         JOIN cricket_matches mt ON mt.id = b.match_id 
         JOIN cricket_markets m ON m.id = b.market_id 
         WHERE b.user_id = $1 
         ORDER BY b.created_at DESC LIMIT 100`,
        [uid(req)]
      )
      return { bets: rows.rows }
    })

    // ══ INTERNAL ══
    app.post('/internal/matka/declare', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid(), session: z.enum(['open', 'close']), panna: z.string().regex(/^[0-9]{3}$/) }).parse(req.body)
      try {
        const res = await settleMatkaSession(db, body.draw_id, body.session, body.panna)
        return { success: true, ...res }
      } catch (err: any) {
        return reply.code(409).send({ error: err.message || 'Declare failed' })
      }
    })

    app.post('/internal/lottery/create', { onRequest: [internal] }, async (req) => {
      const body = z.object({
        name: z.string(),
        ticket_price: z.number().positive(),
        draw_time: z.string(),
        prize_tiers: z.array(z.object({
          match_type: z.enum(['exact', 'last_3', 'last_2', 'last_1']),
          multiplier: z.number().positive(),
        })).min(1),
        // Only weekly/monthly are creatable today — daily/instant are
        // reserved for the future Card/Bingo and Scratch Card mechanics.
        // The DB's CHECK constraint already allows all four so widening
        // this enum later needs no migration, just this one-line change.
        category: z.enum(['daily', 'weekly', 'monthly']),
      }).parse(req.body)
      const botConfigRes = await db.query('SELECT default_max_tickets FROM lottery_bot_config LIMIT 1')
      const maxTickets = botConfigRes.rows[0]?.default_max_tickets ?? 200
      const r = await db.query(`INSERT INTO lottery_draws (name, ticket_price, draw_time, prize_tiers, category, max_tickets) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [body.name, body.ticket_price, body.draw_time, JSON.stringify(body.prize_tiers), body.category, maxTickets])
      try {
        await rebalanceWeeklyMonthlyBotTickets(r.rows[0].id)
      } catch (err: any) {
        console.error(`[lottery] rebalanceWeeklyMonthlyBotTickets failed for newly created draw ${r.rows[0].id}:`, err?.message || err)
      }
      return { success: true, draw: r.rows[0] }
    })

    app.post('/internal/lottery/draw', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        draw_id: z.string().uuid(),
        winning_number: z.string().regex(/^[0-9]{4}$/).optional(),
        random: z.boolean().optional(),
      }).parse(req.body)
      const winningNumber = body.random ? generateWinningNumber() : body.winning_number
      if (!winningNumber) return reply.code(400).send({ error: 'winning_number or random must be provided' })
      const res = await settleLottery(db, body.draw_id, winningNumber)
      return { success: true, winning_number: winningNumber, ...res }
    })

    app.post('/internal/lottery/cancel', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ draw_id: z.string().uuid() }).parse(req.body)
      const drawRes = await db.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [body.draw_id])
      if (!drawRes.rows.length) return reply.code(409).send({ error: 'Draw not open or already settled' })
      const tickets = await db.query(`SELECT * FROM lottery_tickets WHERE draw_id = $1`, [body.draw_id])
      await db.query(`UPDATE lottery_draws SET status = 'cancelled' WHERE id = $1`, [body.draw_id])
      await Promise.all(tickets.rows.map((t: any) =>
        creditPrize({ userId: t.user_id, amount: Number(t.amount), referenceId: t.id, idempotencyKey: `lottery_refund_${t.id}` })
      ))
      return { success: true, refunded: tickets.rows.length }
    })

    app.get('/internal/lottery/bot-config', { onRequest: [internal] }, async (_req, reply) => {
      const result = await db.query('SELECT * FROM lottery_bot_config LIMIT 1')
      return reply.send(result.rows[0] || null)
    })

    app.post('/internal/lottery/bot-config', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        enabled: z.boolean(),
        default_max_tickets: z.coerce.number().int().positive(),
        fill_pct: z.coerce.number().min(0).max(100),
        trigger_pct: z.coerce.number().min(0).max(100),
        release_pct: z.coerce.number().min(0).max(100),
      }).parse(req.body)
      const result = await db.query(
        `UPDATE lottery_bot_config
         SET enabled = $1, default_max_tickets = $2, fill_pct = $3, trigger_pct = $4, release_pct = $5, updated_at = NOW()
         RETURNING *`,
        [body.enabled, body.default_max_tickets, body.fill_pct, body.trigger_pct, body.release_pct]
      )
      return reply.send(result.rows[0])
    })

    app.post('/internal/lottery/scratch/create', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        name: z.string(),
        price: z.number().positive(),
        payouts: z.array(z.object({
          outcome: z.enum(['cash', 'coupon', 'no_win']),
          amount: z.number().positive().optional(),
          promo_code_id: z.string().uuid().optional(),
          probability: z.number().min(0).max(100),
        })).min(1),
      }).parse(req.body)

      const total = body.payouts.reduce((sum, p) => sum + p.probability, 0)
      if (Math.abs(total - 100) > 0.01) return reply.code(400).send({ error: 'Payout probabilities must sum to 100' })
      for (const p of body.payouts) {
        if (p.outcome === 'cash' && p.amount === undefined) return reply.code(400).send({ error: 'Cash payouts require an amount' })
        if (p.outcome === 'coupon' && !p.promo_code_id) return reply.code(400).send({ error: 'Coupon payouts require a promo_code_id' })
      }

      const r = await db.query(
        `INSERT INTO lottery_scratch_products (name, price, payouts) VALUES ($1,$2,$3) RETURNING *`,
        [body.name, body.price, JSON.stringify(body.payouts)],
      )
      return { success: true, product: r.rows[0] }
    })

    // Looks up a cached flag by matching a team/country name against
    // cricket_countries — same fuzzy substring match used by sync-api and
    // import-series-matches, so manually-added matches get flags too instead
    // of relying only on the sync flows.
    async function findCountryFlag(name: string): Promise<string | null> {
      const flagsRes = await db.query('SELECT name, flag_url FROM cricket_teams WHERE flag_url IS NOT NULL')
      const n = name?.toLowerCase() || ''
      for (const row of flagsRes.rows) {
        const k = row.name.toLowerCase()
        if (n.includes(k) || k.includes(n)) return row.flag_url
      }
      return null
    }

    app.post('/internal/cricket/match', { onRequest: [internal] }, async (req) => {
      const body = z.object({ series: z.string(), format: z.string(), team_a: z.string(), team_b: z.string(), team_a_short: z.string().optional(), team_b_short: z.string().optional(), start_time: z.string() }).parse(req.body)
      const [teamAFlag, teamBFlag] = await Promise.all([findCountryFlag(body.team_a), findCountryFlag(body.team_b)])
      const r = await db.query(`INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, team_a_flag, team_b_flag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [body.series, body.format, body.team_a, body.team_b, body.team_a_short, body.team_b_short, body.start_time, teamAFlag, teamBFlag])
      return { success: true, match: r.rows[0] }
    })

    app.post('/internal/cricket/session/create', { onRequest: [internal] }, async (req) => {
      const body = z.object({ match_id: z.string().uuid(), label: z.string(), min_runs: z.number().int(), max_runs: z.number().int(), odds_yes: z.number().default(1.0), odds_no: z.number().default(1.0) }).parse(req.body)
      const r = await db.query(`INSERT INTO cricket_sessions (match_id, label, min_runs, max_runs, odds_yes, odds_no) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [body.match_id, body.label, body.min_runs, body.max_runs, body.odds_yes, body.odds_no])
      return { success: true, session: r.rows[0] }
    })

    app.patch('/internal/cricket/session/:id', { onRequest: [internal] }, async (req, reply) => {
      const { id } = req.params as { id: string }
      const body = z.object({ label: z.string().optional(), min_runs: z.number().int().optional(), max_runs: z.number().int().optional(), odds_yes: z.number().optional(), odds_no: z.number().optional() }).parse(req.body)
      const existing = await db.query('SELECT status FROM cricket_sessions WHERE id = $1', [id])
      if (!existing.rows.length) return reply.code(404).send({ error: 'Session not found' })
      if (existing.rows[0].status === 'settled') return reply.code(409).send({ error: 'Cannot edit a settled session' })
      const fields: string[] = [], params: any[] = [id]
      let i = 2
      for (const [key, val] of Object.entries(body)) {
        if (val === undefined) continue
        fields.push(`${key} = $${i++}`)
        params.push(val)
      }
      if (!fields.length) return reply.code(400).send({ error: 'No fields to update' })
      const res = await db.query(`UPDATE cricket_sessions SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params)
      return { success: true, session: res.rows[0] }
    })

    app.post('/internal/cricket/session/bulk-create', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        match_id: z.string().uuid(),
        label_template: z.string().default('{over} over runs'),
        from_over: z.number().int().min(1),
        to_over: z.number().int().min(1),
        base_runs: z.number().int().min(0),
        runs_per_over: z.number().min(0).default(8),
        bracket_width: z.number().int().min(0).default(2),
        odds_yes: z.number().default(1.0),
        odds_no: z.number().default(1.0),
      }).parse(req.body)

      if (body.to_over < body.from_over) return reply.code(400).send({ error: 'to_over must be greater than or equal to from_over' })

      const mRes = await db.query('SELECT status FROM cricket_matches WHERE id = $1', [body.match_id])
      if (!mRes.rows.length) return reply.code(404).send({ error: 'Match not found' })
      if (['settled', 'closed'].includes(mRes.rows[0].status)) return reply.code(400).send({ error: 'Cannot add sessions to a settled or closed match' })

      const existing = (await db.query('SELECT label FROM cricket_sessions WHERE match_id = $1', [body.match_id]))
        .rows.map(r => String(r.label))

      const created: any[] = []
      const skipped: string[] = []
      for (let over = body.from_over; over <= body.to_over; over++) {
        const label = body.label_template.replace('{over}', String(over))
        if (existing.includes(label)) { skipped.push(label); continue }
        const min = Math.round(body.base_runs + (over - body.from_over) * body.runs_per_over)
        const r = await db.query(
          `INSERT INTO cricket_sessions (match_id, label, min_runs, max_runs, odds_yes, odds_no)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [body.match_id, label, min, min + body.bracket_width, body.odds_yes, body.odds_no],
        )
        created.push(r.rows[0])
      }
      return { success: true, created: created.length, skipped, sessions: created }
    })

    app.post('/internal/cricket/session/settle', { onRequest: [internal] }, async (req) => {
      const body = z.object({ session_id: z.string().uuid(), result_runs: z.number().nullable() }).parse(req.body)
      const res = await settleCricketSession(db, body.session_id, body.result_runs)
      return { success: true, ...res }
    })

    app.post('/internal/cricket/scores/update', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ match_id: z.string().uuid(), live_score: z.any().optional(), live_tv_url: z.string().optional(), status: z.enum(['upcoming', 'live', 'closed', 'settled']).optional() }).parse(req.body)
      const fields: string[] = [], params: any[] = [body.match_id]
      let i = 2
      if (body.live_score) { fields.push(`live_score = $${i++}`); params.push(JSON.stringify(body.live_score)) }
      if (body.live_tv_url !== undefined) { fields.push(`live_tv_url = $${i++}`); params.push(body.live_tv_url || null) }
      if (body.status) { fields.push(`status = $${i++}`); params.push(body.status) }
      if (!fields.length) return reply.code(400).send({ error: 'No fields to update' })
      const res = await db.query(`UPDATE cricket_matches SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params)
      return { success: true, match: res.rows[0] }
    })

    // Settle/Finalize match winner odds-based bets.
    app.post('/internal/cricket/finalize', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ match_id: z.string().uuid() }).parse(req.body)
      try {
        const res = await finalizeMatch(db, body.match_id)
        return { success: true, ...res }
      } catch (e: any) {
        return reply.code(502).send({ error: e.message })
      }
    })

    // Cricket API sync routes (pass-through to external API)
    app.post('/internal/cricket/sync-api', { onRequest: [internal] }, async (req, reply) => {
      try {
        const { insertedIds, updatedCount } = await syncCurrentMatches(db)
        return { success: true, inserted: insertedIds.length, updated: updatedCount }
      } catch (e: any) { return reply.code(500).send({ error: `API Sync failed: ${e.message}` }) }
    })

    app.post('/internal/cricket/sync-countries', { onRequest: [internal] }, async (req, reply) => {
      try {
        const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/countries?apikey=${apiKey}&offset=0`)
        if (data.status !== 'success') throw new Error(data.reason || 'Failed')
        let count = 0
        for (const c of (data.data || [])) {
          if (!c.id || !c.name || !c.genericFlag) continue
          await db.query(
            `INSERT INTO cricket_teams (name, flag_url)
             SELECT $1, $2
             WHERE NOT EXISTS (
               SELECT 1 FROM cricket_teams WHERE lower(name) = lower($1)
             )`,
            [c.name, c.genericFlag],
          )
          count++
        }
        return { success: true, count }
      } catch (e: any) { return reply.code(500).send({ error: `Sync countries failed: ${e.message}` }) }
    })

    app.post('/internal/cricket/sync-series', { onRequest: [internal] }, async (req, reply) => {
      const { search } = req.body as any
      try {
        const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/series?apikey=${apiKey}&offset=0${search ? `&search=${encodeURIComponent(search)}` : ''}`)
        if (data.status !== 'success') throw new Error(data.reason || 'Failed')
        return { success: true, series: (data.data || []).map((s: any) => ({
          id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate, matchCount: s.matches,
        })) }
      } catch (e: any) { return reply.code(500).send({ error: `Series search failed: ${e.message}` }) }
    })

    app.post('/internal/cricket/import-series-matches', { onRequest: [internal] }, async (req, reply) => {
      const { series_id } = req.body as any
      if (!series_id) return reply.code(400).send({ error: 'series_id is required' })
      try {
        const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/series_info?apikey=${apiKey}&id=${series_id}`)
        if (data.status !== 'success') throw new Error(data.reason || 'Failed')
        const info = data.data?.info
        const seriesName = info?.name || 'Imported Series'
        await db.query(`INSERT INTO cricket_series (name, api_series_id) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET api_series_id = $2`, [seriesName, series_id])

        const flagsRes = await db.query('SELECT name, flag_url FROM cricket_teams WHERE flag_url IS NOT NULL')
        const flagMap = new Map(flagsRes.rows.map(r => [r.name.toLowerCase(), r.flag_url]))
        const findFlag = (n: string) => { for (const [k, v] of flagMap) if (n?.toLowerCase().includes(k) || k.includes(n?.toLowerCase())) return v; return null }

        let inserted = 0, updated = 0
        for (const m of (data.data?.matchList || [])) {
          if (!m.id) continue
          const [team_a, team_b] = [m.teams?.[0] || 'Team A', m.teams?.[1] || 'Team B']
          const status = m.matchEnded ? 'settled' : m.matchStarted ? 'live' : 'upcoming'
          const existing = await db.query('SELECT id FROM cricket_matches WHERE match_api_id = $1', [m.id])
          if (existing.rows.length) {
            await db.query(`UPDATE cricket_matches SET status = $1, team_a_flag = $2, team_b_flag = $3 WHERE id = $4`, [status, findFlag(team_a), findFlag(team_b), existing.rows[0].id])
            updated++
          } else {
            await db.query(`INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, match_api_id, status, team_a_flag, team_b_flag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [seriesName, m.matchType || 't20', team_a, team_b, m.teamInfo?.[0]?.shortname || team_a.substring(0,3).toUpperCase(), m.teamInfo?.[1]?.shortname || team_b.substring(0,3).toUpperCase(), m.dateTimeGMT ? `${m.dateTimeGMT}Z` : new Date().toISOString(), m.id, status, findFlag(team_a), findFlag(team_b)])
            inserted++
          }
        }
        return { success: true, series: seriesName, inserted, updated }
      } catch (e: any) { return reply.code(500).send({ error: `Series import failed: ${e.message}` }) }
    })

    // ═══════════════════════════════════════════════════════════════════════
    // 🎨 COLOR PREDICTION (WINGO / PARITY) ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════
    // 🎨 COLOR PREDICTION (WINGO / PARITY) ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════

    // GET /color-prediction/current-round?game_mode=30s|1m|3m|5m
    app.get('/color-prediction/current-round', async (req, reply) => {
      const mode = ((req.query as any)?.game_mode || '30s').toString().toLowerCase()
      const validModes = ['30s', '1m', '3m', '5m']
      const gameMode = validModes.includes(mode) ? mode : '30s'

      let currentRes = await db.query(
        `SELECT *, 
                GREATEST(0, EXTRACT(EPOCH FROM (end_time - NOW()))::int) AS remaining_seconds
         FROM color_prediction_rounds
         WHERE game_mode = $1 AND status IN ('open', 'locked') AND end_time > NOW()
         ORDER BY end_time ASC LIMIT 1`,
        [gameMode]
      )

      let currentRound = currentRes.rows[0]

      // If no active round exists yet for this mode, initialize one immediately
      if (!currentRound) {
        const intervalMap: Record<string, number> = { '30s': 30, '1m': 60, '3m': 180, '5m': 300 }
        const intervalSec = intervalMap[gameMode] || 30
        const periodId = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${gameMode.toUpperCase()}`
        await db.query(
          `INSERT INTO color_prediction_rounds (period_id, game_mode, start_time, end_time, status)
           VALUES ($1, $2, NOW(), NOW() + ($3 || ' seconds')::INTERVAL, 'open')
           ON CONFLICT (period_id) DO NOTHING`,
          [periodId, gameMode, intervalSec]
        )
        currentRes = await db.query(
          `SELECT *, 
                  GREATEST(0, EXTRACT(EPOCH FROM (end_time - NOW()))::int) AS remaining_seconds
           FROM color_prediction_rounds
           WHERE game_mode = $1 AND status IN ('open', 'locked') AND end_time > NOW()
           ORDER BY end_time ASC LIMIT 1`,
          [gameMode]
        )
        currentRound = currentRes.rows[0]
      }

      // Previous 20 settled rounds for trend & bead matrix of this mode
      const historyRes = await db.query(
        `SELECT period_id, winning_number, winning_color, winning_size, settled_at
         FROM color_prediction_rounds
         WHERE game_mode = $1 AND status = 'settled'
         ORDER BY settled_at DESC LIMIT 20`,
        [gameMode]
      )

      const remainingSeconds = currentRound ? Number(currentRound.remaining_seconds) : 30
      const isLocked = currentRound ? (currentRound.status === 'locked' || remainingSeconds <= 5) : false

      return {
        game_mode: gameMode,
        round: currentRound ? {
          id: currentRound.id,
          period_id: currentRound.period_id,
          game_mode: currentRound.game_mode || gameMode,
          start_time: currentRound.start_time,
          end_time: currentRound.end_time,
          remaining_seconds: remainingSeconds,
          is_locked: isLocked,
          status: currentRound.status,
        } : null,
        history: historyRes.rows,
        server_time: new Date().toISOString()
      }
    })

    // POST /color-prediction/bet
    app.post('/color-prediction/bet', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({
        game_mode: z.enum(['30s', '1m', '3m', '5m']).optional().default('30s'),
        bet_type: z.enum(['color', 'number', 'size']),
        bet_value: z.string().min(1).max(16),
        amount: z.number().positive(),
      }).parse(req.body)

      const gameMode = body.game_mode
      const userId = uid(req)
      if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const cfgRes = await db.query("SELECT is_active, rake_percent, special_rules FROM game_configs WHERE game_type = 'color_prediction'")
      if (cfgRes.rows.length && cfgRes.rows[0].is_active === false) {
        return reply.code(403).send({ error: 'Color Prediction is currently disabled' })
      }

      const rules = typeof cfgRes.rows[0]?.special_rules === 'string'
        ? JSON.parse(cfgRes.rows[0]?.special_rules)
        : (cfgRes.rows[0]?.special_rules || {})

      const minBet = Number(rules.min_bet || 10)
      const maxBet = Number(rules.max_bet || 50000)

      if (body.amount < minBet) {
        return reply.code(400).send({ error: `Minimum bet amount is ₹${minBet}` })
      }
      if (body.amount > maxBet) {
        return reply.code(400).send({ error: `Maximum bet amount is ₹${maxBet}` })
      }

      // Validate bet_value according to bet_type
      const val = body.bet_value.toLowerCase()
      if (body.bet_type === 'color' && !['green', 'red', 'violet'].includes(val)) {
        return reply.code(400).send({ error: 'Invalid color (must be green, red, or violet)' })
      }
      if (body.bet_type === 'number' && !/^[0-9]$/.test(val)) {
        return reply.code(400).send({ error: 'Invalid number (must be 0-9)' })
      }
      if (body.bet_type === 'size' && !['big', 'small'].includes(val)) {
        return reply.code(400).send({ error: 'Invalid size (must be big or small)' })
      }

      // Get Active Round for this game_mode (Must be open and have > 5s left)
      const roundRes = await db.query(
        `SELECT * FROM color_prediction_rounds
         WHERE game_mode = $1 AND status = 'open' AND end_time > NOW() + INTERVAL '5 seconds'
         ORDER BY end_time ASC LIMIT 1`,
        [gameMode]
      )

      if (roundRes.rows.length === 0) {
        return reply.code(400).send({ error: `Betting is locked for current ${gameMode.toUpperCase()} round. Please wait for the next period!` })
      }

      const round = roundRes.rows[0]
      const betId = crypto.randomUUID()

      // Debit Stake from Wallet
      const debitRes = await debitStake({
        userId,
        amount: body.amount,
        referenceId: betId,
        idempotencyKey: `color_stake_${betId}`,
        description: `Color Prediction (${gameMode.toUpperCase()}) Bet: ${val.toUpperCase()} (Period ${round.period_id})`
      })

      if (!debitRes.ok) {
        return reply.code(400).send({ error: debitRes.error || 'Insufficient balance to place bet' })
      }

      // Determine Multiplier
      let multiplier = 2.0
      if (body.bet_type === 'number') multiplier = 9.0
      else if (body.bet_type === 'color' && val === 'violet') multiplier = 4.5

      await db.query(
        `INSERT INTO color_prediction_bets (id, user_id, round_id, period_id, game_mode, bet_type, bet_value, amount, multiplier, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
        [betId, userId, round.id, round.period_id, gameMode, body.bet_type, val, body.amount, multiplier]
      )

      // Update total staked on round
      await db.query(
        `UPDATE color_prediction_rounds
         SET total_bet_amount = total_bet_amount + $1
         WHERE id = $2`,
        [body.amount, round.id]
      )

      return {
        success: true,
        bet_id: betId,
        period_id: round.period_id,
        game_mode: gameMode,
        amount: body.amount,
        bet_type: body.bet_type,
        bet_value: val,
        multiplier
      }
    })

    // GET /color-prediction/history?game_mode=30s
    app.get('/color-prediction/history', async (req) => {
      const { limit = '50', page = '1', game_mode } = req.query as any
      const lim = Math.min(parseInt(limit, 10) || 50, 100)
      const offset = ((parseInt(page, 10) || 1) - 1) * lim

      let query = `SELECT period_id, game_mode, winning_number, winning_color, winning_size,
                          total_bet_amount, total_payout_amount, house_profit, settled_at
                   FROM color_prediction_rounds
                   WHERE status = 'settled'`
      const params: any[] = []

      if (game_mode) {
        params.push(game_mode)
        query += ` AND game_mode = $${params.length}`
      }

      query += ` ORDER BY settled_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
      params.push(lim, offset)

      const rows = await db.query(query, params)

      let countQuery = "SELECT COUNT(*)::int AS total FROM color_prediction_rounds WHERE status = 'settled'"
      const countParams: any[] = []
      if (game_mode) {
        countParams.push(game_mode)
        countQuery += " AND game_mode = $1"
      }
      const countRes = await db.query(countQuery, countParams)

      return {
        rounds: rows.rows,
        total: countRes.rows[0]?.total || 0,
        page: parseInt(page, 10) || 1,
        limit: lim
      }
    })

    // GET /color-prediction/my-bets?game_mode=30s
    app.get('/color-prediction/my-bets', { onRequest: [auth] }, async (req) => {
      const userId = uid(req)
      const { game_mode } = req.query as any
      let query = `SELECT b.*, r.winning_number, r.winning_color, r.winning_size, r.status AS round_status
                   FROM color_prediction_bets b
                   LEFT JOIN color_prediction_rounds r ON (r.id = b.round_id OR r.period_id = b.period_id)
                   WHERE b.user_id = $1`
      const params: any[] = [userId]

      if (game_mode) {
        params.push(game_mode)
        query += ` AND (b.game_mode = $2 OR r.game_mode = $2)`
      }

      query += ` ORDER BY b.created_at DESC LIMIT 100`

      const rows = await db.query(query, params)
      return { bets: rows.rows }
    })

    // ══ COLOR PREDICTION ADMIN & INTERNAL ROUTES ══

    // GET /color-prediction/admin/status?game_mode=30s
    app.get('/color-prediction/admin/status', { onRequest: [internal] }, async (req) => {
      const mode = ((req.query as any)?.game_mode || '30s').toString().toLowerCase()
      const validModes = ['30s', '1m', '3m', '5m']
      const gameMode = validModes.includes(mode) ? mode : '30s'

      const now = new Date()
      const activeRes = await db.query(
        `SELECT * FROM color_prediction_rounds
         WHERE game_mode = $1 AND status IN ('open', 'locked') AND end_time > $2
         ORDER BY end_time ASC LIMIT 1`,
        [gameMode, now]
      )
      const activeRound = activeRes.rows[0] || null

      let betSummary = {
        total_bets: 0,
        total_amount: 0,
        green_amount: 0,
        red_amount: 0,
        violet_amount: 0,
        big_amount: 0,
        small_amount: 0,
        number_amounts: Array(10).fill(0),
      }

      if (activeRound) {
        const bets = await db.query(
          `SELECT bet_type, bet_value, SUM(amount)::numeric AS sum_amount, COUNT(*)::int AS cnt
           FROM color_prediction_bets
           WHERE round_id = $1
           GROUP BY bet_type, bet_value`,
          [activeRound.id]
        )

        for (const row of bets.rows) {
          const amt = Number(row.sum_amount)
          betSummary.total_bets += row.cnt
          betSummary.total_amount += amt

          if (row.bet_type === 'color') {
            if (row.bet_value === 'green') betSummary.green_amount += amt
            else if (row.bet_value === 'red') betSummary.red_amount += amt
            else if (row.bet_value === 'violet') betSummary.violet_amount += amt
          } else if (row.bet_type === 'size') {
            if (row.bet_value === 'big') betSummary.big_amount += amt
            else if (row.bet_value === 'small') betSummary.small_amount += amt
          } else if (row.bet_type === 'number') {
            const numIdx = parseInt(row.bet_value, 10)
            if (numIdx >= 0 && numIdx <= 9) betSummary.number_amounts[numIdx] += amt
          }
        }
      }

      const statsRes = await db.query(`
        SELECT
          COUNT(*)::int AS total_settled_rounds,
          COALESCE(SUM(total_bet_amount), 0)::numeric AS total_turnover,
          COALESCE(SUM(total_payout_amount), 0)::numeric AS total_payouts,
          COALESCE(SUM(house_profit), 0)::numeric AS total_house_profit
        FROM color_prediction_rounds WHERE status = 'settled'
      `)

      return {
        active_round: activeRound ? {
          ...activeRound,
          remaining_seconds: Math.max(0, Math.floor((new Date(activeRound.end_time).getTime() - now.getTime()) / 1000))
        } : null,
        bet_summary: betSummary,
        overall_stats: statsRes.rows[0]
      }
    })

    // POST /color-prediction/admin/override
    app.post('/color-prediction/admin/override', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        round_id: z.string().uuid().optional(),
        winning_number: z.number().min(0).max(9),
      }).parse(req.body)

      if (body.round_id) {
        await db.query(
          `UPDATE color_prediction_rounds SET manual_override_number = $1 WHERE id = $2`,
          [body.winning_number, body.round_id]
        )
      } else {
        const now = new Date()
        await db.query(
          `UPDATE color_prediction_rounds
           SET manual_override_number = $1
           WHERE status IN ('open', 'locked') AND end_time > $2`,
          [body.winning_number, now]
        )
      }
      return { success: true, winning_number: body.winning_number }
    })

    // POST /color-prediction/admin/settle
    app.post('/color-prediction/admin/settle', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({
        round_id: z.string().uuid(),
        winning_number: z.number().min(0).max(9).optional(),
      }).parse(req.body)

      try {
        const settled = await settleColorPredictionRound(db, body.round_id, body.winning_number)
        return { success: true, round: settled }
      } catch (err: any) {
        return reply.code(500).send({ error: err.message || 'Settlement failed' })
      }
    })
  }
}
