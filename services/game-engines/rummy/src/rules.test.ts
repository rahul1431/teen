import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildDeck, createInitialState, isJoker, checkGroup, validateDeclareGroups } from './rules'

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

const c = (id: string, rank: string, suit: any) => ({ id, rank, suit })

describe('checkGroup', () => {
  test('3 consecutive same-suit cards with no jokers is a pure sequence', () => {
    const result = checkGroup([c('1', '4', 'S'), c('2', '5', 'S'), c('3', '6', 'S')], '9')
    assert.deepEqual(result, { valid: true, kind: 'sequence', pure: true })
  })

  test('a sequence using a wild-rank card as filler is impure', () => {
    // 4S 5S ?S using a 9(wild) standing in for 6S
    const result = checkGroup([c('1', '4', 'S'), c('2', '5', 'S'), c('3', '9', 'S')], '9')
    assert.equal(result.valid, true)
    assert.equal(result.pure, false)
  })

  test('a printed joker fills a sequence gap and is never pure', () => {
    const result = checkGroup([c('1', '4', 'S'), c('2', 'JOKER', 'JK'), c('3', '6', 'S')], '9')
    assert.equal(result.valid, true)
    assert.equal(result.kind, 'sequence')
    assert.equal(result.pure, false)
  })

  test('mismatched suits is not a valid sequence', () => {
    const result = checkGroup([c('1', '4', 'S'), c('2', '5', 'H'), c('3', '6', 'S')], '9')
    assert.equal(result.valid, false)
  })

  test('3 same-rank distinct-suit cards is a valid set', () => {
    const result = checkGroup([c('1', '7', 'S'), c('2', '7', 'H'), c('3', '7', 'D')], '9')
    assert.deepEqual(result, { valid: true, kind: 'set', pure: false })
  })

  test('a set cannot repeat a suit even across two decks', () => {
    const result = checkGroup([c('1', '7', 'S'), c('2', '7', 'S'), c('3', '7', 'D')], '9')
    assert.equal(result.valid, false)
  })

  test('Ace can run low (A-2-3) or high (Q-K-A) but not wrap (K-A-2)', () => {
    assert.equal(checkGroup([c('1', 'A', 'S'), c('2', '2', 'S'), c('3', '3', 'S')], '9').valid, true)
    assert.equal(checkGroup([c('1', 'Q', 'S'), c('2', 'K', 'S'), c('3', 'A', 'S')], '9').valid, true)
    assert.equal(checkGroup([c('1', 'K', 'S'), c('2', 'A', 'S'), c('3', '2', 'S')], '9').valid, false)
  })

  test('an all-joker group is never valid', () => {
    const result = checkGroup([c('1', 'JOKER', 'JK'), c('2', '9', 'S'), c('3', '9', 'H')], '9')
    assert.equal(result.valid, false)
  })
})

describe('validateDeclareGroups', () => {
  function validHand13() {
    // pure sequence (S: 2-3-4) + sequence (H: 5-6-7) + set (9s: D/C/S) +
    // 4-card set (8s: D/C/H/S) — 3+3+3+4 = 13 cards total, no leftover.
    return [
      c('1', '2', 'S'), c('2', '3', 'S'), c('3', '4', 'S'),
      c('4', '5', 'H'), c('5', '6', 'H'), c('6', '7', 'H'),
      c('7', '9', 'D'), c('8', '9', 'C'), c('9', '9', 'S'),
      c('10', '8', 'D'), c('11', '8', 'C'), c('12', '8', 'H'), c('13', '8', 'S'),
    ]
  }

  test('valid declare: 2 sequences (1 pure) + sets, using all 13 cards', () => {
    const hand = validHand13()
    const groups = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '13']]
    const result = validateDeclareGroups(hand, groups, '__NONE__')
    assert.equal(result.valid, true)
  })

  test('rejects a declare with only 1 sequence', () => {
    const hand = [
      c('1', '2', 'S'), c('2', '3', 'S'), c('3', '4', 'S'), // pure sequence
      c('4', '9', 'D'), c('5', '9', 'C'), c('6', '9', 'S'), // set
      c('7', '8', 'D'), c('8', '8', 'C'), c('9', '8', 'H'), // set
      c('10', '7', 'D'), c('11', '7', 'C'), c('12', '7', 'H'), c('13', '7', 'S'), // set (4)
    ]
    const groups = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '13']]
    const result = validateDeclareGroups(hand, groups, '__NONE__')
    assert.equal(result.valid, false)
    assert.match(result.reason ?? '', /sequence/)
  })

  test('rejects a declare with no pure sequence', () => {
    const hand = [
      c('1', '2', 'S'), c('2', 'JOKER', 'JK'), c('3', '4', 'S'),
      c('4', '5', 'H'), c('5', 'JOKER', 'JK'), c('6', '7', 'H'),
      c('7', '9', 'D'), c('8', '9', 'C'), c('9', '9', 'S'),
      c('10', '8', 'D'), c('11', '8', 'C'), c('12', '8', 'H'), c('13', '8', 'S'),
    ]
    const groups = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '13']]
    const result = validateDeclareGroups(hand, groups, '__NONE__')
    assert.equal(result.valid, false)
    assert.match(result.reason ?? '', /pure/)
  })

  test('rejects groups that reference a card not in hand', () => {
    const hand = validHand13()
    const result = validateDeclareGroups(hand, [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11', '12', '999']], '__NONE__')
    assert.equal(result.valid, false)
  })

  test('rejects groups that do not total exactly 13 cards', () => {
    const hand = validHand13()
    const result = validateDeclareGroups(hand, [['1', '2', '3'], ['4', '5', '6']], '__NONE__')
    assert.equal(result.valid, false)
  })
})
