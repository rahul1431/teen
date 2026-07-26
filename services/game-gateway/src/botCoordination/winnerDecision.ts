import { ElectionAlgorithm, BotWithStats } from './electionAlgorithm'
import { BotTrainingConfig } from '../repositories/botTrainingConfigRepository'

export interface WinnerDecision {
  winnerBotId: string
  strategyUsed: string
}

// True only when the seated bots' resolved difficulties are exactly one
// easy + one medium + one hard bot — genuine tier diversity, not merely
// "a hard-tagged bot happens to be present somewhere." Untagged bots fall
// back to the room-wide default via resolveBotDifficulties, and that
// default can itself be 'hard' (via game_configs.bot_difficulty or the
// personalized-difficulty canary). If getTierDiverseBots returned null and
// the plain random getBots fallback happened to seat three untagged bots
// in a room whose default is 'hard', all three would resolve to 'hard' —
// "hard is present" would be true without a genuine tier-diverse trio
// actually having been seated.
export function hasGenuineTierDiversity(botDifficulties: Map<string, string>): boolean {
  if (botDifficulties.size !== 3) return false
  const tiers = new Set(botDifficulties.values())
  return tiers.size === 3 && tiers.has('easy') && tiers.has('medium') && tiers.has('hard')
}

// Pure decision logic for startGame's coordination block: given the
// bot-training config, each seated bot's resolved difficulty tier, each
// seated bot's stats, and the game type, decides which bot wins and which
// strategy actually produced that decision (which can differ from
// config.strategy whenever tiered_hard_wins falls back to
// config.fallbackStrategy).
//
// tiered_hard_wins is Ludo-only. The coordination block this feeds is
// shared with Teen Patti (which also reaches it via 3-bot + 1-RP rooms),
// and Teen Patti's coordination is under a strict no-changes constraint —
// so any non-ludo gameType always takes the plain election path below,
// even when config.strategy is 'tiered_hard_wins', leaving Teen Patti's
// behavior byte-for-byte unchanged from before tiered_hard_wins existed.
export function decideBotWinner(
  electionAlgorithm: ElectionAlgorithm,
  config: BotTrainingConfig,
  botDifficulties: Map<string, string>,
  botsWithStats: BotWithStats[],
  gameType: string
): WinnerDecision {
  if (config.strategy === 'tiered_hard_wins') {
    if (gameType === 'ludo' && hasGenuineTierDiversity(botDifficulties)) {
      const hardTierBotId = electionAlgorithm.electHardTierWinner(botDifficulties)
      if (hardTierBotId) {
        return { winnerBotId: hardTierBotId, strategyUsed: 'tiered_hard_wins' }
      }
    }
    // Not ludo, diversity isn't genuine, or (shouldn't happen given genuine
    // diversity, but handled defensively) electHardTierWinner found nothing.
    return {
      winnerBotId: electionAlgorithm.electWinnerBot(botsWithStats, config.fallbackStrategy, gameType),
      strategyUsed: config.fallbackStrategy,
    }
  }

  return {
    winnerBotId: electionAlgorithm.electWinnerBot(botsWithStats, config.strategy, gameType),
    strategyUsed: config.strategy,
  }
}

export interface EngineCoordination {
  winnerBotIdx: number
  aggressiveness: number
  winnerSkill: 'casual' | 'skilled' | 'expert'
  boldness: number
  diceBias: number
}

export interface EngineCoordinationInputs {
  strategyUsed: string
  winnerBotIdx: number
  aggressiveness: number
  winnerBotSkill: 'casual' | 'skilled' | 'expert'
  winnerBotDiceBias: number
  // The slider-driven boldness value the caller would use on the
  // non-tiered path (either config.winnerBotBoldness, or the resolved
  // result of the async computeEffectiveBoldness when config.adaptiveBoldness
  // is set). Callers should avoid resolving this expensively when
  // strategyUsed is already known to be 'tiered_hard_wins', since it's
  // discarded below in favor of the maxed-out bias.
  resolvedSliderBoldness: number
}

// Pure construction of the Ludo engine's per-turn bias/skill fields for
// startGame's coordination block. tiered_hard_wins always applies its own
// maxed-out bias (boldness 1.0, skill 'expert', diceBias 1.0), independent
// of the shared sliders — those sliders still apply, unaffected, to every
// other strategy's games.
export function buildEngineCoordination(inputs: EngineCoordinationInputs): EngineCoordination {
  const usingTieredHardWins = inputs.strategyUsed === 'tiered_hard_wins'
  return {
    winnerBotIdx: inputs.winnerBotIdx,
    aggressiveness: inputs.aggressiveness,
    winnerSkill: usingTieredHardWins ? 'expert' : inputs.winnerBotSkill,
    boldness: usingTieredHardWins ? 1.0 : inputs.resolvedSliderBoldness,
    diceBias: usingTieredHardWins ? 1.0 : inputs.winnerBotDiceBias,
  }
}
