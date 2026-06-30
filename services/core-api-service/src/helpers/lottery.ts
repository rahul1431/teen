import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export async function settleLottery(
  db: Pool,
  drawId: string,
  winningNumber: string,
): Promise<{ tickets: number; winners: number; paid: number }> {
  const client = await db.connect()
  const winnerPayouts: { userId: string; prize: number; ticketId: string }[] = []
  let tickets = 0
  let winners = 0
  let paid = 0

  try {
    await client.query('BEGIN')

    const drawRes = await client.query('SELECT * FROM lottery_draws WHERE id = $1 FOR UPDATE', [drawId])
    if (!drawRes.rows.length) throw new Error('Draw not found')
    const multiplier = Number(drawRes.rows[0].prize_multiplier)

    await client.query(
      `UPDATE lottery_draws SET winning_number = $1, status = 'settled' WHERE id = $2`,
      [winningNumber, drawId],
    )

    const countRes = await client.query(
      'SELECT COUNT(*) AS total FROM lottery_tickets WHERE draw_id = $1',
      [drawId],
    )
    tickets = parseInt(countRes.rows[0].total, 10)

    const winnerRes = await client.query(
      `UPDATE lottery_tickets SET is_winner = true, prize = amount * $1
       WHERE draw_id = $2 AND ticket_number = $3
       RETURNING id, user_id, (amount * $1) AS prize`,
      [multiplier, drawId, winningNumber],
    )

    for (const row of winnerRes.rows) {
      winners++
      const prize = Number(row.prize)
      paid += prize
      winnerPayouts.push({ userId: row.user_id, prize, ticketId: row.id })
    }

    await client.query(
      `UPDATE lottery_tickets SET is_winner = false
       WHERE draw_id = $1 AND ticket_number != $2 AND is_winner IS NULL`,
      [drawId, winningNumber],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await Promise.all(winnerPayouts.map(w =>
    creditPrize({ userId: w.userId, amount: w.prize, referenceId: w.ticketId, idempotencyKey: `lottery_payout_${w.ticketId}` }),
  ))

  return { tickets, winners, paid }
}
