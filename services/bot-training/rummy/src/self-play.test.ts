import { test } from 'node:test'
import assert from 'node:assert'
import { runRummySelfPlay, isPureSequence, calculateDeadwood } from './self-play'

test('isPureSequence identifies valid pure sequence', () => {
  const seq = [
    { id: '1', suit: 'H' as const, rank: '7' },
    { id: '2', suit: 'H' as const, rank: '8' },
    { id: '3', suit: 'H' as const, rank: '9' },
  ]
  assert.strictEqual(isPureSequence(seq), true)
})

test('calculateDeadwood correctly sums values', () => {
  const cards = [
    { id: '1', suit: 'H' as const, rank: 'K' }, // 10
    { id: '2', suit: 'D' as const, rank: '5' }, // 5
    { id: '3', suit: 'S' as const, rank: '2', isJoker: true }, // 0
  ]
  assert.strictEqual(calculateDeadwood(cards), 15)
})

test('runRummySelfPlay simulates 20 games and returns metrics', () => {
  const res = runRummySelfPlay(20)
  assert.strictEqual(res.gamesSimulated, 20)
  assert.ok(res.totalTurns > 0)
  assert.ok(res.winDistribution.hard)
  assert.ok(res.calibratedProfiles.hard.open_draw_probability > 0.5)
  assert.ok(res.calibratedProfiles.easy.drop_probability > 0.1)
})

