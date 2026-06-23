import { Pool } from 'pg'
import { creditPrize } from './wallet'

// Standard Satta Matka payout multiples per bet type.
export const MATKA_MULTIPLIERS: Record<string, number> = {
  single: 9.5,         // a single digit 0-9
  jodi: 95,            // a two-digit 00-99 (open digit + close digit)
  single_panna: 142,   // a 3-digit panna, all digits distinct
  double_panna: 285,   // a 3-digit panna with one repeated digit
  triple_panna: 950,   // a 3-digit panna, all digits the same
}

export const MATKA_BET_TYPES = Object.keys(MATKA_MULTIPLIERS)

/** Matka digit = sum of the panna's three digits, mod 10. */
export function pannaToDigit(panna: string): number {
  return panna
    .split('')
    .reduce((s, c) => s + (parseInt(c, 10) || 0), 0) % 10
}

/** Classify a 3-digit panna for payout purposes. */
export function pannaKind(panna: string): 'single_panna' | 'double_panna' | 'triple_panna' {
  const [a, b, c] = panna.split('')
  if (a === b && b === c) return 'triple_panna'
  if (a === b || b === c || a === c) return 'double_panna'
  return 'single_panna'
}

export function validateMatkaBet(betType: string, number: string): string | null {
  if (!MATKA_BET_TYPES.includes(betType)) return 'Invalid bet type'
  if (betType === 'single') {
    if (!/^[0-9]$/.test(number)) return 'Single must be one digit (0-9)'
  } else if (betType === 'jodi') {
    if (!/^[0-9]{2}$/.test(number)) return 'Jodi must be two digits (00-99)'
  } else {
    if (!/^[0-9]{3}$/.test(number)) return 'Panna must be three digits'
    if (pannaKind(number) !== betType) return `That number is not a ${betType.replace('_', ' ')}`
  }
  return null
}

/**
 * Settle one session of a draw.
 *  - session 'open':  declares open_panna → settles open single + panna bets.
 *  - session 'close': declares close_panna → settles close single/panna bets
 *    AND all jodi bets (jodi needs both digits).
 */
export async function settleMatkaSession(
  db: Pool,
  drawId: string,
  session: 'open' | 'close',
  panna: string,
): Promise<{ settled: number; winners: number }> {
  const digit = pannaToDigit(panna)
  const client = await db.connect()
  let settled = 0
  let winners = 0
  try {
    await client.query('BEGIN')

    const drawRes = await client.query('SELECT * FROM matka_draws WHERE id = $1 FOR UPDATE', [drawId])
    if (!drawRes.rows.length) throw new Error('Draw not found')
    const draw = drawRes.rows[0]

    if (session === 'open') {
      await client.query(
        `UPDATE matka_draws SET open_panna = $1, open_digit = $2, status = 'open_declared' WHERE id = $3`,
        [panna, digit, drawId],
      )
    } else {
      const jodi = `${draw.open_digit ?? 0}${digit}`
      await client.query(
        `UPDATE matka_draws SET close_panna = $1, close_digit = $2, jodi = $3, status = 'settled' WHERE id = $4`,
        [panna, digit, jodi, drawId],
      )
    }

    // Which pending bets does this session settle?
    const betsRes = await client.query(
      `SELECT * FROM matka_bets WHERE draw_id = $1 AND status = 'pending'`,
      [drawId],
    )

    const closeDigit = session === 'close' ? digit : draw.close_digit
    const openDigit = session === 'open' ? digit : draw.open_digit
    const jodi = `${openDigit ?? 0}${closeDigit ?? 0}`

    for (const bet of betsRes.rows) {
      let won = false
      let settleNow = false

      if (bet.bet_type === 'jodi') {
        // Jodi only settles once the close digit exists.
        if (session === 'close') {
          settleNow = true
          won = bet.number === jodi
        }
      } else if (bet.session === session) {
        settleNow = true
        if (bet.bet_type === 'single') {
          won = parseInt(bet.number, 10) === digit
        } else {
          won = bet.number === panna
        }
      }

      if (!settleNow) continue
      settled++

      if (won) {
        winners++
        const payout = Number(bet.potential_payout)
        await client.query(
          `UPDATE matka_bets SET status = 'won', payout = $1 WHERE id = $2`,
          [payout, bet.id],
        )
        await creditPrize({
          userId: bet.user_id,
          amount: payout,
          referenceId: bet.id,
          idempotencyKey: `matka_payout_${bet.id}`,
        })
      } else {
        await client.query(`UPDATE matka_bets SET status = 'lost' WHERE id = $1`, [bet.id])
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return { settled, winners }
}
