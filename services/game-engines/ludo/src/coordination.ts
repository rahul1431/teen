import {
  LudoState,
  chooseBotToken,
  absoluteCell,
  movableTokens,
  findCapturingMove,
  SAFE_CELLS,
  MAIN_TRACK,
  HOME_PROGRESS,
  WinnerSkill,
} from './rules'

export interface CoordinationMetadata {
  isHelper: boolean
  winnerBotIdx: number
  aggressiveness: number // 0.0 - 1.0
  winnerSkill?: WinnerSkill // defaults to 'casual'
  boldness?: number // 0.0 - 1.0, defaults to 0.5; only used by 'expert'
}

/**
 * Choose a token for a helper bot to move in coordinated mode.
 * Priority: block RP, clear path for winner, sacrifice, normal move
 */
export function chooseBotTokenCoordinated(
  state: LudoState,
  botIdx: number,
  dice: number,
  metadata: CoordinationMetadata
): number {
  if (!metadata.isHelper) {
    return chooseWinnerBotToken(
      state,
      botIdx,
      dice,
      metadata.winnerSkill ?? 'casual',
      metadata.boldness ?? 0.5
    )
  }

  const myTokens = state.players[botIdx].tokens
  const rpIdx = state.players.findIndex((p) => !p.is_bot)

  // Priority 1: Block RP by landing on a main-track cell one of its tokens occupies
  if (rpIdx !== -1 && metadata.aggressiveness > 0.3) {
    const blockingToken = findTokenThatCanBlock(state, botIdx, rpIdx, dice)
    if (blockingToken !== -1) {
      return blockingToken
    }
  }

  // Priority 2: Move a token off a cell the winner bot's tokens are also on,
  // clearing the way so the winner isn't sharing a square with us
  if (metadata.aggressiveness > 0.2) {
    const myBlocker = findOwnTokenSharingCellWithWinner(state, botIdx, metadata.winnerBotIdx)
    if (myBlocker !== -1) {
      return myBlocker
    }
  }

  // Priority 3: Sacrifice a token if beneficial to winner
  if (metadata.aggressiveness > 0.5) {
    const sacrificeToken = findSacrificeToken(myTokens)
    if (sacrificeToken !== -1) {
      return sacrificeToken
    }
  }

  // Priority 3.5: Throttle. Nothing above stops a helper from simply
  // out-racing the winner bot to the finish line on an ordinary turn where
  // none of the block/clear/sacrifice conditions happen to trigger — a
  // helper is otherwise free to play at full strength and can legitimately
  // win the room itself. Once a helper is materially ahead of the winner
  // bot's own progress, make it advance its LEAST-progressed movable token
  // (never one that would finish) instead of its best one, so it stops
  // closing the gap to home without ever refusing to move (a move is
  // mandatory whenever one is legal).
  const winnerProgress = totalProgress(state, metadata.winnerBotIdx)
  const myProgress = totalProgress(state, botIdx)
  if (myProgress > winnerProgress + THROTTLE_LEAD) {
    const movable = movableTokens(state, botIdx, dice)
    if (movable.length > 0) {
      const nonFinishing = movable.filter((t) => myTokens[t] + dice !== HOME_PROGRESS)
      const pool = nonFinishing.length > 0 ? nonFinishing : movable
      let worst = pool[0]
      for (const t of pool) {
        if (myTokens[t] < myTokens[worst]) worst = t
      }
      return worst
    }
  }

  // Priority 4: Normal best-move logic (fallback)
  return chooseBotToken(state, botIdx, dice)
}

/** Sum of a player's token progress (base = 0, finished = HOME_PROGRESS). Used
 *  to compare a helper bot's race position against the winner bot's. */
function totalProgress(state: LudoState, idx: number): number {
  return state.players[idx].tokens.reduce((sum, t) => sum + Math.max(t, 0), 0)
}

// Roughly one token's worth of progress (main track is 51 cells long) —
// small enough to kick in well before a helper could actually finish, large
// enough that normal early-game jockeying doesn't trigger it constantly.
const THROTTLE_LEAD = 20

/**
 * Index of a token this bot can move `dice` steps to land exactly on a
 * non-safe cell one of the RP's tokens currently occupies. -1 if none.
 * Positions are per-player relative progress; comparisons must go through
 * absoluteCell() since each seat's progress is relative to its own start.
 */
function findTokenThatCanBlock(state: LudoState, botIdx: number, rpIdx: number, dice: number): number {
  const myTokens = state.players[botIdx].tokens
  const rpCells = new Set(
    state.players[rpIdx].tokens
      .filter((t) => t >= 0 && t <= 50)
      .map((t) => absoluteCell(rpIdx, t))
  )
  if (rpCells.size === 0) return -1

  for (let i = 0; i < myTokens.length; i++) {
    const token = myTokens[i]
    if (token < 0 || token > 50) continue // in base or already in home column
    const newProg = token + dice
    if (newProg > 50) continue // would enter the home column, not a track landing
    const landCell = absoluteCell(botIdx, newProg)
    if (rpCells.has(landCell) && !SAFE_CELLS.has(landCell)) {
      return i
    }
  }
  return -1
}

/**
 * Index of one of this bot's own tokens that sits on the same absolute cell
 * as one of the winner bot's tokens. -1 if none or if this bot is the winner.
 */
function findOwnTokenSharingCellWithWinner(state: LudoState, botIdx: number, winnerIdx: number): number {
  if (winnerIdx === botIdx) return -1
  const myTokens = state.players[botIdx].tokens
  const winnerCells = new Set(
    state.players[winnerIdx].tokens
      .filter((t) => t >= 0 && t <= 50)
      .map((t) => absoluteCell(winnerIdx, t))
  )
  if (winnerCells.size === 0) return -1

  for (let i = 0; i < myTokens.length; i++) {
    const token = myTokens[i]
    if (token < 0 || token > 50) continue
    if (winnerCells.has(absoluteCell(botIdx, token))) {
      return i
    }
  }
  return -1
}

function findSacrificeToken(myTokens: number[]): number {
  for (let i = 0; i < myTokens.length; i++) {
    if (myTokens[i] > 0 && myTokens[i] < 20) {
      return i
    }
  }
  return -1
}

/**
 * Result of moving one specific token, computed without mutating state.
 * `landedCell` is -1 for base entries that immediately enter the home
 * column path or reach HOME (i.e. not on the shared 52-cell track).
 */
interface MoveSimulation {
  landedCell: number
  capturesOpponent: boolean
  reachesHome: boolean
  newProgress: number
}

function simulateMove(state: LudoState, botIdx: number, tokenIndex: number, dice: number): MoveSimulation {
  const player = state.players[botIdx]
  const prog = player.tokens[tokenIndex]
  const newProgress = prog === -1 ? 0 : prog + dice
  const reachesHome = newProgress === HOME_PROGRESS
  const landedCell = newProgress <= 50 ? absoluteCell(botIdx, newProgress) : -1

  let capturesOpponent = false
  if (landedCell !== -1 && !SAFE_CELLS.has(landedCell)) {
    for (let p = 0; p < state.players.length; p++) {
      if (p === botIdx) continue
      const here = state.players[p].tokens.filter((t) => absoluteCell(p, t) === landedCell)
      if (here.length === 1) {
        capturesOpponent = true
        break
      }
    }
  }

  return { landedCell, capturesOpponent, reachesHome, newProgress }
}

/** Would `opponentIdx` be able to capture a token sitting on `cell` next turn (1-6 cells behind)? */
function isExposedTo(state: LudoState, cell: number, opponentIdx: number): boolean {
  if (cell === -1) return false
  for (const tp of state.players[opponentIdx].tokens) {
    const oc = absoluteCell(opponentIdx, tp)
    if (oc === -1) continue
    const dist = (cell - oc + MAIN_TRACK) % MAIN_TRACK
    if (dist >= 1 && dist <= 6) return true
  }
  return false
}

/**
 * Entry point for the elected winner bot's own move choice. Skill tier
 * controls how much the bot looks ahead beyond the plain difficulty-based
 * chooseBotToken logic:
 *  - casual:  tactical booster — capture if available, else prefer a safe
 *             cell, else advance the most-progressed token (same behaviour
 *             as chooseBotToken's 'hard' difficulty).
 *  - skilled: casual + checks whether the resulting cell is within the RP's
 *             striking distance next turn, and avoids that when a
 *             non-exposed alternative exists.
 *  - expert:  scores every legal move by capture/home/progress/RP-threat and
 *             picks the best, with `boldness` tuning how much it favours
 *             racing (high) vs. playing safe (low).
 */
export function chooseWinnerBotToken(
  state: LudoState,
  botIdx: number,
  dice: number,
  skill: WinnerSkill,
  boldness: number
): number {
  const movable = movableTokens(state, botIdx, dice)
  if (movable.length === 0) return -1

  if (skill === 'expert') return chooseWinnerBotTokenExpert(state, botIdx, dice, movable, boldness)
  if (skill === 'skilled') return chooseWinnerBotTokenSkilled(state, botIdx, dice, movable)
  return chooseBotToken(state, botIdx, dice, 'hard')
}

function chooseWinnerBotTokenSkilled(state: LudoState, botIdx: number, dice: number, movable: number[]): number {
  const rpIdx = state.players.findIndex((p) => !p.is_bot)
  const player = state.players[botIdx]

  const capturingMove = findCapturingMove(state, botIdx, dice, movable)
  if (capturingMove !== -1) {
    // A capture is always worth taking, even if it leaves us exposed — the
    // trade is favourable (we removed an opponent token from the board).
    return capturingMove
  }

  const nonExposed = movable.filter((t) => {
    if (rpIdx === -1) return true
    const sim = simulateMove(state, botIdx, t, dice)
    return !isExposedTo(state, sim.landedCell, rpIdx)
  })
  const pool = nonExposed.length > 0 ? nonExposed : movable

  let best = pool[0]
  for (const t of pool) {
    if (player.tokens[t] > player.tokens[best]) best = t
  }
  return best
}

function chooseWinnerBotTokenExpert(
  state: LudoState,
  botIdx: number,
  dice: number,
  movable: number[],
  boldness: number
): number {
  const rpIdx = state.players.findIndex((p) => !p.is_bot)
  const progressWeight = 0.3 + 0.7 * boldness
  const safetyPenaltyWeight = 0.3 + 0.7 * (1 - boldness)
  const CAPTURE_BONUS = 50
  const HOME_BONUS = 100

  let best = movable[0]
  let bestScore = -Infinity
  for (const t of movable) {
    const sim = simulateMove(state, botIdx, t, dice)
    let score = sim.newProgress * progressWeight
    if (sim.reachesHome) score += HOME_BONUS
    if (sim.capturesOpponent) score += CAPTURE_BONUS
    if (rpIdx !== -1 && isExposedTo(state, sim.landedCell, rpIdx)) {
      // Getting captured here sends this token's whole newProgress back to
      // base, not a flat amount — a flat penalty is trivial next to an
      // advanced token's progress and fails to discourage exposing it. Scale
      // the penalty by what's actually at stake.
      score -= sim.newProgress * safetyPenaltyWeight
    }
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}
