import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export async function settleLottery(
  db: Pool,
  drawId: string,
  winnersList: { ticket_number: string; prize: number; rank?: number }[]
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

    const winningNumbersStr = winnersList.map(w => w.ticket_number).join(', ')

    await client.query(
      `UPDATE lottery_draws SET winning_number = $1, status = 'settled' WHERE id = $2`,
      [winningNumbersStr, drawId],
    )

    const countRes = await client.query(
      'SELECT COUNT(*) AS total FROM lottery_tickets WHERE draw_id = $1',
      [drawId],
    )
    tickets = parseInt(countRes.rows[0].total, 10)

    // Mark all tickets as not winning first
    await client.query(
      `UPDATE lottery_tickets SET is_winner = false, prize = 0 WHERE draw_id = $1`,
      [drawId]
    )

    // Update each winner
    for (const w of winnersList) {
      const winnerRes = await client.query(
        `UPDATE lottery_tickets SET is_winner = true, prize = $1
         WHERE draw_id = $2 AND ticket_number = $3
         RETURNING id, user_id`,
        [Number(w.prize), drawId, w.ticket_number]
      )
      
      if (winnerRes.rows.length > 0) {
        const row = winnerRes.rows[0]
        winners++
        paid += Number(w.prize)
        winnerPayouts.push({ userId: row.user_id, prize: Number(w.prize), ticketId: row.id })
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Process payouts
  await Promise.all(winnerPayouts.map(w =>
    creditPrize({ userId: w.userId, amount: w.prize, referenceId: w.ticketId, idempotencyKey: `lottery_payout_${w.ticketId}` }),
  ))

  return { tickets, winners, paid }
}
