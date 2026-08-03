import { CronJob } from 'cron'
import { pool } from '../../db/pool'
import { syncCurrentMatches } from '../../helpers/cricket-sync'
import { finalizeMatch } from '../../helpers/cricket-finalize'
import { tryConsumeApiCall } from './apiBudget'
import { createDefaultContests } from './contestFactory'

async function isAutomationEnabled(): Promise<boolean> {
  const res = await pool.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  return res.rows[0]?.special_rules?.auto_contests_enabled !== false
}

async function getSyncIntervalMinutes(): Promise<number> {
  const res = await pool.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const minutes = res.rows[0]?.special_rules?.match_sync_interval_minutes
  return typeof minutes === 'number' && minutes > 0 ? minutes : 15
}

// Both eligibility check and contest creation for one match, isolated so
// one bad match can't stop the rest of the tick.
async function autoCreateContestsIfEligible(matchId: string): Promise<void> {
  try {
    const matchRes = await pool.query('SELECT team_a, team_b FROM cricket_matches WHERE id = $1', [matchId])
    if (!matchRes.rows.length) return
    const { team_a, team_b } = matchRes.rows[0]
    const playersRes = await pool.query(
      'SELECT DISTINCT team_name FROM cricket_fantasy_players WHERE team_name = ANY($1)',
      [[team_a, team_b]],
    )
    const seededTeams = new Set(playersRes.rows.map((r: any) => r.team_name))
    if (!seededTeams.has(team_a) || !seededTeams.has(team_b)) {
      console.log(`[Cricket Automation] Skipping contest creation for match ${matchId} — no seeded squad for "${team_a}" and/or "${team_b}"`)
      return
    }
    const created = await createDefaultContests(pool, matchId)
    if (created > 0) console.log(`[Cricket Automation] Created ${created} contests for match ${matchId} (${team_a} vs ${team_b})`)
  } catch (err: any) {
    console.error(`[Cricket Automation] Error auto-creating contests for match ${matchId}:`, err.message)
  }
}

async function runTick(): Promise<void> {
  if (!(await isAutomationEnabled())) return

  if (!(await tryConsumeApiCall(pool))) {
    console.log('[Cricket Automation] Daily API budget exhausted — skipping this tick')
    return
  }

  let syncResult: { insertedIds: string[]; updatedCount: number }
  try {
    syncResult = await syncCurrentMatches(pool)
  } catch (err: any) {
    console.error('[Cricket Automation] Sync failed:', err.message)
    return
  }

  for (const matchId of syncResult.insertedIds) {
    await autoCreateContestsIfEligible(matchId)
  }

  const closedRes = await pool.query("SELECT id FROM cricket_matches WHERE status = 'closed'")
  for (const row of closedRes.rows) {
    if (!(await tryConsumeApiCall(pool))) {
      console.log('[Cricket Automation] Daily API budget exhausted mid-tick — remaining matches will finalize on a later tick')
      break
    }
    try {
      const res = await finalizeMatch(pool, row.id)
      console.log(`[Cricket Automation] Finalized match ${row.id}: ${res.settledLeagues} leagues, ₹${res.totalPaid} paid`)
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
