import { Pool } from 'pg'
import { Logger } from 'pino'

/**
 * Behavioral Cloning (Imitation Learning from Top 5% Human Winners)
 * 
 * Mines historical game records and per-decision telemetry to clone the exact
 * action distributions (fold, call, raise, aggression, and latency) of elite
 * profitable human players into bot policy profiles.
 */

export interface ElitePlayerStat {
  userId: string;
  gamesPlayed: number;
  netProfit: number;
  winRatePct: number;
}

export interface BehavioralCloneResult {
  gameType: string;
  topPercentileCutoff: number;
  playersAnalyzed: number;
  elitePlayerCount: number;
  elitePlayerIds: string[];
  decisionsExtracted: number;
  extractedDistribution: {
    fold_rate: number;
    call_rate: number;
    raise_rate: number;
    aggression_score: number;
  };
  clonedProfiles: {
    hard: {
      fold_probability: number;
      call_probability: number;
      raise_probability: number;
      aggression_score: number;
      win_rate_target: number;
      avg_decision_delay_ms: number;
    };
    medium: {
      fold_probability: number;
      call_probability: number;
      raise_probability: number;
      aggression_score: number;
      win_rate_target: number;
      avg_decision_delay_ms: number;
    };
  };
}

// Enterprise Shark priors (used for Dirichlet smoothing when sample size is low)
const SHARK_PRIORS = {
  fold_rate: 0.24,
  call_rate: 0.44,
  raise_rate: 0.32,
  aggression_score: 0.75,
};

export async function cloneEliteTeenPattiPlayers(
  pool: Pool,
  logger: Logger,
  topPercentile: number = 5,
  minGames: number = 1
): Promise<BehavioralCloneResult> {
  // 1. Identify human players ranked by net profit
  const playersRes = await pool.query(
    `SELECT
       gp.user_id,
       COUNT(gp.id)::int AS games_played,
       SUM(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee)) AS net_profit,
       COUNT(CASE WHEN gp.prize_won > COALESCE(gp.entry_fee_deducted, gr.entry_fee) THEN 1 END)::int AS wins
     FROM game_participants gp
     JOIN game_rooms gr ON gr.id = gp.room_id
     JOIN users u ON u.id = gp.user_id
     WHERE gr.game_type = 'teen_patti'
       AND u.is_bot = false
     GROUP BY gp.user_id
     HAVING COUNT(gp.id) >= $1
     ORDER BY net_profit DESC`,
    [minGames]
  )

  const allPlayers = playersRes.rows
  const totalCount = allPlayers.length

  // Select top N% (at least 1 player if any exist)
  const eliteCount = Math.max(1, Math.ceil(totalCount * (topPercentile / 100)))
  const elitePlayers = allPlayers.slice(0, eliteCount)
  const eliteIds = elitePlayers.map(p => p.user_id)

  logger.info(
    { totalPlayers: totalCount, eliteCount, topPercentile },
    'Identified elite human player cohort for Behavioral Cloning'
  )

  // 2. Extract decisions of elite players from teen_patti_move_decisions
  let decisionsExtracted = 0
  let rawFoldRate = SHARK_PRIORS.fold_rate
  let rawCallRate = SHARK_PRIORS.call_rate
  let rawRaiseRate = SHARK_PRIORS.raise_rate

  if (eliteIds.length > 0) {
    const decisionsRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total_decisions,
         COUNT(*) FILTER (WHERE action = 'fold')::int AS folds,
         COUNT(*) FILTER (WHERE action = 'call')::int AS calls,
         COUNT(*) FILTER (WHERE action = 'raise')::int AS raises
       FROM teen_patti_move_decisions
       WHERE user_id = ANY($1)`,
      [eliteIds]
    )

    const dRow = decisionsRes.rows[0]
    decisionsExtracted = parseInt(dRow?.total_decisions || '0', 10)

    if (decisionsExtracted > 0) {
      // Empirical Bayes Dirichlet blend (weighting sample size against prior)
      const priorWeight = 20
      const totalWeight = decisionsExtracted + priorWeight

      rawFoldRate = (dRow.folds + SHARK_PRIORS.fold_rate * priorWeight) / totalWeight
      rawCallRate = (dRow.calls + SHARK_PRIORS.call_rate * priorWeight) / totalWeight
      rawRaiseRate = (dRow.raises + SHARK_PRIORS.raise_rate * priorWeight) / totalWeight

      // Normalize
      const sum = rawFoldRate + rawCallRate + rawRaiseRate
      rawFoldRate = Math.round((rawFoldRate / sum) * 10000) / 10000
      rawCallRate = Math.round((rawCallRate / sum) * 10000) / 10000
      rawRaiseRate = Math.round((1 - rawFoldRate - rawCallRate) * 10000) / 10000
    }
  }

  const aggression = Math.round((rawRaiseRate / (rawCallRate + rawFoldRate)) * 1000) / 100

  // 3. Derive cloned profiles
  const clonedProfiles = {
    hard: {
      fold_probability: rawFoldRate,
      call_probability: rawCallRate,
      raise_probability: rawRaiseRate,
      aggression_score: aggression,
      win_rate_target: 52.0,
      avg_decision_delay_ms: 2000,
    },
    medium: {
      fold_probability: Math.round((rawFoldRate + 0.08) * 10000) / 10000,
      call_probability: Math.round((rawCallRate + 0.02) * 10000) / 10000,
      raise_probability: Math.round((rawRaiseRate - 0.10) * 10000) / 10000,
      aggression_score: Math.round((aggression * 0.65) * 100) / 100,
      win_rate_target: 40.0,
      avg_decision_delay_ms: 2400,
    },
  }

  return {
    gameType: 'teen_patti',
    topPercentileCutoff: topPercentile,
    playersAnalyzed: totalCount,
    elitePlayerCount: eliteIds.length,
    elitePlayerIds: eliteIds,
    decisionsExtracted,
    extractedDistribution: {
      fold_rate: rawFoldRate,
      call_rate: rawCallRate,
      raise_rate: rawRaiseRate,
      aggression_score: aggression,
    },
    clonedProfiles,
  }
}

