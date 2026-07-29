// Dream11-style fantasy scoring — point values match Dream11's publicly
// documented T20 Fantasy Points System. Computed automatically from
// cricapi.com's /v1/match_scorecard response (verified live: it returns
// full batting/bowling/fielding stats per player, keyed by the same player
// IDs squad sync already stores as cricket_fantasy_players.external_id).
export interface ScoringRules {
  runPoint: number
  boundaryBonus: number
  sixBonus: number
  bonus25Runs: number
  bonus50Runs: number
  bonus75Runs: number
  bonus100Runs: number
  duckPenalty: number
  // Strike-rate bonus/penalty only applies once a batter has faced this many balls.
  srMinBalls: number
  // Sorted ascending by max; max: null on the last entry means "and above"
  // (NOT Infinity — that doesn't survive JSON.stringify when this rulebook
  // round-trips through the admin API / game_configs.special_rules).
  srBands: { max: number | null; points: number }[]

  wicketPoints: number
  bonus4Wickets: number
  bonus5Wickets: number
  maidenOverPoints: number
  bowledLbwBonus: number
  // Economy bonus/penalty only applies once a bowler has sent down this many overs.
  ecoMinOvers: number
  ecoBands: { max: number | null; points: number }[]

  catchPoints: number
  bonus3Catches: number
  stumpingPoints: number
  runOutPoints: number

  captainMultiplier: number
  viceCaptainMultiplier: number
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  runPoint: 1,
  boundaryBonus: 1,
  sixBonus: 2,
  bonus25Runs: 4,
  bonus50Runs: 8,
  bonus75Runs: 12,
  bonus100Runs: 16,
  duckPenalty: -2,
  srMinBalls: 10,
  srBands: [
    { max: 50, points: -6 },
    { max: 60, points: -4 },
    { max: 70, points: -2 },
    { max: 130, points: 0 },
    { max: 150, points: 2 },
    { max: 170, points: 4 },
    { max: null, points: 6 },
  ],

  wicketPoints: 25,
  bonus4Wickets: 8,
  bonus5Wickets: 16,
  maidenOverPoints: 12,
  bowledLbwBonus: 8,
  ecoMinOvers: 2,
  ecoBands: [
    { max: 5, points: 6 },
    { max: 6, points: 4 },
    { max: 7, points: 2 },
    { max: 10, points: 0 },
    { max: 11, points: -2 },
    { max: 12, points: -4 },
    { max: null, points: -6 },
  ],

  catchPoints: 8,
  bonus3Catches: 4,
  stumpingPoints: 12,
  runOutPoints: 12,

  captainMultiplier: 2.0,
  viceCaptainMultiplier: 1.5,
}

export interface PlayerMatchStats {
  playerId: string
  name: string
  runs: number
  balls: number
  fours: number
  sixes: number
  dismissedForDuck: boolean
  wickets: number
  overs: number // decimal overs (e.g. 3.4 = 3 overs 4 balls) as cricapi reports it
  maidens: number
  runsConceded: number
  bowledOrLbwDismissals: number
  catches: number
  stumpings: number
  runOuts: number
}

/** Aggregates cricapi's match_scorecard `data.scorecard` (one entry per innings)
 *  into one stat line per player across the whole match. */
export function aggregateScorecard(scorecard: any[]): Map<string, PlayerMatchStats> {
  const byPlayer = new Map<string, PlayerMatchStats>()
  const get = (id: string, name: string): PlayerMatchStats => {
    let s = byPlayer.get(id)
    if (!s) {
      s = { playerId: id, name, runs: 0, balls: 0, fours: 0, sixes: 0, dismissedForDuck: false,
        wickets: 0, overs: 0, maidens: 0, runsConceded: 0, bowledOrLbwDismissals: 0,
        catches: 0, stumpings: 0, runOuts: 0 }
      byPlayer.set(id, s)
    }
    return s
  }

  for (const innings of (scorecard || [])) {
    for (const b of (innings.batting || [])) {
      if (!b.batsman?.id) continue
      const s = get(b.batsman.id, b.batsman.name)
      s.runs += Number(b.r) || 0
      s.balls += Number(b.b) || 0
      s.fours += Number(b['4s']) || 0
      s.sixes += Number(b['6s']) || 0
      if ((Number(b.r) || 0) === 0 && b.dismissal && b.dismissal !== 'not out') s.dismissedForDuck = true
    }
    for (const bw of (innings.bowling || [])) {
      if (!bw.bowler?.id) continue
      const s = get(bw.bowler.id, bw.bowler.name)
      s.wickets += Number(bw.w) || 0
      s.overs += Number(bw.o) || 0
      s.maidens += Number(bw.m) || 0
      s.runsConceded += Number(bw.r) || 0
    }
    // "catching" is cricapi's per-dismissal fielding credit list — one entry
    // per wicket that fell, crediting whoever's involved (catcher/stumper).
    // It doesn't distinguish a direct-hit run-out from an assisted one, so
    // every credited run-out gets the same flat bonus (documented simplification).
    for (const c of (innings.catching || [])) {
      if (!c.catcher?.id) continue
      const s = get(c.catcher.id, c.catcher.name)
      if (Number(c.catch) > 0) s.catches += Number(c.catch)
      if (Number(c.stumped) > 0) s.stumpings += Number(c.stumped)
      if (Number(c.runout) > 0) s.runOuts += Number(c.runout)
    }
    // Bowled/LBW bonus: derive from batting dismissal text since bowling
    // entries don't carry dismissal type directly.
    for (const b of (innings.batting || [])) {
      if (!b.bowler?.id) continue
      if (b.dismissal === 'bowled' || b.dismissal === 'lbw') {
        const s = get(b.bowler.id, b.bowler.name)
        s.bowledOrLbwDismissals += 1
      }
    }
  }
  return byPlayer
}

function bandPoints(value: number, bands: { max: number | null; points: number }[]): number {
  for (const band of bands) if (band.max === null || value < band.max) return band.points
  return bands[bands.length - 1]?.points ?? 0
}

export function computeFantasyPoints(rules: ScoringRules, s: PlayerMatchStats): number {
  let pts = 0

  // Batting
  pts += s.runs * rules.runPoint
  pts += s.fours * rules.boundaryBonus
  pts += s.sixes * rules.sixBonus
  if (s.runs >= 100) pts += rules.bonus100Runs
  else if (s.runs >= 75) pts += rules.bonus75Runs
  else if (s.runs >= 50) pts += rules.bonus50Runs
  else if (s.runs >= 25) pts += rules.bonus25Runs
  if (s.dismissedForDuck) pts += rules.duckPenalty
  if (s.balls >= rules.srMinBalls) {
    const sr = (s.runs / s.balls) * 100
    pts += bandPoints(sr, rules.srBands)
  }

  // Bowling
  pts += s.wickets * rules.wicketPoints
  if (s.wickets >= 5) pts += rules.bonus5Wickets
  else if (s.wickets >= 4) pts += rules.bonus4Wickets
  pts += s.maidens * rules.maidenOverPoints
  pts += s.bowledOrLbwDismissals * rules.bowledLbwBonus
  if (s.overs >= rules.ecoMinOvers) {
    // cricapi overs are "o.b" (e.g. 3.4 = 3 overs, 4 balls) — convert to balls for accurate economy.
    const wholeOvers = Math.floor(s.overs)
    const extraBalls = Math.round((s.overs - wholeOvers) * 10)
    const totalBalls = wholeOvers * 6 + extraBalls
    const economy = totalBalls > 0 ? (s.runsConceded / totalBalls) * 6 : 0
    pts += bandPoints(economy, rules.ecoBands)
  }

  // Fielding
  pts += s.catches * rules.catchPoints
  if (s.catches >= 3) pts += rules.bonus3Catches
  pts += s.stumpings * rules.stumpingPoints
  pts += s.runOuts * rules.runOutPoints

  return Math.round(pts * 100) / 100
}
