import { pool } from '../db/pool'
import { debitStake, creditPrize } from './wallet-client'
import crypto from 'crypto'

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

export async function rebalanceWeeklyMonthlyBotTickets(drawId: string): Promise<void> {
  const config = await getBotConfig()
  if (!config) return

  const drawRes = await pool.query(`SELECT * FROM lottery_draws WHERE id = $1 AND status = 'open'`, [drawId])
  if (!drawRes.rows.length) return
  const draw = drawRes.rows[0]
  const maxTickets = draw.max_tickets
  const ticketPrice = Number(draw.ticket_price)

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE u.is_bot = true)::int AS bot_count
     FROM lottery_tickets t JOIN users u ON u.id = t.user_id
     WHERE t.draw_id = $1`,
    [drawId]
  )
  const { total, bot_count } = countRes.rows[0]
  const soldPct = (total / maxTickets) * 100
  const botPct = (bot_count / maxTickets) * 100

  if (soldPct >= config.trigger_pct) {
    const releaseCount = Math.max(1, Math.round((config.release_pct / 100) * maxTickets))
    const toRelease = await pool.query(
      `SELECT t.id, t.user_id, t.amount FROM lottery_tickets t
       JOIN users u ON u.id = t.user_id
       WHERE t.draw_id = $1 AND u.is_bot = true
       ORDER BY random() LIMIT $2`,
      [drawId, releaseCount]
    )
    for (const ticket of toRelease.rows) {
      await pool.query('DELETE FROM lottery_tickets WHERE id = $1', [ticket.id])
      await creditPrize({
        userId: ticket.user_id,
        amount: Number(ticket.amount),
        referenceId: ticket.id,
        idempotencyKey: `lottery_bot_release_${ticket.id}`,
      })
    }
    return
  }

  if (soldPct < config.fill_pct && botPct < config.fill_pct) {
    const ceilingCount = Math.floor((config.fill_pct / 100) * maxTickets)
    const triggerCount = Math.floor((config.trigger_pct / 100) * maxTickets)
    let currentTotal = total
    let currentBot = bot_count
    const existingRes = await pool.query('SELECT ticket_number FROM lottery_tickets WHERE draw_id = $1', [drawId])
    const existingNumbers = new Set<string>(existingRes.rows.map((r: any) => r.ticket_number))

    while (currentBot < ceilingCount && currentTotal < triggerCount) {
      const bot = await pickLotteryBotWithBalance(ticketPrice)
      if (!bot) break
      const ticketNumber = randomUnusedTicketNumber(existingNumbers, 4)
      if (!ticketNumber) break
      const ticketId = crypto.randomUUID()
      const debit = await debitStake({
        userId: bot.id,
        amount: ticketPrice,
        referenceId: ticketId,
        idempotencyKey: `lottery_bot_buy_${ticketId}`,
        description: `Bot fill: ${draw.name}`,
      })
      if (!debit.ok) break
      await pool.query(
        `INSERT INTO lottery_tickets (id, draw_id, user_id, ticket_number, amount) VALUES ($1,$2,$3,$4,$5)`,
        [ticketId, drawId, bot.id, ticketNumber, ticketPrice]
      )
      existingNumbers.add(ticketNumber)
      currentTotal++
      currentBot++
    }
  }
}
