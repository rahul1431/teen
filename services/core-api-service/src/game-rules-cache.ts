import { Pool, PoolClient, QueryResult } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'

/**
 * Game rules caching layer
 * Memoizes game_configs and related game rules in-memory and Redis
 * Reduces JSON parsing overhead and database queries
 */

export interface GameConfig {
  id: string
  game_type: string
  is_active: boolean
  rake_percent: number
  bot_fill_enabled: boolean
  bot_fill_delay_seconds: number
  max_bot_ratio: number
  bot_difficulty: string
  special_rules: Record<string, any>
  bot_fill_table_size: number | null
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  size: number
}

export class GameRulesCache {
  private cache: Map<string, { data: GameConfig; timestamp: number }> = new Map()
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, size: 0 }
  private readonly ttl: number // in milliseconds
  private refreshInterval: NodeJS.Timeout | null = null
  private logger: Logger

  constructor(
    private pool: Pool,
    private redis: Redis,
    logger: Logger,
    ttlSeconds: number = 3600 // 1 hour default
  ) {
    this.logger = logger
    this.ttl = ttlSeconds * 1000
    this.startPeriodicRefresh()
  }

  /**
   * Get a game config by game_type
   * Checks in-memory cache first, then Redis, then database
   */
  async getGameConfig(gameType: string): Promise<GameConfig | null> {
    const cacheKey = `game:config:${gameType}`

    // Check in-memory cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      this.stats.hits++
      this.logger.debug({ gameType, source: 'memory' }, 'Game config cache hit')
      return cached.data
    }

    // Check Redis
    try {
      const redisData = await this.redis.get(cacheKey)
      if (redisData) {
        const config = JSON.parse(redisData) as GameConfig
        this.cache.set(cacheKey, { data: config, timestamp: Date.now() })
        this.stats.hits++
        this.logger.debug({ gameType, source: 'redis' }, 'Game config cache hit')
        return config
      }
    } catch (err) {
      this.logger.warn({ err, gameType }, 'Redis cache lookup failed')
    }

    // Query database
    this.stats.misses++
    try {
      const result = await this.pool.query(
        'SELECT * FROM game_configs WHERE game_type = $1',
        [gameType]
      )

      if (result.rows.length > 0) {
        const config = result.rows[0] as GameConfig
        // Parse special_rules if it's a string
        if (typeof config.special_rules === 'string') {
          config.special_rules = JSON.parse(config.special_rules)
        }

        // Store in both caches
        this.cache.set(cacheKey, { data: config, timestamp: Date.now() })
        await this.redis.setex(cacheKey, this.ttl / 1000, JSON.stringify(config)).catch((err) =>
          this.logger.warn({ err }, 'Failed to update Redis cache')
        )

        this.stats.size = this.cache.size
        this.logger.debug({ gameType, source: 'database' }, 'Game config loaded from database')
        return config
      }
    } catch (err) {
      this.logger.error({ err, gameType }, 'Failed to fetch game config from database')
    }

    return null
  }

  /**
   * Get all game configs
   * Caches all configs together
   */
  async getAllGameConfigs(): Promise<GameConfig[]> {
    const cacheKey = 'game:configs:all'

    // Check in-memory cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      this.stats.hits++
      return [cached.data] // Return as array (data stored as single item)
    }

    // Check Redis
    try {
      const redisData = await this.redis.get(cacheKey)
      if (redisData) {
        const configs = JSON.parse(redisData) as GameConfig[]
        this.cache.set(cacheKey, {
          data: { configs } as any,
          timestamp: Date.now(),
        })
        this.stats.hits++
        return configs
      }
    } catch (err) {
      this.logger.warn({ err }, 'Redis cache lookup failed for all configs')
    }

    // Query database
    this.stats.misses++
    try {
      const result = await this.pool.query('SELECT * FROM game_configs ORDER BY game_type')
      const configs = (result.rows as GameConfig[]).map((config) => {
        if (typeof config.special_rules === 'string') {
          config.special_rules = JSON.parse(config.special_rules)
        }
        return config
      })

      // Store in both caches
      this.cache.set(cacheKey, {
        data: { configs } as any,
        timestamp: Date.now(),
      })
      await this.redis
        .setex(cacheKey, this.ttl / 1000, JSON.stringify(configs))
        .catch((err) => this.logger.warn({ err }, 'Failed to update Redis cache'))

      this.stats.size = this.cache.size
      return configs
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch game configs from database')
      return []
    }
  }

  /**
   * Invalidate cache for a specific game type
   * Called after admin updates a game config
   */
  async invalidate(gameType: string): Promise<void> {
    const cacheKey = `game:config:${gameType}`
    this.cache.delete(cacheKey)
    this.cache.delete('game:configs:all')
    this.stats.evictions++

    try {
      await this.redis.del(cacheKey, 'game:configs:all')
      this.logger.info({ gameType }, 'Game config cache invalidated')
    } catch (err) {
      this.logger.warn({ err, gameType }, 'Failed to invalidate Redis cache')
    }
  }

  /**
   * Invalidate all caches
   */
  async invalidateAll(): Promise<void> {
    this.cache.clear()
    this.stats.evictions += this.stats.size
    this.stats.size = 0

    try {
      await this.redis.keys('game:config:*').then((keys) => {
        if (keys.length > 0) {
          return this.redis.del(...keys)
        }
      })
      this.logger.info('All game config caches invalidated')
    } catch (err) {
      this.logger.warn({ err }, 'Failed to invalidate Redis cache')
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Periodic refresh of cache from database
   */
  private startPeriodicRefresh() {
    this.refreshInterval = setInterval(async () => {
      try {
        await this.getAllGameConfigs()
      } catch (err) {
        this.logger.warn({ err }, 'Periodic cache refresh failed')
      }
    }, this.ttl) // Refresh at TTL interval

    this.refreshInterval.unref()
  }

  /**
   * Close and cleanup
   */
  async close(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
    }
    this.cache.clear()
    this.logger.info('Game rules cache closed')
  }
}

/**
 * Factory function to create game rules cache
 */
export function createGameRulesCache(
  pool: Pool,
  redis: Redis,
  logger: Logger,
  ttlSeconds?: number
): GameRulesCache {
  return new GameRulesCache(pool, redis, logger, ttlSeconds)
}
