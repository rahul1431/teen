import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export const MATKA_MULTIPLIERS: Record<string, number> = {
  single: 9.5, jodi: 95, single_panna: 142, double_panna: 285, triple_panna: 950,
  half_sangam_a: 1000, half_sangam_b: 1000, full_sangam: 10000,
}
export const MATKA_BET_TYPES = Object.keys(MATKA_MULTIPLIERS)

export function pannaToDigit(panna: string): number {
  return panna.split('').reduce((s, c) => s + (parseInt(c, 10) || 0), 0) % 10
}

export function pannaKind(panna: string): 'single_panna' | 'double_panna' | 'triple_panna' {
  const [a, b, c] = panna.split('')
  if (a === b && b === c) return 'triple_panna'
  if (a === b || b === c || a === c) return 'double_panna'
  return 'single_panna'
}

export function isPannaSorted(panna: string): boolean {
  if (!/^[0-9]{3}$/.test(panna)) return false
  const values = panna.split('').map(c => c === '0' ? 10 : parseInt(c, 10))
  return values[0] <= values[1] && values[1] <= values[2]
}

export function validateMatkaBet(betType: string, number: string): string | null {
  if (!MATKA_BET_TYPES.includes(betType)) return 'Invalid bet type'
  if (betType === 'single') {
    if (!/^[0-9]$/.test(number)) return 'Single must be one digit (0-9)'
  } else if (betType === 'jodi') {
    if (!/^[0-9]{2}$/.test(number)) return 'Jodi must be two digits (00-99)'
  } else if (betType === 'half_sangam_a') {
    if (!/^[0-9]{4}$/.test(number)) return 'Half Sangam A must be 4 digits (Panna + Ank)'
    const panna = number.slice(0, 3)
    if (!isPannaSorted(panna)) return 'Open Panna digits must be in ascending order'
  } else if (betType === 'half_sangam_b') {
    if (!/^[0-9]{4}$/.test(number)) return 'Half Sangam B must be 4 digits (Ank + Panna)'
    const panna = number.slice(1, 4)
    if (!isPannaSorted(panna)) return 'Close Panna digits must be in ascending order'
  } else if (betType === 'full_sangam') {
    if (!/^[0-9]{6}$/.test(number)) return 'Full Sangam must be 6 digits (Open Panna + Close Panna)'
    const openPanna = number.slice(0, 3)
    const closePanna = number.slice(3, 6)
    if (!isPannaSorted(openPanna)) return 'Open Panna digits must be in ascending order'
    if (!isPannaSorted(closePanna)) return 'Close Panna digits must be in ascending order'
  } else {
    if (!isPannaSorted(number)) return 'Panna digits must be in ascending order'
    if (pannaKind(number) !== betType) return `That number is not a ${betType.replace('_', ' ')}`
  }
  return null
}

export async function settleMatkaSession(
  db: Pool, drawId: string, session: 'open' | 'close', panna: string,
): Promise<{ settled: number; winners: number }> {
  const digit = pannaToDigit(panna)
  const client = await db.connect()
  let settled = 0
  let winners = 0
  const winnerPayouts: { userId: string; amount: number; betId: string }[] = []

  try {
    await client.query('BEGIN')

    const drawRes = await client.query('SELECT * FROM matka_draws WHERE id = $1 FOR UPDATE', [drawId])
    if (!drawRes.rows.length) throw new Error('Draw not found')
    const draw = drawRes.rows[0]

    const cfgRes = await client.query(`SELECT rake_percent FROM game_configs WHERE game_type = 'matka'`)
    const rakeMultiplier = 1 - (Number(cfgRes.rows[0]?.rake_percent) || 0) / 100

    if (session === 'open') {
      await client.query(
        `UPDATE matka_draws SET open_panna = $1, open_digit = $2, status = 'open_declared' WHERE id = $3`,
        [panna, digit, drawId],
      )
      const wonRes = await client.query(
        `UPDATE matka_bets SET status = 'won', payout = ROUND((potential_payout * $4)::numeric, 2)
         WHERE draw_id = $1 AND status = 'pending' AND session = 'open'
           AND ((bet_type = 'single' AND number = $2) OR (bet_type IN ('single_panna','double_panna','triple_panna') AND number = $3))
         RETURNING id, user_id, payout`,
        [drawId, String(digit), panna, rakeMultiplier],
      )
      for (const row of wonRes.rows) {
        winners++
        winnerPayouts.push({ userId: row.user_id, amount: Number(row.payout), betId: row.id })
      }
      const lostRes = await client.query(
        `UPDATE matka_bets SET status = 'lost' WHERE draw_id = $1 AND status = 'pending' AND session = 'open'`,
        [drawId],
      )
      settled = wonRes.rowCount! + lostRes.rowCount!
    } else {
      if (draw.open_digit === null) throw new Error('Cannot declare Close before Open has been declared for this draw')
      const jodi = `${draw.open_digit}${digit}`
      await client.query(
        `UPDATE matka_draws SET close_panna = $1, close_digit = $2, jodi = $3, status = 'settled' WHERE id = $4`,
        [panna, digit, jodi, drawId],
      )
      const openPanna = draw.open_panna ?? '000'
      const openDigit = String(draw.open_digit ?? 0)
      
      const hsAVal = `${openPanna}${digit}`
      const hsBVal = `${openDigit}${panna}`
      const fsVal = `${openPanna}${panna}`

      const wonRes = await client.query(
        `UPDATE matka_bets SET status = 'won', payout = ROUND((potential_payout * $8)::numeric, 2)
         WHERE draw_id = $1 AND status = 'pending'
           AND ((bet_type = 'jodi' AND number = $2)
             OR (session = 'close' AND bet_type = 'single' AND number = $3)
             OR (session = 'close' AND bet_type IN ('single_panna','double_panna','triple_panna') AND number = $4)
             OR (bet_type = 'half_sangam_a' AND number = $5)
             OR (bet_type = 'half_sangam_b' AND number = $6)
             OR (bet_type = 'full_sangam' AND number = $7))
         RETURNING id, user_id, payout`,
        [drawId, jodi, String(digit), panna, hsAVal, hsBVal, fsVal, rakeMultiplier],
      )
      for (const row of wonRes.rows) {
        winners++
        winnerPayouts.push({ userId: row.user_id, amount: Number(row.payout), betId: row.id })
      }
      const lostRes = await client.query(
        `UPDATE matka_bets SET status = 'lost' WHERE draw_id = $1 AND status = 'pending'`,
        [drawId],
      )
      settled = wonRes.rowCount! + lostRes.rowCount!
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
      amount: w.amount,
      referenceId: w.betId,
      idempotencyKey: `matka_payout_${w.betId}`,
      notification: {
        title: 'Matka Win! 🎯',
        body: `Congratulations! You won ₹${w.amount.toFixed(2)} in Satta Matka.`,
      },
    }),
  ))

  return { settled, winners }
}
