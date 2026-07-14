import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import crypto from 'crypto'
import { debitStake, creditPrize } from '../helpers/wallet-client'
import { MATKA_MULTIPLIERS, validateMatkaBet, settleMatkaSession } from '../helpers/matka'
import { settleLottery, generateWinningNumber } from '../helpers/lottery'
import { rollOutcome } from '../helpers/scratch'
import { settleFantasyLeague, settleCricketSession } from '../helpers/cricket'
import { aggregateScorecard, computeFantasyPoints, DEFAULT_SCORING_RULES } from '../helpers/fantasy-scoring'
import { cricApiFetch } from '../helpers/cricapi-client'

export function bettingPlugin(db: Pool) {
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

    function getMonday(d: Date) {
      const date = new Date(d)
      const day = date.getDay()
      const diff = date.getDate() - day + (day === 0 ? -6 : 1)
      return new Date(date.setDate(diff)).toISOString().slice(0, 10)
    }

    app.get('/matka/markets/:id/chart', { onRequest: [auth] }, async (req) => {
      const { id } = req.params as { id: string }
      const draws = await db.query(
        `SELECT draw_date, open_panna, open_digit, close_panna, close_digit, jodi, status 
         FROM matka_draws 
         WHERE market_id = $1 
         ORDER BY draw_date DESC LIMIT 100`,
        [id],
      )
      const weeks: Record<string, any> = {}
      for (const row of draws.rows) {
        const d = new Date(row.draw_date)
        const mondayStr = getMonday(d)
        if (!weeks[mondayStr]) {
          weeks[mondayStr] = {
            week_start: mondayStr,
            mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null
          }
        }
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const dayKey = days[d.getDay()]
        weeks[mondayStr][dayKey] = {
          open_panna: row.open_panna ?? '***',
          close_panna: row.close_panna ?? '***',
          jodi: row.jodi ?? '**',
          open_digit: row.open_digit !== null ? String(row.open_digit) : '*',
          close_digit: row.close_digit !== null ? String(row.close_digit) : '*'
        }
      }
      return { chart: Object.values(weeks).sort((a, b) => b.week_start.localeCompare(a.week_start)) }
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
      
      const checkRes = await db.query(`SELECT 1 FROM lottery_tickets WHERE draw_id = $1 AND ticket_number = $2`, [body.draw_id, ticketNumClean])
      if (checkRes.rows.length > 0) return reply.code(409).send({ error: 'Ticket number is already reserved by another player' })
      
      const ticketId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: Number(draw.ticket_price), referenceId: ticketId, idempotencyKey: `lottery_buy_${ticketId}`, description: `Lottery: ${draw.name}` })
      if (!debit.ok) return reply.code(400).send({ error: debit.error })
      
      try {
        await db.query(`INSERT INTO lottery_tickets (id, draw_id, user_id, ticket_number, amount) VALUES ($1,$2,$3,$4,$5)`, [ticketId, body.draw_id, uid(req), ticketNumClean, draw.ticket_price])
        return { success: true, ticket_id: ticketId }
      } catch (err: any) {
        await creditPrize({ userId: uid(req), amount: Number(draw.ticket_price), referenceId: ticketId, idempotencyKey: `lottery_buy_refund_${ticketId}` })
        if (err.code === '23505') {
          return reply.code(409).send({ error: 'Ticket number is already reserved' })
        }
        throw err
      }
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

      if (result.outcome === 'cash' && result.amount > 0) {
        await creditPrize({
          userId: uid(req),
          amount: result.amount,
          referenceId: ticketId,
          idempotencyKey: `scratch_payout_${ticketId}`,
          notification: { title: 'Scratch Card Win! 🎉', body: `You won ₹${result.amount.toFixed(2)} on ${product.name}!` },
        })
      }

      await db.query(
        `INSERT INTO lottery_scratch_tickets (id, product_id, user_id, outcome, amount, promo_code_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [ticketId, body.product_id, uid(req), result.outcome, result.amount, result.promo_code_id],
      )

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
        out.push({ ...m, sessions: sessions.rows })
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

    app.get('/cricket/players', { onRequest: [auth] }, async (req) => {
      const { match_id } = req.query as { match_id?: string }
      if (match_id) {
        const mRes = await db.query('SELECT team_a, team_b FROM cricket_matches WHERE id = $1', [match_id])
        if (mRes.rows.length) {
          const players = await db.query(`SELECT * FROM cricket_fantasy_players WHERE team_name IN ($1, $2) ORDER BY role ASC, name ASC`, [mRes.rows[0].team_a, mRes.rows[0].team_b])
          return { players: players.rows }
        }
      }
      const all = await db.query('SELECT * FROM cricket_fantasy_players ORDER BY role ASC, name ASC')
      return { players: all.rows }
    })

    app.post('/cricket/fantasy/team', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ match_id: z.string().uuid(), player_ids: z.array(z.string().uuid()).length(11), captain_id: z.string().uuid(), vice_captain_id: z.string().uuid() }).parse(req.body)
      if (body.captain_id === body.vice_captain_id) return reply.code(400).send({ error: 'Captain and Vice-Captain cannot be the same player' })
      if (!body.player_ids.includes(body.captain_id) || !body.player_ids.includes(body.vice_captain_id)) return reply.code(400).send({ error: 'Captain and Vice-Captain must be members of the selected team' })
      const mRes = await db.query('SELECT status FROM cricket_matches WHERE id = $1', [body.match_id])
      if (!mRes.rows.length) return reply.code(404).send({ error: 'Match not found' })
      if (mRes.rows[0].status !== 'upcoming') return reply.code(400).send({ error: 'Cannot submit team: Match has already started or settled' })
      const playersRes = await db.query('SELECT id, role, credits FROM cricket_fantasy_players WHERE id = ANY($1)', [body.player_ids])
      if (playersRes.rows.length !== 11) return reply.code(400).send({ error: 'One or more selected players do not exist' })
      let totalCredits = 0, wk = 0, bat = 0, ar = 0, bowl = 0
      for (const p of playersRes.rows) {
        totalCredits += Number(p.credits)
        if (p.role === 'wicket_keeper') wk++
        else if (p.role === 'batsman') bat++
        else if (p.role === 'all_rounder') ar++
        else if (p.role === 'bowler') bowl++
      }
      if (totalCredits > 120.0) return reply.code(400).send({ error: `Roster exceeds budget cap: ${totalCredits.toFixed(1)}/120 credits` })
      if (wk < 1 || wk > 4) return reply.code(400).send({ error: 'Roster must contain between 1 and 4 Wicket Keepers' })
      if (bat < 3 || bat > 6) return reply.code(400).send({ error: 'Roster must contain between 3 and 6 Batsmen' })
      if (ar < 1 || ar > 4) return reply.code(400).send({ error: 'Roster must contain between 1 and 4 All-Rounders' })
      if (bowl < 3 || bowl > 6) return reply.code(400).send({ error: 'Roster must contain between 3 and 6 Bowlers' })
      const teamRes = await db.query(`INSERT INTO user_fantasy_teams (user_id, match_id, player_ids, captain_id, vice_captain_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [uid(req), body.match_id, body.player_ids, body.captain_id, body.vice_captain_id])
      return { success: true, team_id: teamRes.rows[0].id }
    })

    app.get('/cricket/fantasy/my-teams', { onRequest: [auth] }, async (req) => {
      const { match_id } = req.query as { match_id: string }
      const res = await db.query(`SELECT t.*, (SELECT name FROM cricket_fantasy_players WHERE id = t.captain_id) AS captain_name, (SELECT name FROM cricket_fantasy_players WHERE id = t.vice_captain_id) AS vice_captain_name FROM user_fantasy_teams t WHERE t.user_id = $1 AND t.match_id = $2`, [uid(req), match_id])
      return { teams: res.rows }
    })

    app.get('/cricket/fantasy/leagues', { onRequest: [auth] }, async (req) => {
      const { match_id } = req.query as { match_id: string }
      // joined_count supports multi-entry contests — a user can hold more
      // than one entry in the same league (with different drafted teams),
      // so this is a count rather than a single scalar entry id.
      const res = await db.query(`SELECT l.*, (SELECT COUNT(*) FROM cricket_fantasy_entries WHERE league_id = l.id AND user_id = $2) AS joined_count FROM cricket_fantasy_leagues l WHERE l.match_id = $1 ORDER BY l.entry_fee ASC`, [match_id, uid(req)])
      return { leagues: res.rows.map(r => ({ ...r, joined_count: Number(r.joined_count) })) }
    })

    app.get('/cricket/fantasy/leagues/:id/leaderboard', { onRequest: [auth] }, async (req) => {
      const { id } = req.params as { id: string }
      const res = await db.query(`
        SELECT e.id, e.points, e.final_rank, e.payout_received, e.status,
               u.username,
               t.id AS team_id,
               (SELECT name FROM cricket_fantasy_players WHERE id = t.captain_id) AS captain_name,
               (SELECT name FROM cricket_fantasy_players WHERE id = t.vice_captain_id) AS vice_captain_name
        FROM cricket_fantasy_entries e
        JOIN users u ON u.id = e.user_id
        JOIN user_fantasy_teams t ON t.id = e.team_id
        WHERE e.league_id = $1
        ORDER BY e.points DESC, e.created_at ASC
      `, [id])
      return { leaderboard: res.rows }
    })

    app.get('/cricket/fantasy/team/:id', { onRequest: [auth] }, async (req, reply) => {
      const { id } = req.params as { id: string }
      const teamRes = await db.query('SELECT * FROM user_fantasy_teams WHERE id = $1', [id])
      if (!teamRes.rows.length) return reply.code(404).send({ error: 'Team not found' })
      const team = teamRes.rows[0]
      const playersRes = await db.query('SELECT * FROM cricket_fantasy_players WHERE id = ANY($1)', [team.player_ids])
      return { team, players: playersRes.rows }
    })

    app.post('/cricket/fantasy/join', { onRequest: [auth] }, async (req, reply) => {
      const body = z.object({ league_id: z.string().uuid(), team_id: z.string().uuid() }).parse(req.body)
      const leagueRes = await db.query('SELECT * FROM cricket_fantasy_leagues WHERE id = $1', [body.league_id])
      if (!leagueRes.rows.length) return reply.code(404).send({ error: 'League not found' })
      const league = leagueRes.rows[0]
      if (league.status !== 'open') return reply.code(400).send({ error: 'League is not open' })
      if (league.current_entries >= league.max_entries) return reply.code(400).send({ error: 'League is full' })
      const teamRes = await db.query('SELECT * FROM user_fantasy_teams WHERE id = $1', [body.team_id])
      if (!teamRes.rows.length) return reply.code(404).send({ error: 'Team roster not found' })
      const team = teamRes.rows[0]
      if (team.user_id !== uid(req)) return reply.code(403).send({ error: 'Not your team roster' })
      if (team.match_id !== league.match_id) return reply.code(400).send({ error: 'Team match mismatch' })

      // Multi-entry contests: a user can join the same league more than
      // once, but only with a different drafted XI each time — reject if
      // any of their existing entries in this league used an identical
      // roster (same 11 players + same captain/vice-captain).
      const existingRes = await db.query(
        `SELECT t.player_ids, t.captain_id, t.vice_captain_id FROM cricket_fantasy_entries e
         JOIN user_fantasy_teams t ON t.id = e.team_id
         WHERE e.league_id = $1 AND e.user_id = $2`,
        [body.league_id, uid(req)],
      )
      const newRoster = [...team.player_ids].sort()
      const isDuplicateRoster = existingRes.rows.some((r: any) => {
        if (r.captain_id !== team.captain_id || r.vice_captain_id !== team.vice_captain_id) return false
        const existingRoster = [...r.player_ids].sort()
        return existingRoster.length === newRoster.length && existingRoster.every((id: string, i: number) => id === newRoster[i])
      })
      if (isDuplicateRoster) return reply.code(409).send({ error: 'You already joined this contest with an identical team — draft a different XI to join again.' })

      const entryId = crypto.randomUUID()
      const debit = await debitStake({ userId: uid(req), amount: Number(league.entry_fee), referenceId: entryId, idempotencyKey: `cricket_fantasy_stake_${entryId}`, description: `Joined fantasy league: ${league.name}` })
      if (!debit.ok) return reply.code(400).send({ error: debit.error || 'Debit failed' })
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        const lc = (await client.query('SELECT current_entries, max_entries, status FROM cricket_fantasy_leagues WHERE id = $1 FOR UPDATE', [body.league_id])).rows[0]
        if (lc.status !== 'open' || lc.current_entries >= lc.max_entries) {
          await client.query('ROLLBACK')
          client.release()
          await creditPrize({ userId: uid(req), amount: Number(league.entry_fee), referenceId: entryId, idempotencyKey: `cricket_fantasy_refund_${entryId}` })
          return reply.code(409).send({ error: 'League is full or closed' })
        }
        await client.query(`INSERT INTO cricket_fantasy_entries (id, league_id, team_id, user_id, points, payout_received, status) VALUES ($1,$2,$3,$4,0.0,0.0,'joined')`, [entryId, body.league_id, body.team_id, uid(req)])
        await client.query('UPDATE cricket_fantasy_leagues SET current_entries = current_entries + 1 WHERE id = $1', [body.league_id])
        await client.query('COMMIT')
        return { success: true, entry_id: entryId }
      } catch (err) {
        await client.query('ROLLBACK')
        // Insert/update failed after the stake was already debited (e.g. a
        // double-submit hitting the league_id+team_id unique constraint) —
        // refund so the user isn't charged for a contest they never joined.
        await creditPrize({ userId: uid(req), amount: Number(league.entry_fee), referenceId: entryId, idempotencyKey: `cricket_fantasy_refund_${entryId}` })
        const pgErr = err as { code?: string }
        if (pgErr.code === '23505') return reply.code(409).send({ error: 'This team has already been entered into this contest' })
        return reply.code(400).send({ error: (err as Error).message })
      } finally {
        client.release()
      }
    })

    app.get('/cricket/matches/:id/live', { onRequest: [auth] }, async (req, reply) => {
      const { id } = req.params as { id: string }
      const matchRes = await db.query('SELECT * FROM cricket_matches WHERE id = $1', [id])
      if (!matchRes.rows.length) return reply.code(404).send({ error: 'Match not found' })
      const [players, sessions] = await Promise.all([
        db.query(`SELECT mp.*, fp.name, fp.role, fp.team_name FROM cricket_match_players mp JOIN cricket_fantasy_players fp ON fp.id = mp.player_id WHERE mp.match_id = $1`, [id]),
        db.query(`SELECT id, label, min_runs, max_runs, odds_yes, odds_no, status, result_runs FROM cricket_sessions WHERE match_id = $1`, [id]),
      ])
      // fantasy_points/overs_bowled are NUMERIC columns — node-postgres
      // returns those as strings, and the mobile app does an unguarded
      // `as num?` cast on fantasy_points that throws on a String, taking
      // down the whole live match screen. Coerce to real numbers here so
      // every client gets proper JSON numbers, not a type it has to guess at.
      const performances = players.rows.map(p => ({
        ...p,
        overs_bowled: Number(p.overs_bowled),
        fantasy_points: Number(p.fantasy_points),
      }))
      const sessionRows = sessions.rows.map(s => ({
        ...s,
        odds_yes: Number(s.odds_yes),
        odds_no: Number(s.odds_no),
      }))
      return { match: matchRes.rows[0], player_performances: performances, sessions: sessionRows }
    })

    // ══ INTERNAL ══
    app.post('/internal/matka/declare', { onRequest: [internal] }, async (req) => {
      const body = z.object({ draw_id: z.string().uuid(), session: z.enum(['open', 'close']), panna: z.string().regex(/^[0-9]{3}$/) }).parse(req.body)
      const res = await settleMatkaSession(db, body.draw_id, body.session, body.panna)
      return { success: true, ...res }
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
        category: z.enum(['weekly', 'monthly']),
      }).parse(req.body)
      const r = await db.query(`INSERT INTO lottery_draws (name, ticket_price, draw_time, prize_tiers, category) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [body.name, body.ticket_price, body.draw_time, JSON.stringify(body.prize_tiers), body.category])
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
      const flagsRes = await db.query('SELECT name, flag_url FROM cricket_countries')
      const n = name?.toLowerCase() || ''
      for (const row of flagsRes.rows) {
        const k = row.name.toLowerCase()
        if (n.includes(k) || k.includes(n)) return row.flag_url
      }
      return null
    }

    // Squad syncs (sync-squad, sync-series-squads) used to match only by
    // external_id, so any pre-existing player row without one (manually
    // seeded, or created before external_id existed) got duplicated the
    // first time a real API sync ran for their team. Falls back to a
    // name+team match and backfills external_id so it's tagged going
    // forward. Also never overwrites role/team_name on an existing row —
    // the API's role string is unreliable (e.g. it mis-tagged wicket-
    // keepers Jos Buttler and KL Rahul as "batsman"), so a curated role
    // shouldn't get clobbered by every sync.
    async function upsertFantasyPlayer(p: { name: string; externalId: string; role: string; teamName: string; avatarUrl: string }): Promise<string> {
      let match = await db.query('SELECT id FROM cricket_fantasy_players WHERE external_id = $1', [p.externalId])
      if (!match.rows.length) {
        match = await db.query('SELECT id FROM cricket_fantasy_players WHERE external_id IS NULL AND lower(name) = lower($1) AND team_name = $2', [p.name, p.teamName])
      }
      if (match.rows.length) {
        const pId = match.rows[0].id
        await db.query('UPDATE cricket_fantasy_players SET external_id = COALESCE(external_id, $1), avatar_url = COALESCE(avatar_url, $2) WHERE id = $3', [p.externalId, p.avatarUrl, pId])
        return pId
      }
      const ins = await db.query(`INSERT INTO cricket_fantasy_players (name, role, credits, team_name, external_id, avatar_url) VALUES ($1,$2,9.0,$3,$4,$5) RETURNING id`, [p.name, p.role, p.teamName, p.externalId, p.avatarUrl])
      return ins.rows[0].id
    }

    app.post('/internal/cricket/match', { onRequest: [internal] }, async (req) => {
      const body = z.object({ series: z.string(), format: z.string(), team_a: z.string(), team_b: z.string(), team_a_short: z.string().optional(), team_b_short: z.string().optional(), start_time: z.string() }).parse(req.body)
      const [teamAFlag, teamBFlag] = await Promise.all([findCountryFlag(body.team_a), findCountryFlag(body.team_b)])
      const r = await db.query(`INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, team_a_flag, team_b_flag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [body.series, body.format, body.team_a, body.team_b, body.team_a_short, body.team_b_short, body.start_time, teamAFlag, teamBFlag])
      return { success: true, match: r.rows[0] }
    })

    app.post('/internal/cricket/fantasy/players', { onRequest: [internal] }, async (req) => {
      // credits uses z.coerce.number() because the admin panel round-trips
      // this value from cricket_fantasy_players.credits (NUMERIC column),
      // which node-postgres returns as a string, not a JS number.
      const body = z.object({ name: z.string(), role: z.enum(['wicket_keeper', 'batsman', 'all_rounder', 'bowler']), credits: z.coerce.number().min(5.0).max(15.0), team_name: z.string(), avatar_url: z.string().optional() }).parse(req.body)
      const res = await db.query(`INSERT INTO cricket_fantasy_players (name, role, credits, team_name, avatar_url) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [body.name, body.role, body.credits, body.team_name, body.avatar_url || null])
      return { success: true, player: res.rows[0] }
    })

    app.patch('/internal/cricket/fantasy/players/:id', { onRequest: [internal] }, async (req, reply) => {
      const { id } = req.params as { id: string }
      const body = z.object({ name: z.string().optional(), role: z.enum(['wicket_keeper', 'batsman', 'all_rounder', 'bowler']).optional(), credits: z.coerce.number().min(5.0).max(15.0).optional(), team_name: z.string().optional(), avatar_url: z.string().optional() }).parse(req.body)
      const fields: string[] = [], params: any[] = [id]
      let i = 2
      for (const [key, val] of Object.entries(body)) {
        if (val === undefined) continue
        fields.push(`${key} = $${i++}`)
        params.push(val)
      }
      if (!fields.length) return reply.code(400).send({ error: 'No fields to update' })
      const res = await db.query(`UPDATE cricket_fantasy_players SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params)
      if (!res.rows.length) return reply.code(404).send({ error: 'Player not found' })
      return { success: true, player: res.rows[0] }
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

    app.post('/internal/cricket/session/settle', { onRequest: [internal] }, async (req) => {
      const body = z.object({ session_id: z.string().uuid(), result_runs: z.number().nullable() }).parse(req.body)
      const res = await settleCricketSession(db, body.session_id, body.result_runs)
      return { success: true, ...res }
    })

    app.post('/internal/cricket/fantasy/leagues', { onRequest: [internal] }, async (req) => {
      const body = z.object({ match_id: z.string().uuid(), name: z.string(), entry_fee: z.number().nonnegative(), prize_pool: z.number().nonnegative(), max_entries: z.number().int().positive(), prize_distribution: z.array(z.object({ rank_start: z.number().int().positive(), rank_end: z.number().int().positive(), payout: z.number().positive() })) }).parse(req.body)
      const res = await db.query(`INSERT INTO cricket_fantasy_leagues (match_id, name, entry_fee, prize_pool, max_entries, prize_distribution) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [body.match_id, body.name, body.entry_fee, body.prize_pool, body.max_entries, JSON.stringify(body.prize_distribution)])
      return { success: true, league: res.rows[0] }
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

    // Manual override — kept as an emergency fallback (e.g. cricapi is down
    // right when a match ends) but no longer the primary path. The admin
    // panel now uses /finalize below, which computes points automatically.
    app.post('/internal/cricket/fantasy/settle', { onRequest: [internal] }, async (req) => {
      const body = z.object({ match_id: z.string().uuid(), player_points: z.record(z.string().uuid(), z.number()) }).parse(req.body)
      const res = await settleFantasyLeague(db, body.match_id, body.player_points)
      return { success: true, ...res }
    })

    // Dream11-style finalize: pull the match's final scorecard one more
    // time, compute every drafted player's points from the scoring
    // rulebook, then hand off to the existing rank/payout logic. Payout
    // stays a single explicit admin click — this just removes the manual
    // "type in every player's points by hand" step.
    app.post('/internal/cricket/fantasy/finalize', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ match_id: z.string().uuid() }).parse(req.body)
      const matchRes = await db.query('SELECT match_api_id FROM cricket_matches WHERE id = $1', [body.match_id])
      if (!matchRes.rows.length || !matchRes.rows[0].match_api_id) {
        return reply.code(400).send({ error: 'Match has no linked external match — cannot fetch a scorecard to finalize from' })
      }
      const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
      const rules = configRes.rows[0]?.special_rules?.scoring_rules
        ? { ...DEFAULT_SCORING_RULES, ...configRes.rows[0].special_rules.scoring_rules }
        : DEFAULT_SCORING_RULES

      const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${matchRes.rows[0].match_api_id}`)
      if (data.status !== 'success' || !data.data?.scorecard) {
        return reply.code(502).send({ error: `Could not fetch final scorecard: ${data.reason || 'unknown error'}` })
      }

      const statsByPlayer = aggregateScorecard(data.data.scorecard)
      const playerPoints: Record<string, number> = {}
      for (const stats of statsByPlayer.values()) {
        const pRes = await db.query('SELECT id FROM cricket_fantasy_players WHERE external_id = $1', [stats.playerId])
        if (!pRes.rows.length) continue
        playerPoints[pRes.rows[0].id] = computeFantasyPoints(rules, stats)
      }

      const res = await settleFantasyLeague(db, body.match_id, playerPoints)
      return { success: true, playersScored: Object.keys(playerPoints).length, ...res }
    })

    // Cricket API sync routes (pass-through to external API)
    app.post('/internal/cricket/sync-api', { onRequest: [internal] }, async (req, reply) => {
      try {
        const currentData = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`)
        if (currentData.status !== 'success') throw new Error(currentData.reason || 'Failed')
        const flagsRes = await db.query('SELECT name, flag_url FROM cricket_countries')
        const flagMap = new Map(flagsRes.rows.map(r => [r.name.toLowerCase(), r.flag_url]))
        const findFlag = (n: string) => { for (const [k, v] of flagMap) if (n?.toLowerCase().includes(k) || k.includes(n?.toLowerCase())) return v; return null }
        let inserted = 0, updated = 0
        for (const m of (currentData.data || [])) {
          if (!m.id) continue
          const [team_a, team_b] = [m.teams?.[0] || 'Team A', m.teams?.[1] || 'Team B']
          const status = m.matchEnded ? 'settled' : m.matchStarted ? 'live' : 'upcoming'
          const live_score = m.score?.length ? { runs: m.score.at(-1).r, wickets: m.score.at(-1).w, overs: m.score.at(-1).o, description: m.status } : {}
          const existing = await db.query('SELECT id FROM cricket_matches WHERE match_api_id = $1', [m.id])
          if (existing.rows.length) {
            await db.query(`UPDATE cricket_matches SET status = $1, live_score = $2, team_a_flag = $3, team_b_flag = $4 WHERE id = $5`, [status, JSON.stringify(live_score), findFlag(team_a), findFlag(team_b), existing.rows[0].id])
            updated++
          } else {
            await db.query(`INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, match_api_id, status, live_score, team_a_flag, team_b_flag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [m.name || 'Current Match', m.matchType || 't20', team_a, team_b, m.teamInfo?.[0]?.shortname || team_a.substring(0,3).toUpperCase(), m.teamInfo?.[1]?.shortname || team_b.substring(0,3).toUpperCase(), m.dateTimeGMT ? `${m.dateTimeGMT}Z` : new Date().toISOString(), m.id, status, JSON.stringify(live_score), findFlag(team_a), findFlag(team_b)])
            inserted++
          }
        }
        return { success: true, inserted, updated }
      } catch (e: any) { return reply.code(500).send({ error: `API Sync failed: ${e.message}` }) }
    })

    app.post('/internal/cricket/sync-countries', { onRequest: [internal] }, async (req, reply) => {
      try {
        const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/countries?apikey=${apiKey}&offset=0`)
        if (data.status !== 'success') throw new Error(data.reason || 'Failed')
        let count = 0
        for (const c of (data.data || [])) {
          if (!c.id || !c.name || !c.genericFlag) continue
          await db.query(`INSERT INTO cricket_countries (id, name, flag_url) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=$2, flag_url=$3`, [c.id.toLowerCase(), c.name, c.genericFlag])
          count++
        }
        return { success: true, count }
      } catch (e: any) { return reply.code(500).send({ error: `Sync countries failed: ${e.message}` }) }
    })

    // Search cricapi's series catalog by name (e.g. "IPL 2026") — the admin
    // panel's "Import Series" modal calls this to find a series_id, but this
    // handler never existed (the panel's fetch just 404'd silently). Adding
    // it here also backs the new bulk squad-sync-by-series feature below.
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

    // Pulls every match in a series in one call (series_info) and upserts
    // them the same way sync-api does for live matches — plus registers the
    // series in the cricket_series catalog so it shows up in the Add Match
    // dropdown without an admin re-typing it.
    app.post('/internal/cricket/import-series-matches', { onRequest: [internal] }, async (req, reply) => {
      const { series_id } = req.body as any
      if (!series_id) return reply.code(400).send({ error: 'series_id is required' })
      try {
        const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/series_info?apikey=${apiKey}&id=${series_id}`)
        if (data.status !== 'success') throw new Error(data.reason || 'Failed')
        const info = data.data?.info
        const seriesName = info?.name || 'Imported Series'
        await db.query(`INSERT INTO cricket_series (name, api_series_id) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET api_series_id = $2`, [seriesName, series_id])

        const flagsRes = await db.query('SELECT name, flag_url FROM cricket_countries')
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

    // Bulk player sync for a WHOLE series at once (all teams' squads in one
    // call) instead of the existing sync-squad, which only pulls the two
    // teams of a single already-imported match — that's why the fantasy
    // player catalog stayed stuck around ~20 rows despite 89 matches synced.
    app.post('/internal/cricket/sync-series-squads', { onRequest: [internal] }, async (req, reply) => {
      const { series_id } = req.body as any
      if (!series_id) return reply.code(400).send({ error: 'series_id is required' })
      try {
        const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/series_info?apikey=${apiKey}&id=${series_id}`)
        if (data.status !== 'success') throw new Error(data.reason || 'Failed')
        let playersSeeded = 0, teamsSeeded = 0
        for (const team of (data.data?.squads || [])) {
          teamsSeeded++
          for (const p of (team.players || [])) {
            if (!p.id) continue
            const role = p.role?.toLowerCase().replace(/[^a-z]/g, '').includes('keeper') ? 'wicket_keeper' : p.role?.toLowerCase().includes('bowl') ? 'bowler' : p.role?.toLowerCase().includes('allrounder') ? 'all_rounder' : 'batsman'
            const fallbackAvatar = `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(p.name)}`
            await upsertFantasyPlayer({ name: p.name, externalId: p.id, role, teamName: team.teamName, avatarUrl: fallbackAvatar })
            playersSeeded++
          }
        }
        return { success: true, teamsSeeded, playersSeeded }
      } catch (e: any) { return reply.code(500).send({ error: `Series squad sync failed: ${e.message}` }) }
    })

    app.post('/internal/cricket/sync-squad', { onRequest: [internal] }, async (req, reply) => {
      const { match_id, match_api_id } = req.body as any
      if (!match_id || !match_api_id) return reply.code(400).send({ error: 'match_id and match_api_id are required' })
      try {
        const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/match_squad?apikey=${apiKey}&id=${match_api_id}`)
        if (data.status !== 'success') throw new Error(data.reason || 'Failed')
        let playersSeeded = 0
        for (const team of (data.data || [])) {
          for (const p of (team.players || [])) {
            if (!p.id) continue
            const role = p.role?.toLowerCase().replace(/[^a-z]/g, '').includes('keeper') ? 'wicket_keeper' : p.role?.toLowerCase().includes('bowl') ? 'bowler' : p.role?.toLowerCase().includes('allrounder') ? 'all_rounder' : 'batsman'
            const fallbackAvatar = `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(p.name)}`
            const pId = await upsertFantasyPlayer({ name: p.name, externalId: p.id, role, teamName: team.teamName, avatarUrl: fallbackAvatar })
            await db.query(`INSERT INTO cricket_match_players (match_id, player_id, runs_scored, balls_faced, fours, sixes, wickets, runs_conceded, overs_bowled, catches, stumpings, run_outs, fantasy_points) VALUES ($1,$2,0,0,0,0,0,0,0.0,0,0,0,0.0) ON CONFLICT (match_id, player_id) DO NOTHING`, [match_id, pId])
            playersSeeded++
          }
        }
        return { success: true, seededCount: playersSeeded }
      } catch (e: any) { return reply.code(500).send({ error: `Squad sync failed: ${e.message}` }) }
    })
  }
}
