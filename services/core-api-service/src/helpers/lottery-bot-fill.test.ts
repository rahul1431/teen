import { pool } from '../db/pool'
import { getBotConfig, pickLotteryBotWithBalance, randomUnusedTicketNumber } from './lottery-bot-fill'

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
      const existing = new Set(['0', '1'])
      const result = randomUnusedTicketNumber(existing, 1)
      expect(result).toBeNull()
    })
  })
})
