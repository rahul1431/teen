import crypto from 'crypto'
// ── Ludo rules engine (pure, no I/O) ──────────────────────────────────────
//
// Board model (standard 4-player Ludo):
//  - One shared 52-cell main track, absolute cells 0..51.
//  - Each seat has a fixed start offset on that track:
//      seat 0 → 0, seat 1 → 13, seat 2 → 26, seat 3 → 39.
//  - A token's per-player "progress" runs 0..57:
//      -1            → in base (yard), needs a 6 to enter play
//       0..50        → on the main track; absolute cell = (offset + progress) % 52
//       51..56       → in the 6-cell home column (private to that seat)
//       57           → HOME (finished); reached only by an exact roll
//  - Safe cells (no capture): every seat start (0,13,26,39) and the four
//    star squares (8,21,34,47), all in absolute-cell terms.

export const MAIN_TRACK = 52
export const HOME_PROGRESS = 56
export const TOKENS_PER_PLAYER = 4
export const START_OFFSETS = [0, 13, 26, 39]
export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47])
export const COLORS = ['red', 'green', 'yellow', 'blue']

export interface LudoPlayer {
  user_id: string
  username: string
  seat: number          // 1-based seat number from the gateway
  is_bot: boolean
  color: string
  tokens: number[]       // progress for each of the 4 tokens
  finished: number       // count of tokens that reached HOME
  status: string         // 'active' | 'finished' | 'disconnected'
  bot_difficulty?: BotDifficulty // per-bot override; unset = use LudoState.bot_difficulty
  capture_probability?: number | null // trained (sub-project #3); null/unset = deterministic rule
  safe_play_probability?: number | null
}

export type BotDifficulty = 'easy' | 'medium' | 'hard'

export interface LudoState {
  room_id: string
  game_type: 'ludo'
  stake: number
  players: LudoPlayer[]
  status: 'active' | 'completed'
  current_turn: number   // index into players[]
  dice: number | null    // last rolled value (null before a roll)
  movable_tokens: number[] // token indices the current player may move now
  awaiting: 'roll' | 'move'
  consecutive_sixes: number
  winner_id: string | null
  round: number
  created_at: number
  bot_difficulty: BotDifficulty
}

export interface ActionResult {
  winner_id: string | null   // null when a game ends with no winner (all real players left)
  prize: number
  rake_fee: number
  rankings: { user_id: string; finished: number }[]
}

/** Absolute main-track cell for a token, or -1 if in base/home column. */
export function absoluteCell(seatIndex: number, progress: number): number {
  if (progress < 0 || progress > 50) return -1
  return (START_OFFSETS[seatIndex % 4] + progress) % MAIN_TRACK
}

export function createInitialState(
  roomId: string,
  stake: number,
  players: { user_id: string; username: string; seat: number; is_bot: boolean; bot_difficulty?: BotDifficulty; capture_probability?: number | null; safe_play_probability?: number | null }[],
  botDifficulty: BotDifficulty = 'medium',
): LudoState {
  return {
    room_id: roomId,
    game_type: 'ludo',
    stake,
    players: players.map((p, i) => ({
      user_id: p.user_id,
      username: p.username,
      seat: p.seat,
      is_bot: p.is_bot,
      color: COLORS[i % 4],
      tokens: [-1, -1, -1, -1],
      finished: 0,
      status: 'active',
      bot_difficulty: p.bot_difficulty,
      capture_probability: p.capture_probability,
      safe_play_probability: p.safe_play_probability,
    })),
    status: 'active',
    current_turn: 0,
    dice: null,
    movable_tokens: [],
    awaiting: 'roll',
    consecutive_sixes: 0,
    winner_id: null,
    round: 1,
    created_at: Date.now(),
    bot_difficulty: botDifficulty,
  }
}

/** Which of a player's tokens can legally move with the given dice value. */
export function movableTokens(state: LudoState, playerIdx: number, dice: number): number[] {
  const player = state.players[playerIdx]
  const movable: number[] = []
  for (let t = 0; t < player.tokens.length; t++) {
    const prog = player.tokens[t]
    if (prog === HOME_PROGRESS) continue          // already home
    if (prog === -1) {
      if (dice === 6) movable.push(t)              // only a 6 leaves base
      continue
    }
    if (prog + dice <= HOME_PROGRESS) movable.push(t) // must not overshoot home
  }
  return movable
}

/**
 * Apply a dice roll for the current player. Returns the updated state and a
 * flag describing what happens next:
 *  - awaiting 'move'  → player must choose a token (movable_tokens populated)
 *  - awaiting 'roll'  → no legal move; turn passed to the next player
 */
export function applyRoll(state: LudoState, dice: number): LudoState {
  const idx = state.current_turn
  state.dice = dice

  // Three consecutive 6s forfeits the turn (anti-stalling rule).
  if (dice === 6) {
    state.consecutive_sixes += 1
    if (state.consecutive_sixes >= 3) {
      state.consecutive_sixes = 0
      passTurn(state)
      return state
    }
  }

  const movable = movableTokens(state, idx, dice)
  if (movable.length === 0) {
    // No move possible. A 6 with nothing to move still ends the turn.
    if (dice !== 6) state.consecutive_sixes = 0
    passTurn(state)
    return state
  }

  state.movable_tokens = movable
  state.awaiting = 'move'
  return state
}

/**
 * Move one token of the current player. Returns { state, result } where result
 * is non-null once a player has gotten all four tokens home.
 */
export function applyMove(
  state: LudoState,
  tokenIndex: number,
): { state: LudoState; result: ActionResult | null } {
  const idx = state.current_turn
  const player = state.players[idx]
  const dice = state.dice ?? 0

  if (!state.movable_tokens.includes(tokenIndex)) {
    // Illegal pick — leave state untouched for the caller to reject.
    return { state, result: null }
  }

  let capturedSomething = false
  const prog = player.tokens[tokenIndex]

  if (prog === -1) {
    // Enter play onto the seat's start cell.
    player.tokens[tokenIndex] = 0
  } else {
    player.tokens[tokenIndex] = prog + dice
  }

  const newProg = player.tokens[tokenIndex]
  let reachedHome = false

  if (newProg === HOME_PROGRESS) {
    player.finished += 1
    reachedHome = true
    if (player.finished >= TOKENS_PER_PLAYER) player.status = 'finished'
  } else {
    // Capture: if we landed on a non-safe main-track cell holding exactly one
    // opponent token, send that token back to base.
    const landedCell = absoluteCell(idx, newProg)
    if (landedCell !== -1 && !SAFE_CELLS.has(landedCell)) {
      capturedSomething = captureAt(state, idx, landedCell)
    }
  }

  // Decide the next turn. A 6, a capture, or sending a token home grants an
  // extra roll; otherwise play passes on.
  const extraTurn = dice === 6 || capturedSomething || reachedHome

  state.dice = null
  state.movable_tokens = []
  state.awaiting = 'roll'

  // Win: first player to bring all four tokens home takes the pot.
  if (player.status === 'finished') {
    return { state, result: buildResult(state, player) }
  }

  if (!extraTurn) {
    state.consecutive_sixes = 0
    passTurn(state)
  }

  return { state, result: null }
}

/** Send any single opponent token on `cell` back to base. Returns true if so. */
function captureAt(state: LudoState, moverIdx: number, cell: number): boolean {
  for (let p = 0; p < state.players.length; p++) {
    if (p === moverIdx) continue
    const other = state.players[p]
    const here: number[] = []
    for (let t = 0; t < other.tokens.length; t++) {
      if (absoluteCell(p, other.tokens[t]) === cell) here.push(t)
    }
    // A blockade (2+ tokens) is not capturable.
    if (here.length === 1) {
      other.tokens[here[0]] = -1
      return true
    }
  }
  return false
}

function passTurn(state: LudoState): void {
  state.awaiting = 'roll'
  state.dice = null
  state.movable_tokens = []
  const n = state.players.length
  let next = state.current_turn
  // Skip players who are no longer in play — finished all four tokens, or
  // left the table (disconnected/forfeited). Only 'active' players take turns.
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n
    if (state.players[next].status === 'active') break
  }
  if (next <= state.current_turn) state.round += 1
  state.current_turn = next
}

function buildResult(state: LudoState, winner: LudoPlayer | null): ActionResult {
  const pot = state.stake * state.players.length
  const rakeFee = winner ? Math.round(pot * 0.05 * 100) / 100 : 0
  const prize = winner ? Math.round((pot - rakeFee) * 100) / 100 : 0
  state.status = 'completed'
  state.winner_id = winner ? winner.user_id : null
  return {
    winner_id: winner ? winner.user_id : null,
    prize,
    rake_fee: rakeFee,
    rankings: [...state.players]
      .sort((a, b) => b.finished - a.finished)
      .map(p => ({ user_id: p.user_id, finished: p.finished })),
  }
}

/**
 * A real player left the table (tapped Leave — a deliberate forfeit, not a
 * transient network drop). The leaver forfeits their stake (settled into the
 * pot at game end), their tokens go back to base, and they're removed from
 * the turn rotation. Then:
 *   - if no real (non-bot) players remain active → the game ends with no
 *     winner (e.g. the lone human in a vs-bots game left);
 *   - if exactly one active player remains → that player wins the pot;
 *   - otherwise the game continues with whoever is left (no bot backfills the
 *     vacated seat).
 * Returns a non-null result once the game has ended.
 */
export function forfeitPlayer(
  state: LudoState,
  userId: string,
): { state: LudoState; result: ActionResult | null } {
  const player = state.players.find(p => p.user_id === userId)
  if (!player || player.status !== 'active') return { state, result: null }

  const wasCurrent = state.players[state.current_turn]?.user_id === userId
  player.status = 'disconnected'
  player.tokens = [-1, -1, -1, -1]
  player.finished = 0

  const active = state.players.filter(p => p.status === 'active')
  const activeHumans = active.filter(p => !p.is_bot)

  // No real players left → end with no winner; every lock is consumed (the
  // leaver's stake is forfeited, not refunded).
  if (activeHumans.length === 0) {
    return { state, result: buildResult(state, null) }
  }
  // Last player standing takes the pot.
  if (active.length === 1) {
    return { state, result: buildResult(state, active[0]) }
  }
  // Game continues. If the leaver was on turn, advance to the next active
  // player; the roll/move state is reset so the new player rolls fresh.
  if (wasCurrent) passTurn(state)
  return { state, result: null }
}

/** Cryptographically secure die roll (1..6). The engine is server-authoritative. */
export function rollDie(): number {
  return crypto.randomInt(1, 7)
}

/**
 * Pick a token for a bot to move from the allowed set. Strategy scales with
 * difficulty:
 *  - easy:   mostly plays a random legal move (rarely hunts captures) so
 *            newer players have room to win against easy bots.
 *  - medium: prefer a capture, then advance the most-progressed token.
 *  - hard:   same as medium, but when no capture is available it also avoids
 *            leaving a token within an opponent's striking distance (1-6
 *            cells behind, on an unsafe cell) if a non-exposed move exists.
 */
/** The first movable token that would capture an opponent this turn, or -1. */
export function findCapturingMove(state: LudoState, playerIdx: number, dice: number, movable: number[]): number {
  const player = state.players[playerIdx]
  for (const t of movable) {
    const prog = player.tokens[t]
    if (prog === -1) continue
    const cell = absoluteCell(playerIdx, prog + dice)
    if (cell !== -1 && !SAFE_CELLS.has(cell)) {
      for (let p = 0; p < state.players.length; p++) {
        if (p === playerIdx) continue
        const here = state.players[p].tokens.filter((tp) => absoluteCell(p, tp) === cell)
        if (here.length === 1) return t
      }
    }
  }
  return -1
}

/** Of the movable tokens, which would NOT leave the token exposed (within an opponent's 1-6 cell striking distance) after this move. */
export function findSafeMoves(state: LudoState, playerIdx: number, dice: number, movable: number[]): number[] {
  const player = state.players[playerIdx]
  return movable.filter((t) => {
    const prog = player.tokens[t]
    if (prog === -1) return true // entering play this turn is never "exposed" yet
    const cell = absoluteCell(playerIdx, prog + dice)
    if (cell === -1 || SAFE_CELLS.has(cell)) return true
    for (let p = 0; p < state.players.length; p++) {
      if (p === playerIdx) continue
      for (const tp of state.players[p].tokens) {
        const oc = absoluteCell(p, tp)
        if (oc === -1) continue
        const dist = (cell - oc + MAIN_TRACK) % MAIN_TRACK
        if (dist >= 1 && dist <= 6) return false
      }
    }
    return true
  })
}

export function chooseBotToken(
  state: LudoState,
  playerIdx: number,
  dice: number,
  difficulty: BotDifficulty = 'medium',
  trainedProfile?: { capture_probability?: number | null; safe_play_probability?: number | null },
): number {
  const movable = movableTokens(state, playerIdx, dice)
  if (movable.length === 0) return -1
  const player = state.players[playerIdx]

  if (difficulty === 'easy' && Math.random() < 0.8) {
    return movable[Math.floor(Math.random() * movable.length)]
  }

  const capturingMove = findCapturingMove(state, playerIdx, dice, movable)
  if (capturingMove !== -1) {
    const captureProbability = trainedProfile?.capture_probability
    if (captureProbability == null || Math.random() < captureProbability) {
      return capturingMove
    }
    // Trained data says: at this rate, a real player would NOT take this
    // capture. Fall through to the same advance-most-progressed logic
    // used when there's genuinely no capture available.
  }

  if (difficulty === 'hard') {
    const safeMoves = findSafeMoves(state, playerIdx, dice, movable)
    if (safeMoves.length > 0) {
      const safePlayProbability = trainedProfile?.safe_play_probability
      if (safePlayProbability == null || Math.random() < safePlayProbability) {
        let best = safeMoves[0]
        for (const t of safeMoves) if (player.tokens[t] > player.tokens[best]) best = t
        return best
      }
      // Trained data says: at this rate, a real player would take the
      // exposed move anyway. Fall through to advance-most-progressed
      // over ALL movable tokens (not just the safe subset).
    }
  }

  // Otherwise advance the most-progressed movable token.
  let best = movable[0]
  for (const t of movable) {
    if (player.tokens[t] > player.tokens[best]) best = t
  }
  return best
}
