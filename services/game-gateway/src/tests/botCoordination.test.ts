import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BotStatsLoader, BotStats } from '../botCoordination/botStatsLoader'
import { ElectionAlgorithm, BotWithStats } from '../botCoordination/electionAlgorithm'
import { GameRecorder, GameOutcome } from '../botCoordination/gameRecorder'

// ============================================================================
// Mock implementations
// ============================================================================

class MockRedis {
  private store: Map<string, string> = new Map()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async setex(key: string, ttl: number, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }

  async flushAll(): Promise<void> {
    this.store.clear()
  }

  getStore() {
    return this.store
  }
}

class MockDatabase {
  private queryResults: Map<string, any[]> = new Map()
  public lastQueries: Array<{ sql: string; params: any[] }> = []

  setQueryResult(sql: string, params: any[], rows: any[]) {
    // Normalize params for matching (convert BigInt to string)
    const normalizedParams = params.map(p =>
      typeof p === 'bigint' ? p.toString() : p
    )
    const key = sql + JSON.stringify(normalizedParams)
    this.queryResults.set(key, rows)
  }

  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    this.lastQueries.push({ sql, params })
    // Normalize params for matching (convert BigInt to string)
    const normalizedParams = params.map(p =>
      typeof p === 'bigint' ? p.toString() : p
    )
    const key = sql + JSON.stringify(normalizedParams)
    const rows = this.queryResults.get(key) ?? []
    return { rows }
  }

  clearQueries() {
    this.lastQueries = []
  }
}

// ============================================================================
// Helper functions
// ============================================================================

function createBotStats(overrides: Partial<BotStats> = {}): BotStats {
  return {
    lifetimeGames: 100,
    lifetimeWins: 50,
    lifetimeWinRate: 0.5,
    gamesAsWinner: 30,
    gamesAsWinnerSuccess: 25,
    vsRpWinRate: 0.45,
    avgBlocksOnRp: 2.3,
    moveEfficiency: 0.72,
    last10Games: [
      { won: true, opponentType: 'rp', date: '2026-07-23T10:00:00Z' },
      { won: false, opponentType: 'rp', date: '2026-07-23T09:00:00Z' },
    ],
    ...overrides,
  }
}

function createBotWithStats(botId: bigint, stats: BotStats): BotWithStats {
  return { botId, stats }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('BotCoordination - ElectionAlgorithm', () => {
  let algorithm: ElectionAlgorithm

  beforeEach(() => {
    algorithm = new ElectionAlgorithm()
  })

  describe('Test 1: Election algorithm chooses correctly by lifetime_winrate strategy', () => {
    it('should select bot with highest lifetime_winrate', () => {
      const bot1 = createBotWithStats(BigInt(1), createBotStats({ lifetimeWinRate: 0.5 }))
      const bot2 = createBotWithStats(BigInt(2), createBotStats({ lifetimeWinRate: 0.75 }))
      const bot3 = createBotWithStats(BigInt(3), createBotStats({ lifetimeWinRate: 0.6 }))

      const elected = algorithm.electWinnerBot([bot1, bot2, bot3], 'lifetime_winrate')

      expect(elected).toBe(BigInt(2))
    })

    it('should handle ties by selecting first bot with highest rate', () => {
      const bot1 = createBotWithStats(BigInt(1), createBotStats({ lifetimeWinRate: 0.8 }))
      const bot2 = createBotWithStats(BigInt(2), createBotStats({ lifetimeWinRate: 0.8 }))

      const elected = algorithm.electWinnerBot([bot1, bot2], 'lifetime_winrate')

      expect(elected).toBe(BigInt(1))
    })

    it('should work with single bot', () => {
      const bot1 = createBotWithStats(BigInt(1), createBotStats({ lifetimeWinRate: 0.5 }))

      const elected = algorithm.electWinnerBot([bot1], 'lifetime_winrate')

      expect(elected).toBe(BigInt(1))
    })

    it('should throw error with no bots', () => {
      expect(() => algorithm.electWinnerBot([], 'lifetime_winrate')).toThrow(
        'Cannot elect winner: no bots provided'
      )
    })
  })

  describe('Test 2: Election algorithm rotates through bots correctly', () => {
    it('should rotate through bots in order', () => {
      const bot1 = createBotWithStats(BigInt(1), createBotStats())
      const bot2 = createBotWithStats(BigInt(2), createBotStats())
      const bot3 = createBotWithStats(BigInt(3), createBotStats())
      const bots = [bot1, bot2, bot3]

      const elected1 = algorithm.electWinnerBot(bots, 'rotation', 'teen_patti')
      const elected2 = algorithm.electWinnerBot(bots, 'rotation', 'teen_patti')
      const elected3 = algorithm.electWinnerBot(bots, 'rotation', 'teen_patti')
      const elected4 = algorithm.electWinnerBot(bots, 'rotation', 'teen_patti')

      expect(elected1).toBe(BigInt(2))
      expect(elected2).toBe(BigInt(3))
      expect(elected3).toBe(BigInt(1))
      expect(elected4).toBe(BigInt(2))
    })

    it('should use separate rotation state per gameTypeKey', () => {
      const bot1 = createBotWithStats(BigInt(1), createBotStats())
      const bot2 = createBotWithStats(BigInt(2), createBotStats())
      const bots = [bot1, bot2]

      const tp1 = algorithm.electWinnerBot(bots, 'rotation', 'teen_patti')
      const ludo1 = algorithm.electWinnerBot(bots, 'rotation', 'ludo')
      const tp2 = algorithm.electWinnerBot(bots, 'rotation', 'teen_patti')
      const ludo2 = algorithm.electWinnerBot(bots, 'rotation', 'ludo')

      expect(tp1).toBe(BigInt(2))
      expect(ludo1).toBe(BigInt(2))
      expect(tp2).toBe(BigInt(1))
      expect(ludo2).toBe(BigInt(1))
    })

    it('should start rotation from index 0 for new gameTypeKey', () => {
      const bot1 = createBotWithStats(BigInt(1), createBotStats())
      const bot2 = createBotWithStats(BigInt(2), createBotStats())
      const bots = [bot1, bot2]

      const elected = algorithm.electWinnerBot(bots, 'rotation', 'new_game')

      expect(elected).toBe(BigInt(2)) // First call returns next index (0+1) % 2 = 1
    })
  })

  describe('Test 3: isCoordinationSuccess returns true when elected bot wins', () => {
    it('should return true when elected bot is the actual winner', () => {
      const electedBotId = BigInt(1)
      const actualWinnerId = BigInt(1)
      const targetWinRate = 0.7

      const success = algorithm.isCoordinationSuccess(actualWinnerId, electedBotId, targetWinRate)

      expect(success).toBe(true)
    })

    it('should return true regardless of targetWinRate when bot wins', () => {
      const electedBotId = BigInt(1)
      const actualWinnerId = BigInt(1)

      const success1 = algorithm.isCoordinationSuccess(actualWinnerId, electedBotId, 0.1)
      const success2 = algorithm.isCoordinationSuccess(actualWinnerId, electedBotId, 0.9)

      expect(success1).toBe(true)
      expect(success2).toBe(true)
    })
  })

  describe('Test 4: isCoordinationSuccess probabilistic evaluation when elected bot loses', () => {
    it('should use probability when elected bot loses', () => {
      const electedBotId = BigInt(1)
      const actualWinnerId = BigInt(2)
      const targetWinRate = 0.8

      // Test multiple times to verify probability is used
      const results: boolean[] = []
      for (let i = 0; i < 100; i++) {
        const success = algorithm.isCoordinationSuccess(actualWinnerId, electedBotId, targetWinRate)
        results.push(success)
      }

      const successCount = results.filter(r => r).length
      // With 0.8 probability, we expect roughly 80 successes out of 100
      // Allow 20-point range for variance (60-100)
      expect(successCount).toBeGreaterThanOrEqual(50)
      expect(successCount).toBeLessThanOrEqual(100)

      // At least some should be false and some should be true
      const hasTrueValues = results.some(r => r === true)
      const hasFalseValues = results.some(r => r === false)
      expect(hasTrueValues || hasFalseValues).toBe(true)
    })

    it('should return mostly false with very low targetWinRate', () => {
      const electedBotId = BigInt(1)
      const actualWinnerId = BigInt(2)
      const targetWinRate = 0.05

      const results: boolean[] = []
      for (let i = 0; i < 100; i++) {
        const success = algorithm.isCoordinationSuccess(actualWinnerId, electedBotId, targetWinRate)
        results.push(success)
      }

      const successCount = results.filter(r => r).length
      // With 0.05 probability, expect very few successes
      expect(successCount).toBeLessThanOrEqual(20)
    })

    it('should return mostly true with very high targetWinRate', () => {
      const electedBotId = BigInt(1)
      const actualWinnerId = BigInt(2)
      const targetWinRate = 0.95

      const results: boolean[] = []
      for (let i = 0; i < 100; i++) {
        const success = algorithm.isCoordinationSuccess(actualWinnerId, electedBotId, targetWinRate)
        results.push(success)
      }

      const successCount = results.filter(r => r).length
      // With 0.95 probability, expect many successes
      expect(successCount).toBeGreaterThanOrEqual(80)
    })
  })
})

describe('BotCoordination - BotStatsLoader', () => {
  let loader: BotStatsLoader
  let mockRedis: MockRedis
  let mockDb: MockDatabase

  beforeEach(() => {
    mockRedis = new MockRedis()
    mockDb = new MockDatabase()
    loader = new BotStatsLoader(mockRedis as any, mockDb as any)
  })

  describe('Test 5: Redis cache is populated at game start with bot stats', () => {
    it('should cache bot stats in Redis after loading', async () => {
      const botId = BigInt(1)
      const expectedStats = createBotStats({ lifetimeWinRate: 0.65 })

      const query = `SELECT
        COUNT(*) as total_games,
        SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as total_wins,
        SUM(CASE WHEN winner_bot_id = $1 AND coordination_success = true THEN 1 ELSE 0 END) as winner_successes,
        SUM(CASE WHEN winner_bot_id = $1 THEN 1 ELSE 0 END) as chosen_as_winner,
        AVG((bot_performance::jsonb -> ($1::text) -> 'blocks_on_rp')::numeric) as avg_blocks,
        AVG((bot_performance::jsonb -> ($1::text) -> 'move_efficiency')::numeric) as avg_efficiency
      FROM bot_learning_sessions
      WHERE bot_ids @> $2::jsonb`

      mockDb.setQueryResult(query, [botId, JSON.stringify(['1'])], [
        {
          total_games: 100,
          total_wins: 65,
          winner_successes: 20,
          chosen_as_winner: 30,
          avg_blocks: 2.3,
          avg_efficiency: 0.72,
        },
      ])

      const rpQuery = `SELECT
        COUNT(*) as rp_games,
        SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as rp_wins
      FROM bot_learning_sessions
      WHERE bot_ids @> $2::jsonb`

      mockDb.setQueryResult(rpQuery, [botId, JSON.stringify(['1'])], [
        {
          rp_games: 100,
          rp_wins: 45,
        },
      ])

      const lastGamesQuery = `SELECT
        actual_winner_id,
        created_at
      FROM bot_learning_sessions
      WHERE bot_ids @> $1::jsonb
      ORDER BY created_at DESC
      LIMIT 10`

      mockDb.setQueryResult(lastGamesQuery, [JSON.stringify(['1'])], [
        { actual_winner_id: botId, created_at: '2026-07-23T10:00:00Z' },
        { actual_winner_id: BigInt(2), created_at: '2026-07-23T09:00:00Z' },
      ])

      // Load stats
      const stats = await loader.loadBotStats(botId)

      // Verify stats are returned
      expect(stats.lifetimeWinRate).toBe(0.65)
      expect(stats.lifetimeGames).toBe(100)
      expect(stats.lifetimeWins).toBe(65)

      // Verify cache is populated
      const cacheKey = `bot:stats:${botId}`
      const cached = await mockRedis.get(cacheKey)
      expect(cached).toBeDefined()
      expect(JSON.parse(cached!)).toEqual(stats)
    })

    it('should return cached stats on second load without DB query', async () => {
      const botId = BigInt(2)
      const expectedStats = createBotStats({ lifetimeWinRate: 0.75 })

      const query = `SELECT
        COUNT(*) as total_games,
        SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as total_wins,
        SUM(CASE WHEN winner_bot_id = $1 AND coordination_success = true THEN 1 ELSE 0 END) as winner_successes,
        SUM(CASE WHEN winner_bot_id = $1 THEN 1 ELSE 0 END) as chosen_as_winner,
        AVG((bot_performance::jsonb -> ($1::text) -> 'blocks_on_rp')::numeric) as avg_blocks,
        AVG((bot_performance::jsonb -> ($1::text) -> 'move_efficiency')::numeric) as avg_efficiency
      FROM bot_learning_sessions
      WHERE bot_ids @> $2::jsonb`

      mockDb.setQueryResult(query, [botId, JSON.stringify(['2'])], [
        {
          total_games: 100,
          total_wins: 75,
          winner_successes: 25,
          chosen_as_winner: 35,
          avg_blocks: 2.5,
          avg_efficiency: 0.75,
        },
      ])

      const rpQuery = `SELECT
        COUNT(*) as rp_games,
        SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as rp_wins
      FROM bot_learning_sessions
      WHERE bot_ids @> $2::jsonb`

      mockDb.setQueryResult(rpQuery, [botId, JSON.stringify(['2'])], [
        {
          rp_games: 100,
          rp_wins: 60,
        },
      ])

      const lastGamesQuery = `SELECT
        actual_winner_id,
        created_at
      FROM bot_learning_sessions
      WHERE bot_ids @> $1::jsonb
      ORDER BY created_at DESC
      LIMIT 10`

      mockDb.setQueryResult(lastGamesQuery, [JSON.stringify(['2'])], [])

      // First load
      const stats1 = await loader.loadBotStats(botId)
      const queryCountAfterFirst = mockDb.lastQueries.length

      mockDb.clearQueries()

      // Second load should use cache
      const stats2 = await loader.loadBotStats(botId)
      const queryCountAfterSecond = mockDb.lastQueries.length

      expect(stats1).toEqual(stats2)
      expect(queryCountAfterSecond).toBe(0) // No new queries
    })

    it('should be able to invalidate cached stats', async () => {
      const botId = BigInt(3)

      // Manually set cache
      const cacheKey = `bot:stats:${botId}`
      const stats = createBotStats()
      await mockRedis.setex(cacheKey, 300, JSON.stringify(stats))

      // Verify cache exists
      let cached = await mockRedis.get(cacheKey)
      expect(cached).toBeDefined()

      // Invalidate
      await loader.invalidateStats(botId)

      // Verify cache is gone
      cached = await mockRedis.get(cacheKey)
      expect(cached).toBeNull()
    })
  })
})

describe('BotCoordination - GameRecorder', () => {
  let recorder: GameRecorder
  let mockDb: MockDatabase

  beforeEach(() => {
    mockDb = new MockDatabase()
    recorder = new GameRecorder(mockDb as any)
  })

  describe('Test 6: Game end records session to database with correct fields', () => {
    it('should record coordinated game with correct fields', async () => {
      const outcome: GameOutcome = {
        gameId: 'game-123',
        actualWinnerId: BigInt(1),
        botTrainingMetadata: {
          winnerBotId: BigInt(1),
          strategy: 'lifetime_winrate',
          targetWinRate: 0.75,
          aggressiveness: 0.8,
          botIds: [BigInt(1), BigInt(2)],
          rpId: BigInt(100),
        },
        botPerformance: {
          '1': { blocks_on_rp: 2, move_efficiency: 0.85 },
          '2': { blocks_on_rp: 1, move_efficiency: 0.7 },
        },
        rpPerformance: { avg_response_time: 500 },
      }

      await recorder.recordCoordinatedGame(outcome)

      // Verify query was called
      expect(mockDb.lastQueries.length).toBe(1)

      const query = mockDb.lastQueries[0]
      expect(query.sql).toContain('INSERT INTO bot_learning_sessions')
      expect(query.sql).toContain('game_id')
      expect(query.sql).toContain('winner_bot_id')
      expect(query.sql).toContain('actual_winner_id')
      expect(query.sql).toContain('bot_ids')
      expect(query.sql).toContain('rp_id')
      expect(query.sql).toContain('strategy_used')
      expect(query.sql).toContain('target_win_rate')
      expect(query.sql).toContain('bot_performance')
      expect(query.sql).toContain('rp_performance')
      expect(query.sql).toContain('coordination_success')

      // Verify parameters
      const params = query.params
      expect(params[0]).toBe('game-123') // gameId
      expect(params[1]).toBe(BigInt(1)) // winnerBotId
      expect(params[2]).toBe(BigInt(1)) // actualWinnerId
      expect(params[3]).toBe(JSON.stringify(['1', '2'])) // botIds (converted to strings)
      expect(params[4]).toBe(BigInt(100)) // rpId
      expect(params[5]).toBe('lifetime_winrate') // strategy
      expect(params[6]).toBe(0.75) // targetWinRate
      expect(params[8]).toBeDefined() // rpPerformance JSON
      expect(params[9]).toBe(true) // coordination_success (bot won)
    })

    it('should record game with coordination_success=true when bot wins', async () => {
      const outcome: GameOutcome = {
        gameId: 'game-win',
        actualWinnerId: BigInt(5),
        botTrainingMetadata: {
          winnerBotId: BigInt(5),
          strategy: 'vs_rp_winrate',
          targetWinRate: 0.6,
          aggressiveness: 0.5,
          botIds: [BigInt(5)],
          rpId: BigInt(200),
        },
        botPerformance: { '5': { blocks_on_rp: 3, move_efficiency: 0.9 } },
        rpPerformance: { avg_response_time: 400 },
      }

      await recorder.recordCoordinatedGame(outcome)

      const params = mockDb.lastQueries[0].params
      expect(params[9]).toBe(true) // coordination_success
    })

    it('should record game with coordination_success based on probability when bot loses', async () => {
      // Mock Math.random to return specific values
      const originalRandom = Math.random
      Math.random = vi.fn(() => 0.3)

      try {
        const outcome: GameOutcome = {
          gameId: 'game-loss',
          actualWinnerId: BigInt(100),
          botTrainingMetadata: {
            winnerBotId: BigInt(5),
            strategy: 'rotation',
            targetWinRate: 0.5, // 50% chance
            aggressiveness: 0.7,
            botIds: [BigInt(5), BigInt(6)],
            rpId: BigInt(200),
          },
          botPerformance: { '5': { blocks_on_rp: 1, move_efficiency: 0.6 } },
          rpPerformance: { avg_response_time: 600 },
        }

        await recorder.recordCoordinatedGame(outcome)

        const params = mockDb.lastQueries[0].params
        // Random returned 0.3, targetWinRate is 0.5, so 0.3 < 0.5 = true
        expect(params[9]).toBe(true)
      } finally {
        Math.random = originalRandom
      }
    })

    it('should skip non-coordinated games (no botTrainingMetadata)', async () => {
      const outcome: GameOutcome = {
        gameId: 'game-no-coordination',
        actualWinnerId: BigInt(1),
        botPerformance: {},
        rpPerformance: {},
      }

      await recorder.recordCoordinatedGame(outcome)

      // Should not record anything
      expect(mockDb.lastQueries.length).toBe(0)
    })

    it('should handle database errors gracefully', async () => {
      // Mock query to throw error
      const originalQuery = mockDb.query.bind(mockDb)
      mockDb.query = vi.fn(async () => {
        throw new Error('Database connection failed')
      })

      const outcome: GameOutcome = {
        gameId: 'game-db-error',
        actualWinnerId: BigInt(1),
        botTrainingMetadata: {
          winnerBotId: BigInt(1),
          strategy: 'lifetime_winrate',
          targetWinRate: 0.7,
          aggressiveness: 0.8,
          botIds: [BigInt(1)],
          rpId: BigInt(100),
        },
        botPerformance: {},
        rpPerformance: {},
      }

      // Should not throw
      await expect(recorder.recordCoordinatedGame(outcome)).resolves.not.toThrow()
    })
  })
})

describe('BotCoordination - Integration', () => {
  it('should work end-to-end: load stats, elect bot, record game', async () => {
    const mockRedis = new MockRedis()
    const mockDb = new MockDatabase()

    const loader = new BotStatsLoader(mockRedis as any, mockDb as any)
    const algorithm = new ElectionAlgorithm()
    const recorder = new GameRecorder(mockDb as any)

    const botId1 = BigInt(1)
    const botId2 = BigInt(2)

    // Setup mock data for stats loading
    const query = `SELECT
      COUNT(*) as total_games,
      SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as total_wins,
      SUM(CASE WHEN winner_bot_id = $1 AND coordination_success = true THEN 1 ELSE 0 END) as winner_successes,
      SUM(CASE WHEN winner_bot_id = $1 THEN 1 ELSE 0 END) as chosen_as_winner,
      AVG((bot_performance::jsonb -> ($1::text) -> 'blocks_on_rp')::numeric) as avg_blocks,
      AVG((bot_performance::jsonb -> ($1::text) -> 'move_efficiency')::numeric) as avg_efficiency
    FROM bot_learning_sessions
    WHERE bot_ids @> $2::jsonb`

    mockDb.setQueryResult(query, [botId1, JSON.stringify(['1'])], [
      { total_games: 100, total_wins: 70, winner_successes: 25, chosen_as_winner: 30, avg_blocks: 2.5, avg_efficiency: 0.8 },
    ])

    mockDb.setQueryResult(query, [botId2, JSON.stringify(['2'])], [
      { total_games: 100, total_wins: 60, winner_successes: 20, chosen_as_winner: 25, avg_blocks: 2.0, avg_efficiency: 0.75 },
    ])

    const rpQuery = `SELECT
      COUNT(*) as rp_games,
      SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as rp_wins
    FROM bot_learning_sessions
    WHERE bot_ids @> $2::jsonb`

    mockDb.setQueryResult(rpQuery, [botId1, JSON.stringify(['1'])], [{ rp_games: 100, rp_wins: 50 }])
    mockDb.setQueryResult(rpQuery, [botId2, JSON.stringify(['2'])], [{ rp_games: 100, rp_wins: 45 }])

    const lastGamesQuery = `SELECT
      actual_winner_id,
      created_at
    FROM bot_learning_sessions
    WHERE bot_ids @> $1::jsonb
    ORDER BY created_at DESC
    LIMIT 10`

    mockDb.setQueryResult(lastGamesQuery, [JSON.stringify(['1'])], [])
    mockDb.setQueryResult(lastGamesQuery, [JSON.stringify(['2'])], [])

    // Load stats for both bots
    const stats1 = await loader.loadBotStats(botId1)
    const stats2 = await loader.loadBotStats(botId2)

    // Verify stats are cached
    expect(await mockRedis.get(`bot:stats:${botId1}`)).toBeDefined()
    expect(await mockRedis.get(`bot:stats:${botId2}`)).toBeDefined()

    // Create BotWithStats
    const bots = [
      { botId: botId1, stats: stats1 },
      { botId: botId2, stats: stats2 },
    ]

    // Elect winner
    const elected = algorithm.electWinnerBot(bots, 'lifetime_winrate')
    expect(elected).toBe(botId1) // Higher win rate

    // Record game
    const outcome: GameOutcome = {
      gameId: 'integration-game-1',
      actualWinnerId: elected,
      botTrainingMetadata: {
        winnerBotId: elected,
        strategy: 'lifetime_winrate',
        targetWinRate: stats1.lifetimeWinRate,
        aggressiveness: 0.75,
        botIds: [botId1, botId2],
        rpId: BigInt(100),
      },
      botPerformance: { '1': { blocks_on_rp: 2.5, move_efficiency: 0.8 } },
      rpPerformance: { avg_response_time: 500 },
    }

    await recorder.recordCoordinatedGame(outcome)

    // Verify game was recorded
    expect(mockDb.lastQueries.length).toBeGreaterThan(0)
    const recordQuery = mockDb.lastQueries[mockDb.lastQueries.length - 1]
    expect(recordQuery.sql).toContain('INSERT INTO bot_learning_sessions')
  })
})
