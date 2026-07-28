import { Pool } from 'pg'
import { creditBonus } from '../../helpers/wallet-client'

// Matches the game types actually shown on the mobile leaderboard screen
// (leaderboard_page.dart's two tabs) — the "Top 3 Win Big" home-screen promo
// links straight into that screen, so the reward only needs to cover what a
// player can actually see themselves ranked on.
const REWARDED_GAME_TYPES = ['teen_patti', 'aviator'] as const

const PRIZE_BY_RANK: Record<number, number> = { 1: 500, 2: 300, 3: 200 }

interface TopEntry {
  user_id: string
  username: string
  score: number
}

async function getTopThreeForDate(db: Pool, gameType: string, dateStr: string): Promise<TopEntry[]> {
  if (gameType === 'aviator') {
    const res = await db.query(
      `SELECT u.id AS user_id, u.username, SUM(wt.amount)::float AS score
       FROM wallet_transactions wt
       JOIN users u ON u.id = wt.user_id
       WHERE wt.type = 'game_credit'
         AND wt.status = 'completed'
         AND wt.idempotency_key LIKE 'aviator_cashout_%'
         AND wt.created_at >= $1::date AND wt.created_at < $1::date + INTERVAL '1 day'
         AND u.is_bot = false
       GROUP BY u.id, u.username
       ORDER BY score DESC
       LIMIT 3`,
      [dateStr]
    )
    return res.rows
  }
  const res = await db.query(
    `SELECT u.id AS user_id, u.username, SUM(gp.prize_won)::float AS score
     FROM game_participants gp
     JOIN game_rooms gr ON gr.id = gp.room_id
     JOIN users u ON u.id = gp.user_id
     WHERE gr.game_type = $1
       AND gr.ended_at >= $2::date AND gr.ended_at < $2::date + INTERVAL '1 day'
       AND gp.prize_won > 0
       AND gp.is_bot = false
       AND u.is_bot = false
     GROUP BY u.id, u.username
     ORDER BY score DESC
     LIMIT 3`,
    [gameType, dateStr]
  )
  return res.rows
}

// Pays out the previous calendar day's top-3 leaderboard finishers per game
// type. Safe to call more than once for the same date (e.g. a cron overlap
// or a manual re-run after a crash): the wallet-service credit call uses a
// deterministic idempotency key (leaderboard_reward:<gameType>:<date>:<rank>)
// which the ledger itself dedupes on, so a repeat call is a no-op rather
// than a double payment. The leaderboard_rewards row is just the audit trail.
export async function payDailyLeaderboardRewards(db: Pool, forDate: Date): Promise<void> {
  const dateStr = forDate.toISOString().slice(0, 10)

  for (const gameType of REWARDED_GAME_TYPES) {
    try {
      const top3 = await getTopThreeForDate(db, gameType, dateStr)
      for (let i = 0; i < top3.length; i++) {
        const rank = i + 1
        const amount = PRIZE_BY_RANK[rank]
        const winner = top3[i]
        const idempotencyKey = `leaderboard_reward:${gameType}:${dateStr}:${rank}`

        const ok = await creditBonus({
          userId: winner.user_id,
          amount,
          idempotencyKey,
          notification: {
            title: `You made the daily ${gameType === 'teen_patti' ? 'Teen Patti' : 'Aviator'} leaderboard!`,
            body: `Rank #${rank} — ₹${amount} bonus credited to your account.`,
          },
        })
        if (!ok) {
          console.error(`[leaderboard-rewards] Failed to credit ${gameType} rank ${rank} (${winner.user_id}) for ${dateStr}`)
          continue
        }

        await db.query(
          `INSERT INTO leaderboard_rewards (game_type, period_date, rank, user_id, amount)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (game_type, period_date, rank) DO NOTHING`,
          [gameType, dateStr, rank, winner.user_id, amount]
        )
      }
      if (top3.length > 0) {
        console.log(`[leaderboard-rewards] Paid ${top3.length} ${gameType} winners for ${dateStr}`)
      }
    } catch (err: any) {
      console.error(`[leaderboard-rewards] Failed to pay ${gameType} rewards for ${dateStr}:`, err.message)
    }
  }
}
