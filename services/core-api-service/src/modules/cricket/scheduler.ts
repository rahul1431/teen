import { CronJob } from 'cron'
import { pool } from '../../db/pool'
import { syncCurrentMatches } from '../../helpers/cricket-sync'
import { finalizeMatch } from '../../helpers/cricket-finalize'
import { syncMatchOdds, syncMatchResults } from '../../helpers/odds-api-client'
import { tryConsumeApiCall } from './apiBudget'

async function isAutomationEnabled(): Promise<boolean> {
  const res = await pool.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  return res.rows[0]?.special_rules?.auto_contests_enabled !== false
}

async function getSyncIntervalMinutes(): Promise<number> {
  const res = await pool.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const minutes = res.rows[0]?.special_rules?.match_sync_interval_minutes
  return typeof minutes === 'number' && minutes > 0 ? minutes : 15
}

async function runTick(): Promise<void> {
  if (!(await isAutomationEnabled())) return

  if (!(await tryConsumeApiCall(pool))) {
    console.log('[Cricket Automation] Daily API budget exhausted — skipping this tick')
    return
  }

  // 1. Sync match list and status updates from CricAPI
  let syncResult: { insertedIds: string[]; updatedCount: number }
  try {
    syncResult = await syncCurrentMatches(pool)
    console.log(`[Cricket Automation] Synced matches: ${syncResult.insertedIds.length} new, ${syncResult.updatedCount} updated`)
  } catch (err: any) {
    console.error('[Cricket Automation] Match list sync failed:', err.message)
  }

  // 2. Sync match-winner odds from The Odds API
  try {
    await syncMatchOdds(pool)
    console.log('[Cricket Automation] Match odds sync completed successfully')
  } catch (err: any) {
    console.error('[Cricket Automation] Odds sync failed:', err.message)
  }

  // 2.5. Sync match results/scores from The Odds API to auto-settle completed matches
  try {
    await syncMatchResults(pool)
    console.log('[Cricket Automation] Match results sync completed successfully')
  } catch (err: any) {
    console.error('[Cricket Automation] Match results sync failed:', err.message)
  }

  // 3. Auto-finalize bets for closed matches
  const closedRes = await pool.query("SELECT id FROM cricket_matches WHERE status = 'closed'")
  for (const row of closedRes.rows) {
    if (!(await tryConsumeApiCall(pool))) {
      console.log('[Cricket Automation] Daily API budget exhausted mid-tick — remaining matches will finalize on a later tick')
      break
    }
    try {
      const res = await finalizeMatch(pool, row.id)
      console.log(`[Cricket Automation] Finalized match ${row.id}: ${res.settledBets} bets settled. Winner: ${res.resultWinner}`)
    } catch (err: any) {
      console.error(`[Cricket Automation] Finalize failed for match ${row.id} (will retry next tick):`, err.message)
    }
  }
}

export async function startCricketAutomationScheduler(): Promise<void> {
  const minutes = await getSyncIntervalMinutes()
  runTick()
  new CronJob(`*/${minutes} * * * *`, runTick).start()
  console.log(`[Cricket Automation] Scheduler started (every ${minutes} min)`)
}
