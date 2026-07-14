import { Pool } from 'pg'
import { cricApiFetch } from './cricapi-client'

// Nothing used to flip a match from 'upcoming' to 'live' once its scheduled
// start_time arrived — that only happened via an admin manually setting it
// in the Live Console, or "Sync Matches" happening to match it against
// CricAPI's currentMatches feed (which doesn't always surface bilateral
// series matches). Matches were getting stuck showing a countdown in
// Upcoming Fixtures long after they'd actually started, and the live
// runs/wickets scoreboard stayed blank until an admin typed it in by hand.
//
// This sweep covers both, off a single CricAPI call per match per cycle
// (deliberately not two, to go easy on the free-tier rate limit):
// - 'upcoming' matches past their start_time: confirm via match_info
//   (accurate through toss/rain delays), falling back to a time-based flip
//   after a grace period if the API call fails or is rate-limited.
// - 'live' matches: refresh live_score from the same match_info response,
//   and flip to 'settled' once CricAPI confirms matchEnded.
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

  private async sweep(): Promise<void> {
    const matches = await this.db.query(
      `SELECT id, match_api_id, start_time, status FROM cricket_matches
       WHERE (status = 'upcoming' AND start_time <= NOW())
          OR (status = 'live' AND match_api_id IS NOT NULL)`
    )
    if (!matches.rows.length) return
    for (const m of matches.rows) {
      try {
        await this.checkMatch(m)
      } catch (e) {
        console.error(`[match-status] failed to check match ${m.id}`, e)
      }
    }
  }

  private async checkMatch(m: { id: string; match_api_id: string | null; start_time: string; status: string }): Promise<void> {
    if (m.match_api_id) {
      try {
        const data = await cricApiFetch(this.db, apiKey => `https://api.cricapi.com/v1/match_info?apikey=${apiKey}&id=${m.match_api_id}`)
        if (data.status === 'success' && data.data) {
          const newStatus = data.data.matchEnded ? 'settled' : data.data.matchStarted ? 'live' : null
          const scoreArr = data.data.score
          const liveScore = scoreArr?.length
            ? { runs: scoreArr.at(-1).r, wickets: scoreArr.at(-1).w, overs: scoreArr.at(-1).o, description: data.data.status }
            : null

          const fields: string[] = [], params: any[] = [m.id]
          let i = 2
          if (newStatus && newStatus !== m.status) { fields.push(`status = $${i++}`); params.push(newStatus) }
          if (liveScore) { fields.push(`live_score = $${i++}`); params.push(JSON.stringify(liveScore)) }
          if (fields.length) {
            await this.db.query(`UPDATE cricket_matches SET ${fields.join(', ')} WHERE id = $1`, params)
            console.log(`[match-status] ${m.id} updated (${fields.join(', ')})`)
          }
          return
        }
      } catch (e) {
        console.error(`[match-status] CricAPI check failed for ${m.id}`, e)
      }
    }

    // No match_api_id, or the API call failed/was rate-limited — only the
    // upcoming->live transition has a time-based fallback (there's no safe
    // fallback for live_score or for detecting a match has ended).
    if (m.status !== 'upcoming') return
    const startedMs = new Date(m.start_time).getTime()
    if (Date.now() - startedMs >= MatchStatusPoller.GRACE_MS) {
      await this.db.query(`UPDATE cricket_matches SET status = 'live' WHERE id = $1`, [m.id])
      console.log(`[match-status] ${m.id} -> live (time-based fallback)`)
    }
  }
}
