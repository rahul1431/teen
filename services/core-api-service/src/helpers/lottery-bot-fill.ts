import { pool } from '../db/pool'

export type BotConfig = {
  enabled: boolean
  default_max_tickets: number
  fill_pct: number
  trigger_pct: number
  release_pct: number
}

export async function getBotConfig(): Promise<BotConfig | null> {
  const result = await pool.query('SELECT * FROM lottery_bot_config LIMIT 1')
  if (!result.rows.length || !result.rows[0].enabled) return null
  const row = result.rows[0]
  return {
    enabled: row.enabled,
    default_max_tickets: row.default_max_tickets,
    fill_pct: Number(row.fill_pct),
    trigger_pct: Number(row.trigger_pct),
    release_pct: Number(row.release_pct),
  }
}

export async function pickLotteryBotWithBalance(minAmount: number): Promise<{ id: string } | null> {
  const result = await pool.query(
    `SELECT u.id FROM users u
     JOIN wallets w ON w.user_id = u.id
     WHERE u.is_bot = true AND u.preferred_game_type = 'lottery' AND w.real_balance >= $1
     ORDER BY random() LIMIT 1`,
    [minAmount]
  )
  return result.rows[0] ? { id: result.rows[0].id } : null
}

export function randomUnusedTicketNumber(existingNumbers: Set<string>, digits: number = 4): string | null {
  const max = 10 ** digits
  if (existingNumbers.size >= max) return null
  let candidate: string
  do {
    candidate = Math.floor(Math.random() * max).toString().padStart(digits, '0')
  } while (existingNumbers.has(candidate))
  return candidate
}
