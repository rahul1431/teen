import { Pool } from 'pg'
import { creditPrize } from './wallet'

/**
 * Settle a cricket market: mark the winning option, then resolve every pending
 * bet on it. Winning bets pay `amount * odds` (odds were locked at bet time).
 * A null/empty resultKey voids the market and refunds stakes.
 */
export async function settleCricketMarket(
  db: Pool,
  marketId: string,
  resultKey: string | null,
): Promise<{ settled: number; winners: number; paid: number }> {
  const client = await db.connect()
  let settled = 0
  let winners = 0
  let paid = 0
  const credits: { userId: string; amount: number; betId: string; ikey: string }[] = []

  try {
    await client.query('BEGIN')

    const mRes = await client.query('SELECT * FROM cricket_markets WHERE id = $1 FOR UPDATE', [marketId])
    if (!mRes.rows.length) throw new Error('Market not found')

    const isVoid = !resultKey
    await client.query(
      `UPDATE cricket_markets SET status = 'settled', result_key = $1 WHERE id = $2`,
      [resultKey, marketId],
    )

    const betsRes = await client.query(
      `SELECT * FROM cricket_bets WHERE market_id = $1 AND status = 'pending'`,
      [marketId],
    )

    for (const bet of betsRes.rows) {
      settled++
      if (isVoid) {
        await client.query(`UPDATE cricket_bets SET status = 'void', payout = $1 WHERE id = $2`,
          [Number(bet.amount), bet.id])
        credits.push({ userId: bet.user_id, amount: Number(bet.amount), betId: bet.id, ikey: `cricket_refund_${bet.id}` })
        continue
      }
      if (bet.option_key === resultKey) {
        winners++
        const payout = Number(bet.potential_payout)
        paid += payout
        await client.query(`UPDATE cricket_bets SET status = 'won', payout = $1 WHERE id = $2`, [payout, bet.id])
        credits.push({ userId: bet.user_id, amount: payout, betId: bet.id, ikey: `cricket_payout_${bet.id}` })
      } else {
        await client.query(`UPDATE cricket_bets SET status = 'lost' WHERE id = $1`, [bet.id])
      }
    }

    // Commit bet statuses — release the FOR UPDATE lock before HTTP calls
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Credit outside the DB transaction — idempotency keys protect against retries
  for (const c of credits) {
    await creditPrize({ userId: c.userId, amount: c.amount, referenceId: c.betId, idempotencyKey: c.ikey })
  }
  return { settled, winners, paid }
}

/**
 * Settle a fantasy match: record player performance points, calculate final fantasy
 * team scores (applying captain and vice-captain multipliers), rank teams, and pay
 * out prizes according to each league's custom prize distribution schema.
 */
export async function settleFantasyLeague(
  db: Pool,
  matchId: string,
  playerPoints: Record<string, number>,
): Promise<{ settledLeagues: number; entriesUpdated: number; totalPaid: number }> {
  const client = await db.connect()
  let settledLeagues = 0
  let entriesUpdated = 0
  let totalPaid = 0

  try {
    await client.query('BEGIN')

    // 1. Record player points
    for (const [playerId, points] of Object.entries(playerPoints)) {
      await client.query(
        `INSERT INTO cricket_match_players (match_id, player_id, fantasy_points)
         VALUES ($1, $2, $3)
         ON CONFLICT (match_id, player_id) DO UPDATE SET fantasy_points = $3`,
        [matchId, playerId, points],
      )
    }

    // 2. Fetch all user teams for this match
    const teamsRes = await client.query(
      `SELECT * FROM user_fantasy_teams WHERE match_id = $1`,
      [matchId],
    )

    // 3. Calculate points total for each team
    for (const team of teamsRes.rows) {
      let teamPoints = 0
      const playerIds: string[] = team.player_ids

      for (const pid of playerIds) {
        const basePoints = playerPoints[pid] || 0
        let mult = 1.0
        if (pid === team.captain_id) mult = 2.0
        else if (pid === team.vice_captain_id) mult = 1.5
        teamPoints += basePoints * mult
      }

      await client.query(
        `UPDATE user_fantasy_teams SET points_total = $1 WHERE id = $2`,
        [teamPoints, team.id],
      )
    }

    // 4. Update cricket_fantasy_entries points
    await client.query(
      `UPDATE cricket_fantasy_entries e
       SET points = t.points_total
       FROM user_fantasy_teams t
       WHERE e.team_id = t.id AND t.match_id = $1`,
      [matchId],
    )

    // 5. Settle each open fantasy league for this match
    const leaguesRes = await client.query(
      `SELECT * FROM cricket_fantasy_leagues WHERE match_id = $1 AND status = 'open' FOR UPDATE`,
      [matchId],
    )

    for (const league of leaguesRes.rows) {
      settledLeagues++

      // Get entries ordered by points DESC
      const entriesRes = await client.query(
        `SELECT * FROM cricket_fantasy_entries WHERE league_id = $1 ORDER BY points DESC`,
        [league.id],
      )
      const entries = entriesRes.rows
      entriesUpdated += entries.length

      // Assign ranks (handling ties)
      let currentRank = 1
      for (let i = 0; i < entries.length; i++) {
        if (i > 0 && Number(entries[i].points) < Number(entries[i - 1].points)) {
          currentRank = i + 1
        }
        entries[i].rank = currentRank
      }

      // Parse custom prize distribution
      // Format: [{"rank_start": 1, "rank_end": 1, "payout": 500}, ...]
      const dist: any[] = typeof league.prize_distribution === 'string'
        ? JSON.parse(league.prize_distribution)
        : league.prize_distribution || []

      // Distribute payouts
      for (const entry of entries) {
        let payout = 0
        const matchedTier = dist.find(t => entry.rank >= t.rank_start && entry.rank <= t.rank_end)
        if (matchedTier) {
          payout = Number(matchedTier.payout || 0)
        }

        await client.query(
          `UPDATE cricket_fantasy_entries 
           SET final_rank = $1, payout_received = $2, status = 'settled' 
           WHERE id = $3`,
          [entry.rank, payout, entry.id],
        )

        if (payout > 0) {
          totalPaid += payout
          await creditPrize({
            userId: entry.user_id,
            amount: payout,
            referenceId: entry.id,
            idempotencyKey: `cricket_fantasy_payout_${entry.id}`,
          })
        }
      }

      await client.query(
        `UPDATE cricket_fantasy_leagues SET status = 'settled' WHERE id = $1`,
        [league.id],
      )
    }

    // Mark the match status as closed/settled
    await client.query(
      `UPDATE cricket_matches SET status = 'settled' WHERE id = $1`,
      [matchId],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { settledLeagues, entriesUpdated, totalPaid }
}

/**
 * Settle a cricket session (Fancy bet): mark the final runs, then resolve bets.
 *  - 'yes' wins if result_runs >= runs_bracket
 *  - 'no' wins if result_runs < runs_bracket
 */
export async function settleCricketSession(
  db: Pool,
  sessionId: string,
  resultRuns: number | null,
): Promise<{ settled: number; winners: number; paid: number }> {
  const client = await db.connect()
  let settled = 0
  let winners = 0
  let paid = 0
  const credits: { userId: string; amount: number; betId: string; ikey: string }[] = []

  try {
    await client.query('BEGIN')

    const sRes = await client.query('SELECT * FROM cricket_sessions WHERE id = $1 FOR UPDATE', [sessionId])
    if (!sRes.rows.length) throw new Error('Session not found')

    const isVoid = resultRuns === null
    await client.query(
      `UPDATE cricket_sessions SET status = 'settled', result_runs = $1 WHERE id = $2`,
      [resultRuns, sessionId],
    )

    const betsRes = await client.query(
      `SELECT * FROM cricket_session_bets WHERE session_id = $1 AND status = 'pending'`,
      [sessionId],
    )

    for (const bet of betsRes.rows) {
      settled++
      if (isVoid) {
        await client.query(`UPDATE cricket_session_bets SET status = 'void', payout = $1 WHERE id = $2`,
          [Number(bet.amount), bet.id])
        credits.push({ userId: bet.user_id, amount: Number(bet.amount), betId: bet.id, ikey: `cricket_session_refund_${bet.id}` })
        continue
      }

      const won = bet.selection === 'yes' ? resultRuns >= bet.runs_bracket : resultRuns < bet.runs_bracket

      if (won) {
        winners++
        const payout = Number(bet.potential_payout)
        paid += payout
        await client.query(`UPDATE cricket_session_bets SET status = 'won', payout = $1 WHERE id = $2`, [payout, bet.id])
        credits.push({ userId: bet.user_id, amount: payout, betId: bet.id, ikey: `cricket_session_payout_${bet.id}` })
      } else {
        await client.query(`UPDATE cricket_session_bets SET status = 'lost' WHERE id = $1`, [bet.id])
      }
    }

    // Commit before HTTP wallet calls
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  for (const c of credits) {
    await creditPrize({ userId: c.userId, amount: c.amount, referenceId: c.betId, idempotencyKey: c.ikey })
  }
  return { settled, winners, paid }
}
