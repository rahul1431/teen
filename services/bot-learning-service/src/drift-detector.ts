import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'
import { SlackNotifier, AlertPayload, ResolutionPayload } from './slack-notifier'

export interface MetricRow {
  game_type: string
  difficulty: string
  hour: Date
  avg_win_rate: number | null
  drift_from_target: number | null
  win_rate_target: number
  profile_id?: string
  sample_size?: number
  game_count?: number
}

export interface DriftPattern {
  game_type: string
  difficulty: string
  max_drift: number
  consecutive_hours: number
  avg_win_rate?: number
  win_rate_target?: number
}

interface AlertState {
  severity: 'RED' | 'YELLOW' | 'GREEN'
  lastAlertTime: number
}

const DRIFT_THRESHOLD = 0.03 // 3%
const MIN_CONSECUTIVE_HOURS = 3
const ALERT_STATE_CACHE_TTL = 86400 // 24 hours

export class DriftDetector {
  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger,
    private slackNotifier: SlackNotifier
  ) {}

  async run(): Promise<void> {
    this.logger.info('Drift detection check started')

    try {
      const drifts = await this.checkDriftPatterns()

      for (const drift of drifts) {
        await this.processAlert(drift)
      }

      // Check for resolutions (previously alerted drifts now cleared)
      const previouslyAlertedKeys = await this.getPreviouslyAlertedKeys()
      for (const key of previouslyAlertedKeys) {
        const [gameType, difficulty] = key.split(':')
        const currentDrift = drifts.find(d => d.game_type === gameType && d.difficulty === difficulty)

        if (!currentDrift) {
          // Drift has cleared
          const drift = {
            game_type: gameType,
            difficulty,
            max_drift: 0,
            consecutive_hours: 0,
          }
          await this.processResolution(drift)
        }
      }

      this.logger.info({ count: drifts.length }, 'Drift detection check completed')
    } catch (err) {
      this.logger.error({ err }, 'Drift detection check failed')
    }
  }

  async checkDriftPatterns(): Promise<DriftPattern[]> {
    try {
      // Query last 6 hours of metrics (to have at least 3 consecutive hours)
      const res = await this.pool.query(`
        SELECT
          game_type,
          difficulty,
          hour,
          avg_win_rate,
          drift_from_target,
          win_rate_target,
          sample_size,
          game_count
        FROM bot_profile_metrics
        WHERE created_at >= NOW() - INTERVAL '6 hours'
        ORDER BY game_type, difficulty, hour DESC
      `)

      if (!res.rows.length) {
        return []
      }

      const metrics = res.rows as MetricRow[]
      return this.analyzeDriftPatterns(metrics)
    } catch (err) {
      this.logger.error({ err }, 'Failed to check drift patterns')
      return []
    }
  }

  private analyzeDriftPatterns(metrics: MetricRow[]): DriftPattern[] {
    const patterns: Map<string, DriftPattern> = new Map()

    // Group metrics by game_type/difficulty
    const grouped: Record<string, MetricRow[]> = {}
    for (const metric of metrics) {
      if (!metric.avg_win_rate || metric.drift_from_target === null) continue

      const key = `${metric.game_type}:${metric.difficulty}`
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(metric)
    }

    // Check each group for 3+ consecutive hours of drift
    for (const [key, groupMetrics] of Object.entries(grouped)) {
      // Sort by hour descending (most recent first)
      groupMetrics.sort((a, b) => new Date(b.hour).getTime() - new Date(a.hour).getTime())

      // Check for consecutive hours with drift > threshold
      let consecutiveHours = 0
      let maxDrift = 0
      let avgWinRate = 0
      let winRateTarget = 0

      for (const metric of groupMetrics) {
        const drift = Math.abs(metric.drift_from_target!)
        if (drift > DRIFT_THRESHOLD) {
          consecutiveHours++
          maxDrift = Math.max(maxDrift, drift)
          avgWinRate = metric.avg_win_rate!
          winRateTarget = metric.win_rate_target
        } else {
          // Break on first hour without drift
          break
        }
      }

      // Only flag if 3+ consecutive hours show drift
      if (consecutiveHours >= MIN_CONSECUTIVE_HOURS) {
        const [gameType, difficulty] = key.split(':')
        patterns.set(key, {
          game_type: gameType,
          difficulty,
          max_drift: maxDrift,
          consecutive_hours: consecutiveHours,
          avg_win_rate: avgWinRate,
          win_rate_target: winRateTarget,
        })
      }
    }

    return Array.from(patterns.values())
  }

  classifySeverity(drift: number): 'RED' | 'YELLOW' | 'GREEN' {
    const absDrift = Math.abs(drift)
    if (absDrift > 0.05) return 'RED'
    if (absDrift > 0.03) return 'YELLOW'
    return 'GREEN'
  }

  async shouldSendAlert(drift: DriftPattern): Promise<boolean> {
    const key = `drift:alert:${drift.game_type}:${drift.difficulty}`
    const cached = await this.redis.get(key)

    if (!cached) {
      return true
    }

    try {
      const prevState = JSON.parse(cached) as AlertState
      const currentSeverity = this.classifySeverity(drift.max_drift)

      // Send alert if severity changed
      if (prevState.severity !== currentSeverity) {
        return true
      }

      return false
    } catch (err) {
      this.logger.warn({ err }, 'Failed to parse cached alert state')
      return true
    }
  }

  async shouldSendResolution(drift: DriftPattern): Promise<boolean> {
    const key = `drift:alert:${drift.game_type}:${drift.difficulty}`
    const cached = await this.redis.get(key)

    if (!cached) {
      return false // No previous alert state, nothing to resolve
    }

    try {
      const prevState = JSON.parse(cached) as AlertState
      const currentSeverity = this.classifySeverity(drift.max_drift)

      // Send resolution if we had an alert and now drift is GREEN
      if (prevState.severity !== 'GREEN' && currentSeverity === 'GREEN') {
        return true
      }

      return false
    } catch (err) {
      this.logger.warn({ err }, 'Failed to parse cached alert state')
      return false
    }
  }

  async processAlert(drift: DriftPattern): Promise<void> {
    const shouldAlert = await this.shouldSendAlert(drift)
    if (!shouldAlert) {
      this.logger.debug(
        { game_type: drift.game_type, difficulty: drift.difficulty },
        'Alert suppressed (already alerted)'
      )
      return
    }

    const severity = this.classifySeverity(drift.max_drift)

    // Prepare Slack payload
    const payload: AlertPayload = {
      game_type: drift.game_type,
      difficulty: drift.difficulty,
      severity,
      current_win_rate: drift.avg_win_rate || 0,
      target_win_rate: drift.win_rate_target || 0,
      drift_percentage: drift.max_drift,
      consecutive_hours: drift.consecutive_hours,
      dashboardLink: `${process.env.ADMIN_DASHBOARD_URL || 'https://admin.example.com'}/metrics/${drift.game_type}/${drift.difficulty}`,
    }

    // Send Slack alert
    const sent = await this.slackNotifier.sendAlert(payload)

    if (sent) {
      // Update cache to avoid duplicate alerts
      const state: AlertState = {
        severity,
        lastAlertTime: Date.now(),
      }
      const key = `drift:alert:${drift.game_type}:${drift.difficulty}`
      await this.redis.setex(key, ALERT_STATE_CACHE_TTL, JSON.stringify(state))
    }

    this.logger.info(
      { game_type: drift.game_type, difficulty: drift.difficulty, severity },
      'Drift alert processed'
    )
  }

  async processResolution(drift: DriftPattern): Promise<void> {
    const shouldSendResolution = await this.shouldSendResolution(drift)
    if (!shouldSendResolution) {
      return
    }

    // Prepare resolution payload
    const payload: ResolutionPayload = {
      game_type: drift.game_type,
      difficulty: drift.difficulty,
      current_win_rate: drift.avg_win_rate || 0,
      target_win_rate: drift.win_rate_target || 0,
      drift_percentage: drift.max_drift,
    }

    // Send Slack resolution
    const sent = await this.slackNotifier.sendResolution(payload)

    if (sent) {
      // Clear cache
      const key = `drift:alert:${drift.game_type}:${drift.difficulty}`
      await this.redis.del(key)
    }

    this.logger.info(
      { game_type: drift.game_type, difficulty: drift.difficulty },
      'Drift resolution sent'
    )
  }

  private async getPreviouslyAlertedKeys(): Promise<string[]> {
    try {
      // Scan Redis for all drift:alert:* keys
      const keys: string[] = []
      let cursor = '0'

      do {
        const [newCursor, scannedKeys] = await this.redis.scan(cursor, 'MATCH', 'drift:alert:*', 'COUNT', 100)
        cursor = newCursor
        keys.push(...scannedKeys)
      } while (cursor !== '0')

      return keys.map(key => {
        // Extract game_type:difficulty from drift:alert:game_type:difficulty
        const parts = key.split(':')
        return `${parts[2]}:${parts[3]}`
      })
    } catch (err) {
      this.logger.warn({ err }, 'Failed to scan Redis for alert keys')
      return []
    }
  }
}
