import { pool } from '../db/pool'
import { getBotConfig, pickLotteryBotWithBalance, randomUnusedTicketNumber } from './lottery-bot-fill'
import { rebalanceWeeklyMonthlyBotTickets } from './lottery-bot-fill'
import crypto from 'crypto'

describe('lottery-bot-fill helpers', () => {
  describe('getBotConfig', () => {
    it('returns null when bot fill is disabled', async () => {
      await pool.query('UPDATE lottery_bot_config SET enabled = false')
      const config = await getBotConfig()
      expect(config).toBeNull()
    })

    it('returns the config row when enabled', async () => {
      await pool.query(
        `UPDATE lottery_bot_config SET enabled = true, default_max_tickets = 300, fill_pct = 60, trigger_pct = 99, release_pct = 1`
      )
      const config = await getBotConfig()
      expect(config).toEqual({
        enabled: true,
        default_max_tickets: 300,
        fill_pct: 60,
        trigger_pct: 99,
        release_pct: 1,
      })
      await pool.query('UPDATE lottery_bot_config SET enabled = false, default_max_tickets = 200')
    })
  })

  describe('pickLotteryBotWithBalance', () => {
    it('returns a lottery-tagged bot with sufficient balance', async () => {
      const bot = await pickLotteryBotWithBalance(50)
      expect(bot).not.toBeNull()
      const check = await pool.query(
        `SELECT is_bot, preferred_game_type FROM users WHERE id = $1`,
        [bot!.id]
      )
      expect(check.rows[0].is_bot).toBe(true)
      expect(check.rows[0].preferred_game_type).toBe('lottery')
    })

    it('returns null when no lottery bot has enough balance', async () => {
      const bot = await pickLotteryBotWithBalance(999999999)
      expect(bot).toBeNull()
    })
  })

  describe('randomUnusedTicketNumber', () => {
    it('never returns a number already in the existing set', () => {
      const existing = new Set(['0000', '0001', '0002'])
      const result = randomUnusedTicketNumber(existing, 4)
      expect(result).not.toBeNull()
      expect(existing.has(result!)).toBe(false)
      expect(result).toMatch(/^\d{4}$/)
    })

    it('returns null when the entire number space is exhausted', () => {
      // digits=1 has a space of 10^1=10 possible values ('0'..'9') -- all
      // must be present for the space to actually be exhausted.
      const existing = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
      const result = randomUnusedTicketNumber(existing, 1)
      expect(result).toBeNull()
    })
  })
})

describe('rebalanceWeeklyMonthlyBotTickets', () => {
  async function createTestDraw(maxTickets: number) {
    const id = crypto.randomUUID()
    await pool.query(
      `INSERT INTO lottery_draws (id, name, ticket_price, draw_time, prize_tiers, category, status, max_tickets)
       VALUES ($1, 'Test Weekly Draw', 10, NOW() + INTERVAL '1 day', '[{"match_type":"exact","multiplier":1000}]', 'weekly', 'open', $2)`,
      [id, maxTickets]
    )
    return id
  }

  it('does nothing when bot fill is disabled', async () => {
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
    const drawId = await createTestDraw(10)
    await rebalanceWeeklyMonthlyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(0)
  })

  it('bots buy up toward fill_pct of the pool when enabled', async () => {
    await pool.query(
      `UPDATE lottery_bot_config SET enabled = true, fill_pct = 60, trigger_pct = 99, release_pct = 1`
    )
    const drawId = await createTestDraw(10) // 60% of 10 = 6 tickets
    await rebalanceWeeklyMonthlyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(6)
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
  })

  it('releases 1% of bot tickets and refunds them once sold reaches trigger_pct', async () => {
    await pool.query(
      `UPDATE lottery_bot_config SET enabled = true, fill_pct = 60, trigger_pct = 90, release_pct = 20`
    )
    const drawId = await createTestDraw(10)
    await rebalanceWeeklyMonthlyBotTickets(drawId) // bots fill to 6/10 (60%)

    // Simulate 3 real purchases to push sold to 9/10 (90%, hits trigger)
    for (let i = 0; i < 3; i++) {
      const ticketId = crypto.randomUUID()
      await pool.query(
        `INSERT INTO lottery_tickets (id, draw_id, user_id, ticket_number, amount)
         VALUES ($1, $2, (SELECT id FROM users WHERE is_bot = false LIMIT 1), $3, 10)`,
        [ticketId, drawId, `100${i}`]
      )
    }
    await rebalanceWeeklyMonthlyBotTickets(drawId)

    const botCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM lottery_tickets t JOIN users u ON u.id = t.user_id WHERE t.draw_id = $1 AND u.is_bot = true`,
      [drawId]
    )
    // Started with 6 bot tickets, release_pct=20% of 10 = 2 released -> 4 remain
    expect(botCount.rows[0].c).toBe(4)
    await pool.query('UPDATE lottery_bot_config SET enabled = false, fill_pct = 60, trigger_pct = 99, release_pct = 1')
  })
})
