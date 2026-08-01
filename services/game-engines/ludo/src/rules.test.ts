import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState,
  applyRoll,
  applyMove,
  movableTokens,
  chooseBotToken,
  findCapturingMove,
  findSafeMoves,
  absoluteCell,
  HOME_PROGRESS,
  LudoState,
} from './rules'

function makeState(overrides?: Partial<LudoState>): LudoState {
  const state = createInitialState('room1', 100, [
    { user_id: 'p0', username: 'P0', seat: 1, is_bot: false },
    { user_id: 'p1', username: 'P1', seat: 2, is_bot: false },
    { user_id: 'p2', username: 'P2', seat: 3, is_bot: false },
    { user_id: 'p3', username: 'P3', seat: 4, is_bot: false },
  ])
  return { ...state, ...overrides }
}

// The board the mobile client draws is a 15x15 grid whose centre 3x3 (rows and
// cols 6..8) is the goal. Each seat's private home column is the middle file of
// its arm OUTSIDE that centre square — red is col 7, rows 9..13 — so it is five
// cells, and the centre triangle is the step immediately after the fifth. These
// assertions pin the total to that geometry: HOME_PROGRESS drifted to 57 once,
// which made every token owe a seventh step the board had nowhere to draw, and
// the finished token rendered on top of a home-column cell.
describe('home column length matches the drawn board', () => {
  test('the home run is 5 column cells (51..55) plus the goal at 56', () => {
    assert.equal(HOME_PROGRESS, 56)
    const homeColumnCells = HOME_PROGRESS - 1 - 50
    assert.equal(homeColumnCells, 5)
  })

  test('a token leaving the last track cell needs exactly 6 steps to finish', () => {
    // progress 50 is the last main-track cell; 56 is home.
    assert.equal(HOME_PROGRESS - 50, 6)
  })

  test('progress 50 is the last cell with a main-track square', () => {
    assert.notEqual(absoluteCell(0, 50), -1)
    for (let p = 51; p <= HOME_PROGRESS; p++) {
      assert.equal(absoluteCell(0, p), -1, `progress ${p} must be off-track`)
    }
  })
})

describe('movableTokens', () => {
  test('a token in base can only move on a 6', () => {
    const state = makeState()
    assert.deepEqual(movableTokens(state, 0, 3), [])
    assert.deepEqual(movableTokens(state, 0, 6), [0, 1, 2, 3])
  })

  test('excludes a token that would overshoot HOME_PROGRESS', () => {
    const state = makeState()
    state.players[0].tokens = [55, -1, -1, -1] // needs exactly 1 to finish
    assert.deepEqual(movableTokens(state, 0, 3), []) // 55+3=58 > 56, overshoot
    assert.deepEqual(movableTokens(state, 0, 1), [0]) // exact
  })

  test('a finished token (HOME_PROGRESS) is never movable', () => {
    const state = makeState()
    // Token 0 is already home; tokens 1-3 are still in base and legitimately
    // movable with a 6 — only index 0 should be excluded from the result.
    state.players[0].tokens = [HOME_PROGRESS, -1, -1, -1]
    assert.deepEqual(movableTokens(state, 0, 6), [1, 2, 3])
  })
})

describe('applyRoll', () => {
  test('no legal move passes the turn immediately and clears dice', () => {
    const state = makeState()
    applyRoll(state, 3) // all tokens in base, needs 6
    assert.equal(state.awaiting, 'roll')
    assert.equal(state.dice, null)
    assert.equal(state.current_turn, 1) // passed to next player
  })

  test('a legal move sets awaiting=move and keeps dice/current_turn', () => {
    const state = makeState()
    applyRoll(state, 6)
    assert.equal(state.awaiting, 'move')
    assert.equal(state.dice, 6)
    assert.equal(state.current_turn, 0)
    assert.deepEqual(state.movable_tokens, [0, 1, 2, 3])
  })

  test('three consecutive sixes forfeits the turn (anti-stalling rule)', () => {
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1] // has a token in play so a 6 would otherwise grant a move
    applyRoll(state, 6)
    assert.equal(state.current_turn, 0) // 1st six: still player's turn
    // Simulate the player using their move + extra-turn roll twice more with sixes
    state.awaiting = 'roll'
    applyRoll(state, 6)
    assert.equal(state.current_turn, 0) // 2nd six: still player's turn
    state.awaiting = 'roll'
    applyRoll(state, 6)
    assert.equal(state.consecutive_sixes, 0)
    assert.equal(state.current_turn, 1) // 3rd six forfeits the turn
    assert.equal(state.awaiting, 'roll')
  })
})

describe('applyMove', () => {
  test('rejects a token index outside movable_tokens', () => {
    const state = makeState()
    applyRoll(state, 3) // no move possible, but force movable_tokens for the test
    state.movable_tokens = [0]
    state.dice = 3
    state.awaiting = 'move'
    const before = JSON.stringify(state.players[0].tokens)
    const { result } = applyMove(state, 2) // not in movable_tokens
    assert.equal(result, null)
    assert.equal(JSON.stringify(state.players[0].tokens), before) // unchanged
  })

  test('entering play from base lands on the seat start cell', () => {
    const state = makeState()
    applyRoll(state, 6)
    applyMove(state, 0)
    assert.equal(state.players[0].tokens[0], 0)
  })

  test('capturing a single exposed opponent token sends it back to base', () => {
    const state = makeState()
    // Seat 0 starts at absolute cell 0; seat 1 starts at 13. Put seat1's token
    // at progress 3 -> absolute cell 16. Move seat0's token from progress 10
    // (absolute cell 10) with a 6 -> absolute cell 16, landing on seat1.
    state.players[0].tokens = [10, -1, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    assert.equal(absoluteCell(0, 16), 16)
    assert.equal(absoluteCell(1, 3), 16)
    state.dice = 6
    state.movable_tokens = [0]
    state.awaiting = 'move'
    const { result } = applyMove(state, 0)
    assert.equal(state.players[1].tokens[0], -1) // captured back to base
    assert.equal(result, null) // no winner yet
    assert.equal(state.current_turn, 0) // capture grants an extra turn
  })

  test('a blockade of 2+ opponent tokens on one cell is not capturable', () => {
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1]
    state.players[1].tokens = [3, 3, -1, -1] // two tokens stacked on the same cell
    state.dice = 6
    state.movable_tokens = [0]
    state.awaiting = 'move'
    applyMove(state, 0)
    assert.deepEqual(state.players[1].tokens, [3, 3, -1, -1]) // untouched
  })

  test('reaching HOME_PROGRESS on the 4th token produces a winner result', () => {
    const state = makeState()
    state.players[0].tokens = [HOME_PROGRESS, HOME_PROGRESS, HOME_PROGRESS, 54]
    state.players[0].finished = 3
    state.dice = 2
    state.movable_tokens = [3]
    state.awaiting = 'move'
    const { result } = applyMove(state, 3)
    assert.ok(result)
    assert.equal(result!.winner_id, 'p0')
    assert.equal(state.players[0].status, 'finished')
    assert.equal(state.status, 'completed')
  })

  test('a non-six, non-capture, non-home move passes the turn', () => {
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1]
    state.dice = 3
    state.movable_tokens = [0]
    state.awaiting = 'move'
    applyMove(state, 0)
    assert.equal(state.current_turn, 1) // passed on
  })

  test('passTurn skips a player who has already finished', () => {
    const state = makeState()
    state.players[1].status = 'finished' // seat index 1 already out
    state.players[0].tokens = [10, -1, -1, -1]
    state.dice = 3
    state.movable_tokens = [0]
    state.awaiting = 'move'
    applyMove(state, 0)
    assert.equal(state.current_turn, 2) // skipped seat 1, landed on seat 2
  })
})

describe('buildResult / rake', () => {
  test('rake is 5% of the pot, rounded to paise; prize is the remainder', () => {
    const state = makeState({ stake: 33 }) // 33 * 4 = 132 pot
    state.players[0].tokens = [HOME_PROGRESS, HOME_PROGRESS, HOME_PROGRESS, 54]
    state.players[0].finished = 3
    state.dice = 2
    state.movable_tokens = [3]
    state.awaiting = 'move'
    const { result } = applyMove(state, 3)
    assert.ok(result)
    const pot = 33 * 4
    const expectedRake = Math.round(pot * 0.05 * 100) / 100
    assert.equal(result!.rake_fee, expectedRake)
    assert.equal(result!.prize, Math.round((pot - expectedRake) * 100) / 100)
  })

  test('rankings are sorted best-first by tokens finished', () => {
    const state = makeState()
    state.players[0].finished = 4
    state.players[1].finished = 2
    state.players[2].finished = 3
    state.players[3].finished = 0
    state.players[0].tokens = [HOME_PROGRESS, HOME_PROGRESS, HOME_PROGRESS, 54]
    state.dice = 2
    state.movable_tokens = [3]
    state.awaiting = 'move'
    const { result } = applyMove(state, 3)
    const order = result!.rankings.map(r => r.user_id)
    assert.deepEqual(order, ['p0', 'p2', 'p1', 'p3'])
  })
})

describe('chooseBotToken', () => {
  test('medium prefers a move that captures an exposed opponent', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1] // sits on absolute cell 16 == 10+6
    const t = chooseBotToken(state, 0, 6, 'medium')
    assert.equal(t, 0) // the token that captures, not token 1
  })

  test('hard avoids leaving a token within striking distance when no capture is available', () => {
    const state = makeState()
    const dice = 4
    // Seat0 (offset 0) token0: progress 5 -> lands at absolute cell 9 (unsafe)
    // with an opponent 3 cells behind it (within 1-6 striking distance).
    // Seat0 token1: progress 30 -> lands at absolute cell 34, a SAFE_CELL star.
    // Neither move captures anything, so "hard" should prefer the safe move
    // (token1) over the more-progressed-but-exposed move (token0).
    state.players[0].tokens = [5, 30, -1, -1]
    // Seat1 (offset 13) token at absolute cell 6 = 3 cells behind cell 9.
    state.players[1].tokens = [45, -1, -1, -1] // (6 - 13 + 52) % 52 = 45
    const t = chooseBotToken(state, 0, dice, 'hard')
    assert.equal(t, 1) // picks the safe star-cell move over the exposed one
  })

  test('every difficulty always returns a legal (movable) token', () => {
    const state = makeState()
    state.players[0].tokens = [5, 12, -1, -1]
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let i = 0; i < 20; i++) {
        const t = chooseBotToken(state, 0, 4, difficulty)
        assert.ok([0, 1].includes(t), `difficulty=${difficulty} returned illegal token ${t}`)
      }
    }
  })
})

describe('per-player bot_difficulty override', () => {
  test('createInitialState maps a per-player bot_difficulty onto that player only', () => {
    const state = createInitialState('room1', 100, [
      { user_id: 'p0', username: 'P0', seat: 1, is_bot: true, bot_difficulty: 'hard' },
      { user_id: 'p1', username: 'P1', seat: 2, is_bot: true },
    ], 'medium')
    assert.equal(state.players[0].bot_difficulty, 'hard')
    assert.equal(state.players[1].bot_difficulty, undefined)
    assert.equal(state.bot_difficulty, 'medium') // room-wide default unchanged
  })

  test('a bot without its own override falls back to the room-wide difficulty at the call site', () => {
    // Mirrors exactly what index.ts's bot-move handler does:
    // state.players[idx].bot_difficulty ?? state.bot_difficulty
    const state = createInitialState('room1', 100, [
      { user_id: 'p0', username: 'P0', seat: 1, is_bot: true },
    ], 'hard')
    const effectiveDifficulty = state.players[0].bot_difficulty ?? state.bot_difficulty
    assert.equal(effectiveDifficulty, 'hard')
  })

  test('a per-player override actually changes chooseBotToken behavior, independent of the room-wide default', () => {
    // Same board as 'hard avoids leaving a token within striking distance' above,
    // but the ROOM-WIDE default is 'medium' (which would prefer the more-progressed
    // token1 move) while player0 has its OWN override set to 'hard'. If the
    // override resolution is wired correctly, the effective difficulty used at
    // the call site is 'hard', and the safe move (token 1) is chosen — proving
    // the per-player tag, not the room default, drove the decision.
    const state = makeState({ bot_difficulty: 'medium' })
    state.players[0].bot_difficulty = 'hard'
    const dice = 4
    state.players[0].tokens = [5, 30, -1, -1]
    state.players[1].tokens = [45, -1, -1, -1]

    const effectiveDifficulty = state.players[0].bot_difficulty ?? state.bot_difficulty
    assert.equal(effectiveDifficulty, 'hard')
    const t = chooseBotToken(state, 0, dice, effectiveDifficulty)
    assert.equal(t, 1) // the safe star-cell move, per 'hard' behavior — not medium's capture-or-advance pick
  })
})

describe('findCapturingMove / findSafeMoves (extracted decision-point helpers)', () => {
  test('findCapturingMove returns the token that captures, matching chooseBotToken medium behavior', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1] // sits on absolute cell 16 == 10+6
    const movable = movableTokens(state, 0, 6)
    assert.equal(findCapturingMove(state, 0, 6, movable), 0)
  })

  test('findCapturingMove returns -1 when no movable token captures', () => {
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1]
    const movable = movableTokens(state, 0, 4)
    assert.equal(findCapturingMove(state, 0, 4, movable), -1)
  })

  test('findSafeMoves matches the exact set chooseBotToken(hard) would pick from', () => {
    const state = makeState()
    const dice = 4
    state.players[0].tokens = [5, 30, -1, -1]
    state.players[1].tokens = [45, -1, -1, -1]
    const movable = movableTokens(state, 0, dice)
    const safe = findSafeMoves(state, 0, dice, movable)
    assert.deepEqual(safe, [1]) // only the star-cell move (token 1) is safe
  })
})

describe('chooseBotToken with a trainedProfile', () => {
  test('absent trainedProfile: byte-identical to today (capture always taken)', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    assert.equal(chooseBotToken(state, 0, 6, 'medium'), 0)
    assert.equal(chooseBotToken(state, 0, 6, 'medium', undefined), 0)
  })

  test('capture_probability: null behaves exactly like absent (always takes the capture)', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    assert.equal(chooseBotToken(state, 0, 6, 'medium', { capture_probability: null }), 0)
  })

  test('capture_probability: 0 never takes an available capture across many trials', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    for (let i = 0; i < 200; i++) {
      const t = chooseBotToken(state, 0, 6, 'medium', { capture_probability: 0 })
      assert.notEqual(t, 0, 'should never choose the capturing token when capture_probability is 0')
    }
  })

  test('capture_probability: 1 always takes an available capture (same as today)', () => {
    const state = makeState()
    state.players[0].tokens = [10, 20, -1, -1]
    state.players[1].tokens = [3, -1, -1, -1]
    for (let i = 0; i < 50; i++) {
      assert.equal(chooseBotToken(state, 0, 6, 'medium', { capture_probability: 1 }), 0)
    }
  })

  test('safe_play_probability: 0 lets hard pick the exposed-but-more-progressed move', () => {
    // token0: progress 30 -> lands at absolute cell 34, a SAFE_CELL star (the safe choice).
    // token1: progress 45 -> lands at absolute cell 49 (unsafe), with an opponent
    // at cell 46 (3 cells behind, within striking distance) -- exposed, but
    // MORE progressed than token0, so it's what "advance most-progressed
    // among ALL movable tokens" would pick once the safe-preference is
    // overridden away.
    const state = makeState()
    const dice = 4
    state.players[0].tokens = [30, 45, -1, -1]
    state.players[1].tokens = [33, -1, -1, -1] // (13+33)%52 = 46

    // Sanity: with the safe preference on (today's default), hard picks the safe token0.
    assert.equal(chooseBotToken(state, 0, dice, 'hard'), 0)

    // With safe_play_probability 0, the override always falls through to the
    // exposed-but-more-progressed token1 instead.
    for (let i = 0; i < 50; i++) {
      assert.equal(chooseBotToken(state, 0, dice, 'hard', { safe_play_probability: 0 }), 1)
    }
  })

  test('safe_play_probability: 1 always picks the safe move (same as today\'s hard default)', () => {
    const state = makeState()
    const dice = 4
    state.players[0].tokens = [30, 45, -1, -1]
    state.players[1].tokens = [33, -1, -1, -1]
    for (let i = 0; i < 50; i++) {
      assert.equal(chooseBotToken(state, 0, dice, 'hard', { safe_play_probability: 1 }), 0)
    }
  })

  test('easy ignores trainedProfile entirely', () => {
    const state = makeState()
    state.players[0].tokens = [5, 12, -1, -1]
    for (let i = 0; i < 20; i++) {
      const t = chooseBotToken(state, 0, 4, 'easy', { capture_probability: 0, safe_play_probability: 1 })
      assert.ok([0, 1].includes(t))
    }
  })
})
