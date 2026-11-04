import { test } from 'node:test'
import assert from 'node:assert'
import { cloneEliteTeenPattiPlayers } from './behavioral-cloning'
import pino from 'pino'

test('cloneEliteTeenPattiPlayers gracefully handles empty DB with shark priors', async () => {
  const logger = pino({ level: 'silent' })
  // Mock pool
  const mockPool: any = {
    query: async (sql: string) => {
      if (sql.includes('game_participants')) {
        return { rows: [] }
      }
      return { rows: [] }
    }
  }

  const result = await cloneEliteTeenPattiPlayers(mockPool, logger, 5, 1)
  assert.strictEqual(result.gameType, 'teen_patti')
  assert.strictEqual(result.topPercentileCutoff, 5)
  assert.ok(result.clonedProfiles.hard.fold_probability > 0.1)
  assert.ok(result.clonedProfiles.hard.raise_probability > 0.2)
  assert.ok(result.clonedProfiles.hard.aggression_score > 0.5)
})

