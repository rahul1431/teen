import Redis from 'ioredis'
import { Pool } from 'pg'
import { Logger } from 'pino'
import { BotProfile } from './profile-builder'

export interface CacheMetrics {
  hits: number
  misses: number
  avgHitLatency: number
  avgMissLatency: number
  avgInvalidationLatency: number
  errorCount: number
}

export class ProfileCache {
  private readonly CACHE_TTL = 3600 // 1 hour in seconds
  private readonly CACHE_KEY_PREFIX = 'profile:'
  private readonly INVALIDATION_CHANNEL = 'bot:profiles:invalidation'
  private readonly REBUILD_CHANNEL = 'bot:profiles:rebuilt'

  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    avgHitLatency: 0,
    avgMissLatency: 0,
    avgInvalidationLatency: 0,
    errorCount: 0,
  }

  private hitLatencies: number[] = []
  private missLatencies: number[] = []
  private invalidationLatencies: number[] = []

  private subscriber: Redis | null = null
  private subscribed = false

  constructor(
    private redis: Redis,
    private pool: Pool,
    private logger: Logger
  ) {}

  /**
   * Initialize pub/sub listener for cache invalidation events
   */
  async initializeSubscriber(): Promise<void> {
    if (this.subscribed) return

    try {
      // Create a separate connection for pub/sub
      this.subscriber = new Redis(this.redis.options)

      this.subscriber.on('message', (channel: string, message: string) => {
        this.logger.debug({ channel, message }, 'Received cache invalidation message')
      })

      // Subscribe to invalidation channels
      await this.subscriber.subscribe(this.INVALIDATION_CHANNEL, this.REBUILD_CHANNEL)
      this.subscribed = true
      this.logger.info({ channels: [this.INVALIDATION_CHANNEL, this.REBUILD_CHANNEL] }, 'Cache subscriber initialized')
    } catch (err) {
      this.logger.error({ err }, 'Failed to initialize cache subscriber')
      this.metrics.errorCount++
      throw err
    }
  }

  /**
   * Get a bot profile from cache, falling back to database on miss
   * Latency SLO: cache hit <5ms, DB fallback <50ms
   */
  async get(gameType: string, difficulty: string): Promise<BotProfile | null> {
    const startTime = performance.now()
    const cacheKey = this.getCacheKey(gameType, difficulty)

    try {
      // Try cache first
      const cached = await this.redis.get(cacheKey)
      const hitLatency = performance.now() - startTime

      if (cached) {
        this.metrics.hits++
        this.recordHitLatency(hitLatency)
        this.logger.debug({ gameType, difficulty, latency: hitLatency.toFixed(2) }, 'Cache hit')
        return JSON.parse(cached) as BotProfile
      }

      // Cache miss - fall back to database
      this.metrics.misses++
      const dbStartTime = performance.now()

      const res = await this.pool.query(
        'SELECT * FROM bot_profiles WHERE game_type = $1 AND difficulty = $2',
        [gameType, difficulty]
      )

      const dbLatency = performance.now() - dbStartTime
      this.recordMissLatency(dbStartTime - startTime + dbLatency)

      if (!res.rows.length) {
        this.logger.debug({ gameType, difficulty }, 'Profile not found in database')
        return null
      }

      const profile = res.rows[0] as BotProfile

      // Cache the profile for future requests
      try {
        await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(profile))
      } catch (cacheErr) {
        this.logger.warn({ err: cacheErr, gameType, difficulty }, 'Failed to cache profile after DB fetch')
        // Continue - profile fetch succeeded even if caching failed
      }

      this.logger.debug(
        { gameType, difficulty, latency: (dbStartTime - startTime + dbLatency).toFixed(2) },
        'Cache miss - fetched from database'
      )
      return profile
    } catch (err) {
      this.metrics.errorCount++
      this.logger.error({ err, gameType, difficulty }, 'Error in profile cache get')
      throw err
    }
  }

  /**
   * Store a profile in cache with TTL
   */
  async set(gameType: string, difficulty: string, profile: BotProfile): Promise<void> {
    const cacheKey = this.getCacheKey(gameType, difficulty)

    try {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(profile))
      this.logger.debug({ gameType, difficulty }, 'Profile cached successfully')
    } catch (err) {
      this.metrics.errorCount++
      this.logger.error({ err, gameType, difficulty }, 'Failed to cache profile')
      throw err
    }
  }

  /**
   * Invalidate a specific profile from cache
   */
  async invalidate(gameType: string, difficulty: string): Promise<void> {
    const startTime = performance.now()
    const cacheKey = this.getCacheKey(gameType, difficulty)

    try {
      await this.redis.del(cacheKey)
      const latency = performance.now() - startTime
      this.recordInvalidationLatency(latency)
      this.logger.debug({ gameType, difficulty, latency: latency.toFixed(2) }, 'Profile invalidated')
    } catch (err) {
      this.metrics.errorCount++
      this.logger.error({ err, gameType, difficulty }, 'Failed to invalidate profile')
      throw err
    }
  }

  /**
   * Invalidate all cached profiles (used on major updates)
   */
  async invalidateAll(): Promise<void> {
    const startTime = performance.now()

    try {
      const pattern = `${this.CACHE_KEY_PREFIX}*`
      const keys = await this.redis.keys(pattern)

      if (keys.length > 0) {
        await this.redis.del(...keys)
      }

      const latency = performance.now() - startTime
      this.recordInvalidationLatency(latency)
      this.logger.info({ count: keys.length, latency: latency.toFixed(2) }, 'All profiles invalidated')
    } catch (err) {
      this.metrics.errorCount++
      this.logger.error({ err }, 'Failed to invalidate all profiles')
      throw err
    }
  }

  /**
   * Publish cache invalidation event via pub/sub
   * Latency SLO: <100ms
   */
  async publishInvalidation(gameType: string, difficulty: string): Promise<void> {
    const startTime = performance.now()

    try {
      const message = JSON.stringify({
        gameType,
        difficulty,
        timestamp: new Date().toISOString(),
      })

      const subscribers = await this.redis.publish(this.INVALIDATION_CHANNEL, message)
      const latency = performance.now() - startTime

      this.logger.debug(
        { gameType, difficulty, subscribers, latency: latency.toFixed(2) },
        'Cache invalidation published'
      )
    } catch (err) {
      this.metrics.errorCount++
      this.logger.error({ err, gameType, difficulty }, 'Failed to publish cache invalidation')
      throw err
    }
  }

  /**
   * Publish rebuild completion event (triggers cache invalidation in subscribers)
   */
  async publishRebuildEvent(version: number): Promise<void> {
    try {
      const message = JSON.stringify({
        version,
        timestamp: new Date().toISOString(),
      })

      await this.redis.publish(this.REBUILD_CHANNEL, message)
      this.logger.debug({ version }, 'Profile rebuild event published')
    } catch (err) {
      this.metrics.errorCount++
      this.logger.error({ err, version }, 'Failed to publish rebuild event')
      throw err
    }
  }

  /**
   * Get current cache metrics
   */
  getMetrics(): CacheMetrics {
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      avgHitLatency: this.hitLatencies.length > 0
        ? this.hitLatencies.reduce((a, b) => a + b, 0) / this.hitLatencies.length
        : 0,
      avgMissLatency: this.missLatencies.length > 0
        ? this.missLatencies.reduce((a, b) => a + b, 0) / this.missLatencies.length
        : 0,
      avgInvalidationLatency: this.invalidationLatencies.length > 0
        ? this.invalidationLatencies.reduce((a, b) => a + b, 0) / this.invalidationLatencies.length
        : 0,
      errorCount: this.metrics.errorCount,
    }
  }

  /**
   * Reset metrics for testing or monitoring reset
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      avgHitLatency: 0,
      avgMissLatency: 0,
      avgInvalidationLatency: 0,
      errorCount: 0,
    }
    this.hitLatencies = []
    this.missLatencies = []
    this.invalidationLatencies = []
  }

  /**
   * Verify latency SLO compliance
   */
  checkLatencySLO(): { compliant: boolean; violations: string[] } {
    const violations: string[] = []
    const SLO_CACHE_HIT = 5 // ms
    const SLO_DB_FALLBACK = 50 // ms
    const SLO_PUB_SUB = 100 // ms

    const metrics = this.getMetrics()

    if (metrics.avgHitLatency > SLO_CACHE_HIT) {
      violations.push(`Cache hit latency ${metrics.avgHitLatency.toFixed(2)}ms exceeds SLO of ${SLO_CACHE_HIT}ms`)
    }

    if (metrics.avgMissLatency > SLO_DB_FALLBACK) {
      violations.push(`Cache miss latency ${metrics.avgMissLatency.toFixed(2)}ms exceeds SLO of ${SLO_DB_FALLBACK}ms`)
    }

    if (metrics.avgInvalidationLatency > SLO_PUB_SUB) {
      violations.push(`Invalidation latency ${metrics.avgInvalidationLatency.toFixed(2)}ms exceeds SLO of ${SLO_PUB_SUB}ms`)
    }

    return {
      compliant: violations.length === 0,
      violations,
    }
  }

  /**
   * Clean up subscriber connection
   */
  async destroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.quit()
        this.subscriber = null
        this.subscribed = false
        this.logger.info('Cache subscriber closed')
      } catch (err) {
        this.logger.error({ err }, 'Error closing cache subscriber')
      }
    }
  }

  // Private helper methods

  private getCacheKey(gameType: string, difficulty: string): string {
    return `${this.CACHE_KEY_PREFIX}${gameType}:${difficulty}`
  }

  private recordHitLatency(latency: number): void {
    this.hitLatencies.push(latency)
    // Keep rolling window of last 1000 measurements
    if (this.hitLatencies.length > 1000) {
      this.hitLatencies.shift()
    }
  }

  private recordMissLatency(latency: number): void {
    this.missLatencies.push(latency)
    // Keep rolling window of last 1000 measurements
    if (this.missLatencies.length > 1000) {
      this.missLatencies.shift()
    }
  }

  private recordInvalidationLatency(latency: number): void {
    this.invalidationLatencies.push(latency)
    // Keep rolling window of last 1000 measurements
    if (this.invalidationLatencies.length > 1000) {
      this.invalidationLatencies.shift()
    }
  }
}
