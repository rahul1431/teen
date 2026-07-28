import { CronJob } from 'cron'
import { Pool } from 'pg'
import { payDailyLeaderboardRewards } from './rewards'

export function startLeaderboardRewardScheduler(db: Pool): void {
  const runForYesterday = () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    payDailyLeaderboardRewards(db, yesterday).catch(err =>
      console.error('[leaderboard-rewards] Scheduled run failed:', err)
    )
  }

  // Runs once on startup — a restart that missed the midnight window
  // self-heals here, and it's a harmless no-op if yesterday was already paid
  // (deterministic idempotency key) — plus daily at 00:05, once the previous
  // day's games have had a few minutes to settle.
  runForYesterday()
  new CronJob('5 0 * * *', runForYesterday).start()

  console.log('[leaderboard-rewards] Scheduler started')
}
