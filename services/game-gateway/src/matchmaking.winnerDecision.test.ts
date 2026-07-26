// services/game-gateway/src/matchmaking.winnerDecision.test.ts
// Run: npx vitest run src/matchmaking.winnerDecision.test.ts
//
// Unit tests for the pure decision logic extracted from startGame's
// coordination block (services/game-gateway/src/botCoordination/winnerDecision.ts).
// Covers the tiered_hard_wins wiring review findings:
//  - strategyUsed (not config.strategy) is what actually gets used
//  - the tiered path only fires on genuine one-of-each tier diversity, on Ludo
//  - fallback fires whenever gameType isn't ludo, even if strategy is tiered_hard_wins
//  - the engine bias (boldness/skill/diceBias) is maxed only on the tiered path
import { describe, it, expect } from 'vitest'
import { ElectionAlgorithm, BotWithStats } from './botCoordination/electionAlgorithm'
import { BotTrainingConfig } from './repositories/botTrainingConfigRepository'
import { decideBotWinner, hasGenuineTierDiversity, buildEngineCoordination } from './botCoordination/winnerDecision'

function makeConfig(overrides: Partial<BotTrainingConfig> = {}): BotTrainingConfig {
  return {
    enabled: true,
    strategy: 'tiered_hard_wins',
    fallbackStrategy: 'lifetime_winrate',
    targetWinRate: 0.95,
    aggressiveness: 0.4,
    winnerBotSkill: 'casual',
    winnerBotBoldness: 0.5,
    adaptiveBoldness: false,
    winnerBotDiceBias: 0,
    ...overrides,
  }
}

function makeBotsWithStats(): BotWithStats[] {
  return [
    { botId: 'bot-easy', stats: { lifetimeGames: 10, lifetimeWins: 5, lifetimeWinRate: 0.5, gamesAsWinner: 3, gamesAsWinnerSuccess: 2, vsRpWinRate: 0.4, avgBlocksOnRp: 1, moveEfficiency: 0.6, last10Games: [] } },
    { botId: 'bot-medium', stats: { lifetimeGames: 10, lifetimeWins: 6, lifetimeWinRate: 0.6, gamesAsWinner: 3, gamesAsWinnerSuccess: 2, vsRpWinRate: 0.5, avgBlocksOnRp: 1, moveEfficiency: 0.6, last10Games: [] } },
    { botId: 'bot-hard', stats: { lifetimeGames: 10, lifetimeWins: 9, lifetimeWinRate: 0.9, gamesAsWinner: 3, gamesAsWinnerSuccess: 3, vsRpWinRate: 0.8, avgBlocksOnRp: 1, moveEfficiency: 0.9, last10Games: [] } },
  ]
}

describe('winnerDecision wiring', () => {
  const algorithm = new ElectionAlgorithm()

  describe('hasGenuineTierDiversity', () => {
    it('true for exactly one easy+medium+hard', () => {
      expect(
        hasGenuineTierDiversity(new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']]))
      ).toBe(true)
    })

    it('false when all three resolve to hard (fake diversity via default inheritance)', () => {
      expect(
        hasGenuineTierDiversity(new Map([['bot-1', 'hard'], ['bot-2', 'hard'], ['bot-3', 'hard']]))
      ).toBe(false)
    })

    it('false when a tier is missing (only easy+hard, no medium)', () => {
      expect(
        hasGenuineTierDiversity(new Map([['bot-1', 'easy'], ['bot-2', 'hard'], ['bot-3', 'hard']]))
      ).toBe(false)
    })

    it('false with fewer than 3 bots', () => {
      expect(
        hasGenuineTierDiversity(new Map([['bot-1', 'easy'], ['bot-2', 'hard']]))
      ).toBe(false)
    })
  })

  it('scenario 1: tiered path fires with genuine diversity + ludo', () => {
    const config = makeConfig({ strategy: 'tiered_hard_wins' })
    const botDifficulties = new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'ludo')
    expect(decision.winnerBotId).toBe('bot-hard')
    expect(decision.strategyUsed).toBe('tiered_hard_wins')
  })

  it('scenario 2: fallback fires with fake diversity via default inheritance', () => {
    const config = makeConfig({ strategy: 'tiered_hard_wins', fallbackStrategy: 'lifetime_winrate' })
    // All three bots fell back to the room-wide default ('hard') — not a
    // genuine tier-diverse trio, even though 'hard' is technically present.
    const botDifficulties = new Map([['bot-easy', 'hard'], ['bot-medium', 'hard'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'ludo')
    // strategyUsed falls back to config.fallbackStrategy, not 'tiered_hard_wins'
    expect(decision.strategyUsed).toBe('lifetime_winrate')
    // lifetime_winrate election picks the highest lifetimeWinRate bot (bot-hard, 0.9)
    expect(decision.winnerBotId).toBe('bot-hard')
  })

  it('scenario 3: fallback fires when gameType isn\'t ludo, even with strategy=tiered_hard_wins', () => {
    const config = makeConfig({ strategy: 'tiered_hard_wins', fallbackStrategy: 'weakest_first' })
    // Genuine tier diversity, but this is Teen Patti, not Ludo -- must be
    // byte-for-byte unaffected by tiered_hard_wins.
    const botDifficulties = new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'teen_patti')
    // non-ludo gameType always falls back, never 'tiered_hard_wins'
    expect(decision.strategyUsed).toBe('weakest_first')
    // weakest_first picks the lowest lifetimeWinRate bot (bot-easy, 0.5)
    expect(decision.winnerBotId).toBe('bot-easy')
  })

  it('sanity: non-tiered strategy is untouched regardless of gameType/diversity', () => {
    const config = makeConfig({ strategy: 'vs_rp_winrate' })
    const botDifficulties = new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'ludo')
    // plain strategy passes through as strategyUsed
    expect(decision.strategyUsed).toBe('vs_rp_winrate')
    // vs_rp_winrate picks highest vsRpWinRate (bot-hard, 0.8)
    expect(decision.winnerBotId).toBe('bot-hard')
  })

  describe('scenario 4: bias values differ correctly between paths', () => {
    it('tiered path forces boldness to 1.0, winnerSkill to expert, diceBias to 1.0', () => {
      const tiered = buildEngineCoordination({
        strategyUsed: 'tiered_hard_wins',
        winnerBotIdx: 2,
        aggressiveness: 0.4,
        winnerBotSkill: 'casual',
        winnerBotDiceBias: 0,
        resolvedSliderBoldness: 0.5,
      })
      expect(tiered.boldness).toBe(1.0)
      expect(tiered.winnerSkill).toBe('expert')
      expect(tiered.diceBias).toBe(1.0)
    })

    it('non-tiered path keeps the resolved slider boldness, configured winnerSkill and diceBias', () => {
      const fallback = buildEngineCoordination({
        strategyUsed: 'lifetime_winrate',
        winnerBotIdx: 2,
        aggressiveness: 0.4,
        winnerBotSkill: 'casual',
        winnerBotDiceBias: 0.3,
        resolvedSliderBoldness: 0.5,
      })
      expect(fallback.boldness).toBe(0.5)
      expect(fallback.winnerSkill).toBe('casual')
      expect(fallback.diceBias).toBe(0.3)
    })
  })
})
