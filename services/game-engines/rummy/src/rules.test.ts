import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildDeck, createInitialState, isJoker } from './rules'

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    user_id: `p${i}`, username: `P${i}`, seat: i + 1, is_bot: false,
  }))
}

describe('buildDeck', () => {
  test('2 decks produce 106 cards (2x52 + 2 printed jokers)', () => {
    const deck = buildDeck(2)
    assert.equal(deck.length, 106)
    assert.equal(deck.filter(c => c.suit === 'JK').length, 2)
    assert.equal(new Set(deck.map(c => c.id)).size, 106)
  })
})

describe('createInitialState', () => {
  test('deals 13 cards to each of 4 players and leaves the rest split between piles', () => {
    const state = createInitialState('room1', 100, makePlayers(4), 'medium', 2, 30, 5)
    for (const p of state.players) assert.equal(p.hand.length, 13)
    assert.equal(state.open_pile.length, 1)
    // 106 total - 52 dealt - 1 wild indicator - 1 open pile card
    assert.equal(state.closed_pile.length, 106 - 52 - 1 - 1)
    assert.equal(state.status, 'active')
    assert.equal(state.awaiting, 'draw')
    assert.equal(state.current_turn, 0)
  })

  test('wild_rank matches the indicator card unless the indicator is itself a printed joker', () => {
    const state = createInitialState('room1', 100, makePlayers(2), 'medium', 2, 30, 5)
    if (state.wild_indicator.suit === 'JK') {
      assert.equal(state.wild_rank, '__NONE__')
    } else {
      assert.equal(state.wild_rank, state.wild_indicator.rank)
    }
  })

  test('a printed joker is always a joker regardless of wild_rank', () => {
    const state = createInitialState('room1', 100, makePlayers(2), 'medium', 2, 30, 5)
    assert.equal(isJoker({ id: 'x', rank: 'JOKER', suit: 'JK' }, state.wild_rank), true)
  })

  test('a card matching wild_rank is a joker even when not printed', () => {
    assert.equal(isJoker({ id: 'x', rank: '7', suit: 'S' }, '7'), true)
    assert.equal(isJoker({ id: 'x', rank: '7', suit: 'S' }, '8'), false)
  })
})
