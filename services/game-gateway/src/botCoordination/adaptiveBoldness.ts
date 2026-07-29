import { Database } from '../db'

const SAMPLE_SIZE = 20
const MIN_SAMPLE = 5
const GAIN = 0.5

/**
 * When Adaptive Boldness is enabled, the winner bot's boldness isn't fixed —
 * it's nudged toward closing the gap between the recent coordination
 * success rate and the configured target win rate (a simple proportional
 * controller, not real ML). `baseBoldness` (the admin-configured slider
 * value) acts as the starting point when there isn't enough recent history
 * to judge yet.
 */
export async function computeEffectiveBoldness(
  db: Database,
  baseBoldness: number,
  targetWinRate: number,
): Promise<number> {
  const res = await db.query(
    `SELECT coordination_success FROM bot_learning_sessions WHERE strategy_used <> 'tiered_hard_wins' ORDER BY created_at DESC LIMIT $1`,
    [SAMPLE_SIZE]
  )
  const rows = res.rows as { coordination_success: boolean }[]
  if (rows.length < MIN_SAMPLE) return baseBoldness

  const successRate = rows.filter((r) => r.coordination_success).length / rows.length
  const gap = targetWinRate - successRate // positive = underperforming target
  const adjusted = baseBoldness + gap * GAIN
  return Math.max(0, Math.min(1, adjusted))
}
