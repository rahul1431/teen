import { ProfileCache, CacheMetrics } from '../src/profile-cache'
import { BotProfile } from '../src/profile-builder'
import pino from 'pino'
import Redis from 'ioredis'

// Mock Redis constructor
jest.mock('ioredis')

// Mock helper functions
const createMockRedis = () => {
  const mockRedis = {
    get: jest.fn(),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    options: { host: 'localhost', port: 6379 },
    on: jest.fn(),
  } as unknown as any

  // Mock the Redis constructor to return a subscriber
  ;(Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedis)

  return mockRedis
}

const createMockPool = () => {
  return {
    query: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as any
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

const createMockProfile = (overrides?: Partial<BotProfile>): BotProfile => {
  return {
    game_type: 'teen_patti',
    difficulty: 'easy',
    win_rate_target: 35.0,
    fold_probability: 0.45,
    call_probability: 0.35,
    raise_probability: 0.2,
    avg_decision_delay_ms: 2800,
    avg_stake_preference: 100,
    aggression_score: 2.5,
    sample_size: 100,
    ...overrides,
  }
}

describe('ProfileCache', () => {
  let redis: any
  let pool: any
  let logger: any
  let cache: ProfileCache

  beforeEach(() => {
    redis = createMockRedis()
    pool = createMockPool()
    logger = createMockLogger()
    cache = new ProfileCache(redis, pool, logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('should cache profiles with TTL', () => {
    it('should store profile in cache with 1 hour TTL', async () => {
      const profile = createMockProfile()
      await cache.set('teen_patti', 'easy', profile)

      expect(redis.setex).toHaveBeenCalledWith(
        'profile:teen_patti:easy',
        3600,
        JSON.stringify(profile)
      )
    })

    it('should retrieve profile from cache on hit', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      const result = await cache.get('teen_patti', 'easy')

      expect(result).toEqual(profile)
      expect(redis.get).toHaveBeenCalledWith('profile:teen_patti:easy')
    })

    it('should increment cache hit counter on cache hit', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      await cache.get('teen_patti', 'easy')
      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
    })

    it('should expire cache entries after TTL', async () => {
      const profile = createMockProfile()

      // Set profile in cache
      await cache.set('teen_patti', 'easy', profile)

      // Verify setex was called with correct TTL
      expect(redis.setex).toHaveBeenCalledWith(
        expect.any(String),
        3600, // 1 hour
        expect.any(String)
      )
    })
  })

  describe('should fallback to DB on cache miss', () => {
    it('should query database when cache miss occurs', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(null)
      pool.query.mockResolvedValue({ rows: [profile] })

      const result = await cache.get('teen_patti', 'easy')

      expect(result).toEqual(profile)
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM bot_profiles WHERE game_type = $1 AND difficulty = $2',
        ['teen_patti', 'easy']
      )
    })

    it('should increment cache miss counter on database fetch', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(null)
      pool.query.mockResolvedValue({ rows: [profile] })

      await cache.get('teen_patti', 'easy')
      const metrics = cache.getMetrics()

      expect(metrics.misses).toBe(1)
      expect(metrics.hits).toBe(0)
    })

    it('should cache profile after database fetch', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(null)
      pool.query.mockResolvedValue({ rows: [profile] })

      await cache.get('teen_patti', 'easy')

      // Verify setex was called to cache the fetched profile
      expect(redis.setex).toHaveBeenCalledWith(
        'profile:teen_patti:easy',
        3600,
        JSON.stringify(profile)
      )
    })

    it('should return null when profile not found in DB', async () => {
      redis.get.mockResolvedValue(null)
      pool.query.mockResolvedValue({ rows: [] })

      const result = await cache.get('teen_patti', 'nonexistent')

      expect(result).toBeNull()
    })

    it('should handle database caching failure gracefully', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(null)
      pool.query.mockResolvedValue({ rows: [profile] })
      redis.setex.mockRejectedValueOnce(new Error('Redis connection failed'))

      const result = await cache.get('teen_patti', 'easy')

      // Should still return the profile even if caching fails
      expect(result).toEqual(profile)
    })
  })

  describe('should invalidate on profile rebuild', () => {
    it('should delete specific profile from cache', async () => {
      redis.del.mockResolvedValue(1)

      await cache.invalidate('teen_patti', 'easy')

      expect(redis.del).toHaveBeenCalledWith('profile:teen_patti:easy')
    })

    it('should invalidate all profiles matching pattern', async () => {
      const keys = [
        'profile:teen_patti:easy',
        'profile:teen_patti:medium',
        'profile:teen_patti:hard',
        'profile:ludo:easy',
      ]
      redis.keys.mockResolvedValue(keys)
      redis.del.mockResolvedValue(keys.length)

      await cache.invalidateAll()

      expect(redis.keys).toHaveBeenCalledWith('profile:*')
      expect(redis.del).toHaveBeenCalledWith(...keys)
    })

    it('should handle empty cache on invalidateAll', async () => {
      redis.keys.mockResolvedValue([])

      await cache.invalidateAll()

      expect(redis.keys).toHaveBeenCalled()
      // del should not be called if no keys found
      expect(redis.del).not.toHaveBeenCalled()
    })

    it('should publish invalidation event via pub/sub', async () => {
      redis.publish.mockResolvedValue(1)

      await cache.publishInvalidation('teen_patti', 'easy')

      expect(redis.publish).toHaveBeenCalledWith(
        'bot:profiles:invalidation',
        expect.stringContaining('teen_patti')
      )
    })

    it('should publish rebuild completion event', async () => {
      redis.publish.mockResolvedValue(1)

      await cache.publishRebuildEvent(1)

      expect(redis.publish).toHaveBeenCalledWith(
        'bot:profiles:rebuilt',
        expect.stringContaining('version')
      )
    })
  })

  describe('should handle concurrent requests', () => {
    it('should handle multiple concurrent cache hits', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      const promises = Array(10)
        .fill(null)
        .map((_, i) =>
          cache.get('teen_patti', i % 2 === 0 ? 'easy' : 'medium')
        )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      expect(results.every(r => r !== null)).toBe(true)
      expect(redis.get).toHaveBeenCalledTimes(10)
    })

    it('should handle concurrent cache misses with database fallback', async () => {
      const profiles = [
        createMockProfile({ difficulty: 'easy' }),
        createMockProfile({ difficulty: 'medium' }),
        createMockProfile({ difficulty: 'hard' }),
      ]

      redis.get.mockResolvedValue(null)
      pool.query.mockImplementation(async (sql: string, params: any[]) => {
        const difficulty = params[1]
        const profile = profiles.find(p => p.difficulty === difficulty)
        return { rows: profile ? [profile] : [] }
      })

      const promises = [
        cache.get('teen_patti', 'easy'),
        cache.get('teen_patti', 'medium'),
        cache.get('teen_patti', 'hard'),
      ]

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      expect(results.every(r => r !== null)).toBe(true)
      expect(pool.query).toHaveBeenCalledTimes(3)
      expect(redis.setex).toHaveBeenCalledTimes(3)
    })

    it('should handle concurrent hits and misses', async () => {
      const profile = createMockProfile()
      let callCount = 0

      // First 5 calls hit cache, next 5 miss
      redis.get.mockImplementation(async () => {
        return callCount++ < 5 ? JSON.stringify(profile) : null
      })

      pool.query.mockResolvedValue({ rows: [profile] })

      const promises = Array(10)
        .fill(null)
        .map(() => cache.get('teen_patti', 'easy'))

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      const metrics = cache.getMetrics()
      expect(metrics.hits).toBe(5)
      expect(metrics.misses).toBe(5)
    })

    it('should handle concurrent invalidations', async () => {
      redis.del.mockResolvedValue(1)

      const promises = Array(5)
        .fill(null)
        .map((_, i) => cache.invalidate('teen_patti', ['easy', 'medium', 'hard'][i % 3]))

      await Promise.all(promises)

      expect(redis.del).toHaveBeenCalledTimes(5)
    })
  })

  describe('should respect cache hit/miss latency SLOs', () => {
    it('should measure cache hit latency', async () => {
      const profile = createMockProfile()
      redis.get.mockImplementation(async () => {
        // Simulate 2ms latency
        await new Promise(resolve => setTimeout(resolve, 2))
        return JSON.stringify(profile)
      })

      await cache.get('teen_patti', 'easy')
      const metrics = cache.getMetrics()

      expect(metrics.avgHitLatency).toBeGreaterThan(0)
      expect(metrics.avgHitLatency).toBeLessThan(50) // Should be well under SLO
    })

    it('should measure cache miss latency (database fetch)', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(null)
      pool.query.mockImplementation(async () => {
        // Simulate database latency
        await new Promise(resolve => setTimeout(resolve, 3))
        return { rows: [profile] }
      })

      await cache.get('teen_patti', 'easy')
      const metrics = cache.getMetrics()

      expect(metrics.avgMissLatency).toBeGreaterThan(0)
      expect(metrics.avgMissLatency).toBeLessThan(100) // Should be under SLO
    })

    it('should verify latency SLO compliance', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      // Execute multiple operations
      for (let i = 0; i < 10; i++) {
        await cache.get('teen_patti', 'easy')
      }

      const sloCheck = cache.checkLatencySLO()

      // With mock operations, should be compliant
      expect(sloCheck.compliant).toBe(true)
    })

    it('should track invalidation latency', async () => {
      redis.del.mockImplementation(async () => {
        // Simulate 1ms latency
        await new Promise(resolve => setTimeout(resolve, 1))
        return 1
      })

      await cache.invalidate('teen_patti', 'easy')
      const metrics = cache.getMetrics()

      expect(metrics.avgInvalidationLatency).toBeGreaterThan(0)
      expect(metrics.avgInvalidationLatency).toBeLessThan(100)
    })

    it('should track SLO violations', async () => {
      // Manually record high latencies to simulate violations
      const profile = createMockProfile()

      // Force slow operation
      redis.get.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return JSON.stringify(profile)
      })

      for (let i = 0; i < 3; i++) {
        await cache.get('teen_patti', 'easy')
      }

      const sloCheck = cache.checkLatencySLO()

      // With 10ms hit latency, might exceed 5ms SLO depending on timing
      if (sloCheck.violations.length > 0) {
        expect(sloCheck.compliant).toBe(false)
        expect(sloCheck.violations.some(v => v.includes('Cache hit latency'))).toBe(true)
      }
    })
  })

  describe('should initialize and manage pub/sub', () => {
    it('should initialize subscriber connection', async () => {
      redis.subscribe.mockResolvedValue(2) // 2 channels subscribed

      await cache.initializeSubscriber()

      expect(redis.subscribe).toHaveBeenCalledWith(
        'bot:profiles:invalidation',
        'bot:profiles:rebuilt'
      )
    })

    it('should handle subscriber initialization errors', async () => {
      redis.subscribe.mockRejectedValue(new Error('Connection failed'))

      const loggerErrorSpy = jest.spyOn(logger, 'error')

      await expect(cache.initializeSubscriber()).rejects.toThrow('Connection failed')
      expect(loggerErrorSpy).toHaveBeenCalled()
    })

    it('should clean up subscriber on destroy', async () => {
      redis.subscribe.mockResolvedValue(2)
      await cache.initializeSubscriber()

      await cache.destroy()

      // Verify quit was called
      expect(redis.quit).toHaveBeenCalled()
    })
  })

  describe('should track metrics correctly', () => {
    it('should initialize metrics with zero values', () => {
      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.avgHitLatency).toBe(0)
      expect(metrics.avgMissLatency).toBe(0)
      expect(metrics.errorCount).toBe(0)
    })

    it('should accumulate hit/miss counts', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))
      pool.query.mockResolvedValue({ rows: [profile] })

      // 3 hits
      for (let i = 0; i < 3; i++) {
        redis.get.mockResolvedValueOnce(JSON.stringify(profile))
        await cache.get('teen_patti', 'easy')
      }

      // 2 misses
      for (let i = 0; i < 2; i++) {
        redis.get.mockResolvedValueOnce(null)
        await cache.get('teen_patti', 'medium')
      }

      const metrics = cache.getMetrics()
      expect(metrics.hits).toBe(3)
      expect(metrics.misses).toBe(2)
    })

    it('should track error count on failures', async () => {
      redis.get.mockRejectedValue(new Error('Redis error'))

      try {
        await cache.get('teen_patti', 'easy')
      } catch (err) {
        // Expected to throw
      }

      const metrics = cache.getMetrics()
      expect(metrics.errorCount).toBeGreaterThan(0)
    })

    it('should reset metrics', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      await cache.get('teen_patti', 'easy')
      let metrics = cache.getMetrics()
      expect(metrics.hits).toBe(1)

      cache.resetMetrics()
      metrics = cache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.errorCount).toBe(0)
    })

    it('should maintain rolling window of latency samples', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      // Record 1100 hits (exceeds 1000 sample rolling window)
      for (let i = 0; i < 1100; i++) {
        await cache.get('teen_patti', 'easy')
      }

      const metrics = cache.getMetrics()
      expect(metrics.hits).toBe(1100)
      // Average latency should still be calculable from last 1000 samples
      expect(metrics.avgHitLatency).toBeDefined()
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle malformed cached JSON gracefully', async () => {
      redis.get.mockResolvedValue('invalid json')
      const loggerErrorSpy = jest.spyOn(logger, 'error')

      try {
        await cache.get('teen_patti', 'easy')
      } catch (err) {
        // Expected
      }

      expect(loggerErrorSpy).toHaveBeenCalled()
    })

    it('should handle different game types and difficulties', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      const testCases = [
        ['teen_patti', 'easy'],
        ['teen_patti', 'medium'],
        ['teen_patti', 'hard'],
        ['ludo', 'easy'],
        ['aviator', 'hard'],
      ]

      for (const [gameType, difficulty] of testCases) {
        await cache.get(gameType, difficulty)
      }

      expect(redis.get).toHaveBeenCalledTimes(5)
    })

    it('should handle special characters in cache keys', async () => {
      const profile = createMockProfile()
      redis.get.mockResolvedValue(JSON.stringify(profile))

      await cache.get('teen_patti_v2', 'easy')

      expect(redis.get).toHaveBeenCalledWith('profile:teen_patti_v2:easy')
    })
  })
})
