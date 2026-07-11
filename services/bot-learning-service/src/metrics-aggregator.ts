import { Pool } from 'pg'
import { Logger } from 'pino'

export interface AggregationResult {
  profileId: string
  gameType: string
  difficulty: string
  hour: string
  gameCount: number
  avgWinRate: number | null
  winRateStd: number | null
  percentileRank: number | null
  sampleSize: number
  driftFromTarget: number | null
}

export class MetricsAggregator {
  private maxRetries = 3
  private retryDelayMs = 1000

  constructor(
    private pool: Pool,
    private logger: Logger
  ) {}

  /**
   * Run hourly metrics aggregation for all bot profiles
   * Returns a promise that resolves when aggregation completes
   * Can be called without awaiting for fire-and-forget behavior
   */
  async aggregateHourlyMetrics(): Promise<AggregationResult[]> {
    this.logger.info('Starting hourly metrics aggregation')
    return this.runAggregation().catch(err => {
      this.logger.error({ err }, 'Hourly metrics aggregation failed')
      return []
    })
  }

  /**
   * Execute the aggregation with retry logic
   */
  private async runAggregation(attempt = 1): Promise<AggregationResult[]> {
    try {
      return await this.executeAggregation()
    } catch (err) {
      if (attempt < this.maxRetries && this.isRetryableError(err)) {
        const delayMs = this.retryDelayMs * attempt
        this.logger.warn(
          { attempt, nextRetryMs: delayMs, err: (err as Error).message },
          'Aggregation failed, retrying'
        )
        await new Promise(resolve => setTimeout(resolve, delayMs))
        return this.runAggregation(attempt + 1)
      }
      throw err
    }
  }

  /**
   * Execute the actual aggregation logic
   */
  private async executeAggregation(): Promise<AggregationResult[]> {
    const results: AggregationResult[] = []

    // Step 1: Get all bot profiles
    const profilesRes = await this.pool.query(
      `SELECT id, game_type, difficulty, win_rate_target
       FROM bot_profiles
       ORDER BY game_type, difficulty`
    )

    if (profilesRes.rows.length === 0) {
      this.logger.info('No bot profiles found')
      return results
    }

    this.logger.info({ profileCount: profilesRes.rows.length }, 'Processing profiles')

    // Step 2: For each profile, fetch and calculate metrics
    for (const profile of profilesRes.rows) {
      try {
        const metric = await this.calculateProfileMetrics(profile)
        if (metric) {
          results.push(metric)
        }
      } catch (err) {
        this.logger.error(
          { profileId: profile.id, gameType: profile.game_type, difficulty: profile.difficulty, err },
          'Failed to calculate metrics for profile'
        )
      }
    }

    // Step 3: Insert aggregated metrics into bot_profile_metrics
    if (results.length > 0) {
      await this.insertMetrics(results)
    }

    this.logger.info({ metricsCount: results.length }, 'Hourly aggregation completed')
    return results
  }

  /**
   * Calculate metrics for a single bot profile
   */
  private async calculateProfileMetrics(profile: any): Promise<AggregationResult | null> {
    const { id: profileId, game_type: gameType, difficulty, win_rate_target: targetWinRate } = profile

    // Fetch game participants for this profile in the last 1 hour
    const participantsRes = await this.pool.query(
      `SELECT gp.id, gp.prize_won, gp.entry_fee_deducted, gr.entry_fee
       FROM game_participants gp
       JOIN game_rooms gr ON gr.id = gp.room_id
       WHERE gp.is_bot = TRUE
         AND gp.bot_profile_id = $1
         AND gp.joined_at > NOW() - INTERVAL '1 hour'
       ORDER BY gp.joined_at DESC
       LIMIT 100`,
      [profileId]
    )

    const participants = participantsRes.rows

    if (participants.length === 0) {
      this.logger.debug(
        { profileId, gameType, difficulty },
        'No game participants found for profile in last hour'
      )
      // Still insert a metrics record with zeros
      return {
        profileId,
        gameType,
        difficulty,
        hour: new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString(),
        gameCount: 0,
        avgWinRate: null,
        winRateStd: null,
        percentileRank: null,
        sampleSize: 0,
        driftFromTarget: null,
      }
    }

    // Calculate win rate for each game
    const winRates = participants.map(p => {
      const entryFee = p.entry_fee_deducted || p.entry_fee || 0
      const profit = p.prize_won - entryFee
      return profit > 0 ? 1 : 0 // Simple: 1 = win, 0 = loss
    })

    // Calculate metrics
    const winRateSum = (winRates as number[]).reduce((a, b) => a + b, 0)
    const avgWinRate = (winRateSum / winRates.length) * 100
    const winRateStd = this.calculateStandardDeviation(winRates.map(w => w * 100))
    const sampleSize = participants.length

    // Percentile rank: position among all profiles (simplified: position in this batch)
    // In a real system, this would be calculated across all profiles
    const percentileRank = Math.min(100, Math.max(0, Math.round((sampleSize / 100) * 100)))

    // Drift from target
    const driftFromTarget = targetWinRate ? avgWinRate - targetWinRate : null

    const hour = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString()

    return {
      profileId,
      gameType,
      difficulty,
      hour,
      gameCount: participants.length,
      avgWinRate: Math.round(avgWinRate * 1000) / 1000, // Round to 3 decimal places
      winRateStd: winRateStd !== null ? Math.round(winRateStd * 1000) / 1000 : null,
      percentileRank,
      sampleSize,
      driftFromTarget: driftFromTarget !== null ? Math.round(driftFromTarget * 1000) / 1000 : null,
    }
  }

  /**
   * Calculate standard deviation from an array of values
   */
  private calculateStandardDeviation(values: number[]): number | null {
    if (values.length === 0) return null
    if (values.length === 1) return 0

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
    return Math.sqrt(variance)
  }

  /**
   * Insert aggregated metrics into bot_profile_metrics table
   */
  private async insertMetrics(results: AggregationResult[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      for (const metric of results) {
        await client.query(
          `INSERT INTO bot_profile_metrics
           (profile_id, game_type, difficulty, hour, game_count, avg_win_rate, win_rate_std, percentile_rank, sample_size, drift_from_target, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            metric.profileId,
            metric.gameType,
            metric.difficulty,
            metric.hour,
            metric.gameCount,
            metric.avgWinRate,
            metric.winRateStd,
            metric.percentileRank,
            metric.sampleSize,
            metric.driftFromTarget,
          ]
        )
      }

      await client.query('COMMIT')
      this.logger.info({ insertedCount: results.length }, 'Metrics inserted successfully')
    } catch (err) {
      await client.query('ROLLBACK')
      this.logger.error({ err }, 'Failed to insert metrics')
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Determine if an error is retryable (e.g., timeout, connection error)
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
    return retryablePatterns.some(pattern => message.toLowerCase().includes(pattern.toLowerCase()))
  }
}
