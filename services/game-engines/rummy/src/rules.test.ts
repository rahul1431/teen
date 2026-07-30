import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeck, createInitialState, isJoker, checkGroup, validateDeclareGroups,
  drawFromClosed, drawFromOpen, discardCard, attemptDeclare, dropPlayer, forfeitPlayer, reshuffleIfNeeded,
  findValidDeclareGrouping,
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

  test('drawFromOpen moves a card into the hand and flips awaiting to discard', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    const before = state.players[0].hand.length
    const openPileLength = state.open_pile.length
    drawFromOpen(state, 0)
    assert.equal(state.players[0].hand.length, before + 1)
    assert.equal(state.open_pile.length, openPileLength - 1)
    assert.equal(state.awaiting, 'discard')
  })

  test('invalid declare causing last-player-standing ends game and prevents further calls', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    drawFromClosed(state, 0)
    const junkGroups = [state.players[0].hand.slice(0, 3).map(c => c.id), state.players[0].hand.slice(3, 6).map(c => c.id), state.players[0].hand.slice(6, 9).map(c => c.id), state.players[0].hand.slice(9, 13).map(c => c.id)]
    const { outcome, result } = attemptDeclare(state, 0, junkGroups)
    assert.equal(outcome.valid, false)
    assert.equal(state.players[0].is_eliminated, true)
    assert.equal(result?.winner_id, 'p1') // Player 1 is the last remaining
    assert.equal(result?.reason, 'last_player_standing')
    assert.equal(state.status, 'completed')
    // Verify that calling another mutator throws because game is completed
    assert.throws(() => discardCard(state, 0, state.players[0].hand[0]?.id || 'x'))
  })
})

describe('findValidDeclareGrouping', () => {
  // The exact search must find a winning partition even when the obvious
  // greedy melding (coordination.ts's greedyGroup, which takes the largest
  // group it can see first and never backtracks) walks into a dead end.
  // Here greedy grabs the 4-card set of 5s (D5,C5,H5,S5 — first four cards in
  // hand order), which steals S5 out of the S4-S5-S6-S7 run and strands
  // S4,S6,S7 with no way to meld them.
  const buriedDeclareHand = [
    c('a1', '5', 'D'), c('a2', '5', 'C'), c('a3', '5', 'H'), c('a4', '5', 'S'),
    c('b1', '4', 'S'), c('b2', '6', 'S'), c('b3', '7', 'S'),
    c('d1', '2', 'H'), c('d2', '3', 'H'), c('d3', '4', 'H'),
    c('e1', '9', 'D'), c('e2', '9', 'C'), c('e3', '9', 'S'),
    c('z1', 'K', 'C'), // the leftover discard — nothing else can meld with it
  ]

  test('finds a valid declare that a greedy (non-backtracking) melding misses', () => {
    const groups = findValidDeclareGrouping(buriedDeclareHand, '__NONE__')
    assert.notEqual(groups, null)
    // Whatever partition it picked must genuinely pass the declare rules.
    assert.deepEqual(validateDeclareGroups(buriedDeclareHand, groups!, '__NONE__'), { valid: true })
    const flat = groups!.flat()
    assert.equal(flat.length, 13)
    assert.equal(new Set(flat).size, 13)
    const handIds = new Set(buriedDeclareHand.map(x => x.id))
    for (const id of flat) assert.equal(handIds.has(id), true)
    // The 4-card set of 5s can never be part of a winning partition here.
    assert.equal(groups!.some(g => g.length === 4 && g.every(id => id.startsWith('a'))), false)
  })

  test('returns a grouping accepted by attemptDeclare end-to-end', () => {
    const state = createInitialState('r', 100, makePlayers(2), 'medium', 2, 30, 5)
    state.wild_rank = '__NONE__'
    state.players[0].hand = buriedDeclareHand.map(x => ({ ...x }))
    state.awaiting = 'discard'
    const groups = findValidDeclareGrouping(state.players[0].hand, state.wild_rank)
    const { outcome, result } = attemptDeclare(state, 0, groups!)
    assert.equal(outcome.valid, true)
    assert.equal(result?.winner_id, 'p0')
    assert.equal(result?.reason, 'valid_declare')
  })

  test('returns null for a hand with no meld at all', () => {
    const junk = [
      c('1', '2', 'S'), c('2', '4', 'H'), c('3', '6', 'D'), c('4', '8', 'C'),
      c('5', '10', 'S'), c('6', 'Q', 'H'), c('7', 'A', 'D'), c('8', '3', 'C'),
      c('9', '5', 'S'), c('10', '7', 'H'), c('11', '9', 'D'), c('12', 'J', 'C'),
      c('13', 'K', 'S'), c('14', '2', 'H'),
    ]
    assert.equal(findValidDeclareGrouping(junk, '__NONE__'), null)
  })

  test('returns null when the hand melds completely but has only one sequence', () => {
    // Three sets + one pure sequence partitions all 13 cards, but the rules
    // demand at least TWO sequences — no other partition can produce a second
    // one (S4 has no other home, so S5/S6 are locked to it, and the aces/7s/9s
    // can only ever form sets). An exhaustive search must still return null.
    const oneSequenceHand = [
      c('s1', 'A', 'S'), c('s2', 'A', 'H'), c('s3', 'A', 'D'), c('s4', 'A', 'C'),
      c('t1', '7', 'S'), c('t2', '7', 'H'), c('t3', '7', 'D'),
      c('u1', '9', 'S'), c('u2', '9', 'H'), c('u3', '9', 'D'),
      c('v1', '4', 'S'), c('v2', '5', 'S'), c('v3', '6', 'S'),
      c('z1', 'K', 'C'),
    ]
    assert.equal(findValidDeclareGrouping(oneSequenceHand, '__NONE__'), null)
  })

  test('returns null for a hand that is not 14 cards (nothing to discard)', () => {
    assert.equal(findValidDeclareGrouping(buriedDeclareHand.slice(0, 13), '__NONE__'), null)
  })

  test('uses jokers when that is the only way to complete the grouping', () => {
    const withJokers = [
      c('p1', '3', 'S'), c('p2', '4', 'S'), c('p3', '5', 'S'), // pure sequence
      c('q1', '8', 'H'), c('q2', '9', 'H'), c('q3', 'JOKER', 'JK'), // joker sequence
      c('r1', 'Q', 'S'), c('r2', 'Q', 'H'), c('r3', 'JOKER', 'JK'), // joker set
      c('w1', '2', 'D'), c('w2', '3', 'D'), c('w3', '4', 'D'), c('w4', '5', 'D'),
      c('z1', 'K', 'C'),
    ]
    const groups = findValidDeclareGrouping(withJokers, '__NONE__')
    assert.notEqual(groups, null)
    assert.deepEqual(validateDeclareGroups(withJokers, groups!, '__NONE__'), { valid: true })
  })
})
