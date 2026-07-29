import { Pool } from 'pg'

// Free CricAPI/CricketData.org keys are capped at 100 hits/day EACH — with
// several live matches polling every few minutes, a single key burns
// through that in well under an hour. Rather than paying for a higher
// tier, this spreads calls round-robin across a configurable pool of free
// keys and automatically fails over to the next key if one comes back
// rate-limited, instead of the whole sync just failing for the day.
//
// Configure via game_configs.special_rules.api_keys: string[] (falls back
// to the legacy single api_key, then to the original hardcoded free key).
let rrIndex = 0

async function getKeyPool(db: Pool): Promise<string[]> {
  const res = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const rules = res.rows[0]?.special_rules
  if (Array.isArray(rules?.api_keys) && rules.api_keys.length) return rules.api_keys
  if (rules?.api_key) return [rules.api_key]
  return ['dd511ce4-aeb7-4e1f-86f4-1160404b2776']
}

function isRateLimited(data: any): boolean {
  return typeof data?.reason === 'string' && /block|limit/i.test(data.reason)
}

// buildUrl receives the chosen key and must return the full request URL.
// Tries each key in the pool (starting from the next one round-robin) until
// one succeeds or isn't rate-limited; returns the last result if all fail.
export async function cricApiFetch(db: Pool, buildUrl: (apiKey: string) => string): Promise<any> {
  const keys = await getKeyPool(db)
  const startIndex = rrIndex
  let lastResult: any = { status: 'failure', reason: 'No CricAPI keys configured' }
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(startIndex + i) % keys.length]
    try {
      const data = await (await fetch(buildUrl(key))).json() as any
      rrIndex = (startIndex + i + 1) % keys.length
      if (data.status === 'success' || !isRateLimited(data)) return data
      lastResult = data // rate-limited on this key — try the next one in the pool
    } catch (e: any) {
      lastResult = { status: 'failure', reason: e?.message || 'Network error' }
    }
  }
  return lastResult
}
