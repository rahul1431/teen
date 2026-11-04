import { Redis } from 'ioredis'
import axios from 'axios'

export interface RummyBotProfile {
  difficulty: 'easy' | 'medium' | 'hard' | 'god_mode'
  win_rate_target: number | null
  drop_probability: number
  open_draw_probability: number
  declare_speed_factor: number
  avg_decision_delay_ms: number
  aggression_score: number | null
}

export const RUMMY_FALLBACK: Record<string, RummyBotProfile> = {
  easy: {
    difficulty: 'easy',
    win_rate_target: 25.0,
    drop_probability: 0.1,
    open_draw_probability: 0.35,
    declare_speed_factor: 0.4,
    avg_decision_delay_ms: 2200,
    aggression_score: 0.5,
  },
  medium: {
    difficulty: 'medium',
    win_rate_target: 48.0,
    drop_probability: 0.3,
    open_draw_probability: 0.6,
    declare_speed_factor: 0.7,
    avg_decision_delay_ms: 1800,
    aggression_score: 1.8,
  },
  hard: {
    difficulty: 'hard',
    win_rate_target: 72.0,
    drop_probability: 0.55,
    open_draw_probability: 0.85,
    declare_speed_factor: 0.95,
    avg_decision_delay_ms: 1500,
    aggression_score: 3.2,
  },
  god_mode: {
    difficulty: 'god_mode',
    win_rate_target: 96.0,
    drop_probability: 0.85,
    open_draw_probability: 0.95,
    declare_speed_factor: 1.0,
    avg_decision_delay_ms: 900,
    aggression_score: 4.9,
  },
}

const CACHE_TTL = 3600
const SERVICE_URL = process.env.RUMMY_BOT_SERVICE_URL || 'http://127.0.0.1:3025'

export async function getRummyBotProfile(
  redis: Redis,
  difficulty: string,
  logger?: { warn: (msg: string) => void }
): Promise<RummyBotProfile> {
  const tier = ['easy', 'medium', 'hard', 'god_mode'].includes(difficulty) ? (difficulty as 'easy' | 'medium' | 'hard' | 'god_mode') : 'medium'
  const cacheKey = `bot:profile:rummy:${tier}`

  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as RummyBotProfile
  } catch {}

  try {
    const res = await axios.get(`${SERVICE_URL}/api/bot/profile`, {
      params: { difficulty: tier },
      timeout: 500,
      headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' },
    })
    if (res.data?.success && res.data?.data) {
      const p = res.data.data
      const profile: RummyBotProfile = {
        difficulty: tier,
        win_rate_target: p.win_rate_target != null ? parseFloat(p.win_rate_target) : null,
        drop_probability: parseFloat(p.drop_probability || '0.25'),
        open_draw_probability: parseFloat(p.open_draw_probability || '0.60'),
        declare_speed_factor: parseFloat(p.declare_speed_factor || '0.70'),
        avg_decision_delay_ms: parseInt(p.avg_decision_delay_ms || '1800', 10),
        aggression_score: p.aggression_score != null ? parseFloat(p.aggression_score) : null,
      }
      redis.setex(cacheKey, CACHE_TTL, JSON.stringify(profile)).catch(() => {})
      return profile
    }
  } catch {
    logger?.warn(`[bot-profile] rummy-bot-training unavailable for ${tier}, using fallback`)
  }

  return RUMMY_FALLBACK[tier] ?? RUMMY_FALLBACK.medium
}

/**
 * Natural cognitive reaction timing for Rummy bots:
 * Human-like timing with each bot timing random 2-7 seconds (2000ms - 7000ms).
 */
export function pickRummyBotDelay(profile?: RummyBotProfile): number {
  const minDelayMs = 2000
  const maxDelayMs = 7000
  return Math.floor(minDelayMs + Math.random() * (maxDelayMs - minDelayMs + 1))
}

