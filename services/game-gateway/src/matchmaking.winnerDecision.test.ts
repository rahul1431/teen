// services/game-gateway/src/matchmaking.winnerDecision.test.ts
// Run: npx tsx src/matchmaking.winnerDecision.test.ts
//
// Unit tests for the pure decision logic extracted from startGame's
// coordination block (services/game-gateway/src/botCoordination/winnerDecision.ts).
// Covers the tiered_hard_wins wiring review findings:
//  - strategyUsed (not config.strategy) is what actually gets used
//  - the tiered path only fires on genuine one-of-each tier diversity, on Ludo
//  - fallback fires whenever gameType isn't ludo, even if strategy is tiered_hard_wins
//  - the engine bias (boldness/skill/diceBias) is maxed only on the tiered path
import { ElectionAlgorithm, BotWithStats } from './botCoordination/electionAlgorithm'
import { BotTrainingConfig } from './repositories/botTrainingConfigRepository'
import { decideBotWinner, hasGenuineTierDiversity, buildEngineCoordination } from './botCoordination/winnerDecision'

let testsPassed = 0
let testsFailed = 0

function assert(label: string, condition: boolean, details?: string) {
  if (condition) {
    testsPassed++
    console.log(`✓ ${label}`)
  } else {
    testsFailed++
    console.error(`✗ ${label}${details ? ` — ${details}` : ''}`)
  }
}

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

async function run() {
  const algorithm = new ElectionAlgorithm()

  // ---- hasGenuineTierDiversity -------------------------------------------
  assert(
    'hasGenuineTierDiversity: true for exactly one easy+medium+hard',
    hasGenuineTierDiversity(new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']])) === true
  )
  assert(
    'hasGenuineTierDiversity: false when all three resolve to hard (fake diversity via default inheritance)',
    hasGenuineTierDiversity(new Map([['bot-1', 'hard'], ['bot-2', 'hard'], ['bot-3', 'hard']])) === false
  )
  assert(
    'hasGenuineTierDiversity: false when a tier is missing (only easy+hard, no medium)',
    hasGenuineTierDiversity(new Map([['bot-1', 'easy'], ['bot-2', 'hard'], ['bot-3', 'hard']])) === false
  )
  assert(
    'hasGenuineTierDiversity: false with fewer than 3 bots',
    hasGenuineTierDiversity(new Map([['bot-1', 'easy'], ['bot-2', 'hard']])) === false
  )

  // ---- Scenario 1: tiered path fires with genuine diversity + ludo -------
  {
    const config = makeConfig({ strategy: 'tiered_hard_wins' })
    const botDifficulties = new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'ludo')
    assert('scenario 1: tiered path elects the hard-tagged bot', decision.winnerBotId === 'bot-hard')
    assert("scenario 1: strategyUsed is 'tiered_hard_wins'", decision.strategyUsed === 'tiered_hard_wins')
  }

  // ---- Scenario 2: fallback fires with fake diversity via default inheritance ----
  {
    const config = makeConfig({ strategy: 'tiered_hard_wins', fallbackStrategy: 'lifetime_winrate' })
    // All three bots fell back to the room-wide default ('hard') — not a
    // genuine tier-diverse trio, even though 'hard' is technically present.
    const botDifficulties = new Map([['bot-easy', 'hard'], ['bot-medium', 'hard'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'ludo')
    assert(
      "scenario 2: strategyUsed falls back to config.fallbackStrategy, not 'tiered_hard_wins'",
      decision.strategyUsed === 'lifetime_winrate'
    )
    // lifetime_winrate election picks the highest lifetimeWinRate bot (bot-hard, 0.9)
    assert('scenario 2: fallback election still runs correctly', decision.winnerBotId === 'bot-hard')
  }

  // ---- Scenario 3: fallback fires when gameType isn't ludo, even with strategy=tiered_hard_wins ----
  {
    const config = makeConfig({ strategy: 'tiered_hard_wins', fallbackStrategy: 'weakest_first' })
    // Genuine tier diversity, but this is Teen Patti, not Ludo -- must be
    // byte-for-byte unaffected by tiered_hard_wins.
    const botDifficulties = new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'teen_patti')
    assert(
      "scenario 3: non-ludo gameType always falls back, never 'tiered_hard_wins'",
      decision.strategyUsed === 'weakest_first'
    )
    // weakest_first picks the lowest lifetimeWinRate bot (bot-easy, 0.5)
    assert('scenario 3: fallback election runs the configured fallbackStrategy', decision.winnerBotId === 'bot-easy')
  }

  // Sanity: non-tiered strategy is untouched regardless of gameType/diversity.
  {
    const config = makeConfig({ strategy: 'vs_rp_winrate' })
    const botDifficulties = new Map([['bot-easy', 'easy'], ['bot-medium', 'medium'], ['bot-hard', 'hard']])
    const decision = decideBotWinner(algorithm, config, botDifficulties, makeBotsWithStats(), 'ludo')
    assert("sanity: plain strategy passes through as strategyUsed", decision.strategyUsed === 'vs_rp_winrate')
    // vs_rp_winrate picks highest vsRpWinRate (bot-hard, 0.8)
    assert('sanity: plain strategy elects via electWinnerBot', decision.winnerBotId === 'bot-hard')
  }

  // ---- Scenario 4: bias values differ correctly between paths -----------
  {
    const tiered = buildEngineCoordination({
      strategyUsed: 'tiered_hard_wins',
      winnerBotIdx: 2,
      aggressiveness: 0.4,
      winnerBotSkill: 'casual',
      winnerBotDiceBias: 0,
      resolvedSliderBoldness: 0.5,
    })
    assert('scenario 4: tiered path forces boldness to 1.0', tiered.boldness === 1.0)
    assert("scenario 4: tiered path forces winnerSkill to 'expert'", tiered.winnerSkill === 'expert')
    assert('scenario 4: tiered path forces diceBias to 1.0', tiered.diceBias === 1.0)

    const fallback = buildEngineCoordination({
      strategyUsed: 'lifetime_winrate',
      winnerBotIdx: 2,
      aggressiveness: 0.4,
      winnerBotSkill: 'casual',
      winnerBotDiceBias: 0.3,
      resolvedSliderBoldness: 0.5,
    })
    assert('scenario 4: non-tiered path keeps the resolved slider boldness', fallback.boldness === 0.5)
    assert("scenario 4: non-tiered path keeps the configured winnerSkill", fallback.winnerSkill === 'casual')
    assert('scenario 4: non-tiered path keeps the configured diceBias', fallback.diceBias === 0.3)
  }

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} winner-decision wiring tests passed.`)
}

run()
