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
    const names = new Set(list.map((p: any) => p.name))
    // Auto-resolve: a service that is online again acknowledges its own
    // open service alerts, so the panel banner clears without manual clicks.
    const online = list.filter((p: any) => p.pm2_env?.status === 'online').map((p: any) => p.name)
    if (online.length) {
      try {
        await this.db.query(
          `UPDATE monitor_alerts SET acknowledged = TRUE
           WHERE acknowledged = FALSE
             AND kind IN ('service_down', 'remediation_failed', 'remediation_exhausted')
             AND details->>'process' = ANY($1)`,
          [online]
        )
      } catch (err) {
        this.logger.error({ err }, 'alert auto-resolve failed')
      }
    }
    // Critical process missing from pm2 entirely (e.g. dropped by a restart
    // from a stale ecosystem config — this is how tp-engine vanished).
    for (const name of CRITICAL_PROCESSES) {
      if (name !== 'teen-app-monitor' && !names.has(name)) {
        await this.remediate(name, 'start')
      }
    }
    for (const p of list) {
      const status = p.pm2_env?.status ?? 'unknown'
      if (status === 'online') continue
      if (p.name === 'teen-app-monitor') continue // can't restart ourselves
      await this.remediate(p.name, 'restart')
    }
  }

  // Level-1 self-healing: restart/start a downed pm2 process, verify it came
  // back, and log the action. Strikes cap at 3 per hour so a crash-looping
  // service escalates to a critical alert instead of restarting forever.
  private async remediate(name: string, mode: 'start' | 'restart'): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return // pm2 names only — never shell metachars
    const strikeKey = `remediate:strikes:${name}`
    const strikes = await this.redis.incr(strikeKey)
    if (strikes === 1) await this.redis.expire(strikeKey, 3600)
    if (strikes > 3) {
      await this.raise(
        'remediation_exhausted', 'critical',
        `Service ${name} keeps going down (${strikes - 1} auto-fixes in the last hour) — manual intervention needed`,
        { process: name }, `remediation_exhausted:${name}`,
      )
      return
    }

    // NO --update-env, and a minimal env for the pm2 CLI: otherwise the
    // restarted service inherits THIS process's environment (PORT=3015 etc.)
    // and crash-loops on a port conflict — dotenv won't override vars that
    // are already set.
    const cmd = mode === 'start'
      ? `cd /opt/teen && pm2 start ecosystem.config.js --only ${name} && pm2 save`
      : `pm2 restart ${name}`
    const cleanEnv = { PATH: process.env.PATH!, HOME: process.env.HOME || '/root', PM2_HOME: process.env.PM2_HOME || '/root/.pm2' }
    let ok = false
    let error = ''
    try {
      execSync(cmd, { timeout: 60000, env: cleanEnv })
      await new Promise(r => setTimeout(r, 8000))
      const after: any[] = JSON.parse(execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString())
      ok = after.some(p => p.name === name && p.pm2_env?.status === 'online')
    } catch (e: any) {
      error = e?.message ?? String(e)
    }

    try {
      await this.db.query(
        `INSERT INTO remediation_actions (target, action, result, details) VALUES ($1, $2, $3, $4)`,
        [name, mode, ok ? 'fixed' : 'failed', JSON.stringify({ strikes, ...(error ? { error } : {}) })]
      )
    } catch (err) {
      this.logger.error({ err }, 'failed to log remediation')
    }

    if (ok) {
      // Strikes intentionally NOT reset — a crash-loop that "fixes" then dies
      // again must still hit the 3-strike escalation within the hour.
      this.logger.warn({ name, mode }, 'AUTO-FIX succeeded')
      await this.sendTelegram('warning', `Auto-fixed: ${name} was down — ${mode} succeeded`)
    } else {
      await this.raise(
        'remediation_failed', 'critical',
        `Auto-${mode} of ${name} FAILED — manual intervention needed`,
        { process: name, error }, `remediation_failed:${name}`,
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
