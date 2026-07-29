import { pool } from '../../../db/pool'
import { getDraw, updateDrawStatus } from './draws'
import { getTier } from './tiers'
import { creditPrize } from '../../../helpers/wallet-client'
import { PrizeTier } from './tiers'

export async function settleDraw(draw_id: string): Promise<{
  settled_count: number
  cash_winners: number
  coupon_winners: number
}> {
  const draw = await getDraw(draw_id)

  if (!draw.winning_number) {
    throw new Error(`Draw ${draw_id} has no winning number`)
  }

  if (draw.status === 'settled') {
    throw new Error(`Draw ${draw_id} already settled`)
  }

  // Get the tier to access the amount (ticket price)
  const tier = await getTier(draw.tier_id)

  // Fetch all unsettled tickets for this draw
  const ticketsResult = await pool.query(
    'SELECT * FROM lottery_daily_tickets WHERE draw_id = $1 AND outcome_type = $2',
    [draw_id, 'none']
  )

  const tickets = ticketsResult.rows

  let cashWinners = 0
  let couponWinners = 0

  for (const ticket of tickets) {
    const matchType = matchTicketToTier(ticket.ticket_number, draw.winning_number)

    if (!matchType) {
      // No match, outcome remains 'none'
      continue
    }

    // Find matching prize tier config from draw.prize_tiers
    const prizeTier = draw.prize_tiers.find((t: PrizeTier) => t.match_type === matchType)

    if (!prizeTier) {
      // No prize configured for this match type
      continue
    }

    // Determine outcome and process
    if (prizeTier.outcome_type === 'cash') {
      const prize = tier.amount * (prizeTier.multiplier || 1)

      // Credit via wallet with idempotency
      try {
        const creditSuccess = await creditPrize({
          userId: ticket.user_id,
          amount: prize,
          referenceId: `lottery_daily_${draw_id}_${ticket.id}`,
          idempotencyKey: `lottery_daily_${draw_id}_${ticket.id}`,
          notification: {
            title: 'Daily Lottery Win!',
            body: `You won ₹${prize} with ${matchType}!`,
          },
        })

        if (!creditSuccess) {
          throw new Error(`Wallet service returned false for ticket ${ticket.id}`)
        }
      } catch (err) {
        console.error(`[Settlement] Failed to credit prize for ticket ${ticket.id}:`, (err as Error).message)
        // Don't update ticket as winner; leave for manual reconciliation
        continue
      }

      // Update ticket with match result
      await pool.query(
        `UPDATE lottery_daily_tickets
         SET match_type = $1, outcome_type = $2, prize = $3
         WHERE id = $4`,
        [matchType, 'cash', prize, ticket.id]
      )

      cashWinners++
    } else if (prizeTier.outcome_type === 'coupon') {
      // Assign coupon
      const couponId = await assignCoupon(ticket.user_id, prizeTier.coupon_code || 'default')

      // Update ticket
      await pool.query(
        `UPDATE lottery_daily_tickets
         SET match_type = $1, outcome_type = $2, coupon_id = $3
         WHERE id = $4`,
        [matchType, 'coupon', couponId, ticket.id]
      )

      couponWinners++
    }
  }

  // Mark draw as settled
  await updateDrawStatus(draw_id, 'settled')

  return {
    settled_count: cashWinners + couponWinners,
    cash_winners: cashWinners,
    coupon_winners: couponWinners,
  }
}

export function matchTicketToTier(
  ticket_number: string,
  winning_number: string
): 'exact' | 'last_3' | 'last_2' | 'last_1' | null {
  // Validate inputs: both must be exactly 4 digits
  if (!/^\d{4}$/.test(ticket_number) || !/^\d{4}$/.test(winning_number)) {
    throw new Error('Ticket and winning numbers must be exactly 4 digits');
  }

  // Check exact match (all 4 digits)
  if (ticket_number === winning_number) {
    return 'exact'
  }

  // Check last 3 digits
  const ticketLast3 = ticket_number.slice(-3)
  const winningLast3 = winning_number.slice(-3)
  if (ticketLast3 === winningLast3) {
    return 'last_3'
  }

  // Check last 2 digits
  const ticketLast2 = ticket_number.slice(-2)
  const winningLast2 = winning_number.slice(-2)
  if (ticketLast2 === winningLast2) {
    return 'last_2'
  }

  // Check last 1 digit
  const ticketLast1 = ticket_number.slice(-1)
  const winningLast1 = winning_number.slice(-1)
  if (ticketLast1 === winningLast1) {
    return 'last_1'
  }

  // No match
  return null
}

/**
 * Assigns a coupon to a user for daily lottery wins.
 *
 * PLACEHOLDER IMPLEMENTATION: This function currently returns a generated coupon ID.
 * It defers actual coupon system integration to a future task (coupon system design & implementation).
 * The placeholder allows settlement processing to proceed without blocking on external coupon logic.
 *
 * TODO: Replace with actual coupon system integration that:
 * - Validates coupon_code exists in coupon system
 * - Creates a user coupon record with expiration
 * - Returns the actual coupon_id from the coupon system
 *
 * @param user_id - User ID receiving the coupon
 * @param coupon_code - Coupon code to assign (e.g., 'default', 'bonus_50')
 * @returns Generated coupon ID (placeholder)
 */
async function assignCoupon(user_id: string, coupon_code: string): Promise<string> {
  return `coupon_${user_id}_${Date.now()}`
}
