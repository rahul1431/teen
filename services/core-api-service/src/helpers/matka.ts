import { Pool } from 'pg'
import { creditPrize } from './wallet-client'

export const MATKA_MULTIPLIERS: Record<string, number> = {
  single: 9.5, jodi: 95, single_panna: 142, double_panna: 285, triple_panna: 950,
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

    if (session === 'open') {
      await client.query(
        `UPDATE matka_draws SET open_panna = $1, open_digit = $2, status = 'open_declared' WHERE id = $3`,
        [panna, digit, drawId],
      )
      const wonRes = await client.query(
        `UPDATE matka_bets SET status = 'won', payout = potential_payout
         WHERE draw_id = $1 AND status = 'pending' AND session = 'open'
           AND ((bet_type = 'single' AND number = $2) OR (bet_type IN ('single_panna','double_panna','triple_panna') AND number = $3))
         RETURNING id, user_id, payout`,
        [drawId, String(digit), panna],
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
      const jodi = `${draw.open_digit ?? 0}${digit}`
      await client.query(
        `UPDATE matka_draws SET close_panna = $1, close_digit = $2, jodi = $3, status = 'settled' WHERE id = $4`,
        [panna, digit, jodi, drawId],
      )
      const wonRes = await client.query(
        `UPDATE matka_bets SET status = 'won', payout = potential_payout
         WHERE draw_id = $1 AND status = 'pending'
           AND ((bet_type = 'jodi' AND number = $2)
             OR (session = 'close' AND bet_type = 'single' AND number = $3)
             OR (session = 'close' AND bet_type IN ('single_panna','double_panna','triple_panna') AND number = $4))
         RETURNING id, user_id, payout`,
        [drawId, jodi, String(digit), panna],
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
    creditPrize({ userId: w.userId, amount: w.amount, referenceId: w.betId, idempotencyKey: `matka_payout_${w.betId}` }),
  ))

  return { settled, winners }
}
