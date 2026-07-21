import { pool } from '../../../db/pool'
import { debitStake, creditPrize } from '../../../helpers/wallet-client'
import { getBotConfig, pickLotteryBotWithBalance, randomUnusedTicketNumber } from '../../../helpers/lottery-bot-fill'
import * as tiersService from './tiers'
import crypto from 'crypto'

export async function rebalanceDailyBotTickets(drawId: string): Promise<void> {
  const config = await getBotConfig()
  if (!config) return

  const drawRes = await pool.query(`SELECT * FROM lottery_daily_draws WHERE id = $1 AND status = 'open'`, [drawId])
  if (!drawRes.rows.length) return
  const draw = drawRes.rows[0]
  const maxTickets = draw.max_tickets
  const tier = await tiersService.getTier(draw.tier_id)
  const ticketPrice = Number(tier.amount)

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE u.is_bot = true)::int AS bot_count
     FROM lottery_daily_tickets t JOIN users u ON u.id = t.user_id
     WHERE t.draw_id = $1`,
    [drawId]
  )
  const { total, bot_count } = countRes.rows[0]
  const soldPct = (total / maxTickets) * 100
  const botPct = (bot_count / maxTickets) * 100

  if (soldPct >= config.trigger_pct) {
    const releaseCount = Math.max(1, Math.round((config.release_pct / 100) * maxTickets))
    const toRelease = await pool.query(
      `SELECT t.id, t.user_id FROM lottery_daily_tickets t
       JOIN users u ON u.id = t.user_id
       WHERE t.draw_id = $1 AND u.is_bot = true
       ORDER BY random() LIMIT $2`,
      [drawId, releaseCount]
    )
    for (const ticket of toRelease.rows) {
      await pool.query('DELETE FROM lottery_daily_tickets WHERE id = $1', [ticket.id])
      await creditPrize({
        userId: ticket.user_id,
        amount: ticketPrice,
        referenceId: ticket.id,
        idempotencyKey: `lottery_daily_bot_release_${ticket.id}`,
      })
    }
    return
  }

  if (soldPct < config.fill_pct && botPct < config.fill_pct) {
    const ceilingCount = Math.floor((config.fill_pct / 100) * maxTickets)
    const triggerCount = Math.floor((config.trigger_pct / 100) * maxTickets)
    let currentTotal = total
    let currentBot = bot_count
    const existingRes = await pool.query('SELECT ticket_number FROM lottery_daily_tickets WHERE draw_id = $1', [drawId])
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
        idempotencyKey: `lottery_daily_bot_buy_${ticketId}`,
        description: 'Bot fill: Daily Lottery',
      })
      if (!debit.ok) break
      await pool.query(
        `INSERT INTO lottery_daily_tickets (id, draw_id, user_id, ticket_number, outcome_type) VALUES ($1,$2,$3,$4,'none')`,
        [ticketId, drawId, bot.id, ticketNumber]
      )
      existingNumbers.add(ticketNumber)
      currentTotal++
      currentBot++
    }
  }
}
