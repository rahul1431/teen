import crypto from 'crypto'

// Phase 2 Task 18/19: personalized bot-difficulty canary.
// Calls churn-ml-service's /predict-difficulty for a small, deterministic
// percentage of rooms (PERSONALIZATION_CANARY_PCT). Never blocks
// matchmaking: any failure or timeout falls back to the caller's existing
// game_configs-based difficulty.

const CHURN_ML_SERVICE_URL = process.env.CHURN_ML_SERVICE_URL || 'http://127.0.0.1:3020'
const CANARY_PCT = Math.max(0, Math.min(100, parseInt(process.env.PERSONALIZATION_CANARY_PCT || '0', 10) || 0))
// Ludo gets its own rollout knob so enabling it can never activate the
// canary for other game types (Teen Patti is under a hard lockdown — this
// must not be a side effect of a Ludo-only rollout decision).
const CANARY_PCT_LUDO = Math.max(0, Math.min(100, parseInt(process.env.PERSONALIZATION_CANARY_PCT_LUDO || '0', 10) || 0))
const PREDICT_TIMEOUT_MS = 150

export interface DifficultyPrediction {
  recommended_difficulty: 'easy' | 'medium' | 'hard'
  confidence_score: number
  prediction_type: 'model' | 'fallback'
}

/** Deterministically hashes an id to 0-99, same scheme as ABExperimentRouter. */
function hashToPercent(id: string): number {
  const hash = crypto.createHash('sha256').update(id).digest('hex')
  return parseInt(hash.substring(0, 8), 16) % 100
}

/**
 * Returns true if this room should use the personalized-difficulty canary,
 * based on a deterministic hash of the room's primary player id. Ludo reads
 * its own PERSONALIZATION_CANARY_PCT_LUDO knob; every other game type keeps
 * using the shared PERSONALIZATION_CANARY_PCT exactly as before.
 */
export function isInPersonalizationCanary(playerId: string, gameType: string): boolean {
  const pct = gameType === 'ludo' ? CANARY_PCT_LUDO : CANARY_PCT
  if (pct <= 0) return false
  return hashToPercent(playerId) < pct
}

/**
 * Fetches a personalized difficulty recommendation. Returns null on any
 * error or timeout so callers can fall back to the standard config-driven
 * difficulty without special-casing failure modes.
 */
export async function getPersonalizedDifficulty(
  playerId: string,
  gameType: string
): Promise<DifficultyPrediction | null> {
  try {
    const res = await fetch(`${CHURN_ML_SERVICE_URL}/predict-difficulty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId, game_type: gameType }),
      signal: AbortSignal.timeout(PREDICT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.recommended_difficulty) return null
    return {
      recommended_difficulty: data.recommended_difficulty,
      confidence_score: data.confidence_score ?? 0,
      prediction_type: data.prediction_type ?? 'fallback',
    }
  } catch (err) {
    console.error('[personalized-difficulty] prediction failed, falling back', err)
    return null
  }
}
