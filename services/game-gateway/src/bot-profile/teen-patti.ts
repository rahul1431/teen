import { Redis } from 'ioredis'
import axios from 'axios'

/**
 * Teen Patti bot profile client.
 *
 * Talks to teen-patti-bot-training (services/bot-training/teen-patti). Holds
 * only the betting-round fields — fold/call/raise and decision delay — because
 * that is the entirety of a Teen Patti bot's decision vocabulary.
 */

export interface TeenPattiBotProfile {
  fold_probability: number
  call_probability: number
  raise_probability: number
  avg_decision_delay_ms: number
  /**
   * Trained aggression on the trainer's own 0..10-ish scale —
   * (raise / (call + fold)) * 10, see trainer.ts. Null on a freshly seeded row
   * that has never been rebuilt. Use aggressionUnit() rather than reading this
   * directly; the engine wants 0..1.
   */
  aggression_score: number | null
}

/**
 * Normalise a profile's aggression to the 0..1 the engine's bot brain expects.
 *
 * When the trained score is missing we recompute it from the rates instead of
 * assuming a middling 0.5, because it is defined as a function of them — a
 * fold-heavy profile with no rebuild yet is still a passive bot, and guessing
 * 0.5 would make it bluff.
 */
export function aggressionUnit(profile: TeenPattiBotProfile): number {
  let score = profile.aggression_score
  if (score === null || !Number.isFinite(score)) {
    const passive = profile.call_probability + profile.fold_probability
    score = passive > 0 ? (profile.raise_probability / passive) * 10 : 10
  }
  return Math.max(0, Math.min(1, score / 10))
}

// Used when the training service is unreachable. These must stay identical to
// the seed values in infra/db/migrations/20260801_per_game_bot_profiles.sql, so
// that "service down" and "table untrained" produce the same bot behaviour
// rather than two subtly different ones.
export const FALLBACK: Record<string, TeenPattiBotProfile> = {
  easy:   { fold_probability: 0.45, call_probability: 0.45, raise_probability: 0.10, avg_decision_delay_ms: 2800, aggression_score: null },
  medium: { fold_probability: 0.30, call_probability: 0.47, raise_probability: 0.23, avg_decision_delay_ms: 2000, aggression_score: null },
  hard:   { fold_probability: 0.18, call_probability: 0.42, raise_probability: 0.40, avg_decision_delay_ms: 1400, aggression_score: null },
}

const CACHE_TTL = 3600
const SERVICE_URL = process.env.TEEN_PATTI_BOT_SERVICE_URL || 'http://127.0.0.1:3023'

export async function getTeenPattiBotProfile(
  redis: Redis,
  difficulty: string,
  logger?: { warn: (msg: string) => void }
): Promise<TeenPattiBotProfile> {
  const tier = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium'
  const cacheKey = `bot:profile:teen_patti:${tier}`

  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as TeenPattiBotProfile
  } catch {
    // Redis unavailable — fall through to HTTP.
  }

  // 500ms ceiling: a bot decision cannot wait on a slow dependency, and the
  // fallback below is a correct profile rather than an error path.
  try {
    const res = await axios.get(`${SERVICE_URL}/api/bot/profile`, {
      params: { difficulty: tier },
      timeout: 500,
      headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' },
    })
    if (res.data?.success && res.data?.data) {
      const p = res.data.data
      const profile: TeenPattiBotProfile = {
        fold_probability:      parseFloat(p.fold_probability),
        call_probability:      parseFloat(p.call_probability),
        raise_probability:     parseFloat(p.raise_probability),
        avg_decision_delay_ms: parseInt(p.avg_decision_delay_ms, 10),
        // NUMERIC arrives as a string; null must survive as null so
        // aggressionUnit can tell "untrained" from a real zero.
        aggression_score: p.aggression_score === null || p.aggression_score === undefined
          ? null
          : parseFloat(p.aggression_score),
      }
      redis.setex(cacheKey, CACHE_TTL, JSON.stringify(profile)).catch(() => {})
      return profile
    }
  } catch {
    logger?.warn(`[bot-profile] teen-patti-bot-training unavailable for ${tier}, using fallback`)
  }

  return FALLBACK[tier] ?? FALLBACK.medium
}

export function pickBotAction(profile: TeenPattiBotProfile): 'fold' | 'call' | 'raise' {
  const rand = Math.random()
  if (rand < profile.fold_probability) return 'fold'
  if (rand < profile.fold_probability + profile.call_probability) return 'call'
  return 'raise'
}

export function pickBotDelay(profile: TeenPattiBotProfile): number {
  // ±30% jitter so bots don't all act on the same beat.
  return Math.round(profile.avg_decision_delay_ms * (0.7 + Math.random() * 0.6))
}
