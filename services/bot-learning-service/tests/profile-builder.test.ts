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

describe('ProfileBuilder - Ludo capture/safe-play aggregation', () => {
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

  it('computes capture_probability and safe_play_probability from ludo_move_decisions for ludo', async () => {
    const configRows = [
      { key: 'min_sample_size', value: '50' },
      { key: 'stream_lookback_days', value: '7' },
      { key: 'history_lookback_days', value: '30' },
      { key: 'easy_percentile_max', value: '25' },
      { key: 'medium_percentile_min', value: '40' },
      { key: 'medium_percentile_max', value: '60' },
      { key: 'hard_percentile_min', value: '75' },
    ]
    const playerRows = Array(300).fill(null).map((_, i) => ({
      user_id: `user_${i}`, games_played: 10, total_profit: 100 + i, avg_profit: 10, wins: 5, avg_stake: 10,
    }))

    const insertParamsByGameType: Record<string, any[][]> = { teen_patti: [], ludo: [], aviator: [] }
    pool.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT key, value FROM bot_learning_config')) return { rows: configRows }
      if (sql.includes('game_participants')) return { rows: playerRows }
      if (sql.includes('FROM ludo_move_decisions')) return { rows: [{ capture_rate: '0.7', safe_play_rate: '0.9' }] }
      if (sql.includes('INSERT INTO bot_profiles') && params) {
        const gameType = params[0]
        insertParamsByGameType[gameType]?.push(params)
        return { rows: [] }
      }
      return { rows: [] }
    })

    await builder.runRebuild()

    // Ludo rows get real capture/safe-play values from the decisions query.
    expect(insertParamsByGameType.ludo.length).toBeGreaterThan(0)
    for (const params of insertParamsByGameType.ludo) {
      const [, , , , , , , , , , captureProbability, safePlayProbability] = params
      expect(captureProbability).toBeCloseTo(0.7)
      expect(safePlayProbability).toBeCloseTo(0.9)
    }

    // Teen Patti rows must NOT get capture/safe-play values -- meaningless
    // for that game, must stay null.
    expect(insertParamsByGameType.teen_patti.length).toBeGreaterThan(0)
    for (const params of insertParamsByGameType.teen_patti) {
      const [, , , , , , , , , , captureProbability, safePlayProbability] = params
      expect(captureProbability).toBeNull()
      expect(safePlayProbability).toBeNull()
    }
  })

  it('leaves capture_probability/safe_play_probability null when the tier is below min_sample_size', async () => {
    const configRows = [
      { key: 'min_sample_size', value: '1000' }, // unreachable -- forces the below-threshold path
      { key: 'stream_lookback_days', value: '7' },
      { key: 'history_lookback_days', value: '30' },
      { key: 'easy_percentile_max', value: '25' },
      { key: 'medium_percentile_min', value: '40' },
      { key: 'medium_percentile_max', value: '60' },
      { key: 'hard_percentile_min', value: '75' },
    ]
    // Enough players to pass the overall gameType-level gate but each
    // individual tier slice is still far below the 1000 min_sample_size.
    const playerRows = Array(1200).fill(null).map((_, i) => ({
      user_id: `user_${i}`, games_played: 10, total_profit: 100 + i, avg_profit: 10, wins: 5, avg_stake: 10,
    }))

    let ludoInsertParams: any[] | null = null
    pool.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT key, value FROM bot_learning_config')) return { rows: configRows }
      if (sql.includes('game_participants')) return { rows: playerRows }
      if (sql.includes('FROM ludo_move_decisions')) return { rows: [{ capture_rate: '0.7', safe_play_rate: '0.9' }] }
      if (sql.includes('INSERT INTO bot_profiles') && params && params[0] === 'ludo') {
        ludoInsertParams = params
        return { rows: [] }
      }
      return { rows: [] }
    })

    await builder.runRebuild()

    expect(ludoInsertParams).not.toBeNull()
    const [, , , , , , , , , , captureProbability, safePlayProbability] = ludoInsertParams!
    expect(captureProbability).toBeNull()
    expect(safePlayProbability).toBeNull()
  })
})
