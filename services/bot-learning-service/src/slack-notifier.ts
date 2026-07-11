import pino from 'pino'

export interface AlertPayload {
  game_type: string
  difficulty: string
  severity: 'RED' | 'YELLOW' | 'GREEN'
  current_win_rate: number
  target_win_rate: number
  drift_percentage: number
  consecutive_hours: number
  dashboardLink: string
}

export interface ResolutionPayload {
  game_type: string
  difficulty: string
  current_win_rate: number
  target_win_rate: number
  drift_percentage: number
}

export class SlackNotifier {
  private webhookUrl: string
  private channel: string
  private resolutionChannel: string

  constructor(
    private logger: pino.Logger
  ) {
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL || ''
    this.channel = process.env.SLACK_DRIFT_ALERT_CHANNEL || '#game-fairness-alerts'
    this.resolutionChannel = process.env.SLACK_DRIFT_RESOLUTION_CHANNEL || '#game-fairness-all'

    if (!this.webhookUrl) {
      this.logger.warn('SLACK_WEBHOOK_URL not configured — Slack notifications disabled')
    }
  }

  async sendAlert(payload: AlertPayload): Promise<boolean> {
    if (!this.webhookUrl) {
      this.logger.debug('Slack webhook not configured — skipping alert')
      return false
    }

    try {
      const color = this.getSeverityColor(payload.severity)
      const emoji = this.getSeverityEmoji(payload.severity)

      const message = {
        channel: this.channel,
        text: `${emoji} [ALERT] ${payload.severity} drift in ${payload.game_type}/${payload.difficulty}`,
        attachments: [
          {
            color,
            title: `Drift Alert: ${payload.game_type.toUpperCase()} - ${payload.difficulty.toUpperCase()}`,
            fields: [
              {
                title: 'Current Win Rate',
                value: `${(payload.current_win_rate * 100).toFixed(2)}%`,
                short: true,
              },
              {
                title: 'Target Win Rate',
                value: `${(payload.target_win_rate * 100).toFixed(2)}%`,
                short: true,
              },
              {
                title: 'Drift',
                value: `${payload.drift_percentage > 0 ? '+' : ''}${(payload.drift_percentage * 100).toFixed(2)}%`,
                short: true,
              },
              {
                title: 'Severity',
                value: payload.severity,
                short: true,
              },
              {
                title: 'Consecutive Hours',
                value: `${payload.consecutive_hours}h+`,
                short: true,
              },
              {
                title: 'Status',
                value: 'ACTIVE',
                short: true,
              },
            ],
            actions: [
              {
                type: 'button',
                text: 'View Dashboard',
                url: payload.dashboardLink,
              },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      }

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        this.logger.error({ status: response.status, statusText: response.statusText }, 'Failed to send Slack alert')
        return false
      }

      this.logger.info(
        { game_type: payload.game_type, difficulty: payload.difficulty, severity: payload.severity },
        'Slack alert sent'
      )
      return true
    } catch (err) {
      this.logger.error({ err }, 'Failed to send Slack alert')
      return false
    }
  }

  async sendResolution(payload: ResolutionPayload): Promise<boolean> {
    if (!this.webhookUrl) {
      this.logger.debug('Slack webhook not configured — skipping resolution')
      return false
    }

    try {
      const message = {
        channel: this.resolutionChannel,
        text: `✅ [RESOLVED] Drift cleared in ${payload.game_type}/${payload.difficulty}`,
        attachments: [
          {
            color: '#36a64f',
            title: `Drift Resolved: ${payload.game_type.toUpperCase()} - ${payload.difficulty.toUpperCase()}`,
            fields: [
              {
                title: 'Current Win Rate',
                value: `${(payload.current_win_rate * 100).toFixed(2)}%`,
                short: true,
              },
              {
                title: 'Target Win Rate',
                value: `${(payload.target_win_rate * 100).toFixed(2)}%`,
                short: true,
              },
              {
                title: 'Drift',
                value: `${payload.drift_percentage > 0 ? '+' : ''}${(payload.drift_percentage * 100).toFixed(2)}%`,
                short: true,
              },
              {
                title: 'Status',
                value: 'RESOLVED',
                short: true,
              },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      }

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        this.logger.error({ status: response.status, statusText: response.statusText }, 'Failed to send Slack resolution')
        return false
      }

      this.logger.info(
        { game_type: payload.game_type, difficulty: payload.difficulty },
        'Slack resolution sent'
      )
      return true
    } catch (err) {
      this.logger.error({ err }, 'Failed to send Slack resolution')
      return false
    }
  }

  private getSeverityColor(severity: 'RED' | 'YELLOW' | 'GREEN'): string {
    switch (severity) {
      case 'RED':
        return '#FF0000'
      case 'YELLOW':
        return '#FFA500'
      case 'GREEN':
        return '#36a64f'
      default:
        return '#808080'
    }
  }

  private getSeverityEmoji(severity: 'RED' | 'YELLOW' | 'GREEN'): string {
    switch (severity) {
      case 'RED':
        return '🔴'
      case 'YELLOW':
        return '🟡'
      case 'GREEN':
        return '🟢'
      default:
        return '⚪'
    }
  }
}
