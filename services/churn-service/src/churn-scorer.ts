import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'
import axios from 'axios'

export interface ChurnScorerConfig {
  notificationServiceUrl: string
  walletServiceUrl: string
}

export interface ChurnConfig {
  low_threshold_days: number
  medium_threshold_days: number
  high_threshold_days: number
  high_bonus_amount: number
  action_cooldown_days: number
  grace_period_days: number
}

export interface ChurnScore {
  userId: string
  score: number
  riskLevel: 'none' | 'low' | 'medium' | 'high'
  daysSinceDeposit: number | null
  lastDepositAt: string | null
}

export class ChurnScorer {
  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger,
    private config: ChurnScorerConfig
  ) {}

  async getConfig(): Promise<ChurnConfig> {
    const res = await this.pool.query('SELECT key, value FROM churn_config')
    const raw: Record<string, string> = {}
    for (const row of res.rows) raw[row.key] = row.value
    return {
      low_threshold_days:    parseFloat(raw.low_threshold_days    ?? '3'),
      medium_threshold_days: parseFloat(raw.medium_threshold_days ?? '7'),
      high_threshold_days:   parseFloat(raw.high_threshold_days   ?? '14'),
      high_bonus_amount:     parseFloat(raw.high_bonus_amount     ?? '50'),
      action_cooldown_days:  parseFloat(raw.action_cooldown_days  ?? '7'),
      grace_period_days:     parseFloat(raw.grace_period_days     ?? '3'),
    }
  }

  async updateConfig(updates: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(updates)) {
      await this.pool.query(
        `INSERT INTO churn_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      )
    }
  }

  async runScoringCycle(): Promise<void> {
    this.logger.info('Churn scoring cycle started')
    const cfg = await this.getConfig()

    // Fetch all eligible users: active, not suspended/banned, account older than grace period, has made at least 1 deposit
    const usersRes = await this.pool.query(
      `SELECT
         u.id,
         u.created_at,
         MAX(wt.created_at) AS last_deposit_at,
         COUNT(wt.id)::int AS total_deposits,
         COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '14 days' THEN 1 END)::int AS deposits_last_14,
         COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '28 days'
                     AND wt.created_at <= NOW() - INTERVAL '14 days' THEN 1 END)::int AS deposits_prior_14
       FROM users u
       JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.txn_type = 'deposit'
       WHERE u.status = 'active'
         AND u.is_bot = false
         AND u.created_at < NOW() - INTERVAL '${cfg.grace_period_days} days'
       GROUP BY u.id, u.created_at
       HAVING COUNT(wt.id) > 0`,
      []
    )

    this.logger.info({ count: usersRes.rows.length }, 'Eligible users for churn scoring')

    for (const user of usersRes.rows) {
      try {
        await this.scoreAndActOnUser(user, cfg)
      } catch (err) {
        this.logger.error({ err, userId: user.id }, 'Failed to score user')
      }
    }

    this.logger.info('Churn scoring cycle complete')
  }

  private async scoreAndActOnUser(user: any, cfg: ChurnConfig): Promise<void> {
    const lastDepositAt = user.last_deposit_at ? new Date(user.last_deposit_at) : null
    const daysSinceDeposit = lastDepositAt
      ? (Date.now() - lastDepositAt.getTime()) / (1000 * 60 * 60 * 24)
      : null

    // Deposit inactivity score (0-70)
    let inactivityScore = 0
    if (daysSinceDeposit !== null) {
      if (daysSinceDeposit >= cfg.high_threshold_days) {
        inactivityScore = 70
      } else if (daysSinceDeposit >= cfg.medium_threshold_days) {
        // Linear interpolation medium → high
        const range = cfg.high_threshold_days - cfg.medium_threshold_days
        const pos = daysSinceDeposit - cfg.medium_threshold_days
        inactivityScore = 60 + (pos / range) * 10
      } else if (daysSinceDeposit >= cfg.low_threshold_days) {
        // Linear interpolation low → medium
        const range = cfg.medium_threshold_days - cfg.low_threshold_days
        const pos = daysSinceDeposit - cfg.low_threshold_days
        inactivityScore = 30 + (pos / range) * 30
      }
    }

    // Frequency drop score (0-30)
    let frequencyScore = 0
    const depositsLast14 = user.deposits_last_14 as number
    const depositsPrior14 = user.deposits_prior_14 as number
    if (depositsPrior14 > 0 && depositsLast14 < depositsPrior14) {
      const dropRate = (depositsPrior14 - depositsLast14) / depositsPrior14
      frequencyScore = dropRate * 30
    } else if (depositsPrior14 > 0 && depositsLast14 === 0) {
      frequencyScore = 30
    }

    const totalScore = Math.min(Math.round(inactivityScore + frequencyScore), 100)

    let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none'
    if (totalScore >= 80) riskLevel = 'high'
    else if (totalScore >= 60) riskLevel = 'medium'
    else if (totalScore >= 30) riskLevel = 'low'

    // Upsert score
    await this.pool.query(
      `INSERT INTO user_churn_scores
         (user_id, score, risk_level, days_since_deposit, last_deposit_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         score = $2,
         risk_level = $3,
         days_since_deposit = $4,
         last_deposit_at = $5,
         updated_at = NOW()`,
      [user.id, totalScore, riskLevel, daysSinceDeposit, lastDepositAt?.toISOString() ?? null]
    )

    // Auto-actions only for medium/high, respecting cooldown
    if (riskLevel === 'none' || riskLevel === 'low') return

    const cooldownKey = `churn:action_sent:${user.id}`
    const alreadySent = await this.redis.get(cooldownKey)
    if (alreadySent) return

    if (riskLevel === 'high') {
      await this.reEngageUser(user.id, true, true)
    } else if (riskLevel === 'medium') {
      await this.reEngageUser(user.id, false, true)
    }

    // Set cooldown
    const cooldownSeconds = cfg.action_cooldown_days * 24 * 60 * 60
    await this.redis.setex(cooldownKey, cooldownSeconds, '1')
  }

  async reEngageUser(userId: string, sendBonus: boolean, sendNotification: boolean): Promise<void> {
    let actionTaken = ''

    if (sendBonus) {
      try {
        const cfg = await this.getConfig()
        await axios.post(`${this.config.walletServiceUrl}/internal/wallet/credit`, {
          userId,
          amount: cfg.high_bonus_amount,
          type: 'bonus',
          reference: `churn_reengagement_${Date.now()}`,
          description: 'Re-engagement bonus',
        })
        actionTaken = 'bonus'
        this.logger.info({ userId, amount: cfg.high_bonus_amount }, 'Re-engagement bonus credited')
      } catch (err) {
        this.logger.error({ err, userId }, 'Failed to credit re-engagement bonus')
      }
    }

    if (sendNotification) {
      try {
        await axios.post(`${this.config.notificationServiceUrl}/internal/notifications/send`, {
          userId,
          title: 'We miss you! 🎮',
          body: sendBonus
            ? 'A special bonus has been added to your wallet. Come back and play!'
            : 'Come back and join the action! New games are waiting for you.',
          type: 'reengagement',
        })
        actionTaken = actionTaken ? `${actionTaken}+notification` : 'notification'
        this.logger.info({ userId }, 'Re-engagement notification sent')
      } catch (err) {
        this.logger.error({ err, userId }, 'Failed to send re-engagement notification')
      }
    }

    if (actionTaken) {
      await this.pool.query(
        `UPDATE user_churn_scores
         SET action_taken = $2, action_taken_at = NOW()
         WHERE user_id = $1`,
        [userId, actionTaken]
      )
    }
  }

  async getStats(): Promise<object> {
    const res = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE risk_level = 'low')    AS low_count,
        COUNT(*) FILTER (WHERE risk_level = 'medium') AS medium_count,
        COUNT(*) FILTER (WHERE risk_level = 'high')   AS high_count,
        COUNT(*) FILTER (WHERE action_taken IS NOT NULL
                           AND action_taken_at > NOW() - INTERVAL '1 day') AS actions_today
      FROM user_churn_scores
    `)
    return res.rows[0]
  }
}
