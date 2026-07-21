import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

const ALLOWED_GAME_TYPES = ['teen_patti', 'ludo']

export function isValidPnlGameType(gameType: string): boolean {
  return ALLOWED_GAME_TYPES.includes(gameType)
}

/** Guards the ROI% divide-by-zero when a bot pool has no logged investment yet. */
export function computeRoiPct(netRealizedPnl: number, totalInvested: number): number {
  return totalInvested > 0 ? (netRealizedPnl / totalInvested) * 100 : 0
}

interface BreakdownRow {
  is_bot: boolean
  total_wagered: number
  total_paid_out: number
  net_pnl: number
}

const EMPTY_BREAKDOWN = { total_wagered: 0, total_paid_out: 0, net_pnl: 0 }

/** Picks the real-player or bot slice out of a GROUP BY is_bot result set. */
export function bySign(rows: BreakdownRow[], isBot: boolean): typeof EMPTY_BREAKDOWN {
  return rows.find((r) => r.is_bot === isBot) ?? EMPTY_BREAKDOWN
}

export async function registerPnlDashboardRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  // GET /api/admin/games/:gameType/pnl-dashboard — combined house/real/bot
  // PnL, daily trend, bot bankroll ROI, leaderboard, and history for a
  // single game. Scoped to teen_patti/ludo (sub-project #4).
  app.get<{ Params: { gameType: string }; Querystring: { from?: string; to?: string; page?: string; limit?: string } }>(
    '/api/admin/games/:gameType/pnl-dashboard',
    { onRequest: [authenticate, requireRole('finance')] },
    async (req, reply) => {
      const { gameType } = req.params
      if (!isValidPnlGameType(gameType)) {
        return reply.code(400).send({ error: 'gameType must be teen_patti or ludo' })
      }

      const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 86400000)
      const to = req.query.to ? new Date(req.query.to) : new Date()
      const page = parseInt(req.query.page ?? '1', 10)
      const limit = parseInt(req.query.limit ?? '20', 10)
      const offset = (page - 1) * limit

      const [summaryRes, breakdownRes, trendRes, investedRes, balanceRes, leaderboardRes, historyRes, historyCountRes] = await Promise.all([
        db.query(
          `SELECT
             COALESCE(SUM(gp.prize_won), 0)::float AS total_paid_out,
             COALESCE(SUM(gp.entry_fee_deducted), 0)::float AS total_wagered
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT gp.is_bot,
             COALESCE(SUM(gp.entry_fee_deducted), 0)::float AS total_wagered,
             COALESCE(SUM(gp.prize_won), 0)::float AS total_paid_out,
             COALESCE(SUM(gp.prize_won - gp.entry_fee_deducted), 0)::float AS net_pnl
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           GROUP BY gp.is_bot`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT date_trunc('day', gr.started_at) AS date,
             COALESCE(SUM(gp.entry_fee_deducted), 0)::float AS wagered,
             COALESCE(SUM(gp.prize_won), 0)::float AS paid_out
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           GROUP BY date_trunc('day', gr.started_at)
           ORDER BY date`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT COALESCE(SUM(wt.amount), 0)::float AS total_invested
           FROM wallet_transactions wt
           JOIN users u ON u.id = wt.user_id
           WHERE wt.type = 'manual_credit' AND u.is_bot = true AND u.preferred_game_type = $1`,
          [gameType]
        ),
        db.query(
          `SELECT COALESCE(SUM(w.real_balance), 0)::float AS current_balance
           FROM wallets w
           JOIN users u ON u.id = w.user_id
           WHERE u.is_bot = true AND u.preferred_game_type = $1`,
          [gameType]
        ),
        db.query(
          `SELECT gp.user_id, u.username, gp.is_bot,
             COALESCE(SUM(gp.prize_won - gp.entry_fee_deducted), 0)::float AS net_pnl,
             COUNT(gp.id)::int AS games_played
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           JOIN users u ON u.id = gp.user_id
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           GROUP BY gp.user_id, u.username, gp.is_bot
           ORDER BY net_pnl DESC
           LIMIT 20`,
          [gameType, from, to]
        ),
        db.query(
          `SELECT gr.id AS room_id, gr.started_at, gr.pot_amount, gr.platform_fee_collected,
             (SELECT COUNT(*) FROM game_participants WHERE room_id = gr.id)::int AS players
           FROM game_rooms gr
           WHERE gr.game_type = $1 AND gr.started_at BETWEEN $2 AND $3
           ORDER BY gr.started_at DESC
           LIMIT $4 OFFSET $5`,
          [gameType, from, to, limit, offset]
        ),
        db.query(
          `SELECT COUNT(*)::int AS total FROM game_rooms WHERE game_type = $1 AND started_at BETWEEN $2 AND $3`,
          [gameType, from, to]
        ),
      ])

      const real = bySign(breakdownRes.rows, false)
      const bot = bySign(breakdownRes.rows, true)

      const totalInvested = investedRes.rows[0].total_invested
      const currentBalance = balanceRes.rows[0].current_balance
      const roiPct = computeRoiPct(bot.net_pnl, totalInvested)

      return reply.send({
        summary: {
          total_wagered: summaryRes.rows[0].total_wagered,
          total_paid_out: summaryRes.rows[0].total_paid_out,
          net_rake: summaryRes.rows[0].total_wagered - summaryRes.rows[0].total_paid_out,
        },
        breakdown: { real, bot },
        daily_trend: trendRes.rows.map((r: any) => ({
          date: r.date,
          wagered: r.wagered,
          paid_out: r.paid_out,
          rake: r.wagered - r.paid_out,
        })),
        bot_roi: {
          total_invested: totalInvested,
          current_balance: currentBalance,
          net_realized_pnl: bot.net_pnl,
          roi_pct: roiPct,
        },
        leaderboard: leaderboardRes.rows,
        history: {
          rows: historyRes.rows,
          total: historyCountRes.rows[0].total,
        },
      })
    }
  )
}
