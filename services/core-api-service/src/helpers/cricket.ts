import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export async function settleFantasyLeague(
  db: Pool, matchId: string, playerPoints: Record<string, number>,
): Promise<{ settledLeagues: number; entriesUpdated: number; totalPaid: number }> {
  const client = await db.connect()
  let settledLeagues = 0, entriesUpdated = 0, totalPaid = 0

  try {
    await client.query('BEGIN')

    for (const [playerId, points] of Object.entries(playerPoints)) {
      await client.query(
        `INSERT INTO cricket_match_players (match_id, player_id, fantasy_points) VALUES ($1, $2, $3)
         ON CONFLICT (match_id, player_id) DO UPDATE SET fantasy_points = $3`,
        [matchId, playerId, points],
      )
    }

    const teamsRes = await client.query(`SELECT * FROM user_fantasy_teams WHERE match_id = $1`, [matchId])
    for (const team of teamsRes.rows) {
      let teamPoints = 0
      for (const pid of (team.player_ids as string[])) {
        const base = playerPoints[pid] || 0
        const mult = pid === team.captain_id ? 2.0 : pid === team.vice_captain_id ? 1.5 : 1.0
        teamPoints += base * mult
      }
      await client.query(`UPDATE user_fantasy_teams SET points_total = $1 WHERE id = $2`, [teamPoints, team.id])
    }

    await client.query(
      `UPDATE cricket_fantasy_entries e SET points = t.points_total FROM user_fantasy_teams t WHERE e.team_id = t.id AND t.match_id = $1`,
      [matchId],
    )

    const leaguesRes = await client.query(
      `SELECT * FROM cricket_fantasy_leagues WHERE match_id = $1 AND status = 'open' FOR UPDATE`, [matchId],
    )

    for (const league of leaguesRes.rows) {
      settledLeagues++
      const entriesRes = await client.query(`SELECT * FROM cricket_fantasy_entries WHERE league_id = $1 ORDER BY points DESC`, [league.id])
      const entries = entriesRes.rows
      entriesUpdated += entries.length

      let currentRank = 1
      for (let i = 0; i < entries.length; i++) {
        if (i > 0 && Number(entries[i].points) < Number(entries[i - 1].points)) currentRank = i + 1
        entries[i].rank = currentRank
      }

      const dist: any[] = typeof league.prize_distribution === 'string'
        ? JSON.parse(league.prize_distribution)
        : league.prize_distribution || []

      for (const entry of entries) {
        let payout = 0
        const tier = dist.find(t => entry.rank >= t.rank_start && entry.rank <= t.rank_end)
        if (tier) payout = Number(tier.payout || 0)
        await client.query(
          `UPDATE cricket_fantasy_entries SET final_rank = $1, payout_received = $2, status = 'settled' WHERE id = $3`,
          [entry.rank, payout, entry.id],
        )
        if (payout > 0) {
          totalPaid += payout
          await creditPrize({
            userId: entry.user_id,
            amount: payout,
            referenceId: entry.id,
            idempotencyKey: `cricket_fantasy_payout_${entry.id}`,
            notification: {
              title: 'Fantasy Cricket Win! 🏆',
              body: `Congratulations! You won ₹${payout.toFixed(2)} in the fantasy league.`,
            },
          })
        }
      }
      await client.query(`UPDATE cricket_fantasy_leagues SET status = 'settled' WHERE id = $1`, [league.id])
    }

    await client.query(`UPDATE cricket_matches SET status = 'settled' WHERE id = $1`, [matchId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { settledLeagues, entriesUpdated, totalPaid }
}
