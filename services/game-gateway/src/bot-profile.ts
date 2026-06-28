import { Redis } from 'ioredis'
import axios from 'axios'

export interface BotDecisionProfile {
  fold_probability: number
  call_probability: number
  raise_probability: number
  avg_decision_delay_ms: number
}

// Hardcoded fallbacks used when bot-learning-service is unreachable
const FALLBACK_PROFILES: Record<string, Record<string, BotDecisionProfile>> = {
  teen_patti: {
    easy:   { fold_probability: 0.45, call_probability: 0.45, raise_probability: 0.10, avg_decision_delay_ms: 2800 },
    medium: { fold_probability: 0.30, call_probability: 0.47, raise_probability: 0.23, avg_decision_delay_ms: 2000 },
    hard:   { fold_probability: 0.18, call_probability: 0.42, raise_probability: 0.40, avg_decision_delay_ms: 1400 },
  },
  ludo: {
    easy:   { fold_probability: 0.45, call_probability: 0.45, raise_probability: 0.10, avg_decision_delay_ms: 3000 },
    medium: { fold_probability: 0.30, call_probability: 0.50, raise_probability: 0.20, avg_decision_delay_ms: 2200 },
    hard:   { fold_probability: 0.15, call_probability: 0.45, raise_probability: 0.40, avg_decision_delay_ms: 1200 },
  },
  aviator: {
    easy:   { fold_probability: 0.50, call_probability: 0.40, raise_probability: 0.10, avg_decision_delay_ms: 3500 },
    medium: { fold_probability: 0.35, call_probability: 0.45, raise_probability: 0.20, avg_decision_delay_ms: 2500 },
    hard:   { fold_probability: 0.20, call_probability: 0.40, raise_probability: 0.40, avg_decision_delay_ms: 1500 },
  },
}

const CACHE_TTL = 3600
const BOT_LEARNING_URL = process.env.BOT_LEARNING_SERVICE_URL || 'http://localhost:3014'

export async function getBotProfile(
  redis: Redis,
  gameType: string,
  difficulty: string,
  logger?: { warn: (msg: string) => void }
): Promise<BotDecisionProfile> {
  const validDifficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium'
  const cacheKey = `bot:profile:${gameType}:${validDifficulty}`

  // Check Redis cache first (set by bot-learning-service with 1hr TTL)
  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as BotDecisionProfile
  } catch {
    // Redis unavailable — continue to HTTP fallback
  }

  // Fetch from bot-learning-service (500ms timeout — bot decisions can't wait long)
  try {
    const res = await axios.get(`${BOT_LEARNING_URL}/api/bots/profile`, {
      params: { game_type: gameType, difficulty: validDifficulty },
      timeout: 500,
    })
    if (res.data?.success && res.data?.data) {
      const p = res.data.data
      const profile: BotDecisionProfile = {
        fold_probability:      parseFloat(p.fold_probability),
        call_probability:      parseFloat(p.call_probability),
        raise_probability:     parseFloat(p.raise_probability),
        avg_decision_delay_ms: parseInt(p.avg_decision_delay_ms, 10),
      }
      // Cache in gateway's own Redis so next call is instant
      redis.setex(cacheKey, CACHE_TTL, JSON.stringify(profile)).catch(() => {})
      return profile
    }
  } catch {
    // Service unreachable — fall through to hardcoded fallback silently
    logger?.warn(`[bot-profile] bot-learning-service unavailable for ${gameType}:${validDifficulty}, using hardcoded fallback`)
  }

  // Hardcoded fallback
  return (
    FALLBACK_PROFILES[gameType]?.[validDifficulty] ??
    FALLBACK_PROFILES.teen_patti.medium
  )
}

export function pickBotAction(profile: BotDecisionProfile): 'fold' | 'call' | 'raise' {
  const rand = Math.random()
  if (rand < profile.fold_probability) return 'fold'
  if (rand < profile.fold_probability + profile.call_probability) return 'call'
  return 'raise'
}

export function pickBotDelay(profile: BotDecisionProfile): number {
  // Add ±30% jitter so bots don't feel robotic
  return Math.round(profile.avg_decision_delay_ms * (0.7 + Math.random() * 0.6))
}
