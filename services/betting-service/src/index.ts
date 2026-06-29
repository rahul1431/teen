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
import { settleCricketMarket, settleFantasyLeague, settleCricketSession } from './cricket'

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
      return reply.code(403).send({ error: 'Forbidden' })
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

  // Get eligible fantasy players for a match (or all players)
  app.get('/cricket/players', { onRequest: [auth] }, async (req) => {
    const { match_id } = req.query as { match_id?: string }
    if (match_id) {
      const mRes = await db.query('SELECT team_a, team_b FROM cricket_matches WHERE id = $1', [match_id])
      if (mRes.rows.length) {
        const match = mRes.rows[0]
        const players = await db.query(
          `SELECT * FROM cricket_fantasy_players 
           WHERE team_name IN ($1, $2) 
           ORDER BY role ASC, name ASC`,
          [match.team_a, match.team_b]
        )
        return { players: players.rows }
      }
    }
    const allPlayers = await db.query('SELECT * FROM cricket_fantasy_players ORDER BY role ASC, name ASC')
    return { players: allPlayers.rows }
  })

  // Submit/edit a user's fantasy team roster
  app.post('/cricket/fantasy/team', { onRequest: [auth] }, async (req, reply) => {
    const body = z.object({
      match_id: z.string().uuid(),
      player_ids: z.array(z.string().uuid()).length(11),
      captain_id: z.string().uuid(),
      vice_captain_id: z.string().uuid(),
    }).parse(req.body)

    if (body.captain_id === body.vice_captain_id) {
      return reply.code(400).send({ error: 'Captain and Vice-Captain cannot be the same player' })
    }
    if (!body.player_ids.includes(body.captain_id) || !body.player_ids.includes(body.vice_captain_id)) {
      return reply.code(400).send({ error: 'Captain and Vice-Captain must be members of the selected team' })
    }

    const mRes = await db.query('SELECT status FROM cricket_matches WHERE id = $1', [body.match_id])
    if (!mRes.rows.length) return reply.code(404).send({ error: 'Match not found' })
    if (mRes.rows[0].status !== 'upcoming') {
      return reply.code(400).send({ error: 'Cannot submit team: Match has already started or settled' })
    }

    const playersRes = await db.query(
      'SELECT id, role, credits FROM cricket_fantasy_players WHERE id = ANY($1)',
      [body.player_ids]
    )
    if (playersRes.rows.length !== 11) {
      return reply.code(400).send({ error: 'One or more selected players do not exist' })
    }

    let totalCredits = 0
    let wk = 0, bat = 0, ar = 0, bowl = 0

    for (const p of playersRes.rows) {
      totalCredits += Number(p.credits)
      if (p.role === 'wicket_keeper') wk++
      else if (p.role === 'batsman') bat++
      else if (p.role === 'all_rounder') ar++
      else if (p.role === 'bowler') bowl++
    }

    if (totalCredits > 100.0) {
      return reply.code(400).send({ error: `Roster exceeds budget cap: ${totalCredits.toFixed(1)}/100 credits` })
    }
    if (wk < 1 || wk > 4) return reply.code(400).send({ error: 'Roster must contain between 1 and 4 Wicket Keepers' })
    if (bat < 3 || bat > 6) return reply.code(400).send({ error: 'Roster must contain between 3 and 6 Batsmen' })
    if (ar < 1 || ar > 4) return reply.code(400).send({ error: 'Roster must contain between 1 and 4 All-Rounders' })
    if (bowl < 3 || bowl > 6) return reply.code(400).send({ error: 'Roster must contain between 3 and 6 Bowlers' })

    const teamRes = await db.query(
      `INSERT INTO user_fantasy_teams (user_id, match_id, player_ids, captain_id, vice_captain_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [uid(req), body.match_id, body.player_ids, body.captain_id, body.vice_captain_id]
    )
    return { success: true, team_id: teamRes.rows[0].id }
  })

  // Get user's fantasy teams
  app.get('/cricket/fantasy/my-teams', { onRequest: [auth] }, async (req) => {
    const { match_id } = req.query as { match_id: string }
    const res = await db.query(
      `SELECT t.*, 
        (SELECT name FROM cricket_fantasy_players WHERE id = t.captain_id) AS captain_name,
        (SELECT name FROM cricket_fantasy_players WHERE id = t.vice_captain_id) AS vice_captain_name
       FROM user_fantasy_teams t 
       WHERE t.user_id = $1 AND t.match_id = $2`,
      [uid(req), match_id]
    )
    return { teams: res.rows }
  })

  // Get open fantasy leagues
  app.get('/cricket/fantasy/leagues', { onRequest: [auth] }, async (req) => {
    const { match_id } = req.query as { match_id: string }
    const res = await db.query(
      `SELECT l.*, 
        (SELECT id FROM cricket_fantasy_entries WHERE league_id = l.id AND user_id = $2) AS joined_entry_id
       FROM cricket_fantasy_leagues l 
       WHERE l.match_id = $1 ORDER BY l.entry_fee ASC`,
      [match_id, uid(req)]
    )
    return { leagues: res.rows }
  })

  // Join a fantasy league
  app.post('/cricket/fantasy/join', { onRequest: [auth] }, async (req, reply) => {
    const body = z.object({
      league_id: z.string().uuid(),
      team_id: z.string().uuid(),
    }).parse(req.body)

    const leagueRes = await db.query('SELECT * FROM cricket_fantasy_leagues WHERE id = $1 FOR UPDATE', [body.league_id])
    if (!leagueRes.rows.length) return reply.code(404).send({ error: 'League not found' })
    const league = leagueRes.rows[0]

    if (league.status !== 'open') return reply.code(400).send({ error: 'League is not open' })
    if (league.current_entries >= league.max_entries) return reply.code(400).send({ error: 'League is full' })

    const teamRes = await db.query('SELECT * FROM user_fantasy_teams WHERE id = $1', [body.team_id])
    if (!teamRes.rows.length) return reply.code(404).send({ error: 'Team roster not found' })
    const team = teamRes.rows[0]
    if (team.user_id !== uid(req)) return reply.code(403).send({ error: 'Not your team roster' })
    if (team.match_id !== league.match_id) return reply.code(400).send({ error: 'Team match mismatch' })

    const entryRes = await db.query('SELECT id FROM cricket_fantasy_entries WHERE league_id = $1 AND user_id = $2', [body.league_id, uid(req)])
    if (entryRes.rows.length) return reply.code(409).send({ error: 'You have already joined this league' })

    const entryId = crypto.randomUUID()
    const client = await db.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO cricket_fantasy_entries (id, league_id, team_id, user_id, points, payout_received, status)
         VALUES ($1, $2, $3, $4, 0.0, 0.0, 'joined')`,
        [entryId, body.league_id, body.team_id, uid(req)]
      )

      const debit = await debitStake({
        userId: uid(req),
        amount: Number(league.entry_fee),
        referenceId: entryId,
        idempotencyKey: `cricket_fantasy_stake_${entryId}`,
        description: `Joined fantasy league: ${league.name}`
      })

      if (!debit.ok) {
        throw new Error(debit.error || 'Debit failed')
      }

      await client.query('UPDATE cricket_fantasy_leagues SET current_entries = current_entries + 1 WHERE id = $1', [body.league_id])
      await client.query('COMMIT')
      return { success: true, entry_id: entryId }
    } catch (err) {
      await client.query('ROLLBACK')
      return reply.code(400).send({ error: (err as Error).message })
    } finally {
      client.release()
    }
  })

  // Get live match details, including score, streaming link, and live markets
  app.get('/cricket/matches/:id/live', { onRequest: [auth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const matchRes = await db.query('SELECT * FROM cricket_matches WHERE id = $1', [id])
    if (!matchRes.rows.length) return reply.code(404).send({ error: 'Match not found' })
    const match = matchRes.rows[0]

    const markets = await db.query(
      `SELECT id, market_type, label, options, status FROM cricket_markets 
       WHERE match_id = $1`,
      [id]
    )

    const sessions = await db.query(
      `SELECT id, label, min_runs, max_runs, odds_yes, odds_no, status, result_runs FROM cricket_sessions 
       WHERE match_id = $1`,
      [id]
    )

    const playersRes = await db.query(
      `SELECT mp.*, fp.name, fp.role, fp.team_name 
       FROM cricket_match_players mp
       JOIN cricket_fantasy_players fp ON fp.id = mp.player_id
       WHERE mp.match_id = $1`,
      [id]
    )

    return { 
      match, 
      markets: markets.rows,
      sessions: sessions.rows,
      player_performances: playersRes.rows
    }
  })

  // Session (Fancy) betting
  app.post('/cricket/session/bet', { onRequest: [auth] }, async (req, reply) => {
    const body = z.object({
      session_id: z.string().uuid(),
      selection: z.enum(['yes', 'no']),
      amount: z.number().positive(),
    }).parse(req.body)

    const sRes = await db.query(
      `SELECT s.*, mt.status AS match_status FROM cricket_sessions s
       JOIN cricket_matches mt ON mt.id = s.match_id
       WHERE s.id = $1`, [body.session_id])
    if (!sRes.rows.length) return reply.code(404).send({ error: 'Session not found' })
    const session = sRes.rows[0]
    if (session.status !== 'open' || session.match_status === 'settled' || session.match_status === 'closed') {
      return reply.code(409).send({ error: 'Session is closed' })
    }

    const odds = body.selection === 'yes' ? Number(session.odds_yes) : Number(session.odds_no)
    const bracket = body.selection === 'yes' ? session.max_runs : session.min_runs
    const potential = Math.round(body.amount * odds * 100) / 100

    const inserted = await db.query(
      `INSERT INTO cricket_session_bets (user_id, match_id, session_id, selection, runs_bracket, amount, potential_payout)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [uid(req), session.match_id, session.id, body.selection, bracket, body.amount, potential],
    )
    const betId = inserted.rows[0].id

    const debit = await debitStake({
      userId: uid(req), amount: body.amount, referenceId: betId,
      idempotencyKey: `cricket_session_stake_${betId}`, description: 'Cricket session bet',
    })
    if (!debit.ok) {
      await db.query('DELETE FROM cricket_session_bets WHERE id = $1', [betId])
      return reply.code(400).send({ error: debit.error })
    }
    return { success: true, bet_id: betId, potential_payout: potential }
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

  // Create fantasy player (Admin)
  app.post('/internal/cricket/fantasy/players', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      name: z.string(),
      role: z.enum(['wicket_keeper', 'batsman', 'all_rounder', 'bowler']),
      credits: z.number().min(5.0).max(15.0),
      team_name: z.string(),
      avatar_url: z.string().optional()
    }).parse(req.body)

    const res = await db.query(
      `INSERT INTO cricket_fantasy_players (name, role, credits, team_name, avatar_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.name, body.role, body.credits, body.team_name, body.avatar_url || null]
    )
    return { success: true, player: res.rows[0] }
  })

  // Create fantasy contest/league for a match (Admin)
  app.post('/internal/cricket/fantasy/leagues', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      match_id: z.string().uuid(),
      name: z.string(),
      entry_fee: z.number().nonnegative(),
      prize_pool: z.number().nonnegative(),
      max_entries: z.number().int().positive(),
      prize_distribution: z.array(z.object({
        rank_start: z.number().int().positive(),
        rank_end: z.number().int().positive(),
        payout: z.number().positive()
      }))
    }).parse(req.body)

    const res = await db.query(
      `INSERT INTO cricket_fantasy_leagues (match_id, name, entry_fee, prize_pool, max_entries, prize_distribution)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.match_id, body.name, body.entry_fee, body.prize_pool, body.max_entries, JSON.stringify(body.prize_distribution)]
    )
    return { success: true, league: res.rows[0] }
  })

  // Update live score, stats, and stream URL (Admin)
  app.post('/internal/cricket/scores/update', { onRequest: [internal] }, async (req, reply) => {
    const body = z.object({
      match_id: z.string().uuid(),
      live_score: z.object({
        runs: z.number(),
        wickets: z.number(),
        overs: z.number(),
        target: z.number().optional(),
        runs_required: z.number().optional(),
        balls_remaining: z.number().optional(),
        batsmen: z.array(z.object({ name: z.string(), runs: z.number(), balls: z.number() })).optional(),
        bowler: z.object({ name: z.string(), overs: z.number(), runs: z.number(), wickets: z.number() }).optional(),
        current_innings: z.string().optional(),
        description: z.string().optional()
      }).optional(),
      live_tv_url: z.string().optional(),
      status: z.enum(['upcoming', 'live', 'closed', 'settled']).optional()
    }).parse(req.body)

    const updateFields: string[] = []
    const params: any[] = [body.match_id]
    let paramIndex = 2

    if (body.live_score) {
      updateFields.push(`live_score = $${paramIndex++}`)
      params.push(JSON.stringify(body.live_score))
    }
    if (body.live_tv_url !== undefined) {
      updateFields.push(`live_tv_url = $${paramIndex++}`)
      params.push(body.live_tv_url || null)
    }
    if (body.status) {
      updateFields.push(`status = $${paramIndex++}`)
      params.push(body.status)
    }

    if (updateFields.length === 0) return reply.code(400).send({ error: 'No fields to update' })

    const res = await db.query(
      `UPDATE cricket_matches SET ${updateFields.join(', ')} WHERE id = $1 RETURNING *`,
      params
    )

    return { success: true, match: res.rows[0] }
  })

  // Settle a cricket session (Admin)
  app.post('/internal/cricket/session/settle', { onRequest: [internal] }, async (req, reply) => {
    const body = z.object({
      session_id: z.string().uuid(),
      result_runs: z.number().nullable(),
    }).parse(req.body)
    const res = await settleCricketSession(db, body.session_id, body.result_runs)
    return { success: true, ...res }
  })

  // Create a cricket session (Admin)
  app.post('/internal/cricket/session/create', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      match_id: z.string().uuid(),
      label: z.string(),
      min_runs: z.number().int(),
      max_runs: z.number().int(),
      odds_yes: z.number().default(1.0),
      odds_no: z.number().default(1.0),
    }).parse(req.body)
    const r = await db.query(
      `INSERT INTO cricket_sessions (match_id, label, min_runs, max_runs, odds_yes, odds_no)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [body.match_id, body.label, body.min_runs, body.max_runs, body.odds_yes, body.odds_no],
    )
    return { success: true, session: r.rows[0] }
  })

  // Settle fantasy points and leagues (Admin)
  app.post('/internal/cricket/fantasy/settle', { onRequest: [internal] }, async (req) => {
    const body = z.object({
      match_id: z.string().uuid(),
      player_points: z.record(z.string().uuid(), z.number())
    }).parse(req.body)

    const res = await settleFantasyLeague(db, body.match_id, body.player_points)
    return { success: true, ...res }
  })

  app.post('/internal/cricket/settle', { onRequest: [internal] }, async (req, reply) => {
    const body = z.object({
      market_id: z.string().uuid(),
      result_key: z.string().nullable(),
    }).parse(req.body)
    const res = await settleCricketMarket(db, body.market_id, body.result_key)
    return { success: true, ...res }
  })

  // Sync cricket matches from CricAPI / CricketData API
  app.post('/internal/cricket/sync-api', { onRequest: [internal] }, async (req, reply) => {
    const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
    const specialRules = configRes.rows[0]?.special_rules || {}
    const { api_key } = specialRules
    const keyToUse = api_key || 'dd511ce4-aeb7-4e1f-86f4-1160404b2776'

    try {
      // 1. Fetch current/live matches
      const currentUrl = `https://api.cricapi.com/v1/currentMatches?apikey=${keyToUse}&offset=0`
      const currentRes = await fetch(currentUrl)
      if (!currentRes.ok) throw new Error(`CricAPI currentMatches returned ${currentRes.status}`)
      const currentData = await currentRes.json()
      if (currentData.status !== 'success') throw new Error(currentData.reason || 'Failed to fetch current matches')

      // 2. Fetch upcoming matches list to show in lobby
      let upcomingMatches: any[] = []
      const matchesUrl = `https://api.cricapi.com/v1/matches?apikey=${keyToUse}&offset=0`
      const matchesRes = await fetch(matchesUrl).catch(() => null)
      if (matchesRes && matchesRes.ok) {
        const matchesData = await matchesRes.json()
        if (matchesData.status === 'success') {
          upcomingMatches = matchesData.data || []
        }
      }

      // Fetch cached country flags
      const flagsRes = await db.query('SELECT name, flag_url FROM cricket_countries')
      const flagMap = new Map<string, string>()
      flagsRes.rows.forEach(r => flagMap.set(r.name.toLowerCase(), r.flag_url))

      const findFlag = (teamName: string): string | null => {
        if (!teamName) return null
        const nameLower = teamName.toLowerCase()
        for (const [countryName, flagUrl] of flagMap.entries()) {
          if (nameLower.includes(countryName) || countryName.includes(nameLower)) {
            return flagUrl
          }
        }
        return null
      }

      const allMatchesCombined = [...(currentData.data || [])]
      // Add upcoming matches that are not already present in currentMatches
      const existingIds = new Set(allMatchesCombined.map(m => m.id))
      for (const m of upcomingMatches) {
        if (!existingIds.has(m.id)) {
          allMatchesCombined.push(m)
        }
      }

      let insertedCount = 0
      let updatedCount = 0

      for (const m of allMatchesCombined) {
        const apiId = m.id
        if (!apiId) continue

        const team_a = m.teams?.[0] || 'Team A'
        const team_b = m.teams?.[1] || 'Team B'
        const team_a_short = m.teamInfo?.[0]?.shortname || team_a.substring(0, 3).toUpperCase()
        const team_b_short = m.teamInfo?.[1]?.shortname || team_b.substring(0, 3).toUpperCase()
        const startTime = m.dateTimeGMT ? `${m.dateTimeGMT}Z` : new Date().toISOString()
        const series = m.name || 'Current Match'
        const format = m.matchType || 't20'

        const team_a_flag = findFlag(team_a)
        const team_b_flag = findFlag(team_b)

        // Cache teams in cricket_teams
        if (m.teamInfo && Array.isArray(m.teamInfo)) {
          for (const t of m.teamInfo) {
            if (t.id && t.name) {
              await db.query(
                `INSERT INTO cricket_teams (id, name, short_name, flag_url)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (id) DO UPDATE SET name = $2, short_name = $3, flag_url = $4`,
                [t.id, t.name, t.shortname || null, t.img || null]
              )
            }
          }
        }

        // Determine status
        let status = 'upcoming'
        if (m.matchEnded) {
          status = 'settled'
        } else if (m.matchStarted) {
          status = 'live'
        }

        // Live score mapping
        const live_score: any = {}
        if (m.score && Array.isArray(m.score)) {
          const latestInning = m.score[m.score.length - 1]
          if (latestInning) {
            live_score.runs = latestInning.r || 0
            live_score.wickets = latestInning.w || 0
            live_score.overs = latestInning.o || 0
            live_score.current_innings = latestInning.inning || ''
            live_score.description = m.status || ''
          }
        }

        const existing = await db.query('SELECT id FROM cricket_matches WHERE match_api_id = $1', [apiId])
        if (existing.rows.length) {
          await db.query(
            `UPDATE cricket_matches 
             SET status = $1, live_score = $2, team_a_flag = $3, team_b_flag = $4, series = $5, format = $6
             WHERE id = $7`,
            [status, JSON.stringify(live_score), team_a_flag, team_b_flag, series, format, existing.rows[0].id]
          )
          updatedCount++
        } else {
          await db.query(
            `INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, match_api_id, status, live_score, team_a_flag, team_b_flag)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [series, format, team_a, team_b, team_a_short, team_b_short, startTime, apiId, status, JSON.stringify(live_score), team_a_flag, team_b_flag]
          )
          insertedCount++
        }
      }

      return { success: true, inserted: insertedCount, updated: updatedCount }
    } catch (e: any) {
      return reply.code(500).send({ error: `API Sync failed: ${e.message}` })
    }
  })

  // Sync countries & flags from CricAPI
  app.post('/internal/cricket/sync-countries', { onRequest: [internal] }, async (req, reply) => {
    const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
    const specialRules = configRes.rows[0]?.special_rules || {}
    const { api_key } = specialRules
    const keyToUse = api_key || 'dd511ce4-aeb7-4e1f-86f4-1160404b2776'

    try {
      const url = `https://api.cricapi.com/v1/countries?apikey=${keyToUse}&offset=0`
      const apiRes = await fetch(url)
      if (!apiRes.ok) throw new Error(`CricAPI countries returned ${apiRes.status}`)
      const data = await apiRes.json()
      if (data.status !== 'success') throw new Error(data.reason || 'Failed to fetch countries')

      const countries = data.data || []
      let count = 0
      for (const c of countries) {
        if (!c.id || !c.name || !c.genericFlag) continue
        await db.query(
          `INSERT INTO cricket_countries (id, name, flag_url) 
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET name = $2, flag_url = $3`,
          [c.id.toLowerCase(), c.name, c.genericFlag]
        )
        count++
      }
      return { success: true, count }
    } catch (e: any) {
      return reply.code(500).send({ error: `Sync countries failed: ${e.message}` })
    }
  })

  // Sync/Search Cricket Series from CricAPI
  app.post('/internal/cricket/sync-series', { onRequest: [internal] }, async (req, reply) => {
    const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
    const specialRules = configRes.rows[0]?.special_rules || {}
    const { api_key } = specialRules
    const keyToUse = api_key || 'dd511ce4-aeb7-4e1f-86f4-1160404b2776'

    const { search, offset = 0 } = req.body as { search?: string, offset?: number }

    try {
      let url = `https://api.cricapi.com/v1/series?apikey=${keyToUse}&offset=${offset}`
      if (search) {
        url += `&search=${encodeURIComponent(search)}`
      }
      const apiRes = await fetch(url)
      if (!apiRes.ok) throw new Error(`CricAPI series returned ${apiRes.status}`)
      const data = await apiRes.json()
      if (data.status !== 'success') throw new Error(data.reason || 'Failed to fetch series')

      return { success: true, series: data.data || [] }
    } catch (e: any) {
      return reply.code(500).send({ error: `Sync series failed: ${e.message}` })
    }
  })

  // Import matches of a series
  app.post('/internal/cricket/import-series-matches', { onRequest: [internal] }, async (req, reply) => {
    const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
    const specialRules = configRes.rows[0]?.special_rules || {}
    const { api_key } = specialRules
    const keyToUse = api_key || 'dd511ce4-aeb7-4e1f-86f4-1160404b2776'

    const { series_id } = req.body as { series_id: string }
    if (!series_id) return reply.code(400).send({ error: 'series_id is required' })

    try {
      const url = `https://api.cricapi.com/v1/series_info?apikey=${keyToUse}&id=${series_id}`
      const apiRes = await fetch(url)
      if (!apiRes.ok) throw new Error(`CricAPI series_info returned ${apiRes.status}`)
      const data = await apiRes.json()
      if (data.status !== 'success') throw new Error(data.reason || 'Failed to fetch series matches')

      const seriesName = data.data?.info?.name || 'Imported Series'
      const matches = data.data?.matchList || []

      // Fetch cached country flags
      const flagsRes = await db.query('SELECT name, flag_url FROM cricket_countries')
      const flagMap = new Map<string, string>()
      flagsRes.rows.forEach(r => flagMap.set(r.name.toLowerCase(), r.flag_url))

      const findFlag = (teamName: string): string | null => {
        if (!teamName) return null
        const nameLower = teamName.toLowerCase()
        for (const [countryName, flagUrl] of flagMap.entries()) {
          if (nameLower.includes(countryName) || countryName.includes(nameLower)) {
            return flagUrl
          }
        }
        return null
      }

      let imported = 0
      for (const m of matches) {
        const apiId = m.id
        if (!apiId) continue

        const team_a = m.teams?.[0] || 'Team A'
        const team_b = m.teams?.[1] || 'Team B'
        const team_a_short = team_a.substring(0, 3).toUpperCase()
        const team_b_short = team_b.substring(0, 3).toUpperCase()
        const startTime = m.dateTimeGMT ? `${m.dateTimeGMT}Z` : new Date().toISOString()
        const format = m.matchType || 't20'
        const status = m.status === 'live' || m.matchStarted ? 'live' : (m.matchEnded ? 'settled' : 'upcoming')
        
        const team_a_flag = findFlag(team_a)
        const team_b_flag = findFlag(team_b)

        const existing = await db.query('SELECT id FROM cricket_matches WHERE match_api_id = $1', [apiId])
        if (existing.rows.length) {
          await db.query(
            `UPDATE cricket_matches 
             SET status = $1, team_a_flag = $2, team_b_flag = $3, series = $4, format = $5
             WHERE id = $6`,
            [status, team_a_flag, team_b_flag, seriesName, format, existing.rows[0].id]
          )
        } else {
          await db.query(
            `INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, match_api_id, status, team_a_flag, team_b_flag)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [seriesName, format, team_a, team_b, team_a_short, team_b_short, startTime, apiId, status, team_a_flag, team_b_flag]
          )
          imported++
        }
      }

      return { success: true, imported, total: matches.length }
    } catch (e: any) {
      return reply.code(500).send({ error: `Import series matches failed: ${e.message}` })
    }
  })

  // Sync Squad for Match from CricAPI
  app.post('/internal/cricket/sync-squad', { onRequest: [internal] }, async (req, reply) => {
    const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
    const specialRules = configRes.rows[0]?.special_rules || {}
    const { api_key } = specialRules
    const keyToUse = api_key || 'dd511ce4-aeb7-4e1f-86f4-1160404b2776'

    const { match_id, match_api_id } = req.body as { match_id: string, match_api_id: string }
    if (!match_id || !match_api_id) {
      return reply.code(400).send({ error: 'match_id and match_api_id are required' })
    }

    try {
      const url = `https://api.cricapi.com/v1/match_squad?apikey=${keyToUse}&id=${match_api_id}`
      const apiRes = await fetch(url)
      if (!apiRes.ok) throw new Error(`CricAPI match_squad returned ${apiRes.status}`)
      const data = await apiRes.json()
      if (data.status !== 'success') throw new Error(data.reason || 'Failed to fetch match squad')

      const squad = data.data || []
      let playersSeeded = 0

      // Map squad details: CricAPI returns array of team objects e.g. [{"teamName": "Team X", "players": [...]}]
      for (const team of squad) {
        const teamName = team.teamName || 'Unknown Team'
        const players = team.players || []

        for (const p of players) {
          const externalId = p.id
          if (!externalId) continue

          const name = p.name || 'Unknown Player'
          
          // Role mapping from CricAPI: role can be e.g. "Batsman", "Bowler", "Allrounder", "Wicketkeeper"
          // Map to: wicket_keeper | batsman | all_rounder | bowler
          let role = 'batsman'
          const apiRole = (p.role || '').toLowerCase().replace(/[^a-z]/g, '')
          if (apiRole.includes('keeper') || apiRole.includes('wk')) {
            role = 'wicket_keeper'
          } else if (apiRole.includes('bowler') || apiRole.includes('bowl')) {
            role = 'bowler'
          } else if (apiRole.includes('allrounder') || apiRole.includes('ar')) {
            role = 'all_rounder'
          }

          // Check if player exists
          let pId: string
          const existingPlayer = await db.query('SELECT id FROM cricket_fantasy_players WHERE external_id = $1', [externalId])
          
          if (existingPlayer.rows.length) {
            pId = existingPlayer.rows[0].id
            await db.query(
              `UPDATE cricket_fantasy_players 
               SET name = $1, role = $2, team_name = $3 
               WHERE id = $4`,
              [name, role, teamName, pId]
            )
          } else {
            // Check by name and team to avoid duplicates if external_id is null in old rows
            const fallbackPlayer = await db.query('SELECT id FROM cricket_fantasy_players WHERE name = $1 AND team_name = $2', [name, teamName])
            if (fallbackPlayer.rows.length) {
              pId = fallbackPlayer.rows[0].id
              await db.query('UPDATE cricket_fantasy_players SET external_id = $1, role = $2 WHERE id = $3', [externalId, role, pId])
            } else {
              const inserted = await db.query(
                `INSERT INTO cricket_fantasy_players (name, role, credits, team_name, external_id)
                 VALUES ($1, $2, 9.0, $3, $4) RETURNING id`,
                [name, role, teamName, externalId]
              )
              pId = inserted.rows[0].id
            }
          }

          // Link player to match in cricket_match_players
          await db.query(
            `INSERT INTO cricket_match_players (match_id, player_id, runs_scored, balls_faced, fours, sixes, wickets, runs_conceded, overs_bowled, catches, stumpings, run_outs, fantasy_points)
             VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0.0, 0, 0, 0, 0.0)
             ON CONFLICT (match_id, player_id) DO NOTHING`,
            [match_id, pId]
          )
          playersSeeded++
        }
      }

      return { success: true, seededCount: playersSeeded }
    } catch (e: any) {
      return reply.code(500).send({ error: `Squad sync failed: ${e.message}` })
    }
  })


  app.get('/health', async () => ({ status: 'ok', service: 'betting' }))

  const port = parseInt(process.env.PORT || '3012')
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Betting service (matka/lottery/cricket) running on port ${port}`)
}

start().catch(err => { console.error(err); process.exit(1) })
