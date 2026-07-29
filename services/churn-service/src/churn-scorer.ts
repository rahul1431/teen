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
  cron_interval_minutes: number  // I2: expose cron cadence in config
}

export interface ChurnScore {
  userId: string
  score: number
  riskLevel: 'none' | 'low' | 'medium' | 'high'
  daysSinceDeposit: number | null
  lastDepositAt: string | null
}

// admin-service's ml:config `churnPrediction` block (POST /api/admin/ml/config) — previously
// edited in the admin panel but read by nothing. See
// docs/Bugs/ai-control-center-churn-prediction-config-unused.md.
interface ChurnPredictionWeights {
  avgLossStreakWeight: number
  bonusBalanceWeight: number
}
const DEFAULT_ML_WEIGHTS: ChurnPredictionWeights = { avgLossStreakWeight: 0.4, bonusBalanceWeight: 0.2 }

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
      cron_interval_minutes: parseFloat(raw.cron_interval_minutes ?? '60'),  // I2
    }
  }

  async updateConfig(updates: Record<string, string>): Promise<void> {
    // C2: Validate numeric keys before persisting — reject non-integer strings
    const numericKeys = [
      'low_threshold_days', 'medium_threshold_days', 'high_threshold_days',
      'high_bonus_amount', 'action_cooldown_days', 'grace_period_days', 'cron_interval_minutes',
    ]
    for (const [key, value] of Object.entries(updates)) {
      if (numericKeys.includes(key)) {
        const parsed = parseInt(value, 10)
        if (isNaN(parsed)) throw new Error(`Invalid numeric value for config key '${key}': ${value}`)
      }
      await this.pool.query(
        `INSERT INTO churn_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      )
    }
  }

  // Reads the admin-configured avgLossStreakWeight/bonusBalanceWeight fresh every
  // cycle rather than caching — cheap (one Redis GET per cron tick, not per-user)
  // and means a config save takes effect on the very next scoring cycle with no
  // separate cache-invalidation path to keep in sync.
  private async getMlWeights(): Promise<ChurnPredictionWeights> {
    try {
      const raw = await this.redis.get('ml:config')
      if (!raw) return DEFAULT_ML_WEIGHTS
      const parsed = JSON.parse(raw)?.churnPrediction
      return {
        avgLossStreakWeight: typeof parsed?.avgLossStreakWeight === 'number' ? parsed.avgLossStreakWeight : DEFAULT_ML_WEIGHTS.avgLossStreakWeight,
        bonusBalanceWeight: typeof parsed?.bonusBalanceWeight === 'number' ? parsed.bonusBalanceWeight : DEFAULT_ML_WEIGHTS.bonusBalanceWeight,
      }
    } catch {
      return DEFAULT_ML_WEIGHTS
    }
  }

  async runScoringCycle(): Promise<void> {
    this.logger.info('Churn scoring cycle started')
    const cfg = await this.getConfig()
    const mlWeights = await this.getMlWeights()

    // C2: parseInt ensures only an integer can enter the SQL INTERVAL literal
    const graceDays = parseInt(String(cfg.grace_period_days), 10)

    // Fetch all eligible users: active, not suspended/banned, account older than grace period, has made at least 1 deposit.
    // bonus_balance and loss_streak feed the avgLossStreakWeight/bonusBalanceWeight
    // scoring adjustment below — bonus_balance is the wallet's unspent bonus (an
    // incentive to return), loss_streak is how many of the user's most recent
    // games (up to 20) were losses in a row, counting back from the most recent.
    const usersRes = await this.pool.query(
      `SELECT
         u.id,
         u.created_at,
         MAX(wt.created_at) AS last_deposit_at,
         COUNT(wt.id)::int AS total_deposits,
         COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '14 days' THEN 1 END)::int AS deposits_last_14,
         COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '28 days'
                     AND wt.created_at <= NOW() - INTERVAL '14 days' THEN 1 END)::int AS deposits_prior_14,
         COALESCE(w.bonus_balance, 0)::float AS bonus_balance,
         COALESCE(streak.loss_streak, 0)::int AS loss_streak
       FROM users u
       JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'deposit'
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS loss_streak FROM (
           SELECT
             SUM(CASE WHEN gp.prize_won > 0 THEN 1 ELSE 0 END) OVER (ORDER BY gp.joined_at DESC) AS wins_so_far
           FROM game_participants gp
           WHERE gp.user_id = u.id
           ORDER BY gp.joined_at DESC
           LIMIT 20
         ) recent
         WHERE wins_so_far = 0
       ) streak ON true
       WHERE u.status = 'active'
         AND u.is_bot = false
         AND u.created_at < NOW() - INTERVAL '${graceDays} days'
       GROUP BY u.id, u.created_at, w.bonus_balance, streak.loss_streak
       HAVING COUNT(wt.id) > 0`,
      []
    )

    this.logger.info({ count: usersRes.rows.length }, 'Eligible users for churn scoring')

    for (const user of usersRes.rows) {
      try {
        await this.scoreAndActOnUser(user, cfg, mlWeights)
      } catch (err) {
        this.logger.error({ err, userId: user.id }, 'Failed to score user')
      }
    }

    this.logger.info('Churn scoring cycle complete')
  }

  private async scoreAndActOnUser(user: any, cfg: ChurnConfig, mlWeights: ChurnPredictionWeights): Promise<void> {
    const lastDepositAt = user.last_deposit_at ? new Date(user.last_deposit_at) : null
    const daysSinceDeposit = lastDepositAt
      ? (Date.now() - lastDepositAt.getTime()) / (1000 * 60 * 60 * 24)
      : null

    let totalScore = 0
    let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none'
    let isMlUsed = false

    try {
      const mlResponse = await axios.post('http://127.0.0.1:3020/predict', { user_id: user.id }, { timeout: 2000 })
      if (mlResponse.data && typeof mlResponse.data.churn_risk === 'number') {
        totalScore = Math.round(mlResponse.data.churn_risk)
        riskLevel = mlResponse.data.risk_level as any
        isMlUsed = true
        this.logger.info({ userId: user.id, score: totalScore, risk: riskLevel }, 'ML churn prediction completed')
      }
    } catch (err: any) {
      this.logger.warn({ userId: user.id, err: err.message }, 'ML churn prediction failed. Falling back to heuristic rules.')
    }

    if (!isMlUsed) {
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
      }

      totalScore = Math.min(Math.round(inactivityScore + frequencyScore), 100)
    }

    // Config-driven adjustment (avgLossStreakWeight/bonusBalanceWeight), applied
    // uniformly whether the base score above came from the ML model or the
    // heuristic fallback — neither accounts for loss streaks or unspent bonus
    // balance on its own. A longer current losing streak raises risk (capped at
    // 30 points before weighting); a larger unspent bonus balance lowers it
    // (capped at 20 points before weighting) since it's an incentive to return.
    const lossStreak = (user.loss_streak as number) || 0
    const bonusBalance = (user.bonus_balance as number) || 0
    const lossStreakAdjustment = Math.min(lossStreak * 5, 30) * mlWeights.avgLossStreakWeight
    const bonusBalanceRelief = Math.min(bonusBalance / 10, 20) * mlWeights.bonusBalanceWeight
    totalScore = Math.max(0, Math.min(100, Math.round(totalScore + lossStreakAdjustment - bonusBalanceRelief)))
    riskLevel = 'none'
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

    // I1: Atomically acquire the cooldown lock with NX before acting to prevent startup-scan
    // and hourly-cron from both firing for the same user simultaneously.
    const lockKey = 'churn:action_sent:' + user.id
    const acquired = await this.redis.set(lockKey, '1', 'EX', Math.round(cfg.action_cooldown_days * 86400), 'NX')
    if (!acquired) return // cooldown active — skip

    // I7: Pass cfg to avoid a second getConfig() round-trip inside reEngageUser
    if (riskLevel === 'high') {
      await this.reEngageUser(user.id, true, true, cfg)
    } else if (riskLevel === 'medium') {
      await this.reEngageUser(user.id, false, true, cfg)
    }
    // No separate cooldown set needed — set atomically via NX above (I1)
  }

  // I7: Optional cfg parameter — when provided (internal call), skips the extra getConfig() round-trip
  //     and skips the per-call cooldown check (caller already acquired the NX lock).
  async reEngageUser(userId: string, sendBonus: boolean, sendNotification: boolean, cfg?: ChurnConfig): Promise<void> {
    // C1: Validate the user is actually in the churn risk list
    const userCheck = await this.pool.query('SELECT id FROM user_churn_scores WHERE user_id = $1', [userId])
    if (!userCheck.rows.length) throw new Error('User not in churn risk list')

    const isExternalCall = !cfg
    let resolvedCfg: ChurnConfig

    if (isExternalCall) {
      // C1: Guard direct API calls with a cooldown check
      const alreadySent = await this.redis.get('churn:action_sent:' + userId)
      if (alreadySent) throw new Error('Action cooldown active')
      resolvedCfg = await this.getConfig()
    } else {
      // Internal call from scoreAndActOnUser — NX lock already acquired, cfg already loaded
      resolvedCfg = cfg as ChurnConfig
    }

    // I4: Track each sub-action independently so partial failures are recorded
    let bonusCredited = false

    if (sendBonus) {
      try {
        // Day-bucketed (not Date.now()) so a retry of this same call is
        // idempotent, but the next legitimate re-engagement cycle — which
        // can't happen for action_cooldown_days (default 7) — still gets a
        // fresh key instead of silently no-opping against wallet-service's
        // ON CONFLICT (idempotency_key) DO NOTHING.
        const cycleDate = new Date().toISOString().slice(0, 10)
        await axios.post(`${this.config.walletServiceUrl}/internal/wallet/credit`, {
          user_id: userId,
          amount: resolvedCfg.high_bonus_amount,
          type: 'bonus',
          idempotency_key: `churn_reengagement_${userId}_${cycleDate}`,
          description: 'Re-engagement bonus',
        }, { headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' } })
        bonusCredited = true
        // I4: Persist bonus success immediately
        await this.pool.query(
          `UPDATE user_churn_scores SET action_taken = 'bonus_credited', action_taken_at = NOW() WHERE user_id = $1`,
          [userId]
        )
        this.logger.info({ userId, amount: resolvedCfg.high_bonus_amount }, 'Re-engagement bonus credited')
      } catch (err) {
        this.logger.error({ err, userId }, 'Failed to credit re-engagement bonus')
      }
    }

    if (sendNotification) {
      try {
        await axios.post(`${this.config.notificationServiceUrl}/internal/notifications/send`, {
          user_id: userId,
          title: 'We miss you! 🎮',
          body: sendBonus
            ? 'A special bonus has been added to your wallet. Come back and play!'
            : 'Come back and join the action! New games are waiting for you.',
          type: 'reengagement',
        }, { headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' } })
        // I4: Persist notification success immediately, reflecting whether bonus also landed
        const newAction = bonusCredited ? 'bonus+notification' : 'notification'
        await this.pool.query(
          `UPDATE user_churn_scores SET action_taken = $2, action_taken_at = NOW() WHERE user_id = $1`,
          [userId, newAction]
        )
        this.logger.info({ userId }, 'Re-engagement notification sent')
      } catch (err) {
        this.logger.error({ err, userId }, 'Failed to send re-engagement notification')
      }
    }

    // C1: Set the cooldown key for external API calls (internal calls already set it via NX)
    if (isExternalCall) {
      await this.redis.set(
        'churn:action_sent:' + userId,
        '1',
        'EX',
        Math.round(resolvedCfg.action_cooldown_days * 86400)
      )
    }
  }

  async getStats(): Promise<object> {
    const res = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE risk_level = 'low')    AS low,
        COUNT(*) FILTER (WHERE risk_level = 'medium') AS medium,
        COUNT(*) FILTER (WHERE risk_level = 'high')   AS high,
        COUNT(*) FILTER (WHERE action_taken IN ('bonus_credited','bonus+notification')
                           AND action_taken_at > NOW() - INTERVAL '1 day') AS bonuses_today,
        COUNT(*) FILTER (WHERE action_taken IN ('notification','bonus+notification')
                           AND action_taken_at > NOW() - INTERVAL '1 day') AS notifications_today
      FROM user_churn_scores
    `)
    const row = res.rows[0]
    return {
      total_at_risk: Number(row.low) + Number(row.medium) + Number(row.high),
      by_level: { low: Number(row.low), medium: Number(row.medium), high: Number(row.high) },
      bonuses_sent_today: Number(row.bonuses_today),
      notifications_sent_today: Number(row.notifications_today),
    }
  }
}
