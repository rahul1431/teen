import { Pool } from 'pg'
import { Logger } from 'pino'

/**
 * Ludo Behavioral Cloning (Imitation Learning from Top 5% Human Winners)
 * 
 * Mines historical Ludo match winners and per-decision move telemetry
 * (ludo_move_decisions) to clone the capture urgency and safe-square habits
 * of elite human players into bot policy profiles.
 */

export interface LudoBehavioralCloneResult {
  gameType: string;
  topPercentileCutoff: number;
  playersAnalyzed: number;
  elitePlayerCount: number;
  elitePlayerIds: string[];
  decisionsExtracted: number;
  extractedDistribution: {
    capture_rate: number;
    safe_play_rate: number;
  };
  clonedProfiles: {
    hard: {
      capture_probability: number;
      safe_play_probability: number;
      win_rate_target: number;
      avg_decision_delay_ms: number;
    };
    medium: {
      capture_probability: number;
      safe_play_probability: number;
      win_rate_target: number;
      avg_decision_delay_ms: number;
    };
  };
}

const LUDO_SHARK_PRIORS = {
  capture_rate: 0.95,
  safe_play_rate: 0.88,
};

export async function cloneEliteLudoPlayers(
  pool: Pool,
  logger: Logger,
  topPercentile: number = 5,
  minGames: number = 1
): Promise<LudoBehavioralCloneResult> {
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
     WHERE gr.game_type = 'ludo'
       AND u.is_bot = false
     GROUP BY gp.user_id
     HAVING COUNT(gp.id) >= $1
     ORDER BY net_profit DESC`,
    [minGames]
  )

  const allPlayers = playersRes.rows
  const totalCount = allPlayers.length

  const eliteCount = Math.max(1, Math.ceil(totalCount * (topPercentile / 100)))
  const elitePlayers = allPlayers.slice(0, eliteCount)
  const eliteIds = elitePlayers.map(p => p.user_id)

  logger.info(
    { totalPlayers: totalCount, eliteCount, topPercentile },
    'Identified elite human player cohort for Ludo Behavioral Cloning'
  )

  let decisionsExtracted = 0
  let rawCaptureRate = LUDO_SHARK_PRIORS.capture_rate
  let rawSafePlayRate = LUDO_SHARK_PRIORS.safe_play_rate

  if (eliteIds.length > 0) {
    const decisionsRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total_decisions,
         COUNT(*) FILTER (WHERE capture_available = true)::int AS cap_available,
         COUNT(*) FILTER (WHERE capture_taken = true)::int AS cap_taken,
         COUNT(*) FILTER (WHERE safe_move_available = true)::int AS safe_available,
         COUNT(*) FILTER (WHERE chose_safe_move = true)::int AS safe_taken
       FROM ludo_move_decisions
       WHERE user_id = ANY($1)`,
      [eliteIds]
    )

    const dRow = decisionsRes.rows[0]
    decisionsExtracted = parseInt(dRow?.total_decisions || '0', 10)

    if (decisionsExtracted > 0 && dRow.cap_available > 0) {
      const priorWeight = 15
      rawCaptureRate = (dRow.cap_taken + LUDO_SHARK_PRIORS.capture_rate * priorWeight) / (dRow.cap_available + priorWeight)
      rawCaptureRate = Math.round(rawCaptureRate * 10000) / 10000
    }

    if (decisionsExtracted > 0 && dRow.safe_available > 0) {
      const priorWeight = 15
      rawSafePlayRate = (dRow.safe_taken + LUDO_SHARK_PRIORS.safe_play_rate * priorWeight) / (dRow.safe_available + priorWeight)
      rawSafePlayRate = Math.round(rawSafePlayRate * 10000) / 10000
    }
  }

  const clonedProfiles = {
    hard: {
      capture_probability: rawCaptureRate,
      safe_play_probability: rawSafePlayRate,
      win_rate_target: 48.0,
      avg_decision_delay_ms: 1800,
    },
    medium: {
      capture_probability: Math.round((rawCaptureRate * 0.80) * 10000) / 10000,
      safe_play_probability: Math.round((rawSafePlayRate * 0.80) * 10000) / 10000,
      win_rate_target: 35.0,
      avg_decision_delay_ms: 2400,
    },
  }

  return {
    gameType: 'ludo',
    topPercentileCutoff: topPercentile,
    playersAnalyzed: totalCount,
    elitePlayerCount: eliteIds.length,
    elitePlayerIds: eliteIds,
    decisionsExtracted,
    extractedDistribution: {
      capture_rate: rawCaptureRate,
      safe_play_rate: rawSafePlayRate,
    },
    clonedProfiles,
  }
}

