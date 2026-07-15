import { CronJob } from 'cron'
import { pool } from '../../../db/pool'
import * as drawsService from './draws'
import * as settlementService from './settlement'

/**
 * Daily Lottery scheduler — runs inside core-api-service so it shares the
 * same initialized DB pool and business logic as the HTTP routes. A
 * standalone scheduler process would need its own pool wiring and cannot
 * import this module's sibling files without leaving its own rootDir.
 */
export function startLotteryDailyScheduler(): void {
  // Job 1: Create today's draws for every active tier, once per day at 00:00
  new CronJob('0 0 * * *', async () => {
    console.log('[Lottery Daily] Creating draws for today')

    try {
      const tiersResult = await pool.query(
        "SELECT * FROM lottery_daily_tiers WHERE status = 'active'"
      )

      let createdCount = 0

      for (const tier of tiersResult.rows) {
        try {
          const draw = await drawsService.createDraw({
            tier_id: tier.id,
            draw_date: new Date(),
            prize_tiers: tier.default_prize_tiers,
          })

          console.log(`[Lottery Daily] Created draw ${draw.id} for tier ${tier.id}`)
          createdCount++
        } catch (err) {
          // Draw already exists for this tier/date (unique constraint) — expected on restart
          console.log(`[Lottery Daily] Draw already exists for tier ${tier.id}`)
        }
      }

      console.log(`[Lottery Daily] Created ${createdCount} draws`)
    } catch (err: any) {
      console.error('[Lottery Daily] Error creating draws:', err.message)
    }
  }).start()

  // Job 2: Settle draws whose draw_time has arrived, checked every 30 seconds
  new CronJob('*/30 * * * * *', async () => {
    try {
      const drawsDue = await drawsService.getDrawsDueForSettlement()

      for (const draw of drawsDue) {
        if (draw.status === 'open') {
          const winningNumber = draw.winning_number || generateRandomNumber()
          await drawsService.updateDrawWinningNumber(draw.id, winningNumber)
          await drawsService.updateDrawStatus(draw.id, 'calling')
        }

        if (draw.status === 'calling') {
          try {
            const result = await settlementService.settleDraw(draw.id)
            console.log(
              `[Lottery Daily] Settled draw ${draw.id}: ${result.settled_count} winners`
            )
          } catch (err: any) {
            console.error(`[Lottery Daily] Error settling draw ${draw.id}:`, err.message)
          }
        }
      }
    } catch (err: any) {
      console.error('[Lottery Daily] Error in settlement job:', err.message)
    }
  }).start()

  console.log('[Lottery Daily] Scheduler started')
}

function generateRandomNumber(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}
