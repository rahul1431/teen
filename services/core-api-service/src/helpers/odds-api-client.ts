import { Pool } from 'pg'

const ODDS_API_KEY = process.env.ODDS_API_KEY || ''

interface OddsOutcome {
  name: string
  price: number
}

interface OddsMarket {
  key: string
  outcomes: OddsOutcome[]
}

interface OddsBookmaker {
  key: string
  title: string
  markets: OddsMarket[]
}

interface OddsEvent {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsBookmaker[]
}

// Helper to fuzzy match team names
function teamMatches(dbName: string, apiName: string): boolean {
  const cleanDb = dbName.toLowerCase().replace(/[^a-z0-9]/g, '')
  const cleanApi = apiName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return cleanDb.includes(cleanApi) || cleanApi.includes(cleanDb)
}

export async function syncMatchOdds(db: Pool): Promise<void> {
  if (!ODDS_API_KEY) {
    console.log('[Odds Sync] Skipping odds sync: ODDS_API_KEY not configured')
    return
  }

  // 1. Fetch active sports keys dynamically
  let sportsKeys: string[] = []
  try {
    const sportsUrl = `https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`
    const sportsRes = await fetch(sportsUrl)
    if (!sportsRes.ok) {
      console.error(`[Odds Sync] Failed to fetch sports list: ${sportsRes.statusText}`)
      return
    }
    const sportsList = await sportsRes.json() as any[]
    if (Array.isArray(sportsList)) {
      sportsKeys = sportsList
        .filter(s => s.active && !s.key.includes('winner') && !s.key.includes('championship') && !s.key.includes('outright'))
        .map(s => s.key)
    }
  } catch (err: any) {
    console.error('[Odds Sync] Error fetching sports keys:', err.message)
    return
  }

  if (!sportsKeys.length) return

  // Query The Odds API for each active sport
  for (const sport of sportsKeys) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=us,uk,au&markets=h2h`
      const res = await fetch(url)
      if (!res.ok) {
        console.error(`[Odds Sync] Failed to fetch odds for ${sport}: ${res.statusText}`)
        continue
      }

      const events = (await res.json()) as OddsEvent[]
      if (!Array.isArray(events)) continue

      for (const event of events) {
        const now = new Date()
        const commenceTime = new Date(event.commence_time)
        const initialStatus = commenceTime > now ? 'upcoming' : 'live'

        // Check if there is already a closed or settled match in the database for this match_api_id
        const existingRes = await db.query(
          "SELECT status FROM cricket_matches WHERE match_api_id = $1",
          [event.id]
        )
        if (existingRes.rows.length > 0 && ['closed', 'settled'].includes(existingRes.rows[0].status)) {
          continue
        }

        // Upsert match record
        const matchUpsert = await db.query(
          `INSERT INTO cricket_matches (series, format, team_a, team_b, start_time, match_api_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (match_api_id) 
           DO UPDATE SET series = EXCLUDED.series, start_time = EXCLUDED.start_time
           RETURNING id`,
          [event.sport_title, event.sport_key, event.home_team, event.away_team, event.commence_time, event.id, initialStatus]
        )
        const matchId = matchUpsert.rows[0].id

        // Get outcomes from first bookmaker that has h2h market
        const bookmaker = event.bookmakers?.[0]
        const market = bookmaker?.markets?.find(m => m.key === 'h2h')
        const outcomes = market?.outcomes
        if (!outcomes || outcomes.length < 2) continue

        // Map outcomes to match teams
        const options = outcomes.map((o, idx) => {
          let key = 'draw'
          if (teamMatches(event.home_team, o.name)) {
            key = 'team_a'
          } else if (teamMatches(event.away_team, o.name)) {
            key = 'team_b'
          } else {
            key = `option_${idx}`
          }
          return {
            key,
            label: o.name,
            odds: Number(o.price),
          }
        })

        // Upsert the match_winner market
        const marketLabel = `${event.home_team} vs ${event.away_team} - Match Winner`
        await db.query(
          `INSERT INTO cricket_markets (match_id, market_type, label, options, status)
           VALUES ($1, 'match_winner', $2, $3, 'open')
           ON CONFLICT (match_id, market_type) 
           DO UPDATE SET options = EXCLUDED.options, label = EXCLUDED.label
           WHERE cricket_markets.status = 'open'`,
          [matchId, marketLabel, JSON.stringify(options)]
        )
      }
    } catch (err: any) {
      console.error(`[Odds Sync] Error syncing sport ${sport}:`, err.message)
    }
  }
}

export async function syncMatchResults(db: Pool): Promise<void> {
  if (!ODDS_API_KEY) return

  // Find unique active sport formats currently waiting for score settlement
  const activeMatches = await db.query(
    `SELECT DISTINCT format AS sport_key 
     FROM cricket_matches 
     WHERE status IN ('upcoming', 'live') AND start_time <= NOW() AND match_api_id IS NOT NULL`
  )
  if (!activeMatches.rows.length) return

  for (const row of activeMatches.rows) {
    const sportKey = row.sport_key
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`
      const res = await fetch(url)
      if (!res.ok) {
        console.error(`[Results Sync] Failed to fetch scores for ${sportKey}: ${res.statusText}`)
        continue
      }

      const events = await res.json() as any[]
      if (!Array.isArray(events)) continue

      for (const event of events) {
        if (!event.completed) continue

        // Check if we have this match pending settlement
        const dbMatchRes = await db.query(
          "SELECT id, team_a, team_b FROM cricket_matches WHERE match_api_id = $1 AND status IN ('upcoming', 'live')",
          [event.id]
        )
        if (!dbMatchRes.rows.length) continue
        const match = dbMatchRes.rows[0]

        const scores = event.scores
        if (!Array.isArray(scores) || scores.length < 2) continue

        const scoreA = Number(scores.find(s => teamMatches(match.team_a, s.name))?.score ?? 0)
        const scoreB = Number(scores.find(s => teamMatches(match.team_b, s.name))?.score ?? 0)

        let winner: string | null = null
        if (scoreA > scoreB) {
          winner = match.team_a
        } else if (scoreB > scoreA) {
          winner = match.team_b
        }

        console.log(`[Results Sync] Match ${match.id} completed. Winner: ${winner} (Score: ${scoreA} - ${scoreB})`)

        // Update match status to closed and record result winner
        await db.query(
          "UPDATE cricket_matches SET status = 'closed', result_winner = $1 WHERE id = $2",
          [winner, match.id]
        )
      }
    } catch (err: any) {
      console.error(`[Results Sync] Error syncing results for ${sportKey}:`, err.message)
    }
  }
}
