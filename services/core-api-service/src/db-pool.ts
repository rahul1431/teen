import { Pool, PoolClient, QueryResult } from 'pg'
import { Logger } from 'pino'

/**
 * HikariCP-style connection pool wrapper for PostgreSQL
 * Provides:
 * - Connection pooling with configurable size and timeouts
 * - Connection validation (SELECT 1)
 * - Leak detection (warns on long-held connections)
 * - Metrics and monitoring
 */
export interface PoolConfig {
  maxConnections?: number // Max pool size (default 20)
  idleTimeoutMs?: number // Connection idle timeout (default 10 min = 600000ms)
  maxLifetimeMs?: number // Max connection lifetime (default 30 min = 1800000ms)
  leakDetectionMs?: number // Warn on connections held >X ms (default 5 min = 300000ms)
  validationQuery?: string // Connection validation query (default: SELECT 1)
}

interface PooledConnection {
  client: PoolClient
  acquiredAt: number
  releaseCallbacks: Array<() => void>
}

export class OptimizedPool {
  private pool: Pool
  private connectionMetadata: Map<PoolClient, PooledConnection>
  private leakCheckInterval: NodeJS.Timeout | null = null
  private logger: Logger
  private config: Required<PoolConfig>

  constructor(connectionString: string, logger: Logger, config?: PoolConfig) {
    this.logger = logger
    this.config = {
      maxConnections: config?.maxConnections ?? 20,
      idleTimeoutMs: config?.idleTimeoutMs ?? 600000, // 10 minutes
      maxLifetimeMs: config?.maxLifetimeMs ?? 1800000, // 30 minutes
      leakDetectionMs: config?.leakDetectionMs ?? 300000, // 5 minutes
      validationQuery: config?.validationQuery ?? 'SELECT 1',
    }

    this.pool = new Pool({
      connectionString,
      max: this.config.maxConnections,
      idleTimeoutMillis: this.config.idleTimeoutMs,
      connectionTimeoutMillis: 5000,
    })

    this.connectionMetadata = new Map()

    // Set up event handlers
    this.pool.on('error', (err, client) => {
      this.logger.error({ err, clientId: this.getClientId(client) }, 'Pool error')
    })

    this.pool.on('connect', (client) => {
      this.logger.debug({ clientId: this.getClientId(client) }, 'New connection established')
    })

    // Start leak detection
    this.startLeakDetection()
  }

  /**
   * Get a connection from the pool with validation
   */
  async acquire(): Promise<PoolClient> {
    try {
      const client = await this.pool.connect()

      // Validate connection
      try {
        await client.query(this.config.validationQuery)
      } catch (err) {
        this.logger.warn({ err }, 'Connection validation failed, releasing')
        client.release()
        // Retry once
        return this.acquire()
      }

      // Track connection acquisition
      const metadata: PooledConnection = {
        client,
        acquiredAt: Date.now(),
        releaseCallbacks: [],
      }
      this.connectionMetadata.set(client, metadata)

      this.logger.debug(
        { clientId: this.getClientId(client), poolSize: this.pool.totalCount },
        'Connection acquired'
      )

      return client
    } catch (err) {
      this.logger.error({ err }, 'Failed to acquire connection')
      throw err
    }
  }

  /**
   * Execute a query (handles connection acquisition/release automatically)
   */
  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const client = await this.acquire()
    try {
      const result = await client.query<T>(sql, params)
      return result
    } finally {
      client.release()
    }
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.acquire()
    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Get current pool statistics
   */
  getStats() {
    return {
      idleCount: this.pool.idleCount,
      totalCount: this.pool.totalCount,
      waitingCount: this.pool.waitingCount,
      maxSize: this.config.maxConnections,
      utilization: (this.pool.totalCount - this.pool.idleCount) / this.pool.totalCount,
    }
  }

  /**
   * Start leak detection (periodically check for long-held connections)
   */
  private startLeakDetection() {
    this.leakCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const [client, metadata] of this.connectionMetadata.entries()) {
        const holdTime = now - metadata.acquiredAt
        if (holdTime > this.config.leakDetectionMs) {
          this.logger.warn(
            {
              clientId: this.getClientId(client),
              heldForMs: holdTime,
              thresholdMs: this.config.leakDetectionMs,
            },
            'Connection held for too long (possible leak)'
          )
        }
      }
    }, 30000) // Check every 30 seconds

    this.leakCheckInterval.unref()
  }

  /**
   * Close the pool
   */
  async close(): Promise<void> {
    if (this.leakCheckInterval) {
      clearInterval(this.leakCheckInterval)
    }
    await this.pool.end()
    this.logger.info('Pool closed')
  }

  /**
   * Helper to get a unique client identifier
   */
  private getClientId(client: PoolClient): string {
    return `pg_${(client as any).processID || 'unknown'}`
  }
}

/**
 * Factory function to create an optimized pool
 */
export function createOptimizedPool(
  connectionString: string,
  logger: Logger,
  config?: PoolConfig
): OptimizedPool {
  return new OptimizedPool(connectionString, logger, config)
}
