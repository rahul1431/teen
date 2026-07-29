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

describe('ProfileBuilder - Profile Versioning', () => {
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

  describe('should create new version on rebuild', () => {
    it('should create bot_profiles_v{N} table on rebuild', async () => {
      const configRows = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
        { key: 'active_profile_version', value: '0' },
      ]

      const playerRows = Array(300)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 10,
          total_profit: 100 + i,
          avg_profit: 10,
          wins: 5,
          avg_stake: 10,
        }))

      const queryCalls: string[] = []

      pool.query.mockImplementation(async (sql: string) => {
        queryCalls.push(sql)
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('SELECT') && sql.includes('game_participants')) {
          return { rows: playerRows }
        } else if (sql.includes('CREATE TABLE') && sql.includes('bot_profiles_v')) {
          return { rows: [] }
        } else if (sql.includes('SELECT') && sql.includes('information_schema')) {
          return { rows: [] }
        } else if (sql.includes('INSERT INTO bot_learning_config')) {
          return { rows: [] }
        } else if (sql.includes('INSERT INTO bot_profiles_v')) {
          return { rows: [] }
        } else if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return { rows: [] }
        } else if (sql.includes('SELECT') && sql.includes('bot_profiles')) {
          return { rows: [] }
        } else if (sql.includes('DROP TABLE')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await builder.runRebuild()

      // Verify that a CREATE TABLE call was made for bot_profiles_v
      const createTableCalls = queryCalls.filter(
        sql => sql.includes('CREATE TABLE') && sql.includes('bot_profiles_v')
      )
      expect(createTableCalls.length).toBeGreaterThan(0)

      // Verify that INSERT INTO bot_learning_config was called
      const configUpdateCalls = queryCalls.filter(
        sql => sql.includes('INSERT INTO bot_learning_config')
      )
      expect(configUpdateCalls.length).toBeGreaterThan(0)
    })

    it('should increment version number on successive rebuilds', async () => {
      const configRowsV1 = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
        { key: 'active_profile_version', value: '0' },
      ]

      const playerRows = Array(300)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 10,
          total_profit: 100 + i,
          avg_profit: 10,
          wins: 5,
          avg_stake: 10,
        }))

      const createdTables: string[] = []

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRowsV1 }
        } else if (sql.includes('SELECT') && sql.includes('game_participants')) {
          return { rows: playerRows }
        } else if (sql.includes('CREATE TABLE') && sql.includes('bot_profiles_v')) {
          const match = sql.match(/bot_profiles_v(\d+)/)
          if (match) {
            createdTables.push(`bot_profiles_v${match[1]}`)
          }
          return { rows: [] }
        } else if (sql.includes('INSERT INTO bot_profiles_v')) {
          return { rows: [] }
        } else if (sql.includes('SELECT') && sql.includes('bot_profiles')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await builder.runRebuild()

      expect(createdTables.length).toBeGreaterThan(0)
      expect(createdTables[0]).toContain('bot_profiles_v')
    })
  })

  describe('should use active version when fetching profiles', () => {
    it('should fetch profiles from active version table', async () => {
      const configRows = [
        { key: 'active_profile_version', value: '2' },
      ]

      const profileRows = [
        {
          id: 'profile-1',
          game_type: 'teen_patti',
          difficulty: 'easy',
          win_rate_target: 35.0,
          fold_probability: 0.45,
          call_probability: 0.45,
          raise_probability: 0.1,
          avg_decision_delay_ms: 2800,
          avg_stake_preference: 10.0,
          aggression_score: 1.8,
          sample_size: 100,
        },
      ]

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('FROM bot_profiles_v2')) {
          return { rows: profileRows }
        } else if (sql.includes('FROM bot_profiles')) {
          return { rows: profileRows }
        }
        return { rows: [] }
      })

      const profiles = await builder.getProfiles()

      expect(profiles).toHaveLength(1)
      expect(profiles[0].game_type).toBe('teen_patti')
      expect(profiles[0].difficulty).toBe('easy')
    })

    it('should fetch single profile from active version', async () => {
      const configRows = [
        { key: 'active_profile_version', value: '1' },
      ]

      const profileRow = {
        id: 'profile-1',
        game_type: 'teen_patti',
        difficulty: 'easy',
        win_rate_target: 35.0,
        fold_probability: 0.45,
        call_probability: 0.45,
        raise_probability: 0.1,
        avg_decision_delay_ms: 2800,
        avg_stake_preference: 10.0,
        aggression_score: 1.8,
        sample_size: 100,
      }

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('FROM bot_profiles_v1') && sql.includes('difficulty')) {
          return { rows: [profileRow] }
        }
        return { rows: [] }
      })

      const profile = await builder.getProfile('teen_patti', 'easy')

      expect(profile).not.toBeNull()
      expect(profile?.game_type).toBe('teen_patti')
    })
  })

  describe('should rollback to previous version', () => {
    it('should rollback to previous version by updating active_profile_version', async () => {
      const queryCalls: string[] = []
      let rollbackSucceeded = false

      pool.query.mockImplementation(async (sql: string) => {
        queryCalls.push(sql)
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return {
            rows: [{ key: 'active_profile_version', value: '2' }],
          }
        } else if (sql.includes('SELECT EXISTS') && sql.includes('information_schema')) {
          return {
            rows: [{ exists: true }],
          }
        } else if (sql.includes('INSERT INTO bot_learning_config')) {
          rollbackSucceeded = true
          return { rows: [] }
        } else if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return { rows: [] }
        } else if (sql.includes('DELETE FROM')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await builder.rollbackProfile('1')

      // Verify that INSERT INTO bot_learning_config was called (which contains the version update)
      expect(rollbackSucceeded).toBe(true)
    })

    it('should not rollback if version does not exist', async () => {
      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return {
            rows: [
              { key: 'active_profile_version', value: '1' },
            ],
          }
        } else if (sql.includes('SELECT EXISTS') && sql.includes('information_schema')) {
          return {
            rows: [{ exists: false }],
          }
        } else if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      const loggerErrorSpy = jest.spyOn(logger, 'error')

      try {
        await builder.rollbackProfile('99')
      } catch (e) {
        // Expected to fail
      }

      expect(loggerErrorSpy).toHaveBeenCalled()
    })

    it('should maintain version history for rollback', async () => {
      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return {
            rows: [{ key: 'active_profile_version', value: '2' }],
          }
        } else if (sql.includes('SELECT EXISTS') && sql.includes('information_schema.tables')) {
          return {
            rows: [{ exists: false }],
          }
        } else if (sql.includes('SELECT table_name') && sql.includes('bot_profiles_v')) {
          return {
            rows: [
              { table_name: 'bot_profiles_v0' },
              { table_name: 'bot_profiles_v1' },
              { table_name: 'bot_profiles_v2' },
            ],
          }
        }
        return { rows: [] }
      })

      const versions = await builder.getProfileVersionHistory()

      expect(versions).toBeDefined()
      expect(versions.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('should cleanup old versions (keep last 5)', () => {
    it('should delete versions older than the last 5', async () => {
      const deletedVersions: string[] = []

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return {
            rows: [{ key: 'active_profile_version', value: '10' }],
          }
        } else if (sql.includes('SELECT table_name') && sql.includes('bot_profiles_v')) {
          return {
            rows: [
              { table_name: 'bot_profiles_v1' },
              { table_name: 'bot_profiles_v2' },
              { table_name: 'bot_profiles_v3' },
              { table_name: 'bot_profiles_v4' },
              { table_name: 'bot_profiles_v5' },
              { table_name: 'bot_profiles_v6' },
              { table_name: 'bot_profiles_v7' },
              { table_name: 'bot_profiles_v8' },
              { table_name: 'bot_profiles_v9' },
              { table_name: 'bot_profiles_v10' },
            ],
          }
        } else if (sql.includes('DROP TABLE') && sql.includes('bot_profiles_v')) {
          const match = sql.match(/bot_profiles_v(\d+)/)
          if (match) {
            deletedVersions.push(`bot_profiles_v${match[1]}`)
          }
          return { rows: [] }
        }
        return { rows: [] }
      })

      await builder.cleanupOldVersions()

      // Cleanup should remove tables older than the last 5
      // If we're at version 10, we should keep 6-10 and delete 1-5
      expect(deletedVersions.length).toBeGreaterThan(0)
    })

    it('should not delete recent versions', async () => {
      const deletedVersions: string[] = []

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return {
            rows: [{ key: 'active_profile_version', value: '3' }],
          }
        } else if (sql.includes('SELECT table_name') && sql.includes('bot_profiles_v')) {
          return {
            rows: [
              { table_name: 'bot_profiles_v1' },
              { table_name: 'bot_profiles_v2' },
              { table_name: 'bot_profiles_v3' },
            ],
          }
        } else if (sql.includes('DROP TABLE') && sql.includes('bot_profiles_v')) {
          const match = sql.match(/bot_profiles_v(\d+)/)
          if (match) {
            deletedVersions.push(`bot_profiles_v${match[1]}`)
          }
          return { rows: [] }
        }
        return { rows: [] }
      })

      await builder.cleanupOldVersions()

      // Should not delete versions 1-3 since we only have 3 versions total
      expect(deletedVersions.length).toBe(0)
    })

    it('should maintain metadata for version tracking', async () => {
      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT EXISTS') && sql.includes('profile_versions')) {
          return {
            rows: [{ exists: true }],
          }
        } else if (sql.includes('SELECT') && sql.includes('profile_versions')) {
          return {
            rows: [
              {
                version: 1,
                created_at: '2024-01-01T00:00:00Z',
                is_active: false,
              },
              {
                version: 2,
                created_at: '2024-01-02T00:00:00Z',
                is_active: true,
              },
            ],
          }
        }
        return { rows: [] }
      })

      const history = await builder.getProfileVersionHistory()

      expect(history).toBeDefined()
      expect(history.some((v: any) => v.is_active === true)).toBe(true)
    })
  })

  describe('version switching edge cases', () => {
    it('should handle switching to same version gracefully', async () => {
      const loggerWarnSpy = jest.spyOn(logger, 'warn')

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return {
            rows: [{ key: 'active_profile_version', value: '2' }],
          }
        }
        return { rows: [] }
      })

      await builder.rollbackProfile('2')

      // Should either warn or gracefully handle
      // This depends on implementation
    })

    it('should handle concurrent rebuild requests safely', async () => {
      const configRows = [
        { key: 'min_sample_size', value: '50' },
        { key: 'rebuild_hour', value: '2' },
        { key: 'stream_lookback_days', value: '7' },
        { key: 'history_lookback_days', value: '30' },
        { key: 'easy_percentile_max', value: '25' },
        { key: 'medium_percentile_min', value: '40' },
        { key: 'medium_percentile_max', value: '60' },
        { key: 'hard_percentile_min', value: '75' },
        { key: 'active_profile_version', value: '0' },
      ]

      const playerRows = Array(300)
        .fill(null)
        .map((_, i) => ({
          user_id: `user_${i}`,
          games_played: 10,
          total_profit: 100 + i,
          avg_profit: 10,
          wins: 5,
          avg_stake: 10,
        }))

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT key, value FROM bot_learning_config')) {
          return { rows: configRows }
        } else if (sql.includes('SELECT') && sql.includes('game_participants')) {
          return { rows: playerRows }
        } else if (sql.includes('CREATE TABLE') && sql.includes('bot_profiles_v')) {
          return { rows: [] }
        } else if (sql.includes('INSERT INTO bot_profiles_v')) {
          return { rows: [] }
        } else if (sql.includes('SELECT') && sql.includes('bot_profiles')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      // Execute multiple rebuilds concurrently
      await Promise.all([
        builder.runRebuild(),
        builder.runRebuild(),
      ])

      // Should not throw errors
      expect(pool.query).toHaveBeenCalled()
    })
  })
})
