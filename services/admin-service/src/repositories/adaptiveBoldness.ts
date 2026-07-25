import { Database } from '../db'

const SAMPLE_SIZE = 20
const MIN_SAMPLE = 5
const GAIN = 0.5

/**
 * Mirrors services/game-gateway/src/botCoordination/adaptiveBoldness.ts —
 * used here only to surface the live effective boldness value for the
 * admin panel readout, not to drive actual gameplay (the gateway computes
 * its own copy at match-start time).
 */
export async function computeEffectiveBoldness(
  db: Database,
  baseBoldness: number,
  targetWinRate: number,
): Promise<number> {
  const res = await db.query(
    `SELECT coordination_success FROM bot_learning_sessions ORDER BY created_at DESC LIMIT $1`,
    [SAMPLE_SIZE]
  )
  const rows = res.rows as { coordination_success: boolean }[]
  if (rows.length < MIN_SAMPLE) return baseBoldness

  const successRate = rows.filter((r) => r.coordination_success).length / rows.length
  const gap = targetWinRate - successRate
  const adjusted = baseBoldness + gap * GAIN
  return Math.max(0, Math.min(1, adjusted))
}
