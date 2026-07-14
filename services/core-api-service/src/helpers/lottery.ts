import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export type PrizeTier = { match_type: 'exact' | 'last_3' | 'last_2' | 'last_1'; multiplier: number }

const TIER_ORDER: PrizeTier['match_type'][] = ['exact', 'last_3', 'last_2', 'last_1']
const TIER_LENGTH: Record<PrizeTier['match_type'], number> = { exact: 4, last_3: 3, last_2: 2, last_1: 1 }

// Returns the highest-value tier a ticket qualifies for, checked in order —
// NOT cumulative. A ticket matching all 4 digits wins only the exact tier,
// not every lower tier too.
export function findMatchingTier(ticketNumber: string, winningNumber: string, tiers: PrizeTier[]): PrizeTier | null {
  for (const matchType of TIER_ORDER) {
    const len = TIER_LENGTH[matchType]
    if (ticketNumber.slice(-len) === winningNumber.slice(-len)) {
      const tier = tiers.find(t => t.match_type === matchType)
      if (tier) return tier
    }
  }
  return null
}

export function generateWinningNumber(): string {
  return Math.floor(Math.random() * 10000).toString().padStart(4, '0')
}

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
    const draw = drawRes.rows[0]
    const tiers: PrizeTier[] = draw.prize_tiers || []
    const ticketPrice = Number(draw.ticket_price)

    await client.query(
      `UPDATE lottery_draws SET winning_number = $1, status = 'settled' WHERE id = $2`,
      [winningNumber, drawId],
    )

    const ticketsRes = await client.query('SELECT * FROM lottery_tickets WHERE draw_id = $1', [drawId])
    tickets = ticketsRes.rows.length

    for (const t of ticketsRes.rows) {
      const tier = findMatchingTier(t.ticket_number, winningNumber, tiers)
      if (tier) {
        const prize = ticketPrice * Number(tier.multiplier)
        await client.query(`UPDATE lottery_tickets SET is_winner = true, prize = $1 WHERE id = $2`, [prize, t.id])
        winners++
        paid += prize
        winnerPayouts.push({ userId: t.user_id, prize, ticketId: t.id })
      } else {
        await client.query(`UPDATE lottery_tickets SET is_winner = false, prize = 0 WHERE id = $1`, [t.id])
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await Promise.all(winnerPayouts.map(w =>
    creditPrize({
      userId: w.userId,
      amount: w.prize,
      referenceId: w.ticketId,
      idempotencyKey: `lottery_payout_${w.ticketId}`,
      notification: {
        title: 'Lottery Win! 🎰',
        body: `Congratulations! Your ticket won a prize of ₹${w.prize.toFixed(2)} in the draw.`,
      },
    }),
  ))

  return { tickets, winners, paid }
}
