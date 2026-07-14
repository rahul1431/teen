import { Pool } from 'pg'
import { aggregateScorecard, computeFantasyPoints, DEFAULT_SCORING_RULES, ScoringRules } from './fantasy-scoring'
import { cricApiFetch } from './cricapi-client'

// Polls cricapi's match_scorecard for every currently-live match and keeps
// fantasy points + contest leaderboards updating in near-real-time (Dream11
// itself polls its data vendor rather than truly streaming ball-by-ball, so
// a 2-minute cadence is the same class of "live" experience).
//
// This only updates points/ranks for display — it never pays out. Payout
// only happens via the explicit admin Finalize action once a match is over,
// same safety boundary the rest of this app's settlement code uses.
export class FantasyScoringPoller {
  private static readonly POLL_MS = 2 * 60 * 1000

  constructor(private db: Pool) {}

  start(): void {
    setInterval(() => {
      this.sweep().catch(err => console.error('[fantasy-scoring] sweep failed', err))
    }, FantasyScoringPoller.POLL_MS)
    console.log('[fantasy-scoring] poller started (every 2m)')
  }

  private async getRules(): Promise<ScoringRules> {
    const res = await this.db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
    const stored = res.rows[0]?.special_rules?.scoring_rules
    return stored ? { ...DEFAULT_SCORING_RULES, ...stored } : DEFAULT_SCORING_RULES
  }

  private async sweep(): Promise<void> {
    const matches = await this.db.query(
      `SELECT id, match_api_id FROM cricket_matches WHERE status = 'live' AND match_api_id IS NOT NULL`
    )
    if (!matches.rows.length) return
    const rules = await this.getRules()
    for (const m of matches.rows) {
      try {
        await this.updateMatch(m.id, m.match_api_id, rules)
      } catch (e) {
        console.error(`[fantasy-scoring] failed to update match ${m.id}`, e)
      }
    }
  }

  async updateMatch(matchId: string, matchApiId: string, rules: ScoringRules): Promise<void> {
    const data = await cricApiFetch(this.db, apiKey => `https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${matchApiId}`)
    if (data.status !== 'success' || !data.data?.scorecard) {
      // Same silent-failure gap as match-status-poller — surface it instead
      // of leaving fantasy points frozen with no trace of why.
      console.error(`[fantasy-scoring] ${matchId} CricAPI non-success response: ${JSON.stringify(data)}`)
      return
    }

    const statsByPlayer = aggregateScorecard(data.data.scorecard)
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      for (const stats of statsByPlayer.values()) {
        const points = computeFantasyPoints(rules, stats)
        // Only players already seeded (via squad sync) get scored — an
        // unmatched external_id means that player was never drafted into
        // any fantasy team, so there's nothing meaningful to update.
        const playerRes = await client.query('SELECT id FROM cricket_fantasy_players WHERE external_id = $1', [stats.playerId])
        if (!playerRes.rows.length) continue
        const playerId = playerRes.rows[0].id
        await client.query(
          `INSERT INTO cricket_match_players (match_id, player_id, runs_scored, balls_faced, fours, sixes, wickets, runs_conceded, overs_bowled, catches, stumpings, run_outs, fantasy_points)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (match_id, player_id) DO UPDATE SET
             runs_scored=$3, balls_faced=$4, fours=$5, sixes=$6, wickets=$7, runs_conceded=$8,
             overs_bowled=$9, catches=$10, stumpings=$11, run_outs=$12, fantasy_points=$13`,
          [matchId, playerId, stats.runs, stats.balls, stats.fours, stats.sixes, stats.wickets,
            stats.runsConceded, stats.overs, stats.catches, stats.stumpings, stats.runOuts, points],
        )
      }

      // Live leaderboard recompute (points only — no payout, no status change).
      const teamsRes = await client.query(`SELECT * FROM user_fantasy_teams WHERE match_id = $1`, [matchId])
      for (const team of teamsRes.rows) {
        let teamPoints = 0
        for (const pid of (team.player_ids as string[])) {
          const mpRes = await client.query('SELECT fantasy_points FROM cricket_match_players WHERE match_id = $1 AND player_id = $2', [matchId, pid])
          const base = Number(mpRes.rows[0]?.fantasy_points) || 0
          const mult = pid === team.captain_id ? rules.captainMultiplier : pid === team.vice_captain_id ? rules.viceCaptainMultiplier : 1.0
          teamPoints += base * mult
        }
        await client.query(`UPDATE user_fantasy_teams SET points_total = $1 WHERE id = $2`, [teamPoints, team.id])
      }
      await client.query(
        `UPDATE cricket_fantasy_entries e SET points = t.points_total FROM user_fantasy_teams t WHERE e.team_id = t.id AND t.match_id = $1`,
        [matchId],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}
