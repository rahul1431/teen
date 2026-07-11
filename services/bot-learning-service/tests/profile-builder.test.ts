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

describe('ProfileBuilder - MIN_SAMPLE_SIZE', () => {
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

  it('should require at least 50 players per tier', async () => {
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

    const playerRows = Array(25)
      .fill(null)
      .map((_, i) => ({
        user_id: `user_${i}`,
        games_played: 10,
        total_profit: 100,
        avg_profit: 10,
        wins: 5,
        avg_stake: 10,
      }))

    // Setup mock to handle multiple calls
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT key, value FROM bot_learning_config')) {
        return { rows: configRows }
      } else if (sql.includes('SELECT') && sql.includes('game_participants')) {
        return { rows: playerRows }
      } else if (sql.includes('INSERT INTO bot_profiles') || sql.includes('SELECT * FROM bot_profiles')) {
        return { rows: [] }
      }
      return { rows: [] }
    })

    const loggerWarnSpy = jest.spyOn(logger, 'warn')

    // Call runRebuild which internally validates min_sample_size
    await builder.runRebuild()

    // Verify logger warned about insufficient data for at least one game type
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        found: 25,
        need: 50,
      }),
      expect.stringContaining('Insufficient data')
    )
  })

  it('should accept profiles with 50+ players per tier', async () => {
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

    // Mock sufficient player data (300 players will split as:
    // easy (0-25% of 300 = 75), medium (40-60% of 300 = 60), hard (75-100% of 300 = 75)
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

    // Setup mock to handle multiple calls
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT key, value FROM bot_learning_config')) {
        return { rows: configRows }
      } else if (sql.includes('SELECT') && sql.includes('game_participants')) {
        return { rows: playerRows }
      } else if (sql.includes('INSERT INTO bot_profiles') || sql.includes('SELECT * FROM bot_profiles')) {
        return { rows: [] }
      }
      return { rows: [] }
    })

    const loggerInfoSpy = jest.spyOn(logger, 'info')

    // Call runRebuild
    await builder.runRebuild()

    // Verify that profiles were built (not skipped due to insufficient data)
    const profileUpsertCalls = loggerInfoSpy.mock.calls.filter(
      (call) => typeof call[1] === 'string' && (call[1].includes('Profile upserted') || call[1].includes('Building profiles'))
    )
    expect(profileUpsertCalls.length).toBeGreaterThan(0)
  })
})
