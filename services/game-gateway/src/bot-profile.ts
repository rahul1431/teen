import { Redis } from 'ioredis'
import { getTeenPattiBotProfile, TeenPattiBotProfile } from './bot-profile/teen-patti'
import { getLudoBotProfile, LudoBotProfile } from './bot-profile/ludo'

export { pickBotAction, pickBotDelay } from './bot-profile/teen-patti'
export { getTeenPattiBotProfile, getLudoBotProfile }
export type { TeenPattiBotProfile, LudoBotProfile }

/**
 * Per-game bot profile routing.
 *
 * Each game's bots are now trained and served by their own service
 * (services/bot-training/<game>), and each has its own client module under
 * ./bot-profile/. This file only dispatches; it holds no game logic.
 *
 * The previous single BotDecisionProfile carried every game's fields at once,
 * so Ludo profiles arrived with meaningless fold/call/raise values and Teen
 * Patti ones with permanently-null capture/safe-play fields. Callers that know
 * their game should import the specific client directly — getBotProfile below
 * exists only for paths where the game type is known at runtime.
 */

/** @deprecated Import TeenPattiBotProfile or LudoBotProfile instead. Retained
 *  so existing call sites keep compiling through the split. */
export type BotDecisionProfile = TeenPattiBotProfile & Partial<LudoBotProfile>

// Aviator's bots reuse Teen Patti's fold/call/raise decision shape but have no
// training service of their own — there is no aviator move-decision log to
// learn from, and its rooms are solo-crash (registry.json: maxPlayers 1), so
// these constants are the whole profile rather than a fallback.
const AVIATOR_PROFILES: Record<string, TeenPattiBotProfile> = {
  easy:   { fold_probability: 0.50, call_probability: 0.40, raise_probability: 0.10, avg_decision_delay_ms: 3500 },
  medium: { fold_probability: 0.35, call_probability: 0.45, raise_probability: 0.20, avg_decision_delay_ms: 2500 },
  hard:   { fold_probability: 0.20, call_probability: 0.40, raise_probability: 0.40, avg_decision_delay_ms: 1500 },
}

/**
 * Runtime-dispatched profile lookup, for call sites whose game type comes from
 * room state. Returns the union shape so existing callers keep compiling.
 */
export async function getBotProfile(
  redis: Redis,
  gameType: string,
  difficulty: string,
  logger?: { warn: (msg: string) => void }
): Promise<BotDecisionProfile> {
  const tier = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium'

  if (gameType === 'ludo') {
    const ludo = await getLudoBotProfile(redis, tier, logger)
    // Ludo never reaches pickBotAction — it has no betting round — but the
    // union return type needs these fields present. Zeroed rather than guessed:
    // a mistaken call site then produces an obvious "always raises" bug instead
    // of a plausible-looking one that ships unnoticed.
    return {
      fold_probability: 0,
      call_probability: 0,
      raise_probability: 0,
      avg_decision_delay_ms: ludo.avg_decision_delay_ms,
      capture_probability: ludo.capture_probability,
      safe_play_probability: ludo.safe_play_probability,
    }
  }

  if (gameType === 'aviator') {
    return AVIATOR_PROFILES[tier] ?? AVIATOR_PROFILES.medium
  }

  return getTeenPattiBotProfile(redis, tier, logger)
}
