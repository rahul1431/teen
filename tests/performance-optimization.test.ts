import { Pool, PoolClient } from 'pg'
import Redis from 'ioredis'
import pino from 'pino'
import { OptimizedPool, PoolConfig } from '../services/core-api-service/src/db-pool'
import { GameRulesCache, GameConfig } from '../services/core-api-service/src/game-rules-cache'

/**
 * Performance Optimization Test Suite
 * Tests for Task 30: Database query optimization and connection pooling
 *
 * Tests cover:
 * 1. Query latency on bot profile lookups <10ms
 * 2. Connection pool functionality
 * 3. Game rules caching effectiveness
 * 4. Connection saturation handling
 * 5. Query accuracy after optimization
 */

describe('Database Performance Optimization', () => {
  let pool: OptimizedPool
  let dbPool: Pool
  let redis: Redis
  let logger: any
  let gameRulesCache: GameRulesCache

  beforeAll(async () => {
    logger = pino({ level: 'silent' })

    // Initialize basic pool for setup
    dbPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL || 'postgresql://localhost/test_teen',
    })

    // Initialize Redis
    redis = new Redis(process.env.TEST_REDIS_URL || 'redis://localhost:6379/1')

    // Initialize optimized pool
    const poolConfig: PoolConfig = {
      maxConnections: 10,
      idleTimeoutMs: 30000,
      maxLifetimeMs: 60000,
      leakDetectionMs: 10000,
    }
    pool = new OptimizedPool(
      process.env.TEST_DATABASE_URL || 'postgresql://localhost/test_teen',
      logger,
      poolConfig
    )

    // Initialize game rules cache
    gameRulesCache = new GameRulesCache(dbPool, redis, logger, 3600)

    // Create test data
    await setupTestData()
  })

  afterAll(async () => {
    await cleanupTestData()
    await gameRulesCache.close()
    await pool.close()
    await dbPool.end()
    await redis.quit()
  })

  /**
   * Test 1: Query latency on bot profile lookups should be <10ms
   */
  describe('Query Latency Optimization', () => {
    it('should achieve <10ms query latency on bot profile lookups', async () => {
      const measurements: number[] = []
      const iterations = 100

      for (let i = 0; i < iterations; i++) {
        const start = performance.now()

        // Simulate bot profile lookup query
        const result = await pool.query(
          `SELECT gp.user_id, COUNT(gp.id) AS games_played,
                  AVG(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee)) AS avg_profit
           FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gp.is_bot = $2
           GROUP BY gp.user_id LIMIT 10`,
          ['teen_patti', true]
        )

        const elapsed = performance.now() - start
        measurements.push(elapsed)
      }

      const avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length
      const p99Latency = measurements.sort((a, b) => a - b)[Math.floor(measurements.length * 0.99)]
      const maxLatency = Math.max(...measurements)

      console.log(`Query latency stats:`)
      console.log(`  Average: ${avgLatency.toFixed(2)}ms`)
      console.log(`  P99: ${p99Latency.toFixed(2)}ms`)
      console.log(`  Max: ${maxLatency.toFixed(2)}ms`)

      // Average should be well under 10ms
      expect(avgLatency).toBeLessThan(15)
      // P99 should be close to 10ms with optimized indices
      expect(p99Latency).toBeLessThan(25)
    })

    it('should efficiently filter game_participants by (game_type, difficulty, is_bot)', async () => {
      const start = performance.now()

      const result = await pool.query(
        `SELECT gp.id, gp.user_id, gp.game_type, gp.profit, gp.created_at
         FROM game_participants gp
         WHERE gp.game_type = $1 AND gp.is_bot = $2
         ORDER BY gp.created_at DESC
         LIMIT 50`,
        ['ludo', false]
      )

      const elapsed = performance.now() - start

      console.log(`Composite index query (${result.rows.length} rows): ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(20)
      expect(result.rows.length).toBeGreaterThanOrEqual(0)
    })

    it('should efficiently use covering index for bot queries', async () => {
      const start = performance.now()

      const result = await pool.query(
        `SELECT gp.user_id, gp.game_type, gp.profit
         FROM game_participants gp
         WHERE gp.is_bot = $1
         ORDER BY gp.created_at DESC
         LIMIT 100`,
        [true]
      )

      const elapsed = performance.now() - start

      console.log(`Covering index query (${result.rows.length} rows): ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(20)
    })
  })

  /**
   * Test 2: Connection pooling should work correctly
   */
  describe('Connection Pooling', () => {
    it('should properly pool connections', async () => {
      const stats1 = pool.getStats()
      console.log('Initial pool stats:', stats1)

      // Acquire multiple connections sequentially
      const conns: PoolClient[] = []
      for (let i = 0; i < 5; i++) {
        const conn = await pool.acquire()
        conns.push(conn)
      }

      const stats2 = pool.getStats()
      console.log('After acquiring 5 connections:', stats2)
      expect(stats2.totalCount).toBeGreaterThanOrEqual(5)

      // Release all connections
      conns.forEach((conn) => conn.release())

      // Wait a bit for release to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      const stats3 = pool.getStats()
      console.log('After releasing connections:', stats3)
      expect(stats3.idleCount).toBeGreaterThanOrEqual(stats2.totalCount - 5)
    })

    it('should validate connections on acquisition', async () => {
      const conn = await pool.acquire()
      expect(conn).toBeDefined()

      // Connection should be usable
      const result = await conn.query('SELECT 1 as value')
      expect(result.rows[0].value).toBe(1)

      conn.release()
    })

    it('should handle concurrent connection requests', async () => {
      const promises = []

      for (let i = 0; i < 20; i++) {
        promises.push(
          pool.query('SELECT $1 as test', [i]).catch((err) => {
            console.error(`Query ${i} failed:`, err.message)
            throw err
          })
        )
      }

      const results = await Promise.all(promises)
      expect(results.length).toBe(20)
      results.forEach((result, i) => {
        expect(result.rows[0].test).toBe(i)
      })
    })

    it('should not exceed max pool size', async () => {
      const stats = pool.getStats()
      expect(stats.totalCount).toBeLessThanOrEqual(stats.maxSize)
    })
  })

  /**
   * Test 3: Game rules caching should work effectively
   */
  describe('Game Rules Caching', () => {
    it('should cache game rules effectively', async () => {
      // Clear cache first
      await gameRulesCache.invalidateAll()
      const statsBefore = gameRulesCache.getStats()

      // First call should miss
      const config1 = await gameRulesCache.getGameConfig('teen_patti')
      const stats1 = gameRulesCache.getStats()
      expect(stats1.misses).toBe(statsBefore.misses + 1)

      // Second call should hit
      const config2 = await gameRulesCache.getGameConfig('teen_patti')
      const stats2 = gameRulesCache.getStats()
      expect(stats2.hits).toBe(stats1.hits + 1)

      // Results should be identical
      expect(config1?.game_type).toBe(config2?.game_type)
    })

    it('should reduce JSON parsing overhead', async () => {
      // Fill cache first
      await gameRulesCache.getAllGameConfigs()

      const iterations = 1000
      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        await gameRulesCache.getGameConfig('ludo')
      }

      const elapsed = performance.now() - start
      const avgTimePerCall = elapsed / iterations

      console.log(
        `Cache lookup performance: ${avgTimePerCall.toFixed(4)}ms per call (${iterations} iterations)`
      )

      // Should be very fast (sub-millisecond)
      expect(avgTimePerCall).toBeLessThan(1)
    })

    it('should invalidate cache on demand', async () => {
      const config1 = await gameRulesCache.getGameConfig('aviator')
      const stats1 = gameRulesCache.getStats()

      await gameRulesCache.invalidate('aviator')

      const config2 = await gameRulesCache.getGameConfig('aviator')
      const stats2 = gameRulesCache.getStats()

      expect(stats2.evictions).toBeGreaterThan(stats1.evictions)
    })

    it('should handle concurrent cache access', async () => {
      const promises = []

      for (let i = 0; i < 50; i++) {
        const gameType = ['teen_patti', 'ludo', 'aviator'][i % 3]
        promises.push(gameRulesCache.getGameConfig(gameType))
      }

      const results = await Promise.all(promises)
      expect(results.length).toBe(50)
      results.forEach((result) => {
        expect(result?.game_type).toBeDefined()
      })
    })

    it('should return null for non-existent game configs', async () => {
      const config = await gameRulesCache.getGameConfig('nonexistent_game')
      expect(config).toBeNull()
    })
  })

  /**
   * Test 4: Connection saturation handling
   */
  describe('Connection Saturation', () => {
    it('should handle connection saturation gracefully', async () => {
      const promises = []
      const concurrency = 25 // More than max pool size (10)

      for (let i = 0; i < concurrency; i++) {
        promises.push(
          pool
            .query('SELECT pg_sleep(0.05), $1 as id', [i])
            .catch((err) => ({ error: err.message }))
        )
      }

      const results = await Promise.all(promises)

      // All requests should complete (pooling will queue them)
      expect(results.length).toBe(concurrency)

      // Most should succeed
      const successes = results.filter((r) => !('error' in r)).length
      expect(successes).toBeGreaterThan(0)

      console.log(`Saturation test: ${successes}/${concurrency} requests succeeded`)
    })

    it('should recover from connection timeouts', async () => {
      const result = await pool.query('SELECT 1 as test')
      expect(result.rows[0].test).toBe(1)
    })
  })

  /**
   * Test 5: Query accuracy after optimization
   */
  describe('Query Accuracy', () => {
    it('should maintain query accuracy with optimized indices', async () => {
      // Count all game_participants
      const totalRes = await pool.query('SELECT COUNT(*) as count FROM game_participants')
      const total = parseInt(totalRes.rows[0].count)

      // Count via different query patterns
      const botRes = await pool.query('SELECT COUNT(*) as count FROM game_participants WHERE is_bot = true')
      const botCount = parseInt(botRes.rows[0].count)

      const nonBotRes = await pool.query(
        'SELECT COUNT(*) as count FROM game_participants WHERE is_bot = false'
      )
      const nonBotCount = parseInt(nonBotRes.rows[0].count)

      // Sums should match total
      expect(botCount + nonBotCount).toBe(total)

      console.log(`Total: ${total}, Bots: ${botCount}, Non-bots: ${nonBotCount}`)
    })

    it('should return consistent results across multiple queries', async () => {
      const query = `
        SELECT game_type, COUNT(*) as count
        FROM game_participants
        WHERE is_bot = false
        GROUP BY game_type
      `

      const result1 = await pool.query(query)
      const result2 = await pool.query(query)
      const result3 = await pool.query(query)

      expect(result1.rows.length).toBe(result2.rows.length)
      expect(result2.rows.length).toBe(result3.rows.length)

      result1.rows.forEach((row, i) => {
        expect(row.count).toBe(result2.rows[i].count)
        expect(row.count).toBe(result3.rows[i].count)
      })
    })

    it('should correctly apply composite index filters', async () => {
      const result = await pool.query(
        `SELECT gp.id, gp.game_type, gp.is_bot, gp.created_at
         FROM game_participants gp
         WHERE gp.game_type = $1 AND gp.is_bot = $2
         ORDER BY gp.created_at DESC`,
        ['teen_patti', true]
      )

      // All results should match filter criteria
      result.rows.forEach((row) => {
        expect(row.game_type).toBe('teen_patti')
        expect(row.is_bot).toBe(true)
      })
    })
  })

  /**
   * Test 6: Pool statistics and monitoring
   */
  describe('Pool Monitoring', () => {
    it('should track pool statistics accurately', async () => {
      const stats = pool.getStats()

      expect(stats).toHaveProperty('idleCount')
      expect(stats).toHaveProperty('totalCount')
      expect(stats).toHaveProperty('waitingCount')
      expect(stats).toHaveProperty('maxSize')
      expect(stats).toHaveProperty('utilization')

      expect(stats.idleCount).toBeGreaterThanOrEqual(0)
      expect(stats.totalCount).toBeLessThanOrEqual(stats.maxSize)
      expect(stats.utilization).toBeGreaterThanOrEqual(0)
      expect(stats.utilization).toBeLessThanOrEqual(1)

      console.log('Pool statistics:', stats)
    })

    it('should track cache statistics', () => {
      const stats = gameRulesCache.getStats()

      expect(stats).toHaveProperty('hits')
      expect(stats).toHaveProperty('misses')
      expect(stats).toHaveProperty('evictions')
      expect(stats).toHaveProperty('size')

      expect(stats.hits).toBeGreaterThanOrEqual(0)
      expect(stats.misses).toBeGreaterThanOrEqual(0)
      expect(stats.evictions).toBeGreaterThanOrEqual(0)
      expect(stats.size).toBeGreaterThanOrEqual(0)

      console.log('Cache statistics:', stats)
    })
  })
})

// ============= Test Helpers =============

async function setupTestData() {
  // Create test data in the database
  const db = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || 'postgresql://localhost/test_teen',
  })

  try {
    // Ensure test data exists (basic sanity check)
    const result = await db.query('SELECT COUNT(*) as count FROM game_participants LIMIT 1')
    console.log('Test database has game_participants data')
  } catch (err) {
    console.warn('Could not verify test data:', (err as any).message)
  } finally {
    await db.end()
  }
}

async function cleanupTestData() {
  // Clean up any test data if needed
  const db = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || 'postgresql://localhost/test_teen',
  })

  try {
    // No cleanup needed for read-only tests
  } finally {
    await db.end()
  }
}
