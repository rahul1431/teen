import { pool } from '../../../db/pool'
import * as tiersService from './tiers'
import * as drawsService from './draws'
import { rebalanceDailyBotTickets } from './bot-fill'

describe('rebalanceDailyBotTickets', () => {
  async function createTestDrawWithTier(maxTickets: number, amount = 20) {
    const tier = await tiersService.createTier({
      amount,
      draw_time: '23:59:00',
      default_prize_tiers: [{ match_type: 'exact', outcome_type: 'cash', multiplier: 100 }],
      status: 'active',
    })
    const draw = await drawsService.createDraw({ tier_id: tier.id, draw_date: new Date(Date.now() + 86400000) })
    await pool.query('UPDATE lottery_daily_draws SET max_tickets = $1 WHERE id = $2', [maxTickets, draw.id])
    return draw.id
  }

  it('does nothing when bot fill is disabled', async () => {
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
    const drawId = await createTestDrawWithTier(10)
    await rebalanceDailyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_daily_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(0)
  })

  it('bots buy up toward fill_pct of the pool when enabled', async () => {
    await pool.query('UPDATE lottery_bot_config SET enabled = true, fill_pct = 60, trigger_pct = 99, release_pct = 1')
    const drawId = await createTestDrawWithTier(10) // 60% of 10 = 6 tickets
    await rebalanceDailyBotTickets(drawId)
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM lottery_daily_tickets WHERE draw_id = $1', [drawId])
    expect(count.rows[0].c).toBe(6)
    await pool.query('UPDATE lottery_bot_config SET enabled = false')
  })
})
