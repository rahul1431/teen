import { Pool } from 'pg'
import { settleCricketOddsBets } from './cricket'

// Finalizes match winner bets when the match is closed/ended.
export async function finalizeMatch(db: Pool, matchId: string) {
  const matchRes = await db.query('SELECT result_winner, status FROM cricket_matches WHERE id = $1', [matchId])
  if (!matchRes.rows.length) {
    throw new Error('Match not found')
  }

  const { result_winner, status } = matchRes.rows[0]
  const isAbandoned = !result_winner && status === 'closed' // No winner usually means match drawn or abandoned

  const result = await settleCricketOddsBets(db, matchId, result_winner, isAbandoned)
  return { ...result, resultWinner: result_winner, isAbandoned }
}
