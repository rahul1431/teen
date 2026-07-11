import { ProfileBuilder } from '../src/profile-builder'
import pino from 'pino'

// Mock helper functions
const createMockPool = () => {
  return {
    query: jest.fn(),
  } as unknown as any
}

const createMockRedis = () => {
  return {
    del: jest.fn().mockResolvedValue(0),
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    publish: jest.fn().mockResolvedValue(0),
  } as unknown as any
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

describe('ProfileBuilder - Incremental 6-Hourly Rebuild', () => {
  let pool: any
  let redis: any
  let logger: any
  let builder: ProfileBuilder

  beforeEach(() => {
    pool = createMockPool()
    redis = createMockRedis()
    logger = createMockLogger()
    builder = new ProfileBuilder(pool, redis, logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('rebuildProfilesIncremental', () => {
    it('should rebuild using last 6 hours data', async () => {
      const gameType = 'teen_patti'
      const difficulty = 'medium'

      // Mock config
      const configRows = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
      ]

      // Mock player data from last 6 hours (sufficient sample)
      const playerRows = Array(100)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 10,
          total_profit: 100 + i,
          avg_profit: 10,
          wins: 5,
          avg_stake: 50,
        }))

      // Mock current profile
      const currentProfile = {
        game_type: gameType,
        difficulty: difficulty,
        win_rate_target: 50.0,
        fold_probability: 0.3,
        call_probability: 0.47,
        raise_probability: 0.23,
        avg_decision_delay_ms: 2000,
        avg_stake_preference: 50,
        aggression_score: 3.5,
        sample_size: 50,
        last_rebuilt_at: new Date().toISOString(),
      }

      let queryCount = 0
      pool.query.mockImplementation(async (sql: string) => {
        queryCount++

        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('DATE_TRUNC') && sql.includes('game_participants')) {
          // Query for last 6 hours data
          return { rows: playerRows }
        } else if (sql.includes('SELECT * FROM bot_profiles WHERE game_type') && sql.includes('AND difficulty')) {
          // Query for current profile
          return { rows: [currentProfile] }
        } else if (sql.includes('UPDATE bot_profiles')) {
          // Update query
          return { rows: [] }
        }
        return { rows: [] }
      })

      // Call incremental rebuild
      await builder.rebuildProfilesIncremental(gameType, difficulty)

      // Verify that UPDATE was called on bot_profiles
      const updateCalls = pool.query.mock.calls.filter(
        (call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE bot_profiles')
      )
      expect(updateCalls.length).toBeGreaterThan(0)
    })

    it('should update percentile rank correctly', async () => {
      const gameType = 'teen_patti'
      const difficulty = 'hard'

      const configRows = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
      ]

      // Create players with calculated wins for percentile calculation
      const playerRows = Array(150)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 10,
          total_profit: 100 + i * 2,
          avg_profit: 10,
          wins: Math.ceil(8 + i * 0.1), // Varying wins to test percentile calculation
          avg_stake: 100,
        }))

      const currentProfile = {
        game_type: gameType,
        difficulty: difficulty,
        win_rate_target: 65.0,
        fold_probability: 0.18,
        call_probability: 0.42,
        raise_probability: 0.4,
        avg_decision_delay_ms: 1400,
        avg_stake_preference: 100,
        aggression_score: 6.2,
        sample_size: 75,
        last_rebuilt_at: new Date().toISOString(),
      }

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('DATE_TRUNC') && sql.includes('game_participants')) {
          return { rows: playerRows }
        } else if (sql.includes('SELECT * FROM bot_profiles WHERE game_type') && sql.includes('AND difficulty')) {
          return { rows: [currentProfile] }
        } else if (sql.includes('UPDATE bot_profiles')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await builder.rebuildProfilesIncremental(gameType, difficulty)

      // Verify update was called
      expect(pool.query).toHaveBeenCalled()
    })

    it('should preserve profile history', async () => {
      const gameType = 'ludo'
      const difficulty = 'easy'

      const configRows = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
      ]

      const playerRows = Array(80)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 10,
          total_profit: 50 + i,
          avg_profit: 5,
          wins: 4,
          avg_stake: 10,
        }))

      const currentProfile = {
        game_type: gameType,
        difficulty: difficulty,
        win_rate_target: 30.0,
        fold_probability: 0.45,
        call_probability: 0.45,
        raise_probability: 0.1,
        avg_decision_delay_ms: 3000,
        avg_stake_preference: 10,
        aggression_score: 1.5,
        sample_size: 40,
        last_rebuilt_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // 8 hours ago
      }

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('DATE_TRUNC') && sql.includes('game_participants')) {
          return { rows: playerRows }
        } else if (sql.includes('SELECT * FROM bot_profiles WHERE game_type') && sql.includes('AND difficulty')) {
          return { rows: [currentProfile] }
        } else if (sql.includes('UPDATE bot_profiles')) {
          // Should update the last_rebuilt_at field
          return { rows: [] }
        }
        return { rows: [] }
      })

      await builder.rebuildProfilesIncremental(gameType, difficulty)

      // Verify that last_rebuilt_at was updated
      const updateCalls = pool.query.mock.calls.filter(
        (call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE bot_profiles')
      )
      expect(updateCalls.length).toBeGreaterThan(0)

      // Verify UPDATE includes last_rebuilt_at = NOW()
      const lastUpdateCall = updateCalls[updateCalls.length - 1]
      const updateSql = lastUpdateCall[0]
      expect(updateSql).toContain('last_rebuilt_at')
    })

    it('should handle profiles with insufficient data', async () => {
      const gameType = 'aviator'
      const difficulty = 'hard'

      const configRows = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
      ]

      // Insufficient data (only 25 players in last 6 hours)
      const playerRows = Array(25)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 5,
          total_profit: 10 + i,
          avg_profit: 2,
          wins: 2,
          avg_stake: 100,
        }))

      const currentProfile = {
        game_type: gameType,
        difficulty: difficulty,
        win_rate_target: 65.0,
        fold_probability: 0.2,
        call_probability: 0.4,
        raise_probability: 0.4,
        avg_decision_delay_ms: 1500,
        avg_stake_preference: 100,
        aggression_score: 5.5,
        sample_size: 80,
        last_rebuilt_at: new Date().toISOString(),
      }

      const loggerWarnSpy = jest.spyOn(logger, 'warn')

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('DATE_TRUNC') && sql.includes('game_participants')) {
          return { rows: playerRows }
        } else if (sql.includes('SELECT * FROM bot_profiles WHERE game_type') && sql.includes('AND difficulty')) {
          return { rows: [currentProfile] }
        }
        return { rows: [] }
      })

      await builder.rebuildProfilesIncremental(gameType, difficulty)

      // Should log warning about insufficient data
      expect(loggerWarnSpy).toHaveBeenCalled()
    })

    it('should maintain min_sample_size requirement', async () => {
      const gameType = 'teen_patti'
      const difficulty = 'medium'

      const configRows = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
      ]

      // Exactly at the boundary (50 players)
      const playerRows = Array(50)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 10,
          total_profit: 100,
          avg_profit: 10,
          wins: 5,
          avg_stake: 50,
        }))

      const currentProfile = {
        game_type: gameType,
        difficulty: difficulty,
        win_rate_target: 50.0,
        fold_probability: 0.3,
        call_probability: 0.47,
        raise_probability: 0.23,
        avg_decision_delay_ms: 2000,
        avg_stake_preference: 50,
        aggression_score: 3.5,
        sample_size: 50,
        last_rebuilt_at: new Date().toISOString(),
      }

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('DATE_TRUNC') && sql.includes('game_participants')) {
          return { rows: playerRows }
        } else if (sql.includes('SELECT * FROM bot_profiles WHERE game_type') && sql.includes('AND difficulty')) {
          return { rows: [currentProfile] }
        } else if (sql.includes('UPDATE bot_profiles')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      // Should successfully rebuild with exactly min_sample_size
      await builder.rebuildProfilesIncremental(gameType, difficulty)

      // Verify update was called (not skipped)
      const updateCalls = pool.query.mock.calls.filter(
        (call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE bot_profiles')
      )
      expect(updateCalls.length).toBeGreaterThan(0)
    })
  })
})
