import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export async function settleCricketMarket(
  db: Pool, marketId: string, resultKey: string | null,
): Promise<{ settled: number; winners: number; paid: number }> {
  const client = await db.connect()
  let settled = 0, winners = 0, paid = 0
  const credits: { userId: string; amount: number; betId: string; ikey: string }[] = []

  try {
    await client.query('BEGIN')
    const mRes = await client.query('SELECT * FROM cricket_markets WHERE id = $1 FOR UPDATE', [marketId])
    if (!mRes.rows.length) throw new Error('Market not found')
    const isVoid = !resultKey
    await client.query(`UPDATE cricket_markets SET status = 'settled', result_key = $1 WHERE id = $2`, [resultKey, marketId])
    const betsRes = await client.query(`SELECT * FROM cricket_bets WHERE market_id = $1 AND status = 'pending'`, [marketId])

    for (const bet of betsRes.rows) {
      settled++
      if (isVoid) {
        await client.query(`UPDATE cricket_bets SET status = 'void', payout = $1 WHERE id = $2`, [Number(bet.amount), bet.id])
        credits.push({ userId: bet.user_id, amount: Number(bet.amount), betId: bet.id, ikey: `cricket_refund_${bet.id}` })
      } else if (bet.option_key === resultKey) {
        winners++
        const payout = Number(bet.potential_payout)
        paid += payout
        await client.query(`UPDATE cricket_bets SET status = 'won', payout = $1 WHERE id = $2`, [payout, bet.id])
        credits.push({ userId: bet.user_id, amount: payout, betId: bet.id, ikey: `cricket_payout_${bet.id}` })
      } else {
        await client.query(`UPDATE cricket_bets SET status = 'lost' WHERE id = $1`, [bet.id])
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  for (const c of credits) {
    const isRefund = c.ikey.startsWith('cricket_refund_')
    await creditPrize({
      userId: c.userId,
      amount: c.amount,
      referenceId: c.betId,
      idempotencyKey: c.ikey,
      notification: {
        title: isRefund ? 'Cricket Bet Refunded 🏏' : 'Cricket Bet Win! 🏏',
        body: isRefund
          ? `Your cricket bet has been voided and ₹${c.amount.toFixed(2)} refunded to your wallet.`
          : `Congratulations! Your cricket bet won. ₹${c.amount.toFixed(2)} has been credited.`,
      },
    })
  }
  return { settled, winners, paid }
}

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

export async function settleCricketSession(
  db: Pool, sessionId: string, resultRuns: number | null,
): Promise<{ settled: number; winners: number; paid: number }> {
  const client = await db.connect()
  let settled = 0, winners = 0, paid = 0
  const credits: { userId: string; amount: number; betId: string; ikey: string }[] = []

  try {
    await client.query('BEGIN')
    const sRes = await client.query('SELECT * FROM cricket_sessions WHERE id = $1 FOR UPDATE', [sessionId])
    if (!sRes.rows.length) throw new Error('Session not found')
    const isVoid = resultRuns === null
    await client.query(`UPDATE cricket_sessions SET status = 'settled', result_runs = $1 WHERE id = $2`, [resultRuns, sessionId])
    const betsRes = await client.query(`SELECT * FROM cricket_session_bets WHERE session_id = $1 AND status = 'pending'`, [sessionId])

    for (const bet of betsRes.rows) {
      settled++
      if (isVoid) {
        await client.query(`UPDATE cricket_session_bets SET status = 'void', payout = $1 WHERE id = $2`, [Number(bet.amount), bet.id])
        credits.push({ userId: bet.user_id, amount: Number(bet.amount), betId: bet.id, ikey: `cricket_session_refund_${bet.id}` })
      } else {
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
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  for (const c of credits) {
    const isRefund = c.ikey.startsWith('cricket_session_refund_')
    await creditPrize({
      userId: c.userId,
      amount: c.amount,
      referenceId: c.betId,
      idempotencyKey: c.ikey,
      notification: {
        title: isRefund ? 'Cricket Session Refunded 🏏' : 'Cricket Session Win! 🏏',
        body: isRefund
          ? `Your session bet was voided and ₹${c.amount.toFixed(2)} refunded.`
          : `Congratulations! Your session bet won. ₹${c.amount.toFixed(2)} has been credited.`,
      },
    })
  }
  return { settled, winners, paid }
}
