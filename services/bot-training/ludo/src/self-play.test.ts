import { test } from 'node:test'
import assert from 'node:assert'
import { runLudoSelfPlay } from './self-play'

test('runLudoSelfPlay simulates 10 games and computes metrics', () => {
  const res = runLudoSelfPlay(10)
  assert.strictEqual(res.gamesSimulated, 10)
  assert.ok(res.totalRolls > 0)
  assert.ok(res.winDistribution.hard)
  assert.ok(res.winDistribution.medium)
  assert.ok(res.winDistribution.easy)
  assert.ok(res.calibratedProfiles.hard.capture_probability > 0.8)
  assert.ok(res.calibratedProfiles.easy.capture_probability < 0.6)
})

