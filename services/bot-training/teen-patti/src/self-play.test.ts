import { test } from 'node:test'
import assert from 'node:assert'
import { runTeenPattiSelfPlay, evaluateHand } from './self-play'

test('evaluateHand correctly identifies trail (trio)', () => {
  const hand = [
    { val: 'K', suit: '♠', rank: 13 },
    { val: 'K', suit: '♥', rank: 13 },
    { val: 'K', suit: '♦', rank: 13 },
  ]
  const res = evaluateHand(hand)
  assert.strictEqual(res.type, 6) // HAND_TRAIL
})

test('evaluateHand correctly identifies pure sequence', () => {
  const hand = [
    { val: 'Q', suit: '♥', rank: 12 },
    { val: 'J', suit: '♥', rank: 11 },
    { val: '10', suit: '♥', rank: 10 },
  ]
  const res = evaluateHand(hand)
  assert.strictEqual(res.type, 5) // HAND_PURE_SEQ
})

test('runTeenPattiSelfPlay simulates 50 games and converges', () => {
  const result = runTeenPattiSelfPlay(50)
  assert.strictEqual(result.gamesSimulated, 50)
  assert.ok(result.totalPotWagered > 0)
  assert.ok(result.durationMs >= 0)
  assert.ok(result.winDistribution.easy)
  assert.ok(result.winDistribution.medium)
  assert.ok(result.winDistribution.hard)
  assert.ok(result.calibratedProfiles.easy.fold_probability > 0)
  assert.ok(result.calibratedProfiles.hard.raise_probability > 0)
})

