import { AdaptiveThresholds } from '../src/adaptive-thresholds'
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
    publish: jest.fn().mockResolvedValue(0),
  } as unknown as any
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

describe('AdaptiveThresholds', () => {
  let pool: any
  let redis: any
  let logger: any
  let adaptive: AdaptiveThresholds

  beforeEach(() => {
    pool = createMockPool()
    redis = createMockRedis()
    logger = createMockLogger()
    adaptive = new AdaptiveThresholds(pool, redis, logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('calculateCohortTargets', () => {
    it('should calculate cohort targets from player clusters', async () => {
      const cohortData = [
        { cluster_id: 0, avg_win_rate: 0.52, player_count: 50, cluster_name: 'Casual' },
        { cluster_id: 1, avg_win_rate: 0.58, player_count: 40, cluster_name: 'Aggressive' },
        { cluster_id: 2, avg_win_rate: 0.50, player_count: 60, cluster_name: 'Grind' },
        { cluster_id: 3, avg_win_rate: 0.45, player_count: 30, cluster_name: 'Risky' },
      ]

      pool.query.mockResolvedValue({ rows: cohortData })

      const gameType = 'teen_patti'
      const difficulty = 'easy'

      const result = await adaptive.calculateCohortTargets(gameType, difficulty)

      expect(result).toHaveLength(4)
      expect(result[0]).toMatchObject({
        cluster_id: 0,
        cohort_target_win_rate: 0.54, // 0.52 + 0.02
      })
      expect(result[1]).toMatchObject({
        cluster_id: 1,
        cohort_target_win_rate: 0.60, // 0.58 + 0.02
      })
    })

    it('should handle missing cluster data gracefully', async () => {
      pool.query.mockResolvedValue({ rows: [] })

      const gameType = 'teen_patti'
      const difficulty = 'easy'

      const result = await adaptive.calculateCohortTargets(gameType, difficulty)

      expect(result).toEqual([])
    })

    it('should apply cohort_id to bot profiles', async () => {
      // Mock bot_profiles_cohort_targets insert
      pool.query.mockResolvedValue({ rows: [] })

      const gameType = 'teen_patti'
      const difficulty = 'easy'
      const cohortTargets = [
        { cluster_id: 0, cohort_target_win_rate: 0.54, player_count: 50, cluster_name: 'Casual', avg_win_rate: 0.52 },
      ]

      await adaptive.storeCohortTargets(gameType, difficulty, cohortTargets)

      // Verify insert was called
      expect(pool.query).toHaveBeenCalled()

      // Verify the SQL contains the insert
      const calls = pool.query.mock.calls
      const insertCall = calls.find((c: any[]) => c[0].includes('INSERT INTO bot_profiles_cohort_targets'))
      expect(insertCall).toBeDefined()
    })

    it('should handle per-game_type/difficulty cohorts', async () => {
      const cohortData = [
        { cluster_id: 0, avg_win_rate: 0.50, player_count: 100, cluster_name: 'Casual' },
      ]

      pool.query.mockResolvedValue({ rows: cohortData })

      // Test for different game types and difficulties
      const combinations = [
        { gameType: 'teen_patti', difficulty: 'easy' },
        { gameType: 'teen_patti', difficulty: 'medium' },
        { gameType: 'teen_patti', difficulty: 'hard' },
        { gameType: 'ludo', difficulty: 'easy' },
        { gameType: 'aviator', difficulty: 'medium' },
      ]

      for (const combo of combinations) {
        const result = await adaptive.calculateCohortTargets(combo.gameType, combo.difficulty)
        expect(result).toBeDefined()
        expect(pool.query).toHaveBeenCalledWith(
          expect.stringContaining('WHERE gr.game_type = $1 AND gr.difficulty = $2'),
          expect.arrayContaining([combo.gameType, combo.difficulty])
        )
      }
    })
  })

  describe('recalculateCohortTargetsDaily', () => {
    it('should update cohort targets daily', async () => {
      // Mock queries for getting all game_type/difficulty combinations
      pool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT DISTINCT game_type, difficulty FROM bot_profiles')) {
          return {
            rows: [
              { game_type: 'teen_patti', difficulty: 'easy' },
              { game_type: 'teen_patti', difficulty: 'medium' },
              { game_type: 'teen_patti', difficulty: 'hard' },
              { game_type: 'ludo', difficulty: 'easy' },
              { game_type: 'ludo', difficulty: 'medium' },
              { game_type: 'ludo', difficulty: 'hard' },
              { game_type: 'aviator', difficulty: 'easy' },
              { game_type: 'aviator', difficulty: 'medium' },
              { game_type: 'aviator', difficulty: 'hard' },
            ],
          }
        } else if (sql.includes('SELECT') && sql.includes('cluster_id')) {
          return {
            rows: [
              { cluster_id: 0, avg_win_rate: 0.50, player_count: 100, cluster_name: 'Casual' },
            ],
          }
        } else if (sql.includes('INSERT') || sql.includes('UPDATE')) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      const loggerInfoSpy = jest.spyOn(logger, 'info')

      await adaptive.recalculateCohortTargetsDaily()

      // Verify daily recalculation was logged
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Cohort target recalculation')
      )
    })

    it('should handle errors gracefully during daily recalculation', async () => {
      // First call returns profiles list, subsequent calls fail
      let callCount = 0
      pool.query.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // First call: get distinct game_type/difficulty
          return {
            rows: [
              { game_type: 'teen_patti', difficulty: 'easy' },
            ],
          }
        }
        // Subsequent calls fail
        throw new Error('Database error')
      })

      const loggerErrorSpy = jest.spyOn(logger, 'error')

      await adaptive.recalculateCohortTargetsDaily()

      // Verify error was logged
      expect(loggerErrorSpy).toHaveBeenCalled()
    })
  })

  describe('getCohortTargetForProfile', () => {
    it('should retrieve cohort target for a bot profile', async () => {
      pool.query.mockResolvedValue({
        rows: [{ cohort_target_win_rate: 0.54, cohort_id: 0 }],
      })

      const target = await adaptive.getCohortTargetForProfile('teen_patti', 'easy')

      expect(target).toBe(0.54)
      expect(pool.query).toHaveBeenCalled()
    })

    it('should return default target if cohort target not found', async () => {
      pool.query.mockResolvedValue({ rows: [] })

      const target = await adaptive.getCohortTargetForProfile('teen_patti', 'easy')

      // Default to 0.50 if not found
      expect(target).toBe(0.50)
    })
  })

  describe('applyDriftDetectionWithCohortTarget', () => {
    it('should use cohort target instead of global target for drift detection', async () => {
      pool.query.mockResolvedValue({
        rows: [{ cohort_target_win_rate: 0.54, cohort_id: 0 }],
      })

      const actualWinRate = 0.45
      const drift = await adaptive.calculateDriftWithCohortTarget('teen_patti', 'easy', actualWinRate)

      // drift = 0.45 - 0.54 = -0.09
      expect(drift).toBeCloseTo(-0.09, 2)
    })

    it('should handle multiple difficulty levels', async () => {
      let callCount = 0
      const targets: Record<string, number> = {
        'teen_patti-easy': 0.45,
        'teen_patti-medium': 0.50,
        'teen_patti-hard': 0.60,
      }

      pool.query.mockImplementation(async (sql: string, params: any[]) => {
        const gameType = params[0]
        const difficulty = params[1]
        const key = `${gameType}-${difficulty}`
        const target = targets[key] || 0.50
        return { rows: [{ cohort_target_win_rate: target }] }
      })

      const easyDrift = await adaptive.calculateDriftWithCohortTarget('teen_patti', 'easy', 0.50)
      const mediumDrift = await adaptive.calculateDriftWithCohortTarget('teen_patti', 'medium', 0.50)
      const hardDrift = await adaptive.calculateDriftWithCohortTarget('teen_patti', 'hard', 0.50)

      // easy: 0.50 - 0.45 = 0.05
      // medium: 0.50 - 0.50 = 0.00
      // hard: 0.50 - 0.60 = -0.10
      expect(easyDrift).toBeCloseTo(0.05, 2)
      expect(mediumDrift).toBeCloseTo(0.00, 2)
      expect(hardDrift).toBeCloseTo(-0.10, 2)
    })
  })
})
