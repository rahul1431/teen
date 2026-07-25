// services/core-api-service/src/helpers/mission-metrics.ts
import { pool } from '../db/pool'

export async function getDepositSum(userId: string, start: Date, end: Date): Promise<number> {
  const res = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions
     WHERE user_id = $1 AND type = 'deposit' AND status = 'completed'
       AND created_at >= $2 AND created_at < $3`,
    [userId, start, end],
  )
  return parseFloat(res.rows[0].total)
}

export async function getReferralCount(userId: string, start: Date, end: Date): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM referrals
     WHERE referrer_id = $1 AND status IN ('qualified', 'rewarded')
       AND COALESCE(qualified_at, created_at) >= $2 AND COALESCE(qualified_at, created_at) < $3`,
    [userId, start, end],
  )
  return res.rows[0].count
}

export async function getGamePlayedCount(
  userId: string,
  gameType: string,
  minStake: number | null,
  start: Date,
  end: Date,
): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM game_participants gp
     JOIN game_rooms gr ON gr.id = gp.room_id
     WHERE gp.user_id = $1 AND gr.game_type = $2 AND gp.is_bot = false
       AND ($3::numeric IS NULL OR gr.entry_fee >= $3)
       AND gp.joined_at >= $4 AND gp.joined_at < $5`,
    [userId, gameType, minStake, start, end],
  )
  return res.rows[0].count
}
