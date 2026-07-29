import { Pool, QueryResult } from 'pg'
import pino from 'pino'

export interface AnomalyRecord {
  id: string
  player_id: string
  anomaly_type: string
  confidence: number
  anomaly_score: number
  feature_zscore: number
  status: string
  created_at: Date
}

export interface PauseResponse {
  player_id: string
  anomaly_id: string
  paused: boolean
  ticket_id?: string
  slack_sent: boolean
  error?: string
}

export interface ResponseHandlerStats {
  total_anomalies_processed: number
  players_paused: number
  support_tickets_created: number
  slack_alerts_sent: number
  errors: number
  timestamp: Date
}

const CONFIDENCE_THRESHOLD = 0.7
const SLACK_FRAUD_CHANNEL = '#game-fraud-alerts'
const ADMIN_DASHBOARD_URL = process.env.ADMIN_DASHBOARD_URL || 'https://admin.teen-patti-live.com'

export class AnomalyResponseHandler {
  constructor(
    private pool: Pool,
    private logger: pino.Logger,
    private slackWebhookUrl: string = process.env.SLACK_WEBHOOK_URL || ''
  ) {}

  /**
   * Main handler to process new anomalies and take response actions
   */
  async processAnomalies(): Promise<ResponseHandlerStats> {
    const startTime = Date.now()
    const stats: ResponseHandlerStats = {
      total_anomalies_processed: 0,
      players_paused: 0,
      support_tickets_created: 0,
      slack_alerts_sent: 0,
      errors: 0,
      timestamp: new Date(),
    }

    const client = await this.pool.connect()

    try {
      // Start transaction
      await client.query('BEGIN')

      // Query for new anomalies with confidence > threshold
      const anomalies = await this.getNewAnomalies(client, CONFIDENCE_THRESHOLD)
      stats.total_anomalies_processed = anomalies.length

      if (anomalies.length === 0) {
        this.logger.info('No high-confidence anomalies to process')
        await client.query('COMMIT')
        return stats
      }

      this.logger.info({ count: anomalies.length }, 'Processing anomalies')

      // Process each anomaly
      for (const anomaly of anomalies) {
        try {
          // 1. Pause player
          const paused = await this.pausePlayer(client, anomaly.player_id)
          if (paused) {
            stats.players_paused++
            // Log pause action
            await this.logAnomalyResponse(client, anomaly.id, anomaly.player_id, 'paused', {
              paused_at: new Date().toISOString(),
              confidence: anomaly.confidence,
            })
          }

          // 2. Create support ticket
          const ticketId = await this.createSupportTicket(
            client,
            anomaly.player_id,
            anomaly.anomaly_type,
            anomaly.confidence
          )
          if (ticketId) {
            stats.support_tickets_created++
            // Update anomaly with ticket ID
            await client.query(
              'UPDATE player_anomalies SET support_ticket_id = $1 WHERE id = $2',
              [ticketId, anomaly.id]
            )
            // Log ticket creation
            await this.logAnomalyResponse(client, anomaly.id, anomaly.player_id, 'ticket_created', {
              ticket_id: ticketId,
            })
          }

          // 3. Send Slack alert
          const slackSent = await this.sendSlackAlert(anomaly, ticketId)
          if (slackSent) {
            stats.slack_alerts_sent++
            // Log Slack alert
            await this.logAnomalyResponse(client, anomaly.id, anomaly.player_id, 'alert_sent', {
              channel: SLACK_FRAUD_CHANNEL,
            })
          }

          // 4. Update anomaly status to 'responded'
          await client.query(
            'UPDATE player_anomalies SET status = $1, player_paused_at = NOW(), updated_at = NOW() WHERE id = $2',
            ['responded', anomaly.id]
          )
        } catch (err) {
          stats.errors++
          this.logger.error({ err, anomaly_id: anomaly.id, player_id: anomaly.player_id }, 'Failed to process anomaly')
        }
      }

      await client.query('COMMIT')

      const elapsed = Date.now() - startTime
      this.logger.info(
        { ...stats, elapsed_ms: elapsed },
        'Anomaly response processing completed'
      )

      return stats
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error({ err }, 'Anomaly response processing failed')
      stats.errors++
      return stats
    } finally {
      client.release()
    }
  }

  /**
   * Query for new anomalies with confidence > threshold
   */
  private async getNewAnomalies(client: any, threshold: number): Promise<AnomalyRecord[]> {
    const query = `
      SELECT
        id,
        player_id,
        anomaly_type,
        confidence,
        anomaly_score,
        feature_zscore,
        status,
        created_at
      FROM player_anomalies
      WHERE status = 'new' AND confidence > $1
      ORDER BY confidence DESC, created_at ASC
      LIMIT 100
    `

    const result = await client.query(query, [threshold])
    return result.rows
  }

  /**
   * Pause a player by updating their status
   */
  private async pausePlayer(client: any, playerId: string): Promise<boolean> {
    try {
      const result = await client.query(
        'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2 AND status != $1',
        ['paused_anomaly', playerId]
      )
      return result.rowCount > 0
    } catch (err) {
      this.logger.error({ err, player_id: playerId }, 'Failed to pause player')
      return false
    }
  }

  /**
   * Create a high-priority support ticket
   */
  private async createSupportTicket(
    client: any,
    playerId: string,
    anomalyType: string,
    confidence: number
  ): Promise<string | null> {
    try {
      const subject = `Anomaly Detected: ${anomalyType} (${(confidence * 100).toFixed(1)}%)`
      const category = 'anomaly_detected'

      const result = await client.query(
        `INSERT INTO support_tickets (user_id, subject, category, status, priority, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        [playerId, subject, category, 'open', 'high']
      )

      const ticketId = result.rows[0].id
      this.logger.info({ ticket_id: ticketId, player_id: playerId }, 'Support ticket created')
      return ticketId
    } catch (err) {
      this.logger.error({ err, player_id: playerId }, 'Failed to create support ticket')
      return null
    }
  }

  /**
   * Send Slack alert to fraud channel
   */
  private async sendSlackAlert(anomaly: AnomalyRecord, ticketId?: string | null): Promise<boolean> {
    if (!this.slackWebhookUrl) {
      this.logger.debug('Slack webhook not configured — skipping alert')
      return false
    }

    try {
      const playerLink = `${ADMIN_DASHBOARD_URL}/players/${anomaly.player_id}`
      const anomalyDashboardLink = `${ADMIN_DASHBOARD_URL}/anomalies`

      const message = {
        channel: SLACK_FRAUD_CHANNEL,
        text: `[ANOMALY] ${anomaly.anomaly_type} detected for player ${anomaly.player_id}`,
        attachments: [
          {
            color: '#FF0000', // Red for alerts
            title: `Anomaly Alert: ${anomaly.anomaly_type}`,
            fields: [
              {
                title: 'Player ID',
                value: `<${playerLink}|${anomaly.player_id.substring(0, 8)}>`,
                short: true,
              },
              {
                title: 'Anomaly Type',
                value: anomaly.anomaly_type,
                short: true,
              },
              {
                title: 'Confidence',
                value: `${(anomaly.confidence * 100).toFixed(1)}%`,
                short: true,
              },
              {
                title: 'Action Taken',
                value: 'Player paused',
                short: true,
              },
              {
                title: 'Anomaly Score',
                value: `${anomaly.anomaly_score.toFixed(3)}`,
                short: true,
              },
              {
                title: 'Feature Z-Score',
                value: `${anomaly.feature_zscore.toFixed(2)}σ`,
                short: true,
              },
              {
                title: 'Support Ticket',
                value: ticketId ? `<${ADMIN_DASHBOARD_URL}/tickets/${ticketId}|${ticketId.substring(0, 8)}>` : 'Not created',
                short: true,
              },
              {
                title: 'Detected At',
                value: anomaly.created_at.toISOString(),
                short: true,
              },
            ],
            actions: [
              {
                type: 'button',
                text: 'View Player',
                url: playerLink,
              },
              {
                type: 'button',
                text: 'View Anomalies Dashboard',
                url: anomalyDashboardLink,
              },
              {
                type: 'button',
                text: 'Override Pause',
                url: `${ADMIN_DASHBOARD_URL}/api/admin/override-anomaly-pause/${anomaly.player_id}`,
                style: 'danger',
              },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      }

      const response = await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        this.logger.error(
          { status: response.status, player_id: anomaly.player_id },
          'Failed to send Slack alert'
        )
        return false
      }

      this.logger.info({ player_id: anomaly.player_id, anomaly_type: anomaly.anomaly_type }, 'Slack alert sent')
      return true
    } catch (err) {
      this.logger.error({ err, player_id: anomaly.player_id }, 'Failed to send Slack alert')
      return false
    }
  }

  /**
   * Log anomaly response action to audit table
   */
  private async logAnomalyResponse(
    client: any,
    anomalyId: string,
    playerId: string,
    action: string,
    details?: Record<string, any>
  ): Promise<void> {
    try {
      await client.query(
        `INSERT INTO anomaly_response_log (anomaly_id, player_id, action, details, actor_type, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [anomalyId, playerId, action, JSON.stringify(details || {}), 'system']
      )
    } catch (err) {
      this.logger.error({ err, anomaly_id: anomalyId }, 'Failed to log anomaly response')
    }
  }

  /**
   * Generate daily report of paused players and ticket backlog
   */
  async generateDailyReport(): Promise<Record<string, any>> {
    const client = await this.pool.connect()

    try {
      // Count paused players
      const pausedResult = await client.query(
        `SELECT COUNT(DISTINCT player_id) as count
         FROM player_anomalies
         WHERE status IN ('responded', 'paused')
         AND player_paused_at > NOW() - INTERVAL '24 hours'`
      )
      const pausedCount = pausedResult.rows[0].count

      // Count support tickets
      const ticketsResult = await client.query(
        `SELECT COUNT(*) as count
         FROM support_tickets
         WHERE category = 'anomaly_detected'
         AND status IN ('open', 'in_progress')
         AND created_at > NOW() - INTERVAL '24 hours'`
      )
      const ticketCount = ticketsResult.rows[0].count

      // Count anomalies by type
      const typesResult = await client.query(
        `SELECT anomaly_type, COUNT(*) as count
         FROM player_anomalies
         WHERE status IN ('responded', 'paused', 'new')
         AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY anomaly_type
         ORDER BY count DESC`
      )

      const report = {
        timestamp: new Date().toISOString(),
        period: 'last_24_hours',
        players_paused: pausedCount,
        support_tickets_backlog: ticketCount,
        anomalies_by_type: typesResult.rows.reduce((acc: any, row: any) => {
          acc[row.anomaly_type] = row.count
          return acc
        }, {}),
      }

      this.logger.info({ report }, 'Daily anomaly response report')
      return report
    } catch (err) {
      this.logger.error({ err }, 'Failed to generate daily report')
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Handle admin override of anomaly pause
   */
  async handleAdminOverride(
    playerId: string,
    anomalyId: string,
    adminId: string,
    reason: string
  ): Promise<boolean> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Update player status back to active
      await client.query(
        'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2',
        ['active', playerId]
      )

      // 2. Update anomaly status to overridden
      await client.query(
        `UPDATE player_anomalies
         SET status = $1, admin_override_at = NOW(), override_by = $2, override_reason = $3, updated_at = NOW()
         WHERE id = $4`,
        ['overridden', adminId, reason, anomalyId]
      )

      // 3. Create admin override audit record
      await client.query(
        `INSERT INTO admin_anomaly_overrides (anomaly_id, player_id, override_reason, overridden_by, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [anomalyId, playerId, reason, adminId]
      )

      // 4. Log the override action
      await this.logAnomalyResponse(client, anomalyId, playerId, 'override_approved', {
        admin_id: adminId,
        reason,
      })

      await client.query('COMMIT')

      this.logger.info({ player_id: playerId, anomaly_id: anomalyId, admin_id: adminId }, 'Admin override applied')
      return true
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error({ err, player_id: playerId }, 'Failed to apply admin override')
      return false
    } finally {
      client.release()
    }
  }

  /**
   * Dismiss an anomaly without taking action (admin action)
   */
  async dismissAnomaly(anomalyId: string, adminId: string, reason: string): Promise<boolean> {
    const client = await this.pool.connect()

    try {
      await client.query(
        `UPDATE player_anomalies
         SET status = $1, dismissed_at = NOW(), dismissed_by = $2, dismissal_reason = $3, updated_at = NOW()
         WHERE id = $4`,
        ['dismissed', adminId, reason, anomalyId]
      )

      this.logger.info({ anomaly_id: anomalyId, admin_id: adminId }, 'Anomaly dismissed')
      return true
    } catch (err) {
      this.logger.error({ err, anomaly_id: anomalyId }, 'Failed to dismiss anomaly')
      return false
    } finally {
      client.release()
    }
  }

  /**
   * Check for duplicate pauses to prevent multiple pauses for same player
   */
  async hasPendingPause(playerId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count
         FROM player_anomalies
         WHERE player_id = $1
         AND status IN ('new', 'responded', 'paused')
         AND player_paused_at IS NOT NULL
         AND player_paused_at > NOW() - INTERVAL '1 hour'`,
        [playerId]
      )
      return result.rows[0].count > 0
    } catch (err) {
      this.logger.error({ err, player_id: playerId }, 'Failed to check pending pause')
      return false
    }
  }
}
