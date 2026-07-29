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
async function ensureDrawsForToday(): Promise<void> {
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
        // Draw already exists for this tier/date (unique constraint) — expected
      }
    }

    if (createdCount > 0) {
      console.log(`[Lottery Daily] Created ${createdCount} draws`)
    }
  } catch (err: any) {
    console.error('[Lottery Daily] Error creating draws:', err.message)
  }
}

export function startLotteryDailyScheduler(): void {
  // Job 1: Ensure every active tier has today's draw. Runs immediately on
  // startup (so a service restart mid-day self-heals) and every 15 minutes
  // (so a tier activated mid-day gets a draw without waiting for the next
  // midnight run). Idempotent — createDraw's unique constraint is caught
  // above, so re-running is a cheap no-op once a tier's draw exists.
  ensureDrawsForToday()
  new CronJob('*/15 * * * *', ensureDrawsForToday).start()

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
