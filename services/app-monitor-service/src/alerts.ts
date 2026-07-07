// Alerting engine: every 2 minutes evaluate health conditions and raise
// alerts into monitor_alerts (shown in the admin AI Control Center) and,
// when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are configured, to Telegram.
// Each condition has a 30-minute Redis cooldown so a sustained outage
// produces one alert, not one every sweep.
import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'
import { execSync } from 'child_process'
import { MonitorIngestor } from './monitor-ingestor'

const SWEEP_MS = 2 * 60 * 1000
const COOLDOWN_SEC = 30 * 60

// Processes that must be online; anything else down is still reported, but
// these are marked critical.
const CRITICAL_PROCESSES = new Set([
  'teen-core-api', 'teen-wallet', 'teen-gateway', 'teen-tp-engine', 'teen-admin-svc',
])

export class AlertEngine {
  constructor(
    private db: Pool,
    private redis: Redis,
    private ingestor: MonitorIngestor,
    private logger: Logger,
  ) {}

  start(): void {
    setInterval(() => {
      this.sweep().catch(err => this.logger.error({ err }, 'alert sweep failed'))
    }, SWEEP_MS)
    this.logger.info('alert engine started (sweep=2m, cooldown=30m)')
  }

  private async sweep(): Promise<void> {
    await this.checkProcesses()
    await this.checkAppErrors()
  }

  private async checkProcesses(): Promise<void> {
    let list: any[] = []
    try {
      list = JSON.parse(execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString())
    } catch { return /* pm2 unavailable (dev) */ }
    for (const p of list) {
      const status = p.pm2_env?.status ?? 'unknown'
      if (status === 'online') continue
      const critical = CRITICAL_PROCESSES.has(p.name)
      await this.raise(
        'service_down',
        critical ? 'critical' : 'warning',
        `Service ${p.name} is ${status}`,
        { process: p.name, status, restarts: p.pm2_env?.restart_time ?? 0 },
        `service_down:${p.name}`,
      )
    }
  }

  private async checkAppErrors(): Promise<void> {
    const stats = await this.ingestor.getStats()
    if (stats.api_error_rate_pct > 20 && stats.errors_last_5min >= 5) {
      await this.raise(
        'api_error_rate',
        'critical',
        `API error rate at ${stats.api_error_rate_pct}% (${stats.errors_last_5min} errors in 5 min)`,
        { ...stats },
        'api_error_rate',
      )
    } else if (stats.errors_last_5min >= 10) {
      await this.raise(
        'error_spike',
        'warning',
        `${stats.errors_last_5min} app errors in the last 5 minutes`,
        { ...stats },
        'error_spike',
      )
    }
  }

  private async raise(
    kind: string, severity: string, message: string,
    details: Record<string, unknown>, cooldownKey: string,
  ): Promise<void> {
    const ok = await this.redis.set(`alert:cooldown:${cooldownKey}`, '1', 'EX', COOLDOWN_SEC, 'NX')
    if (!ok) return // already alerted recently
    this.logger.warn({ kind, severity, message }, 'ALERT raised')
    await this.db.query(
      `INSERT INTO monitor_alerts (kind, severity, message, details) VALUES ($1, $2, $3, $4)`,
      [kind, severity, message, JSON.stringify(details)]
    )
    await this.sendTelegram(severity, message)
  }

  private async sendTelegram(severity: string, message: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!token || !chatId) return // not configured — panel-only alerts
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${severity === 'critical' ? '🔴' : '🟠'} MyOnlineJoker: ${message}`,
        }),
      })
    } catch (err) {
      this.logger.error({ err }, 'telegram send failed')
    }
  }
}
