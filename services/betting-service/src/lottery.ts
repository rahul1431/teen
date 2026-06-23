import { Pool } from 'pg'
import { creditPrize } from './wallet'

/**
 * Draw a lottery: set the winning number, then settle every ticket. An exact
 * match pays `ticket.amount * prize_multiplier`. (Partial-match tiers can be
 * layered on later.)
 */
export async function settleLottery(
  db: Pool,
  drawId: string,
  winningNumber: string,
): Promise<{ tickets: number; winners: number; paid: number }> {
  const client = await db.connect()
  let tickets = 0
  let winners = 0
  let paid = 0
  try {
    await client.query('BEGIN')

    const drawRes = await client.query('SELECT * FROM lottery_draws WHERE id = $1 FOR UPDATE', [drawId])
    if (!drawRes.rows.length) throw new Error('Draw not found')
    const draw = drawRes.rows[0]
    const multiplier = Number(draw.prize_multiplier)

    await client.query(
      `UPDATE lottery_draws SET winning_number = $1, status = 'settled' WHERE id = $2`,
      [winningNumber, drawId],
    )

    const ticketRes = await client.query(
      `SELECT * FROM lottery_tickets WHERE draw_id = $1`,
      [drawId],
    )

    for (const t of ticketRes.rows) {
      tickets++
      if (t.ticket_number === winningNumber) {
        winners++
        const prize = Number(t.amount) * multiplier
        paid += prize
        await client.query(
          `UPDATE lottery_tickets SET is_winner = true, prize = $1 WHERE id = $2`,
          [prize, t.id],
        )
        await creditPrize({
          userId: t.user_id,
          amount: prize,
          referenceId: t.id,
          idempotencyKey: `lottery_payout_${t.id}`,
        })
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return { tickets, winners, paid }
}
