import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'
import { Kafka, Producer } from 'kafkajs'
import { KafkaConsumer } from './kafka-consumer'
import { EventRecord } from './event-schema'

export interface ProfileUpdateEvent {
  event_type: 'profile-update'
  affected_profiles: Array<{
    game_type: string
    difficulty: string
    win_rate: number
    std_dev: number
    percentile_rank: number
  }>
  timestamp: string
}

export interface StreamingEvaluatorMetrics {
  totalEventsProcessed: number
  totalBatchesProcessed: number
  avgLatencyMs: number
  maxLatencyMs: number
  minLatencyMs: number
  dbErrorCount: number
  kafkaErrorCount: number
  deadLetterCount: number
  profilesUpdated: number
  lastEvaluationTime?: string
}

/**
 * StreamingEvaluator - Event-driven profile evaluation
 *
 * Replaces hourly cron-based aggregation with Kafka event streaming:
 * 1. Consumes game-complete events from Kafka game-events topic
 * 2. Batches events (100 events or 10s timeout)
 * 3. Aggregates profile statistics (win_rate, std_dev, percentile_rank)
 * 4. Updates profiles in PostgreSQL
 * 5. Publishes profile-updates events to Kafka for cache invalidation
 * 6. Monitors latency and alerts on SLO violations (>1s)
 */
export class StreamingEvaluator {
  private consumer: KafkaConsumer | null = null
  private producer: Producer | null = null
  private kafka: Kafka | null = null
  private eventBatch: EventRecord[] = []
  private batchTimer: NodeJS.Timeout | null = null
  private readonly BATCH_SIZE = 100
  private readonly BATCH_TIMEOUT_MS = 10000 // 10 seconds
  private readonly LATENCY_SLO_MS = 1000 // 1 second SLO
  private connected = false

  // Metrics
  private metrics: StreamingEvaluatorMetrics = {
    totalEventsProcessed: 0,
    totalBatchesProcessed: 0,
    avgLatencyMs: 0,
    maxLatencyMs: 0,
    minLatencyMs: Infinity,
    dbErrorCount: 0,
    kafkaErrorCount: 0,
    deadLetterCount: 0,
    profilesUpdated: 0,
  }

  private latencies: number[] = []
  private deadLetterQueue: EventRecord[] = []

  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger,
    brokers: string[] = ['localhost:9092']
  ) {
    this.consumer = new KafkaConsumer(brokers, 'bot-learning-evaluator')
    this.kafka = new Kafka({
      clientId: 'bot-learning-producer',
      brokers,
    })
    this.producer = this.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 5,
    })
  }

  /**
   * Initialize and start the streaming evaluator
   */
  async initialize(): Promise<void> {
    if (this.connected) return

    try {
      // Connect consumer and producer
      await this.consumer?.connect()
      await this.producer?.connect()

      // Subscribe to game-events topic
      if (this.consumer) {
        await this.consumer.subscribe('game-events', this.handleGameEvent.bind(this))
        await this.consumer.onError(this.handleConsumerError.bind(this))
      }

      this.connected = true
      this.logger.info('Streaming evaluator initialized')
    } catch (err) {
      this.logger.error({ err }, 'Failed to initialize streaming evaluator')
      throw err
    }
  }

  /**
   * Shutdown the streaming evaluator
   */
  async shutdown(): Promise<void> {
    if (!this.connected) return

    // Flush remaining batch
    if (this.eventBatch.length > 0) {
      await this.evaluateBatch()
    }

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    // Disconnect
    await this.consumer?.disconnect()
    await this.producer?.disconnect()

    this.connected = false
    this.logger.info('Streaming evaluator shut down')
  }

  /**
   * Handle incoming game event
   */
  private async handleGameEvent(event: EventRecord): Promise<void> {
    try {
      // Only process game-complete events
      if (event.event_type !== 'game-complete') {
        return
      }

      this.eventBatch.push(event)
      this.metrics.totalEventsProcessed++

      // Start batch timer if this is the first event
      if (this.eventBatch.length === 1) {
        this.startBatchTimer()
      }

      // Evaluate batch if full
      if (this.eventBatch.length >= this.BATCH_SIZE) {
        await this.evaluateBatch()
      }
    } catch (err) {
      this.logger.error({ err, event }, 'Error handling game event')
      // Add to dead letter queue for later processing
      this.deadLetterQueue.push(event)
      this.metrics.deadLetterCount++
    }
  }

  /**
   * Start the batch timeout timer
   */
  private startBatchTimer(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer)

    this.batchTimer = setTimeout(async () => {
      if (this.eventBatch.length > 0) {
        this.logger.debug(
          { batchSize: this.eventBatch.length },
          'Batch timeout reached, evaluating'
        )
        await this.evaluateBatch()
      }
    }, this.BATCH_TIMEOUT_MS)
  }

  /**
   * Clear the batch timer
   */
  private clearBatchTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  /**
   * Evaluate the current batch of events
   */
  private async evaluateBatch(): Promise<void> {
    if (this.eventBatch.length === 0) return

    const startTime = Date.now()
    const batchToProcess = [...this.eventBatch]
    this.eventBatch = []
    this.clearBatchTimer()

    try {
      this.logger.info({ batchSize: batchToProcess.length }, 'Evaluating batch')

      // Step 1: Aggregate events by player_id and game_type
      const aggregatedData = this.aggregateEvents(batchToProcess)

      // Step 2: Calculate profile statistics
      const profileUpdates = await this.calculateProfileStats(aggregatedData)

      // Step 3: Update profiles in database with retry logic
      const updatedProfiles = await this.updateProfilesWithRetry(profileUpdates)

      // Step 4: Publish profile-updates event to Kafka
      if (updatedProfiles.length > 0) {
        await this.publishProfileUpdates(updatedProfiles)
      }

      // Step 5: Record metrics
      const latency = Date.now() - startTime
      this.recordLatency(latency)

      // Step 6: Alert if SLO violated
      if (latency > this.LATENCY_SLO_MS) {
        this.logger.warn(
          { latency, slo: this.LATENCY_SLO_MS },
          'Latency SLO violation'
        )
      }

      this.metrics.totalBatchesProcessed++
      this.metrics.profilesUpdated += updatedProfiles.length
      this.metrics.lastEvaluationTime = new Date().toISOString()

      this.logger.info(
        {
          batchSize: batchToProcess.length,
          profilesUpdated: updatedProfiles.length,
          latency,
        },
        'Batch evaluation complete'
      )
    } catch (err) {
      this.logger.error(
        { err, batchSize: batchToProcess.length },
        'Failed to evaluate batch'
      )
      // Re-queue failed events to dead letter queue for retry
      this.deadLetterQueue.push(...batchToProcess)
      this.metrics.deadLetterCount += batchToProcess.length
    }
  }

  /**
   * Aggregate events by player and game type
   */
  private aggregateEvents(events: EventRecord[]): Map<string, EventRecord[]> {
    const aggregated = new Map<string, EventRecord[]>()

    for (const event of events) {
      const key = `${event.player_id}:${event.game_type}`
      if (!aggregated.has(key)) {
        aggregated.set(key, [])
      }
      aggregated.get(key)!.push(event)
    }

    return aggregated
  }

  /**
   * Calculate profile statistics from aggregated events
   */
  private async calculateProfileStats(
    aggregatedData: Map<string, EventRecord[]>
  ): Promise<
    Array<{
      player_id: string
      game_type: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }>
  > {
    const updates: Array<{
      player_id: string
      game_type: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }> = []

    for (const [key, events] of aggregatedData.entries()) {
      const [playerId, gameType] = key.split(':')

      // Calculate win rate
      const wins = events.filter(e => e.outcome === 'win').length
      const winRate = wins / events.length

      // Calculate standard deviation of win rates across events
      const winRates = events.map(e => (e.outcome === 'win' ? 1 : 0))
      const stdDev = this.calculateStandardDeviation(winRates)

      // Calculate percentile rank (simplified: normalized by sample size)
      const percentileRank = Math.min(100, Math.round((events.length / 100) * 100))

      updates.push({
        player_id: playerId,
        game_type: gameType,
        win_rate: Math.round(winRate * 10000) / 10000,
        std_dev: Math.round(stdDev * 10000) / 10000,
        percentile_rank: percentileRank,
      })
    }

    return updates
  }

  /**
   * Calculate standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0
    if (values.length === 1) return 0

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
    return Math.sqrt(variance)
  }

  /**
   * Update profiles in database with exponential backoff retry
   */
  private async updateProfilesWithRetry(
    updates: Array<{
      player_id: string
      game_type: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }>,
    attempt = 1,
    maxAttempts = 3
  ): Promise<
    Array<{
      game_type: string
      difficulty: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }>
  > {
    try {
      return await this.updateProfiles(updates)
    } catch (err) {
      if (attempt < maxAttempts && this.isRetryableError(err)) {
        const delayMs = Math.pow(2, attempt - 1) * 1000 // Exponential backoff: 1s, 2s, 4s
        this.logger.warn(
          { attempt, nextRetryMs: delayMs, err: (err as Error).message },
          'Profile update failed, retrying'
        )
        await new Promise(resolve => setTimeout(resolve, delayMs))
        return this.updateProfilesWithRetry(updates, attempt + 1, maxAttempts)
      }
      this.metrics.dbErrorCount++
      throw err
    }
  }

  /**
   * Update profiles in database
   */
  private async updateProfiles(
    updates: Array<{
      player_id: string
      game_type: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }>
  ): Promise<
    Array<{
      game_type: string
      difficulty: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }>
  > {
    const client = await this.pool.connect()
    const updatedProfiles: Array<{
      game_type: string
      difficulty: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }> = []

    try {
      await client.query('BEGIN')

      for (const update of updates) {
        // Fetch current profile to get difficulty tier
        const profileRes = await client.query(
          `SELECT id, game_type, difficulty, win_rate_target, std_dev, percentile_rank
           FROM bot_profiles
           WHERE game_type = $1
           ORDER BY difficulty
           LIMIT 1`,
          [update.game_type]
        )

        if (profileRes.rows.length > 0) {
          const profile = profileRes.rows[0]

          // Update the profile
          await client.query(
            `UPDATE bot_profiles
             SET win_rate_target = $1, std_dev = $2, percentile_rank = $3, last_rebuilt_at = NOW()
             WHERE game_type = $4`,
            [update.win_rate, update.std_dev, update.percentile_rank, update.game_type]
          )

          updatedProfiles.push({
            game_type: profile.game_type,
            difficulty: profile.difficulty,
            win_rate: update.win_rate,
            std_dev: update.std_dev,
            percentile_rank: update.percentile_rank,
          })
        }
      }

      await client.query('COMMIT')
      return updatedProfiles
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Publish profile-updates event to Kafka
   */
  private async publishProfileUpdates(
    updatedProfiles: Array<{
      game_type: string
      difficulty: string
      win_rate: number
      std_dev: number
      percentile_rank: number
    }>
  ): Promise<void> {
    try {
      const event: ProfileUpdateEvent = {
        event_type: 'profile-update',
        affected_profiles: updatedProfiles,
        timestamp: new Date().toISOString(),
      }

      const result = await this.producer?.publishEvent('profile-updates', event as any)

      if (!result?.success) {
        this.logger.error(
          { error: result?.error },
          'Failed to publish profile-updates event'
        )
        this.metrics.kafkaErrorCount++
        throw new Error(`Failed to publish profile-updates: ${result?.error}`)
      }

      this.logger.debug(
        { profileCount: updatedProfiles.length },
        'Profile-updates event published'
      )
    } catch (err) {
      this.logger.error({ err }, 'Error publishing profile-updates')
      this.metrics.kafkaErrorCount++
      throw err
    }
  }

  /**
   * Handle consumer errors
   */
  private async handleConsumerError(error: Error): Promise<void> {
    this.logger.error({ err: error }, 'Consumer error')
    this.metrics.kafkaErrorCount++
  }

  /**
   * Record latency metric
   */
  private recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs)

    // Keep only last 100 latencies for average calculation
    if (this.latencies.length > 100) {
      this.latencies.shift()
    }

    this.metrics.avgLatencyMs =
      this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
    this.metrics.maxLatencyMs = Math.max(this.metrics.maxLatencyMs, latencyMs)
    this.metrics.minLatencyMs = Math.min(this.metrics.minLatencyMs, latencyMs)
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(err: any): boolean {
    const message = (err as Error)?.message || String(err)
    const retryablePatterns = [
      'timeout',
      'connection',
      'ECONNREFUSED',
      'ENOTFOUND',
      'socket',
      'ETIMEDOUT',
    ]
    return retryablePatterns.some(pattern =>
      message.toLowerCase().includes(pattern.toLowerCase())
    )
  }

  /**
   * Get current metrics
   */
  getMetrics(): StreamingEvaluatorMetrics {
    return { ...this.metrics }
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue(): EventRecord[] {
    return [...this.deadLetterQueue]
  }

  /**
   * Clear dead letter queue (after successful reprocessing)
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = []
  }

  /**
   * Check if evaluator is connected
   */
  isConnected(): boolean {
    return this.connected
  }
}
