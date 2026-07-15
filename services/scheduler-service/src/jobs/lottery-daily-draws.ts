import { pool } from '../../../core-api-service/src/db/pool'
import * as drawsService from '../../../core-api-service/src/modules/lottery/daily/draws'
import * as settlementService from '../../../core-api-service/src/modules/lottery/daily/settlement'
import { CronJob } from 'cron'

export function startLotteryDailyScheduler() {
  // Job 1: Create draws at 00:00 daily
  new CronJob('0 0 * * *', async () => {
    console.log('[Lottery Daily] Creating draws for today')

    try {
      const tiersResult = await pool.query(
        "SELECT * FROM lottery_daily_tiers WHERE status = 'active'"
      )

      const tiers = tiersResult.rows
      let createdCount = 0

      for (const tier of tiers) {
        try {
          const today = new Date()
          const draw = await drawsService.createDraw({
            tier_id: tier.id,
            draw_date: today,
            prize_tiers: tier.default_prize_tiers
          })

          console.log(
            `[Lottery Daily] Created draw ${draw.id} for tier ${tier.id}`
          )
          createdCount++
        } catch (err) {
          // Draw might already exist for this tier/date (duplicate key)
          console.log(`[Lottery Daily] Draw already exists for tier ${tier.id}`)
        }
      }

      console.log(`[Lottery Daily] Created ${createdCount} draws`)
    } catch (err: any) {
      console.error('[Lottery Daily] Error creating draws:', err.message)
    }
  }).start()

  // Job 2: Settle draws every 30 seconds
  new CronJob('*/30 * * * * *', async () => {
    try {
      const drawsDue = await drawsService.getDrawsDueForSettlement()

      for (const draw of drawsDue) {
        if (draw.status === 'open') {
          // Generate winning number if not declared
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
            console.error(
              `[Lottery Daily] Error settling draw ${draw.id}:`,
              err.message
            )
          }
        }
      }
    } catch (err: any) {
      console.error(
        '[Lottery Daily] Error in settlement job:',
        err.message
      )
    }
  }).start()

  console.log('[Lottery Daily] Scheduler started')
}

function generateRandomNumber(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}
