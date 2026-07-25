// Standalone simulation harness for the Ludo Bot Training feature.
//
// Runs the REAL rules.ts + coordination.ts engine code in-process (no HTTP,
// no DB, no wallet, no real users) to generate N synthetic 1-simulated-RP +
// 3-bot games, using the exact coordination config currently live in
// production (aggressiveness 0.6, winnerSkill expert, boldness 1). The
// "RP" seat is played by chooseBotToken(..., 'hard') as a stand-in for a
// competent real player. Output is a console summary only -- nothing is
// written to any database, so this cannot pollute real bot_learning_sessions
// data or touch real money/users in any way.
//
// Run with: npx tsx scripts/simulate-bot-training.ts [gameCount]
import {
  createInitialState,
  applyRoll,
  applyMove,
  rollDie,
  rollDieBiased,
  chooseBotToken,
  LudoState,
  ActionResult,
} from '../src/rules'
import { chooseBotTokenCoordinated, CoordinationMetadata } from '../src/coordination'

const N_GAMES = parseInt(process.argv[2] || '100', 10)
const WINNER_IDX = 1 // seat 2 (index 1) is always the elected winner bot in this sim
const AGGRESSIVENESS = 0.6
const WINNER_SKILL = 'expert' as const
const BOLDNESS = 1
const MAX_TURNS = 3000 // safety cap; a real game should finish in well under this

interface GameOutcome {
  gameId: string
  actualWinnerId: string
  turns: number
  rankings: { user_id: string; finished: number }[]
}

function simulateOneGame(gameId: string, diceBias: number): GameOutcome {
  let state: LudoState = createInitialState(gameId, 50, [
    { user_id: 'sim-rp', username: 'SimRP', seat: 1, is_bot: false },
    { user_id: 'sim-winner', username: 'SimWinner', seat: 2, is_bot: true },
    { user_id: 'sim-helper-1', username: 'SimHelper1', seat: 3, is_bot: true },
    { user_id: 'sim-helper-2', username: 'SimHelper2', seat: 4, is_bot: true },
  ])

  let result: ActionResult | null = null
  let turns = 0

  while (!result && turns < MAX_TURNS) {
    turns++
    const idx = state.current_turn
    const dice = idx === WINNER_IDX ? rollDieBiased(diceBias) : rollDie()
    state = applyRoll(state, dice)

    if (state.awaiting !== 'move') continue // no legal move this roll, turn already passed

    let tokenIndex: number
    if (idx === 0) {
      // Simulated RP: a solid, non-coordinated player.
      tokenIndex = chooseBotToken(state, idx, state.dice!, 'hard')
    } else {
      const metadata: CoordinationMetadata = {
        isHelper: idx !== WINNER_IDX,
        winnerBotIdx: WINNER_IDX,
        aggressiveness: AGGRESSIVENESS,
        winnerSkill: WINNER_SKILL,
        boldness: BOLDNESS,
      }
      tokenIndex = chooseBotTokenCoordinated(state, idx, state.dice!, metadata)
    }

    if (tokenIndex === -1) continue // defensive; movableTokens said there was a move

    const applied = applyMove(state, tokenIndex)
    state = applied.state
    if (applied.result) result = applied.result
  }

  if (!result) {
    throw new Error(`Game ${gameId} did not finish within ${MAX_TURNS} turns`)
  }

  return { gameId, actualWinnerId: result.winner_id!, turns, rankings: result.rankings }
}

const BIAS_LEVELS = process.argv[3]
  ? process.argv[3].split(',').map(Number)
  : [0, 0.3, 0.5, 0.7, 1.0]

for (const diceBias of BIAS_LEVELS) {
  const outcomes: GameOutcome[] = []
  for (let i = 0; i < N_GAMES; i++) {
    outcomes.push(simulateOneGame(`sim-${diceBias}-${i}`, diceBias))
  }

  const winnerBotWins = outcomes.filter((o) => o.actualWinnerId === 'sim-winner').length
  const rpWins = outcomes.filter((o) => o.actualWinnerId === 'sim-rp').length
  const helper1Wins = outcomes.filter((o) => o.actualWinnerId === 'sim-helper-1').length
  const helper2Wins = outcomes.filter((o) => o.actualWinnerId === 'sim-helper-2').length
  const avgTurns = Math.round(outcomes.reduce((s, o) => s + o.turns, 0) / outcomes.length)

  console.log(`\n=== diceBias=${diceBias} | ${N_GAMES} games (aggressiveness=${AGGRESSIVENESS} winnerSkill=${WINNER_SKILL} boldness=${BOLDNESS}) ===`)
  console.log(`Elected winner bot won: ${winnerBotWins}/${N_GAMES} (${(100 * winnerBotWins / N_GAMES).toFixed(1)}%)`)
  console.log(`Simulated RP won:       ${rpWins}/${N_GAMES} (${(100 * rpWins / N_GAMES).toFixed(1)}%)`)
  console.log(`Helper 1 won:           ${helper1Wins}/${N_GAMES} (${(100 * helper1Wins / N_GAMES).toFixed(1)}%)`)
  console.log(`Helper 2 won:           ${helper2Wins}/${N_GAMES} (${(100 * helper2Wins / N_GAMES).toFixed(1)}%)`)
  console.log(`Average turns per game: ${avgTurns}`)
}
