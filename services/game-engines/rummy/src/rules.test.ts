import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeck, createInitialState, isJoker, checkGroup, validateDeclareGroups,
  drawFromClosed, drawFromOpen, discardCard, attemptDeclare, dropPlayer, forfeitPlayer, reshuffleIfNeeded,
} from './rules'

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

describe('turn actions', () => {
  test('drawFromClosed moves a card into the hand and flips awaiting to discard', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    const before = state.players[0].hand.length
    drawFromClosed(state, 0)
    assert.equal(state.players[0].hand.length, before + 1)
    assert.equal(state.awaiting, 'discard')
  })

  test('drawFromClosed throws if it is not that player\'s turn', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    assert.throws(() => drawFromClosed(state, 1))
  })

  test('discardCard removes the card from hand, pushes it to open_pile, and advances the turn', () => {
    const state = createInitialState('r', 100, makePlayers(3), 'medium', 2, 30, 5)
    drawFromClosed(state, 0)
    const cardId = state.players[0].hand[0].id
    discardCard(state, 0, cardId)
    assert.equal(state.players[0].hand.some(c => c.id === cardId), false)
    assert.equal(state.open_pile[state.open_pile.length - 1].id, cardId)
    assert.equal(state.current_turn, 1)
    assert.equal(state.awaiting, 'draw')
  })

  test('reshuffleIfNeeded rebuilds the closed pile from the open pile (keeping its top card) once empty', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    state.open_pile = [{ id: 'a', rank: '2', suit: 'S' }, { id: 'b', rank: '3', suit: 'S' }, { id: 'c', rank: '4', suit: 'S' }]
    state.closed_pile = []
    reshuffleIfNeeded(state)
    assert.equal(state.open_pile.length, 1)
    assert.equal(state.open_pile[0].id, 'c')
    assert.equal(state.closed_pile.length, 2)
  })

  test('an invalid declare eliminates the declarer and play continues to the next active player', () => {
    const state = createInitialState('r', 100, makePlayers(3), 'medium', 2, 30, 5)
    drawFromClosed(state, 0)
    const junkGroups = [state.players[0].hand.slice(0, 3).map(c => c.id), state.players[0].hand.slice(3, 6).map(c => c.id), state.players[0].hand.slice(6, 9).map(c => c.id), state.players[0].hand.slice(9, 13).map(c => c.id)]
    const { outcome, result } = attemptDeclare(state, 0, junkGroups)
    assert.equal(outcome.valid, false)
    assert.equal(state.players[0].is_eliminated, true)
    assert.equal(result, null) // 2 players still active (1, 2), not last-player-standing
    assert.equal(state.current_turn, 1)
  })

  test('dropPlayer before any draw removes them from turn order without elimination', () => {
    const state = createInitialState('r', 100, makePlayers(3), 'medium', 2, 30, 5)
    dropPlayer(state, 0)
    assert.equal(state.players[0].has_dropped, true)
    assert.equal(state.current_turn, 1)
  })

  test('dropPlayer after already taking a turn throws (First Drop only)', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    drawFromClosed(state, 0)
    discardCard(state, 0, state.players[0].hand[0].id)
    drawFromClosed(state, 1)
    discardCard(state, 1, state.players[1].hand[0].id)
    assert.throws(() => dropPlayer(state, 0))
  })

  test('last player standing (via drop) wins automatically', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    const result = dropPlayer(state, 0)
    assert.equal(result?.winner_id, 'p1')
    assert.equal(state.status, 'completed')
    assert.equal(result?.reason, 'last_player_standing')
  })

  test('forfeitPlayer eliminates a user by id and ends the game if they were last active', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    const result = forfeitPlayer(state, 'p0')
    assert.equal(result?.winner_id, 'p1')
    assert.equal(state.status, 'completed')
  })

  test('settlement math: pot minus rake goes to the winner', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 10)
    const result = dropPlayer(state, 0)
    // pot = 100 * 2 = 200; rake 10% = 20; prize = 180
    assert.equal(result?.rake_fee, 20)
    assert.equal(result?.prize, 180)
  })
})
