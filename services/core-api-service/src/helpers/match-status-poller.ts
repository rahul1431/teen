import { Pool } from 'pg'

// Nothing used to flip a match from 'upcoming' to 'live' once its scheduled
// start_time arrived — that only happened via an admin manually setting it
// in the Live Console, or "Sync Matches" happening to match it against
// CricAPI's currentMatches feed (which doesn't always surface bilateral
// series matches). Matches were getting stuck showing a countdown in
// Upcoming Fixtures long after they'd actually started.
//
// This sweep checks every 'upcoming' match whose start_time has passed:
// first tries to confirm via CricAPI's match_info (accurate through toss/
// rain delays), and if that call fails or is rate-limited, falls back to
// a time-based flip after a grace period so a match never gets stuck
// waiting on an API that might be unavailable.
export class MatchStatusPoller {
  private static readonly POLL_MS = 2 * 60 * 1000
  private static readonly GRACE_MS = 10 * 60 * 1000

  constructor(private db: Pool) {}

  start(): void {
    setInterval(() => {
      this.sweep().catch(err => console.error('[match-status] sweep failed', err))
    }, MatchStatusPoller.POLL_MS)
    console.log('[match-status] poller started (every 2m)')
  }

  private async getApiKey(): Promise<string> {
    const res = await this.db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
    return res.rows[0]?.special_rules?.api_key || 'dd511ce4-aeb7-4e1f-86f4-1160404b2776'
  }

  private async sweep(): Promise<void> {
    const matches = await this.db.query(
      `SELECT id, match_api_id, start_time FROM cricket_matches WHERE status = 'upcoming' AND start_time <= NOW()`
    )
    if (!matches.rows.length) return
    const apiKey = await this.getApiKey()
    for (const m of matches.rows) {
      try {
        await this.checkMatch(m, apiKey)
      } catch (e) {
        console.error(`[match-status] failed to check match ${m.id}`, e)
      }
    }
  }

  private async checkMatch(m: { id: string; match_api_id: string | null; start_time: string }, apiKey: string): Promise<void> {
    if (m.match_api_id) {
      try {
        const data = await (await fetch(`https://api.cricapi.com/v1/match_info?apikey=${apiKey}&id=${m.match_api_id}`)).json() as any
        if (data.status === 'success' && data.data) {
          const status = data.data.matchEnded ? 'settled' : data.data.matchStarted ? 'live' : null
          if (status) {
            await this.db.query('UPDATE cricket_matches SET status = $1 WHERE id = $2', [status, m.id])
            console.log(`[match-status] ${m.id} -> ${status} (confirmed via CricAPI)`)
          }
          return
        }
      } catch (e) {
        console.error(`[match-status] CricAPI check failed for ${m.id}, falling back to time-based flip`, e)
      }
    }

    // No match_api_id, or the API call failed/was rate-limited — fall back
    // to a time-based flip once the grace period has passed, rather than
    // leaving the match stuck showing a stale countdown indefinitely.
    const startedMs = new Date(m.start_time).getTime()
    if (Date.now() - startedMs >= MatchStatusPoller.GRACE_MS) {
      await this.db.query(`UPDATE cricket_matches SET status = 'live' WHERE id = $1`, [m.id])
      console.log(`[match-status] ${m.id} -> live (time-based fallback)`)
    }
  }
}
