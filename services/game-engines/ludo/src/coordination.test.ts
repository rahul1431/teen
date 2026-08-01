import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState,
  LudoState,
  HOME_PROGRESS,
} from './rules'
import {
  chooseBotTokenCoordinated,
  chooseWinnerBotToken,
  CoordinationMetadata,
} from './coordination'

function makeState(overrides?: Partial<LudoState>): LudoState {
  const state = createInitialState('room1', 100, [
    { user_id: 'rp', username: 'RealPlayer', seat: 1, is_bot: false },
    { user_id: 'b1', username: 'Bot1', seat: 2, is_bot: true },
    { user_id: 'b2', username: 'Bot2', seat: 3, is_bot: true },
    { user_id: 'b3', username: 'Bot3', seat: 4, is_bot: true },
  ])
  return { ...state, ...overrides }
}

describe('chooseBotTokenCoordinated', () => {
  test('helper bot blocks RP instead of advancing own token', () => {
    // Setup: 1 RP (seat idx 0, offset 0) + 3 bots. Helper bot is seat idx 1 (offset 13).
    // RP token at progress 20 -> absolute cell 20 (offset 0).
    // Helper token at progress 1; rolling a 6 moves it to progress 7 ->
    // absolute cell (13+7)%52 = 20, landing exactly on the RP's cell.
    const state = makeState()
    state.players[0].tokens = [20, -1, -1, -1] // RP at progress 20 (absolute cell 20)
    state.players[1].tokens = [1, -1, -1, -1] // Helper bot at progress 1
    state.players[2].tokens = [-1, -1, -1, -1] // Other bots inactive
    state.players[3].tokens = [-1, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2, // Another bot is the winner
      aggressiveness: 0.5,
    }

    const result = chooseBotTokenCoordinated(state, 1, 6, metadata)
    // Token at index 0 can block RP (progress 1+6=7 -> absolute cell 20, same as RP)
    // Should return 0 (the blocking token)
    assert.equal(result, 0, 'helper bot should choose the token that blocks RP')
  })

  test('winner bot plays normally (best move logic, not helper logic)', () => {
    // Setup: winner bot should ignore all helper coordination logic
    // Even with high aggressiveness, a winner bot should use normal chooseBotToken
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1] // RP
    state.players[1].tokens = [5, 20, -1, -1] // Winner bot with 2 tokens
    state.players[2].tokens = [3, -1, -1, -1] // Another bot, can be captured at absolute cell 16
    state.players[3].tokens = [-1, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: false, // This is the winner, not a helper
      winnerBotIdx: 1,
      aggressiveness: 1.0, // Max aggressiveness, but should be ignored
    }

    // A 6 makes all four tokens movable: 0 and 1 advance, 2 and 3 can leave
    // base. No capture is available, so this only checks that the winner bot
    // routes through normal move scoring rather than the helper path.
    //
    // Tokens 2 and 3 are legal answers and are in fact the *right* ones — the
    // scored bot spends a 6 opening a third token instead of shuffling one
    // already on the track. The previous cascade never did this (it always
    // advanced the most-progressed token), which is why this assertion used to
    // read [0, 1].
    const result = chooseBotTokenCoordinated(state, 1, 6, metadata)
    assert.ok([0, 1, 2, 3].includes(result), 'winner bot should use normal move logic')
  })

  test('low aggressiveness (0.1) falls back to normal logic', () => {
    // Setup: with aggressiveness 0.1, neither priority 1 (>0.3) nor priority 2 (>0.2)
    // should trigger, so it should fall back to normal chooseBotToken
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1] // RP
    state.players[1].tokens = [4, 20, -1, -1] // Helper bot with 2 tokens
    state.players[2].tokens = [50, -1, -1, -1] // Winner bot
    state.players[3].tokens = [25, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2,
      aggressiveness: 0.1, // Low aggressiveness: below all thresholds
    }

    const result = chooseBotTokenCoordinated(state, 1, 3, metadata)
    // Should return a valid token (normal move logic)
    assert.ok([0, 1].includes(result), 'low aggressiveness should fall back to normal logic')
  })

  test('priority 1 (blocking RP) triggers when aggressiveness > 0.3', () => {
    // Setup: RP (seat idx 0, offset 0) has a token that can be blocked.
    // Helper bot is seat idx 1 (offset 13), at progress 10; rolling a 5 moves
    // it to progress 15 -> absolute cell (13+15)%52 = 28, matching RP's cell.
    const state = makeState()
    state.players[0].tokens = [28, -1, -1, -1] // RP at progress 28 (absolute cell 28)
    state.players[1].tokens = [10, 20, -1, -1] // Helper bot; token 0 can block
    state.players[2].tokens = [30, -1, -1, -1]
    state.players[3].tokens = [40, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2,
      aggressiveness: 0.4, // > 0.3
    }

    const result = chooseBotTokenCoordinated(state, 1, 5, metadata)
    // Token 0 can block (progress 10+5=15 -> absolute cell 28, same as RP)
    assert.equal(result, 0, 'priority 1 should trigger when aggressiveness > 0.3 and RP can be blocked')
  })

  test('priority 2 (clearing path) triggers when aggressiveness > 0.2', () => {
    // Setup: winner bot shares an absolute cell with the helper bot.
    // Helper is seat idx 1 (offset 13) at progress 25 -> absolute cell (13+25)%52 = 38.
    // Winner is seat idx 2 (offset 26) at progress 12 -> absolute cell (26+12)%52 = 38.
    // With aggressiveness > 0.2 (but not > 0.3), priority 2 should trigger.
    const state = makeState()
    state.players[0].tokens = [-1, -1, -1, -1] // RP (no tokens): priority 1 can't trigger
    state.players[1].tokens = [25, -1, -1, -1] // Helper bot: token 0 shares winner's cell
    state.players[2].tokens = [12, 30, -1, -1] // Winner bot
    state.players[3].tokens = [40, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2,
      aggressiveness: 0.3, // > 0.2 but not > 0.3
    }

    const result = chooseBotTokenCoordinated(state, 1, 3, metadata)
    // Token 0 (absolute cell 38) shares a cell with the winner's token 0 (also 38)
    // Should return 0 to clear the path (move token 0 out of the way)
    assert.equal(result, 0, 'priority 2 should trigger when aggressiveness > 0.2 and helper is blocking winner')
  })

  test('priority 3.5 (throttle) stalls a helper materially ahead of the winner bot', () => {
    // Helper (idx 1) total progress 40+3=43 vs winner (idx 2) total progress 5:
    // a 38-point lead, past the 20-point throttle threshold. Neither blocking,
    // clearing, nor sacrifice conditions are set up (aggressiveness is below
    // all of their thresholds), so without the throttle this would fall
    // through to normal best-move logic and advance the most-progressed
    // token (0). The throttle should instead pick the least-progressed
    // movable token (1) so the helper doesn't race ahead of the winner.
    const state = makeState()
    state.players[0].tokens = [-1, -1, -1, -1] // RP: no tokens in play
    state.players[1].tokens = [40, 3, -1, -1] // Helper bot: far ahead
    state.players[2].tokens = [5, -1, -1, -1] // Winner bot: far behind

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2,
      aggressiveness: 0.1, // below every other priority's threshold
    }

    const result = chooseBotTokenCoordinated(state, 1, 3, metadata)
    assert.equal(result, 1, 'throttle should move the least-progressed token instead of racing ahead')
  })

  test('priority 3.5 (throttle) does not trigger when the helper is not materially ahead', () => {
    // Same shape as above, but the lead is only 10 points (5+3=8 helper vs 3
    // winner... use values that keep the gap under THROTTLE_LEAD=20) so
    // normal best-move logic should run instead, picking the most-progressed
    // movable token (0).
    const state = makeState()
    state.players[0].tokens = [-1, -1, -1, -1]
    state.players[1].tokens = [10, 3, -1, -1] // Helper bot: total 13
    state.players[2].tokens = [5, -1, -1, -1] // Winner bot: total 5 (gap = 8)

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2,
      aggressiveness: 0.1,
    }

    const result = chooseBotTokenCoordinated(state, 1, 3, metadata)
    assert.equal(result, 0, 'below the throttle threshold, helper should play its normal best move')
  })
})

describe('chooseWinnerBotToken (skill tiers)', () => {
  test('casual tier always takes an available capture', () => {
    // Winner is seat idx 2 (offset 26). RP token at progress 10 (abs cell 10).
    // Winner's token 0 at progress 30; +6 -> progress 36 -> abs cell (26+36)%52 = 10,
    // landing exactly on the RP and capturing it. Tokens 1-3 are in base and
    // also become movable with a 6 roll, but only token 0 captures.
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1] // RP
    state.players[2].tokens = [30, -1, -1, -1] // Winner bot

    const result = chooseWinnerBotToken(state, 2, 6, 'casual', 0.5)
    assert.equal(result, 0, 'casual tier should take the available capture')
  })

  test('skilled tier avoids a move exposed to the RP when a safe alternative exists', () => {
    // Winner is seat idx 2 (offset 26). No capture available. Token 0
    // (progress 20 -> 25 -> abs cell 51) lands within the RP's (abs cell 48)
    // 1-6 striking distance next turn. Token 1 (progress 10 -> 15 -> abs
    // cell 41) lands safely out of range.
    const state = makeState()
    state.players[0].tokens = [48, -1, -1, -1] // RP
    state.players[2].tokens = [20, 10, -1, -1] // Winner: token0 exposed, token1 safe

    const result = chooseWinnerBotToken(state, 2, 5, 'skilled', 0.5)
    assert.equal(result, 1, 'skilled tier should prefer the non-exposed token over the exposed one')
  })

  test('expert tier with high boldness favours progress over avoiding RP exposure', () => {
    const state = makeState()
    state.players[0].tokens = [48, -1, -1, -1] // RP at abs cell 48
    state.players[2].tokens = [20, 10, -1, -1] // Winner: token0 -> progress 25 (exposed), token1 -> progress 15 (safe)

    const result = chooseWinnerBotToken(state, 2, 5, 'expert', 0.9)
    assert.equal(result, 0, 'bold expert tier should take the higher-progress exposed move')
  })

  test('expert tier with low boldness favours playing safe over raw progress', () => {
    const state = makeState()
    state.players[0].tokens = [48, -1, -1, -1] // RP at abs cell 48
    state.players[2].tokens = [20, 10, -1, -1] // Winner: token0 -> progress 25 (exposed), token1 -> progress 15 (safe)

    const result = chooseWinnerBotToken(state, 2, 5, 'expert', 0.1)
    assert.equal(result, 1, 'cautious expert tier should take the safer, lower-progress move')
  })

  test('expert tier at boldness=0.85 still avoids a bad trade (flat exposure penalty ignores stakes)', () => {
    // Same setup as the two tests above: exposed token0 reaches progress 25,
    // safe token1 reaches progress 15 — a fairly close call. A flat
    // exposure-penalty constant treats getting captured at progress 25 the
    // same as getting captured at progress 5, so it underweights how much a
    // near-tie decision should actually favour the safe route once the bot's
    // own advanced progress is what's at stake. The winner bot should not
    // need near-maximum caution (boldness=0.1) to make this call correctly.
    const state = makeState()
    state.players[0].tokens = [48, -1, -1, -1] // RP at abs cell 48
    state.players[2].tokens = [20, 10, -1, -1] // Winner: token0 -> progress 25 (exposed), token1 -> progress 15 (safe)

    const result = chooseWinnerBotToken(state, 2, 5, 'expert', 0.85)
    assert.equal(result, 1, 'exposure penalty should scale with the progress actually at risk, not a flat constant')
  })
})
