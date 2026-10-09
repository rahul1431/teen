import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export async function settleCricketOddsBets(
  db: Pool,
  matchId: string,
  resultWinner: string | null,
  isAbandoned: boolean = false
): Promise<{ settledBets: number; totalPaid: number }> {
  const client = await db.connect()
  let settledBets = 0
  let totalPaid = 0
  const payouts: { userId: string; amount: number; betId: string; ikey: string; isWin: boolean }[] = []

  try {
    await client.query('BEGIN')

    // Get all open markets for the match
    const marketsRes = await client.query(
      `SELECT * FROM cricket_markets WHERE match_id = $1 AND status = 'open' FOR UPDATE`,
      [matchId]
    )

    // Also get team names to map resultWinner to option keys
    const matchRes = await client.query(
      `SELECT team_a, team_b FROM cricket_matches WHERE id = $1`,
      [matchId]
    )
    const { team_a, team_b } = matchRes.rows[0]

    for (const market of marketsRes.rows) {
      let winningKey: string | null = null

      if (!isAbandoned && resultWinner) {
        if (resultWinner.toLowerCase() === team_a.toLowerCase()) {
          winningKey = 'team_a'
        } else if (resultWinner.toLowerCase() === team_b.toLowerCase()) {
          winningKey = 'team_b'
        } else {
          winningKey = 'draw'
        }
      }

      // Update market status
      await client.query(
        `UPDATE cricket_markets 
         SET status = 'settled', result_key = $1 
         WHERE id = $2`,
        [winningKey, market.id]
      )

      // Fetch all pending bets for this market
      const betsRes = await client.query(
        `SELECT * FROM cricket_bets WHERE market_id = $1 AND status = 'pending' FOR UPDATE`,
        [market.id]
      )

      for (const bet of betsRes.rows) {
        settledBets++
        if (isAbandoned || !winningKey) {
          // Void bet and refund stake
          const refundAmount = Number(bet.amount)
          await client.query(
            `UPDATE cricket_bets SET status = 'void', payout = $1 WHERE id = $2`,
            [refundAmount, bet.id]
          )
          payouts.push({
            userId: bet.user_id,
            amount: refundAmount,
            betId: bet.id,
            ikey: `cricket_odds_refund_${bet.id}`,
            isWin: false,
          })
        } else if (bet.option_key === winningKey) {
          // Bet won
          const payoutAmount = Number(bet.potential_payout)
          totalPaid += payoutAmount
          await client.query(
            `UPDATE cricket_bets SET status = 'won', payout = $1 WHERE id = $2`,
            [payoutAmount, bet.id]
          )
          payouts.push({
            userId: bet.user_id,
            amount: payoutAmount,
            betId: bet.id,
            ikey: `cricket_odds_payout_${bet.id}`,
            isWin: true,
          })
        } else {
          // Bet lost
          await client.query(
            `UPDATE cricket_bets SET status = 'lost', payout = 0 WHERE id = $2`,
            [bet.id]
          )
        }
      }
    }

    // Auto-void any remaining unsettled sessions for this match
    const openSessions = await client.query(
      `SELECT id FROM cricket_sessions WHERE match_id = $1 AND status != 'settled' FOR UPDATE`,
      [matchId]
    )
    for (const session of openSessions.rows) {
      await client.query(`UPDATE cricket_sessions SET status = 'settled', result_runs = NULL WHERE id = $1`, [session.id])
      const betsRes = await client.query(`SELECT * FROM cricket_session_bets WHERE session_id = $1 AND status = 'pending'`, [session.id])
      for (const bet of betsRes.rows) {
        await client.query(`UPDATE cricket_session_bets SET status = 'void', payout = $1 WHERE id = $2`, [Number(bet.amount), bet.id])
        payouts.push({
          userId: bet.user_id,
          amount: Number(bet.amount),
          betId: bet.id,
          ikey: `cricket_session_refund_${bet.id}`,
          isWin: false,
        })
      }
    }

    await client.query(`UPDATE cricket_matches SET status = 'settled' WHERE id = $1`, [matchId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Process payouts and notifications asynchronously
  for (const p of payouts) {
    await creditPrize({
      userId: p.userId,
      amount: p.amount,
      referenceId: p.betId,
      idempotencyKey: p.ikey,
      notification: p.isWin
        ? {
            title: 'Cricket Bet Won! 🏆',
            body: `Congratulations! Your bet won. ₹${p.amount.toFixed(2)} has been credited.`,
          }
        : {
            title: 'Cricket Bet Refunded 🏏',
            body: `Your bet was voided/refunded. ₹${p.amount.toFixed(2)} has been credited back.`,
          },
    })
  }

  return { settledBets, totalPaid }
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
