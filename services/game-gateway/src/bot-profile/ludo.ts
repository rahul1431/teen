import { Redis } from 'ioredis'
import axios from 'axios'

/**
 * Ludo bot profile client.
 *
 * Talks to ludo-bot-training (services/bot-training/ludo). Ludo has no betting
 * round, so there are deliberately no fold/call/raise fields here — the bot's
 * decision is which token to move, and these two rates shape it.
 *
 * null is a meaningful value, not an error: the Ludo engine's chooseBotToken
 * reads a null capture_probability as "no trained data, use the deterministic
 * rule". Never substitute a numeric default for null on this path.
 */

export interface LudoBotProfile {
  capture_probability: number | null
  safe_play_probability: number | null
  avg_decision_delay_ms: number
}

// Unreachable service falls back to fully untrained: deterministic rule, not a
// guessed rate. Matches the Ludo seed rows in
// infra/db/migrations/20260801_per_game_bot_profiles.sql.
export const FALLBACK: Record<string, LudoBotProfile> = {
  easy:   { capture_probability: null, safe_play_probability: null, avg_decision_delay_ms: 3000 },
  medium: { capture_probability: null, safe_play_probability: null, avg_decision_delay_ms: 3500 },
  hard:   { capture_probability: null, safe_play_probability: null, avg_decision_delay_ms: 3700 },
}

const CACHE_TTL = 3600
const SERVICE_URL = process.env.LUDO_BOT_SERVICE_URL || 'http://127.0.0.1:3024'

export async function getLudoBotProfile(
  redis: Redis,
  difficulty: string,
  logger?: { warn: (msg: string) => void }
): Promise<LudoBotProfile> {
  const tier = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium'
  const cacheKey = `bot:profile:ludo:${tier}`

  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as LudoBotProfile
  } catch {
    // Redis unavailable — fall through to HTTP.
  }

  try {
    const res = await axios.get(`${SERVICE_URL}/api/bot/profile`, {
      params: { difficulty: tier },
      timeout: 500,
      headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' },
    })
    if (res.data?.success && res.data?.data) {
      const p = res.data.data
      const profile: LudoBotProfile = {
        capture_probability:   p.capture_probability   != null ? parseFloat(p.capture_probability)   : null,
        safe_play_probability: p.safe_play_probability != null ? parseFloat(p.safe_play_probability) : null,
        avg_decision_delay_ms: parseInt(p.avg_decision_delay_ms, 10),
      }
      redis.setex(cacheKey, CACHE_TTL, JSON.stringify(profile)).catch(() => {})
      return profile
    }
  } catch {
    logger?.warn(`[bot-profile] ludo-bot-training unavailable for ${tier}, using fallback`)
  }

  return FALLBACK[tier] ?? FALLBACK.medium
}
