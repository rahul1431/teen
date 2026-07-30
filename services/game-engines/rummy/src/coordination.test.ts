import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState } from './rules'
import { chooseBotDraw, chooseBotDiscard, tryBotDeclare } from './coordination'

function makeState() {
  const state = createInitialState('r', 100, [
    { user_id: 'p0', username: 'Bot', seat: 1, is_bot: true, bot_difficulty: 'medium' },
    { user_id: 'p1', username: 'P1', seat: 2, is_bot: false },
  ], 'medium', 2, 30, 5)
  return state
}

describe('chooseBotDraw', () => {
  test('always picks the open pile when its top card is a joker', () => {
    const state = makeState()
    state.open_pile = [{ id: 'x', rank: 'JOKER', suit: 'JK' }]
    assert.equal(chooseBotDraw(state, 0), 'open')
  })

  test('returns closed when the open pile is empty', () => {
    const state = makeState()
    state.open_pile = []
    assert.equal(chooseBotDraw(state, 0), 'closed')
  })
})

describe('chooseBotDiscard', () => {
  test('never discards a joker if a non-joker is available', () => {
    const state = makeState()
    state.players[0].hand = [
      { id: '1', rank: 'JOKER', suit: 'JK' },
      { id: '2', rank: 'K', suit: 'H' },
      { id: '3', rank: '2', suit: 'S' },
    ]
    const discardId = chooseBotDiscard(state, 0)
    assert.notEqual(discardId, '1')
  })

  test('never discards a joker even when all naturals are locked in melds', () => {
    const state = makeState()
    state.wild_rank = '__NONE__'
    // Construct a hand where greedyGroup consumes all 12 non-joker cards into melds,
    // leaving only 2 jokers in leftover. The bot should still discard a non-joker
    // (breaking a meld) rather than a joker.
    state.players[0].hand = [
      // Set 1: 9D, 9C, 9S (3 naturals)
      { id: '1', rank: '9', suit: 'D' },
      { id: '2', rank: '9', suit: 'C' },
      { id: '3', rank: '9', suit: 'S' },
      // Sequence 1: 2S, 3S, 4S (3 naturals)
      { id: '4', rank: '2', suit: 'S' },
      { id: '5', rank: '3', suit: 'S' },
      { id: '6', rank: '4', suit: 'S' },
      // Sequence 2: 5H, 6H, 7H (3 naturals)
      { id: '7', rank: '5', suit: 'H' },
      { id: '8', rank: '6', suit: 'H' },
      { id: '9', rank: '7', suit: 'H' },
      // Set 2: 8D, 8C, 8S (3 naturals)
      { id: '10', rank: '8', suit: 'D' },
      { id: '11', rank: '8', suit: 'C' },
      { id: '12', rank: '8', suit: 'S' },
      // Jokers: JOKER, JOKER (2 jokers — leftover after greedyGroup)
      { id: '13', rank: 'JOKER', suit: 'JK' },
      { id: '14', rank: 'JOKER', suit: 'JK' },
    ]
    const discardId = chooseBotDiscard(state, 0)
    // Should discard one of the naturals (locked in melds), not a joker
    assert.notEqual(discardId, '13')
    assert.notEqual(discardId, '14')
  })
})

describe('tryBotDeclare', () => {
  test('returns null when the hand cannot legally declare', () => {
    const state = makeState()
    // Fresh 13-card deal is essentially never a valid declare — leftover won't be exactly 1 unmatched card.
    const result = tryBotDeclare(state, 0)
    assert.equal(result, null)
  })

  test('returns a valid grouping when the hand can legally declare', () => {
    const state = makeState()
    // wild_rank is normally randomized by createInitialState's wild-indicator
    // draw — pin it so this hand's card ranks can't accidentally collide
    // with it and change which cards count as jokers.
    state.wild_rank = '__NONE__'
    state.players[0].hand = [
      { id: '1', rank: '2', suit: 'S' }, { id: '2', rank: '3', suit: 'S' }, { id: '3', rank: '4', suit: 'S' },
      { id: '4', rank: '5', suit: 'H' }, { id: '5', rank: '6', suit: 'H' }, { id: '6', rank: '7', suit: 'H' },
      { id: '7', rank: '9', suit: 'D' }, { id: '8', rank: '9', suit: 'C' }, { id: '9', rank: '9', suit: 'S' },
      { id: '10', rank: '8', suit: 'D' }, { id: '11', rank: '8', suit: 'C' }, { id: '12', rank: '8', suit: 'H' }, { id: '13', rank: '8', suit: 'S' },
      { id: '14', rank: 'K', suit: 'D' }, // the single leftover (unmatched) card
    ]
    const result = tryBotDeclare(state, 0)
    assert.notEqual(result, null)
  })
})
