import { Pool } from 'pg'

const DEFAULT_DAILY_BUDGET = 300

export async function getApiDailyBudget(db: Pool): Promise<number> {
  const res = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const budget = res.rows[0]?.special_rules?.api_daily_budget
  return typeof budget === 'number' && budget > 0 ? budget : DEFAULT_DAILY_BUDGET
}

// Atomically records one CricAPI call against today's usage and reports
// whether it's within budget. The increment happens unconditionally (so
// concurrent callers never double-count the same slot); the caller must
// check the returned boolean BEFORE actually firing the CricAPI request —
// a false return means this call should be skipped, not made.
export async function tryConsumeApiCall(db: Pool): Promise<boolean> {
  const budget = await getApiDailyBudget(db)
  const res = await db.query(
    `INSERT INTO cricket_api_usage (usage_date, calls_used) VALUES (CURRENT_DATE, 1)
     ON CONFLICT (usage_date) DO UPDATE SET calls_used = cricket_api_usage.calls_used + 1
     RETURNING calls_used`,
  )
  return res.rows[0].calls_used <= budget
}
