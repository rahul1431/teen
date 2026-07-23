import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState,
  LudoState,
  HOME_PROGRESS,
} from './rules'
import {
  chooseBotTokenCoordinated,
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
    // Setup: 1 RP + 3 bots
    // RP token at progress 10 (absolute cell 10 for seat 0)
    // Helper bot (b1) at progress 4 (absolute cell 17 for seat 1)
    // If helper rolls a 6, it could move token to 4+6=10, landing on RP
    // With aggressiveness > 0.3, it should choose to block (return token index)
    const state = makeState()
    state.players[0].tokens = [10, -1, -1, -1] // RP at progress 10
    state.players[1].tokens = [4, -1, -1, -1] // Helper bot at progress 4
    state.players[2].tokens = [-1, -1, -1, -1] // Other bots inactive
    state.players[3].tokens = [-1, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2, // Another bot is the winner
      aggressiveness: 0.5,
    }

    const result = chooseBotTokenCoordinated(state, 1, 6, metadata)
    // Token at index 0 can block RP (4+6=10, landing on RP at 10)
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

    // With a 6 roll: token 0 moves from 5 -> 11, token 1 moves from 20 -> 26
    // Token at index 0 (from seat 1 offset 13) -> progress 5 = absolute cell 18 (13+5)
    // Other bot token at seat 2 offset 26, progress 3 = absolute cell 29 (26+3)
    // No direct capture scenario here, but winner should use normal logic
    const result = chooseBotTokenCoordinated(state, 1, 6, metadata)
    // Result should be a valid token index (0 or 1)
    assert.ok([0, 1].includes(result), 'winner bot should use normal move logic')
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
    // Setup: RP has a token that can be blocked
    // Helper bot can block it on the current roll
    // With aggressiveness > 0.3, priority 1 should trigger
    const state = makeState()
    // RP token at progress 15
    state.players[0].tokens = [15, -1, -1, -1]
    // Helper bot at progress 10, can move to 15 with a 5-roll
    state.players[1].tokens = [10, 20, -1, -1]
    state.players[2].tokens = [30, -1, -1, -1]
    state.players[3].tokens = [40, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2,
      aggressiveness: 0.4, // > 0.3
    }

    const result = chooseBotTokenCoordinated(state, 1, 5, metadata)
    // Token 0 can block (10+5=15)
    assert.equal(result, 0, 'priority 1 should trigger when aggressiveness > 0.3 and RP can be blocked')
  })

  test('priority 2 (clearing path) triggers when aggressiveness > 0.2', () => {
    // Setup: winner bot has a token blocked by helper bot
    // With aggressiveness > 0.2 (but not > 0.3), priority 2 should trigger
    // Priority 1 check: no RP tokens or aggressiveness <= 0.3, so skip
    // Priority 2 check: aggressiveness > 0.2 and helper is blocking winner
    const state = makeState()
    state.players[0].tokens = [-1, -1, -1, -1] // RP (no tokens)
    // Helper bot: tokens at position 25
    state.players[1].tokens = [25, -1, -1, -1]
    // Winner bot: also has token at position 25 (same cell, blocked)
    state.players[2].tokens = [25, 30, -1, -1]
    state.players[3].tokens = [40, -1, -1, -1]

    const metadata: CoordinationMetadata = {
      isHelper: true,
      winnerBotIdx: 2,
      aggressiveness: 0.3, // > 0.2 but not > 0.3
    }

    const result = chooseBotTokenCoordinated(state, 1, 3, metadata)
    // Token 0 (at position 25) is blocking winner's token at position 25
    // Should return 0 to clear the path (move token 0 out of the way)
    assert.equal(result, 0, 'priority 2 should trigger when aggressiveness > 0.2 and helper is blocking winner')
  })
})
