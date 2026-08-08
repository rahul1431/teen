import { CronJob } from 'cron'
import { Pool } from 'pg'
import { payDailyLeaderboardRewards } from './rewards'

export function startLeaderboardRewardScheduler(db: Pool): void {
  console.log('[leaderboard-rewards] Leaderboard rewards disabled')
}
