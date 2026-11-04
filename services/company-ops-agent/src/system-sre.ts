import { execSync } from 'child_process'
import os from 'os'
import { Pool } from 'pg'
import Redis from 'ioredis'
import { ProcessStatus, SystemMetrics } from './types'

export class SystemSre {
  private restartStrikes: Map<string, { count: number; firstStrike: number }> = new Map()

  constructor(
    private db: Pool,
    private redis: Redis
  ) {}

  public async getSystemMetrics(): Promise<SystemMetrics> {
    // 1. Memory stats
    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024))
    const freeMemMb = Math.round(os.freemem() / (1024 * 1024))
    const memUsedPct = Math.round(((totalMemMb - freeMemMb) / totalMemMb) * 100)

    // 2. Disk stats (Linux /opt or root)
    let diskFreeGb = 10
    let diskUsedPct = 50
    try {
      const dfOut = execSync('df -k / 2>/dev/null | tail -1', { timeout: 3000 }).toString()
      const parts = dfOut.trim().split(/\s+/)
      if (parts.length >= 5) {
        const totalKb = parseInt(parts[1], 10)
        const availKb = parseInt(parts[3], 10)
        diskFreeGb = Math.round((availKb / (1024 * 1024)) * 10) / 10
        diskUsedPct = Math.round(((totalKb - availKb) / totalKb) * 100)
      }
    } catch {
      // Windows dev fallback
    }

    // 3. PostgreSQL Latency
    let dbConnected = false
    let dbLatencyMs = 0
    try {
      const t0 = Date.now()
      await this.db.query('SELECT 1')
      dbLatencyMs = Date.now() - t0
      dbConnected = true
    } catch {
      dbConnected = false
    }

    // 4. Redis Latency
    let redisConnected = false
    let redisLatencyMs = 0
    try {
      const t0 = Date.now()
      await this.redis.ping()
      redisLatencyMs = Date.now() - t0
      redisConnected = true
    } catch {
      redisConnected = false
    }

    // 5. PM2 Process List
    const processes: ProcessStatus[] = []
    let erroredCount = 0

    try {
      const raw = execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString()
      const list = JSON.parse(raw)
      for (const p of list) {
        const memBytes = p.monit?.memory || 0
        const cpuPct = p.monit?.cpu || 0
        const status = p.pm2_env?.status || 'unknown'
        const restarts = p.pm2_env?.restart_time || 0
        const uptimeSec = p.pm2_env?.pm_uptime ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000) : 0

        if (status === 'errored') {
          erroredCount++
        }

        processes.push({
          name: p.name,
          status,
          cpu: cpuPct,
          memoryMb: Math.round(memBytes / (1024 * 1024)),
          restarts,
          uptimeSec
        })
      }
    } catch {
      // pm2 not running or in dev mode
    }

    return {
      totalMemMb,
      freeMemMb,
      memUsedPct,
      diskFreeGb,
      diskUsedPct,
      dbConnected,
      dbLatencyMs,
      redisConnected,
      redisLatencyMs,
      processes,
      erroredCount
    }
  }

  public async checkAndHeal(autoHeal = true): Promise<string[]> {
    const actionsTaken: string[] = []
    const metrics = await this.getSystemMetrics()

    // Disk space cleanup if > 88%
    if (metrics.diskUsedPct > 88) {
      try {
        execSync('pm2 flush 2>/dev/null', { timeout: 10000 })
        actionsTaken.push(`🧹 High disk usage (${metrics.diskUsedPct}%) - Flushed PM2 log files`)
      } catch (err: any) {
        actionsTaken.push(`❌ Failed to flush logs: ${err.message}`)
      }
    }

    if (!autoHeal) return actionsTaken

    // Scan for errored processes
    for (const proc of metrics.processes) {
      if (proc.status === 'errored' && proc.name !== 'teen-company-ops') {
        const healed = await this.restartService(proc.name)
        if (healed.success) {
          actionsTaken.push(`🔄 Auto-healed: Restarted crashed service [${proc.name}]`)
        } else {
          actionsTaken.push(`⚠️ Auto-heal alert: [${proc.name}] - ${healed.message}`)
        }
      }
    }

    return actionsTaken
  }

  public async restartService(name: string): Promise<{ success: boolean; message: string }> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return { success: false, message: 'Invalid service name format' }
    }

    const now = Date.now()
    const strike = this.restartStrikes.get(name) || { count: 0, firstStrike: now }

    // Reset strike window if older than 1 hour
    if (now - strike.firstStrike > 3600 * 1000) {
      strike.count = 0
      strike.firstStrike = now
    }

    strike.count++
    this.restartStrikes.set(name, strike)

    if (strike.count > 4) {
      return {
        success: false,
        message: `Strike limit exceeded (${strike.count} in 1h). Service is crash-looping. Manual review required.`
      }
    }

    try {
      execSync(`pm2 restart ${name} 2>/dev/null`, { timeout: 25000 })
      return { success: true, message: `Service ${name} successfully restarted.` }
    } catch (err: any) {
      return { success: false, message: `Failed to restart: ${err.message}` }
    }
  }

  public flushLogs(): { success: boolean; message: string } {
    try {
      execSync('pm2 flush 2>/dev/null', { timeout: 10000 })
      return { success: true, message: 'All PM2 logs flushed and truncated.' }
    } catch (err: any) {
      return { success: false, message: `Flush failed: ${err.message}` }
    }
  }
}
