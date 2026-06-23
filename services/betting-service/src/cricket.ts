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
        // Refund the stake.
        await client.query(`UPDATE cricket_bets SET status = 'void', payout = $1 WHERE id = $2`,
          [Number(bet.amount), bet.id])
        await creditPrize({
          userId: bet.user_id,
          amount: Number(bet.amount),
          referenceId: bet.id,
          idempotencyKey: `cricket_refund_${bet.id}`,
        })
        continue
      }
      if (bet.option_key === resultKey) {
        winners++
        const payout = Number(bet.potential_payout)
        paid += payout
        await client.query(`UPDATE cricket_bets SET status = 'won', payout = $1 WHERE id = $2`,
          [payout, bet.id])
        await creditPrize({
          userId: bet.user_id,
          amount: payout,
          referenceId: bet.id,
          idempotencyKey: `cricket_payout_${bet.id}`,
        })
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
  return { settled, winners, paid }
}
