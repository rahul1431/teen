import { Pool } from 'pg'
import { settleFantasyLeague } from './cricket'
import { aggregateScorecard, computeFantasyPoints, DEFAULT_SCORING_RULES } from './fantasy-scoring'
import { cricApiFetch } from './cricapi-client'

// Dream11-style finalize: pulls a match's final scorecard, computes every
// drafted player's points via the scoring rulebook, then settles every
// open league on the match. Shared by the admin's manual "Finalize" button
// and the automatic scheduler (cricket/scheduler.ts) — one implementation.
export async function finalizeMatch(db: Pool, matchId: string) {
  const matchRes = await db.query('SELECT match_api_id FROM cricket_matches WHERE id = $1', [matchId])
  if (!matchRes.rows.length || !matchRes.rows[0].match_api_id) {
    throw new Error('Match has no linked external match — cannot fetch a scorecard to finalize from')
  }

  const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const rules = configRes.rows[0]?.special_rules?.scoring_rules
    ? { ...DEFAULT_SCORING_RULES, ...configRes.rows[0].special_rules.scoring_rules }
    : DEFAULT_SCORING_RULES

  const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${matchRes.rows[0].match_api_id}`)
  if (data.status !== 'success' || !data.data?.scorecard) {
    throw new Error(`Could not fetch final scorecard: ${data.reason || 'unknown error'}`)
  }

  const statsByPlayer = aggregateScorecard(data.data.scorecard)
  const playerPoints: Record<string, number> = {}
  for (const stats of statsByPlayer.values()) {
    const pRes = await db.query('SELECT id FROM cricket_fantasy_players WHERE external_id = $1', [stats.playerId])
    if (!pRes.rows.length) continue
    playerPoints[pRes.rows[0].id] = computeFantasyPoints(rules, stats)
  }

  const result = await settleFantasyLeague(db, matchId, playerPoints)
  return { ...result, playersScored: Object.keys(playerPoints).length }
}
