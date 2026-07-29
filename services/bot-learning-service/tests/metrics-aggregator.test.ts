import { MetricsAggregator } from '../src/metrics-aggregator'
import pino from 'pino'

// Mock helper functions
const createMockPool = () => {
  return {
    query: jest.fn(),
    connect: jest.fn(),
  } as unknown as any
}

const createMockClient = () => {
  return {
    query: jest.fn(),
    release: jest.fn(),
  } as unknown as any
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

describe('MetricsAggregator', () => {
  let pool: any
  let logger: any
  let aggregator: MetricsAggregator

  beforeEach(() => {
    pool = createMockPool()
    logger = createMockLogger()
    aggregator = new MetricsAggregator(pool, logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('should aggregate metrics for all profiles', () => {
    it('should fetch metrics for all bot profiles and insert into bot_profile_metrics', async () => {
      const mockProfiles = [
        { id: 'profile-1', game_type: 'teen_patti', difficulty: 'easy', win_rate_target: 35.0 },
        { id: 'profile-2', game_type: 'teen_patti', difficulty: 'medium', win_rate_target: 50.0 },
      ]

      const mockParticipants = [
        { id: 'p1', prize_won: 100, entry_fee_deducted: 50 },
        { id: 'p2', prize_won: 50, entry_fee_deducted: 50 },
        { id: 'p3', prize_won: 150, entry_fee_deducted: 50 },
      ]

      const mockClient = createMockClient()
      mockClient.query.mockResolvedValue({ rows: [] })

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, game_type, difficulty, win_rate_target')) {
          return { rows: mockProfiles }
        }
        if (sql.includes('SELECT gp.id, gp.prize_won')) {
          return { rows: mockParticipants }
        }
        return { rows: [] }
      })

      pool.connect.mockResolvedValue(mockClient)

      // Call aggregation and await it
      await aggregator.aggregateHourlyMetrics()

      // Verify that profiles were queried
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, game_type, difficulty, win_rate_target')
      )

      // Verify that client was used for transaction
      expect(pool.connect).toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('should handle empty profiles gracefully', async () => {
      pool.query.mockResolvedValue({ rows: [] })

      const loggerInfoSpy = jest.spyOn(logger, 'info')

      await aggregator.aggregateHourlyMetrics()

      expect(loggerInfoSpy).toHaveBeenCalledWith('No bot profiles found')
    })
  })

  describe('should calculate drift correctly', () => {
    it('should calculate drift_from_target = actual_win_rate - target_win_rate', async () => {
      const mockProfiles = [
        { id: 'profile-1', game_type: 'teen_patti', difficulty: 'easy', win_rate_target: 35.0 },
      ]

      // Create participants where win rate will be 66.67% (2 wins out of 3)
      const mockParticipants = [
        { id: 'p1', prize_won: 100, entry_fee_deducted: 50 }, // win: 100 > 50
        { id: 'p2', prize_won: 30, entry_fee_deducted: 50 }, // loss: 30 < 50
        { id: 'p3', prize_won: 150, entry_fee_deducted: 50 }, // win: 150 > 50
      ]

      const mockClient = createMockClient()
      mockClient.query.mockResolvedValue({ rows: [] })

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, game_type, difficulty, win_rate_target')) {
          return { rows: mockProfiles }
        }
        if (sql.includes('SELECT gp.id, gp.prize_won')) {
          return { rows: mockParticipants }
        }
        return { rows: [] }
      })

      pool.connect.mockResolvedValue(mockClient)

      await aggregator.aggregateHourlyMetrics()

      // Capture the INSERT call to verify drift calculation
      const insertCalls = mockClient.query.mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO bot_profile_metrics')
      )

      expect(insertCalls.length).toBeGreaterThan(0)

      // Check the parameters of the INSERT call
      // The drift should be: (2/3 * 100) - 35.0 = 66.67 - 35.0 = 31.67
      const params = insertCalls[0][1]
      const driftFromTarget = params[9] // Position 9 is drift_from_target

      // drift ≈ 66.67 - 35.0 = 31.67
      expect(driftFromTarget).toBeCloseTo(31.667, 2)
    })
  })

  describe('should handle missing data gracefully', () => {
    it('should handle profiles with no game participants in last hour', async () => {
      const mockProfiles = [
        { id: 'profile-1', game_type: 'teen_patti', difficulty: 'easy', win_rate_target: 35.0 },
      ]

      const mockClient = createMockClient()
      mockClient.query.mockResolvedValue({ rows: [] })

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, game_type, difficulty, win_rate_target')) {
          return { rows: mockProfiles }
        }
        if (sql.includes('SELECT gp.id, gp.prize_won')) {
          // No participants for this profile
          return { rows: [] }
        }
        return { rows: [] }
      })

      pool.connect.mockResolvedValue(mockClient)

      await aggregator.aggregateHourlyMetrics()

      // Verify that a metrics record was still inserted with zero values
      const insertCalls = mockClient.query.mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO bot_profile_metrics')
      )

      expect(insertCalls.length).toBeGreaterThan(0)

      const params = insertCalls[0][1]
      expect(params[4]).toBe(0) // game_count = 0
      expect(params[8]).toBe(0) // sample_size = 0
    })

    it('should log errors but not throw when a profile fails', async () => {
      const mockProfiles = [
        { id: 'profile-1', game_type: 'teen_patti', difficulty: 'easy', win_rate_target: 35.0 },
        { id: 'profile-2', game_type: 'teen_patti', difficulty: 'medium', win_rate_target: 50.0 },
      ]

      const mockClient = createMockClient()
      mockClient.query.mockResolvedValue({ rows: [] })

      let callCount = 0
      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, game_type, difficulty, win_rate_target')) {
          return { rows: mockProfiles }
        }
        if (sql.includes('SELECT gp.id, gp.prize_won')) {
          callCount++
          if (callCount === 1) {
            throw new Error('Database error for profile 1')
          }
          // Second profile succeeds
          return { rows: [{ id: 'p1', prize_won: 100, entry_fee_deducted: 50 }] }
        }
        return { rows: [] }
      })

      pool.connect.mockResolvedValue(mockClient)

      const loggerErrorSpy = jest.spyOn(logger, 'error')

      await aggregator.aggregateHourlyMetrics()

      // Verify that error was logged but aggregation continued
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: 'profile-1',
          gameType: 'teen_patti',
          difficulty: 'easy',
        }),
        expect.stringContaining('Failed to calculate metrics for profile')
      )

      // Verify that at least one metric was inserted (for profile 2)
      const insertCalls = mockClient.query.mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO bot_profile_metrics')
      )
      expect(insertCalls.length).toBeGreaterThan(0)
    })
  })

  describe('should retry on database timeout', () => {
    it('should retry on connection timeout and eventually succeed', async () => {
      const mockProfiles = [
        { id: 'profile-1', game_type: 'teen_patti', difficulty: 'easy', win_rate_target: 35.0 },
      ]

      const mockParticipants = [
        { id: 'p1', prize_won: 100, entry_fee_deducted: 50 },
      ]

      const mockClient = createMockClient()
      mockClient.query.mockResolvedValue({ rows: [] })

      let attemptCount = 0
      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, game_type, difficulty, win_rate_target')) {
          attemptCount++
          if (attemptCount === 1) {
            throw new Error('Connection timeout')
          }
          return { rows: mockProfiles }
        }
        if (sql.includes('SELECT gp.id, gp.prize_won')) {
          return { rows: mockParticipants }
        }
        return { rows: [] }
      })

      pool.connect.mockResolvedValue(mockClient)

      const loggerWarnSpy = jest.spyOn(logger, 'warn')

      await aggregator.aggregateHourlyMetrics()

      // Verify that retry was attempted
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
        }),
        expect.stringContaining('Aggregation failed, retrying')
      )

      // Verify that eventually succeeded (metrics were inserted)
      const insertCalls = mockClient.query.mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO bot_profile_metrics')
      )
      expect(insertCalls.length).toBeGreaterThan(0)
    }, 10000)

    it('should give up after max retries', async () => {
      pool.query.mockRejectedValue(new Error('Connection timeout'))

      const loggerErrorSpy = jest.spyOn(logger, 'error')

      await aggregator.aggregateHourlyMetrics()

      // Verify that error was logged after max retries
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Hourly metrics aggregation failed')
      )
    }, 10000)
  })

  describe('win rate and standard deviation calculations', () => {
    it('should calculate win rate as percentage of wins', async () => {
      const mockProfiles = [
        { id: 'profile-1', game_type: 'teen_patti', difficulty: 'easy', win_rate_target: 35.0 },
      ]

      // 2 wins, 1 loss = 66.67% win rate
      const mockParticipants = [
        { id: 'p1', prize_won: 100, entry_fee_deducted: 50 }, // win
        { id: 'p2', prize_won: 30, entry_fee_deducted: 50 }, // loss
        { id: 'p3', prize_won: 150, entry_fee_deducted: 50 }, // win
      ]

      const mockClient = createMockClient()
      mockClient.query.mockResolvedValue({ rows: [] })

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, game_type, difficulty, win_rate_target')) {
          return { rows: mockProfiles }
        }
        if (sql.includes('SELECT gp.id, gp.prize_won')) {
          return { rows: mockParticipants }
        }
        return { rows: [] }
      })

      pool.connect.mockResolvedValue(mockClient)

      await aggregator.aggregateHourlyMetrics()

      const insertCalls = mockClient.query.mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO bot_profile_metrics')
      )

      const params = insertCalls[0][1]
      const avgWinRate = params[5] // Position 5 is avg_win_rate

      // Should be approximately 66.67%
      expect(avgWinRate).toBeCloseTo(66.667, 2)
    })

    it('should calculate win rate std deviation', async () => {
      const mockProfiles = [
        { id: 'profile-1', game_type: 'teen_patti', difficulty: 'easy', win_rate_target: 35.0 },
      ]

      // Alternating wins and losses for consistent pattern
      const mockParticipants = [
        { id: 'p1', prize_won: 100, entry_fee_deducted: 50 }, // win (100%)
        { id: 'p2', prize_won: 30, entry_fee_deducted: 50 }, // loss (0%)
        { id: 'p3', prize_won: 150, entry_fee_deducted: 50 }, // win (100%)
        { id: 'p4', prize_won: 40, entry_fee_deducted: 50 }, // loss (0%)
      ]

      const mockClient = createMockClient()
      mockClient.query.mockResolvedValue({ rows: [] })

      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, game_type, difficulty, win_rate_target')) {
          return { rows: mockProfiles }
        }
        if (sql.includes('SELECT gp.id, gp.prize_won')) {
          return { rows: mockParticipants }
        }
        return { rows: [] }
      })

      pool.connect.mockResolvedValue(mockClient)

      await aggregator.aggregateHourlyMetrics()

      const insertCalls = mockClient.query.mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO bot_profile_metrics')
      )

      const params = insertCalls[0][1]
      const winRateStd = params[6] // Position 6 is win_rate_std

      // Should be > 0 since there's variance
      expect(winRateStd).toBeGreaterThan(0)
      // For this pattern: mean = 50%, values are [100, 0, 100, 0]
      // std = sqrt(((100-50)^2 + (0-50)^2 + (100-50)^2 + (0-50)^2) / 4) = sqrt(2500) = 50
      expect(winRateStd).toBeCloseTo(50, 1)
    })
  })
})
