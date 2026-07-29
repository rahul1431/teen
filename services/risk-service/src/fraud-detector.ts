import Redis from 'ioredis'
import { Pool } from 'pg'
import { Logger } from 'pino'

export interface FraudEvent {
  user_id: string
  game_type: string
  rule_triggered: string
  fraud_score: number // 0-1 (0=safe, 1=definitely fraud)
  confidence: number // 0-1
  evidence: string
  timestamp: string
  action: 'allow' | 'slow_lane' | 'block'
}

export interface FraudConfig {
  coLocationThreshold: number
  winRateAnomalyThreshold: number
  velocityLimitHours: number
  referralChainDepth: number
  enabled: boolean
}

export class FraudDetector {
  private config: FraudConfig

  constructor(
    private redis: Redis,
    private pool: Pool,
    private logger: Logger,
    config: FraudConfig
  ) {
    this.config = config
  }

  /**
   * Analyze game event for fraud signals
   */
  async analyzeGameEvent(event: any): Promise<FraudEvent | null> {
    try {
      // Skip if fraud detection disabled
      if (!this.config.enabled) return null

      const user_id = event.user_id
      if (!user_id) return null

      let totalScore = 0
      let ruleTriggered = ''
      let evidence = ''

      // Rule 1: Co-location Detection
      const coLocationScore = await this.checkCoLocation(user_id)
      if (coLocationScore > 0) {
        totalScore += coLocationScore * 0.3 // Weight: 30%
        ruleTriggered = 'co_location'
        evidence += `Multiple accounts on same device. `
      }

      // Rule 2: Win-Rate Anomalies
      const winRateScore = await this.checkWinRateAnomaly(user_id, event)
      if (winRateScore > 0) {
        totalScore += winRateScore * 0.35 // Weight: 35%
        ruleTriggered = 'win_rate_anomaly'
        evidence += `Unusual win rate pattern detected. `
      }

      // Rule 3: Velocity Checks (for wallet events)
      if (event.event_type === 'gameAction' || event.event_type === 'gameResult') {
        const velocityScore = await this.checkVelocity(user_id, event.amount)
        if (velocityScore > 0) {
          totalScore += velocityScore * 0.2 // Weight: 20%
          ruleTriggered = 'velocity'
          evidence += `Large transaction volume in short time. `
        }
      }

      // Rule 4: Referral Chain (check if referrer is flagged)
      const referralScore = await this.checkReferralChain(user_id)
      if (referralScore > 0) {
        totalScore += referralScore * 0.15 // Weight: 15%
        ruleTriggered = 'referral_chain'
        evidence += `Associated with flagged referrer. `
      }

      // Determine action based on score
      let action: 'allow' | 'slow_lane' | 'block' = 'allow'
      let confidence = Math.min(totalScore, 1) // Clamp to 0-1

      if (confidence > 0.85) {
        action = 'block'
      } else if (confidence > 0.6) {
        action = 'slow_lane'
      }

      // If fraud detected, return event
      if (confidence > 0.4) {
        const fraudEvent: FraudEvent = {
          user_id,
          game_type: event.game_type || 'unknown',
          rule_triggered: ruleTriggered,
          fraud_score: Math.min(totalScore, 1),
          confidence,
          evidence: evidence.trim(),
          timestamp: new Date().toISOString(),
          action,
        }

        // Log to PostgreSQL (async, non-blocking)
        this.logFraudEvent(fraudEvent).catch((err) => {
          this.logger.error({ err }, 'Failed to log fraud event')
        })

        return fraudEvent
      }

      return null
    } catch (err) {
      this.logger.error({ err, event }, 'Error analyzing game event')
      return null
    }
  }

  /**
   * Rule 1: Co-location Detection
   * Flag if 3+ accounts on same device fingerprint
   */
  private async checkCoLocation(user_id: string): Promise<number> {
    try {
      // A user can have multiple device_fingerprints rows (one per distinct
      // device/reinstall they've logged in from), so the inner lookup must
      // be an IN, not a `=` scalar subquery — the latter throws "more than
      // one row returned by a subquery" as soon as any user has 2+ devices,
      // which now that device_fingerprints is actually populated (see
      // docs/Bugs/device-fingerprint-never-collected.md) is a real case,
      // not just a theoretical one.
      const result = await this.pool.query(
        `SELECT COUNT(DISTINCT u.id) as account_count
         FROM users u
         JOIN device_fingerprints df ON u.id = df.user_id
         WHERE df.fingerprint IN (
           SELECT fingerprint FROM device_fingerprints WHERE user_id = $1
         )
         AND u.status = 'active'`,
        [user_id]
      )

      const accountCount = result.rows[0]?.account_count || 1

      // Score increases with account count
      if (accountCount >= this.config.coLocationThreshold) {
        return Math.min(accountCount / 10, 1) // Normalize to 0-1
      }

      return 0
    } catch (err) {
      this.logger.error({ err }, 'Co-location check failed')
      return 0
    }
  }

  /**
   * Rule 2: Win-Rate Anomalies
   * Flag if player has >95% win rate vs specific opponent
   */
  private async checkWinRateAnomaly(user_id: string, event: any): Promise<number> {
    try {
      // Win = took out more than they put in for that room (prize > entry fees).
      // game_rooms.game_type is an enum, so compare as text to tolerate any
      // game_type string arriving on the event without a cast error.
      const result = await this.pool.query(
        `SELECT
           COUNT(*) as total_games,
           COUNT(CASE WHEN gp.prize_won > gp.entry_fee_deducted THEN 1 END) as wins
         FROM game_participants gp
         JOIN game_rooms gr ON gr.id = gp.room_id
         WHERE gp.user_id = $1
           AND gp.joined_at > NOW() - INTERVAL '7 days'
           AND gr.game_type::text = $2`,
        [user_id, event.game_type || 'teen_patti']
      )

      const { total_games, wins } = result.rows[0] || { total_games: 0, wins: 0 }

      if (total_games < 10) return 0 // Need minimum games for statistic

      const winRate = (wins / total_games) * 100

      // Check win rate threshold
      if (winRate > this.config.winRateAnomalyThreshold) {
        // Higher score for more extreme win rates
        return Math.min((winRate - this.config.winRateAnomalyThreshold) / 5, 1)
      }

      return 0
    } catch (err) {
      this.logger.error({ err }, 'Win-rate check failed')
      return 0
    }
  }

  /**
   * Rule 3: Velocity Checks
   * Flag if user deposits/withdraws >₹10k in <1 hour
   */
  private async checkVelocity(user_id: string, amount?: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT SUM(CAST(amount AS DECIMAL)) as total_amount
         FROM wallet_transactions
         WHERE user_id = $1
           AND type IN ('deposit', 'withdrawal')
           AND created_at > NOW() - INTERVAL '${this.config.velocityLimitHours} hours'`,
        [user_id]
      )

      const totalAmount = parseFloat(result.rows[0]?.total_amount || '0')
      const threshold = 10000 // ₹10k

      if (totalAmount > threshold) {
        // Score increases with amount over threshold
        return Math.min((totalAmount - threshold) / 50000, 1) // Normalize
      }

      return 0
    } catch (err) {
      this.logger.error({ err }, 'Velocity check failed')
      return 0
    }
  }

  /**
   * Rule 4: Referral Chain
   * Flag if referrer (or referrer's referrer...) is flagged
   */
  private async checkReferralChain(user_id: string): Promise<number> {
    try {
      let currentUserId = user_id
      let depth = 0

      while (depth < this.config.referralChainDepth) {
        // Get referrer
        const result = await this.pool.query(
          `SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1`,
          [currentUserId]
        )

        if (result.rows.length === 0) break

        const referrerId = result.rows[0].referrer_id

        // Check if referrer is flagged
        const flagged = await this.redis.get(`fraud:flagged:${referrerId}`)
        if (flagged) {
          // Higher score for closer referrer in chain
          return 1 - depth * 0.2 // Closer = higher score
        }

        currentUserId = referrerId
        depth++
      }

      return 0
    } catch (err) {
      this.logger.error({ err }, 'Referral chain check failed')
      return 0
    }
  }

  /**
   * Log fraud event to PostgreSQL and Redis
   */
  private async logFraudEvent(event: FraudEvent): Promise<void> {
    try {
      // Store in PostgreSQL
      await this.pool.query(
        `INSERT INTO fraud_events (
          user_id, game_type, rule_triggered, fraud_score, confidence,
          evidence, action, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          event.user_id,
          event.game_type,
          event.rule_triggered,
          event.fraud_score,
          event.confidence,
          event.evidence,
          event.action,
        ]
      )

      // Flag in Redis for quick lookup
      if (event.action === 'block') {
        await this.redis.setex(
          `fraud:flagged:${event.user_id}`,
          86400, // 24 hours
          JSON.stringify(event)
        )
      }

      // Publish to admin alerts channel
      await this.redis.publish(
        'fraud:alerts',
        JSON.stringify({
          ...event,
          admin_action_required: event.action === 'block',
        })
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to log fraud event')
      throw err
    }
  }

  /**
   * Get fraud events for a user
   */
  async getUserFraudHistory(user_id: string, limit: number = 50): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM fraud_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [user_id, limit]
      )
      return result.rows
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch fraud history')
      throw err
    }
  }

  /**
   * Get recent fraud alerts
   */
  async getRecentAlerts(limit: number = 100): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM fraud_events
         WHERE action IN ('slow_lane', 'block')
         AND created_at > NOW() - INTERVAL '24 hours'
         ORDER BY fraud_score DESC, created_at DESC
         LIMIT $1`,
        [limit]
      )
      return result.rows
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch fraud alerts')
      throw err
    }
  }

  /**
   * Manually flag or unflag a user
   */
  async setUserFlag(
    user_id: string,
    isFlagged: boolean,
    reason: string
  ): Promise<void> {
    try {
      if (isFlagged) {
        await this.redis.setex(
          `fraud:flagged:${user_id}`,
          86400 * 7, // 7 days
          JSON.stringify({ manual_flag: true, reason })
        )
      } else {
        await this.redis.del(`fraud:flagged:${user_id}`)
      }

      // Log to audit trail (fraud_score/confidence are NOT NULL columns)
      await this.pool.query(
        `INSERT INTO fraud_events (
          user_id, rule_triggered, fraud_score, confidence, evidence, action, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          user_id,
          'manual_flag',
          isFlagged ? 1 : 0,
          1,
          `Manual ${isFlagged ? 'flag' : 'unflag'}: ${reason}`,
          isFlagged ? 'block' : 'allow',
        ]
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to set user flag')
      throw err
    }
  }
}
