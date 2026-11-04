import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import os from 'os'
import http from 'http'
import https from 'https'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const MASTER_PIN = process.env.SERVER_MASTER_PIN || process.env.ADMIN_MASTER_PIN || '9849'

// Helper to measure HTTP ping latency
function pingHttp(url: string, timeoutMs: number = 2500): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const isHttps = url.startsWith('https')
    const client = isHttps ? https : http

    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      const latencyMs = Date.now() - start
      res.resume() // consume stream
      resolve({ ok: res.statusCode !== undefined && res.statusCode < 500, status: res.statusCode || 0, latencyMs })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 504, latencyMs: Date.now() - start, error: 'Request Timeout' })
    })

    req.on('error', (err) => {
      resolve({ ok: false, status: 503, latencyMs: Date.now() - start, error: err.message })
    })
  })
}

export async function registerServerDashboardRoutes(
  app: FastifyInstance,
  redis: Redis,
  db: Pool,
  authenticate: any,
  requireRole: any
) {
  // 1. Overview & System Telemetry
  app.get('/api/server/overview', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const load = os.loadavg()
      const cores = os.cpus().length || 1
      const cpuUsage = Math.min(Math.round((load[0] / cores) * 100), 100)

      let diskUsage: any[] = []
      try {
        const { stdout } = await execAsync('df -h', { timeout: 3000 })
        const lines = stdout.trim().split('\n')
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(/\s+/)
          if (parts.length >= 6) {
            diskUsage.push({
              filesystem: parts[0],
              size: parts[1],
              used: parts[2],
              avail: parts[3],
              percent: parts[4],
              mounted: parts[5]
            })
          }
        }
      } catch (err: any) {
        app.log.warn(`df -h error: ${err.message}`)
      }

      // Memory metrics
      let ramDetails = {
        total: Math.round(os.totalmem() / 1024 / 1024),
        free: Math.round(os.freemem() / 1024 / 1024),
        used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
        buffCache: 0,
        available: Math.round(os.freemem() / 1024 / 1024)
      }

      try {
        const { stdout } = await execAsync('free -m', { timeout: 3000 })
        const memLine = stdout.trim().split('\n').find(l => l.startsWith('Mem:'))
        if (memLine) {
          const parts = memLine.split(/\s+/)
          if (parts.length >= 7) {
            ramDetails = {
              total: parseInt(parts[1], 10),
              used: parseInt(parts[2], 10),
              free: parseInt(parts[3], 10),
              buffCache: parseInt(parts[5], 10),
              available: parseInt(parts[6], 10)
            }
          }
        }
      } catch {}

      // Count PM2 & Docker quick summary
      let pm2Summary = { total: 0, online: 0, errored: 0, stopped: 0 }
      try {
        const { stdout } = await execAsync('pm2 jlist 2>/dev/null', { timeout: 4000 })
        if (stdout && stdout.trim()) {
          const list = JSON.parse(stdout)
          pm2Summary.total = list.length
          for (const p of list) {
            const st = p.pm2_env?.status
            if (st === 'online') pm2Summary.online++
            else if (st === 'errored' || st === 'error') pm2Summary.errored++
            else pm2Summary.stopped++
          }
        }
      } catch {}

      let dockerCount = 0
      try {
        const { stdout } = await execAsync('sudo docker ps -q 2>/dev/null | wc -l', { timeout: 3000 })
        dockerCount = parseInt(stdout.trim(), 10) || 0
      } catch {}

      // Network connection count
      let networkSocketsCount = 0
      try {
        const { stdout } = await execAsync('ss -tulwn 2>/dev/null | wc -l', { timeout: 3000 })
        networkSocketsCount = Math.max(0, parseInt(stdout.trim(), 10) - 1)
      } catch {}

      return reply.send({
        success: true,
        data: {
          host: {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            nodeVersion: process.version,
            uptimeSeconds: os.uptime()
          },
          cpu: {
            usage: cpuUsage,
            loadAvg: [
              Math.round(load[0] * 100) / 100,
              Math.round(load[1] * 100) / 100,
              Math.round(load[2] * 100) / 100
            ],
            cores
          },
          memory: ramDetails,
          disk: diskUsage,
          pm2: pm2Summary,
          docker: { runningCount: dockerCount },
          networkSocketsCount,
          checkedAt: new Date().toISOString()
        }
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // 2. PM2 Process List
  app.get('/api/server/pm2/list', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const { stdout } = await execAsync('pm2 jlist 2>/dev/null', { timeout: 6000 })
      if (!stdout || !stdout.trim()) {
        return reply.send({ success: true, data: [] })
      }

      const rawList = JSON.parse(stdout)
      const formatted = rawList.map((p: any) => ({
        pm_id: p.pm_id,
        name: p.name,
        status: p.pm2_env?.status ?? 'unknown',
        cpu: p.monit?.cpu ?? 0,
        memory_bytes: p.monit?.memory ?? 0,
        memory_mb: Math.round((p.monit?.memory ?? 0) / 1024 / 1024),
        restarts: p.pm2_env?.restart_time ?? 0,
        unstable_restarts: p.pm2_env?.unstable_restarts ?? 0,
        uptime_ms: p.pm2_env?.pm_uptime ? (Date.now() - p.pm2_env.pm_uptime) : 0,
        pid: p.pid ?? null,
        mode: p.pm2_env?.exec_mode ?? 'fork',
        version: p.pm2_env?.version ?? '1.0.0',
        user: p.pm2_env?.username ?? 'root',
        created_at: p.pm2_env?.created_at ?? null
      }))

      return reply.send({ success: true, data: formatted })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // 3. PM2 Process Action (start/stop/restart/reload)
  app.post<{ Body: { action: 'restart' | 'stop' | 'start' | 'reload'; target: string; pin?: string } }>(
    '/api/server/pm2/action',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const { action, target, pin } = req.body || {}
      if (!['restart', 'stop', 'start', 'reload'].includes(action)) {
        return reply.code(400).send({ success: false, error: 'Invalid PM2 action' })
      }

      // Safe alphanumeric validation
      const sanitized = (target || '').trim()
      if (!sanitized || !/^[a-zA-Z0-9_\-\.]+$/.test(sanitized)) {
        return reply.code(400).send({ success: false, error: 'Invalid target process identifier' })
      }

      // Stop, or touching core critical services / all requires Master PIN
      const isSensitive = action === 'stop' || sanitized === 'all' || ['teen-core-api', 'teen-wallet', 'teen-admin-svc'].includes(sanitized)
      if (isSensitive) {
        if (!pin || pin !== MASTER_PIN) {
          return reply.code(403).send({ success: false, error: 'Master PIN verification required for sensitive process action', pin_required: true })
        }
      }

      try {
        const cmd = sanitized === 'all' ? `pm2 ${action} all` : `pm2 ${action} ${sanitized}`
        const { stdout, stderr } = await execAsync(cmd, { timeout: 15000 })
        return reply.send({
          success: true,
          message: `PM2 ${action} executed on ${sanitized}`,
          output: stdout || stderr
        })
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message })
      }
    }
  )

  // 4. PM2 Process Logs
  app.get<{ Params: { name: string }; Querystring: { lines?: string } }>(
    '/api/server/pm2/logs/:name',
    { onRequest: [authenticate] },
    async (req, reply) => {
      const name = req.params.name
      if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
        return reply.code(400).send({ success: false, error: 'Invalid process name' })
      }

      const numLines = Math.min(Math.max(parseInt(req.query.lines || '100', 10), 10), 500)

      try {
        const { stdout, stderr } = await execAsync(`pm2 logs ${name} --lines ${numLines} --nostream 2>/dev/null`, {
          timeout: 6000,
          maxBuffer: 1024 * 1024
        })
        return reply.send({ success: true, logs: stdout || stderr || 'No log entries found.' })
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message })
      }
    }
  )

  // 5. Docker Containers List
  app.get('/api/server/docker/list', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const { stdout } = await execAsync(
        'sudo docker ps -a --format "{{.ID}}~{{.Names}}~{{.Image}}~{{.Status}}~{{.State}}~{{.Ports}}~{{.CreatedAt}}"',
        { timeout: 5000 }
      )

      if (!stdout || !stdout.trim()) {
        return reply.send({ success: true, data: [] })
      }

      const containers = stdout.trim().split('\n').map((line: string) => {
        const [id, name, image, status, state, ports, createdAt] = line.split('~')
        return {
          id: id || '',
          name: name || '',
          image: image || '',
          status: status || '',
          state: state || 'unknown',
          ports: ports || '',
          createdAt: createdAt || '',
          healthy: status?.includes('(healthy)') ? 'healthy' : status?.includes('(unhealthy)') ? 'unhealthy' : 'standard'
        }
      })

      return reply.send({ success: true, data: containers })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // 6. Docker Container Action
  app.post<{ Body: { action: 'restart' | 'stop' | 'start'; container: string; pin: string } }>(
    '/api/server/docker/action',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const { action, container, pin } = req.body || {}
      if (!['restart', 'stop', 'start'].includes(action)) {
        return reply.code(400).send({ success: false, error: 'Invalid Docker action' })
      }

      if (!pin || pin !== MASTER_PIN) {
        return reply.code(403).send({ success: false, error: 'Master PIN verification required for Docker actions', pin_required: true })
      }

      const sanitized = (container || '').trim()
      if (!/^[a-zA-Z0-9_\-\.]+$/.test(sanitized)) {
        return reply.code(400).send({ success: false, error: 'Invalid container name' })
      }

      try {
        const { stdout } = await execAsync(`sudo docker ${action} ${sanitized}`, { timeout: 20000 })
        return reply.send({
          success: true,
          message: `Docker container ${sanitized} ${action} completed`,
          output: stdout
        })
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message })
      }
    }
  )

  // 7. Docker Container Logs
  app.get<{ Params: { name: string }; Querystring: { lines?: string } }>(
    '/api/server/docker/logs/:name',
    { onRequest: [authenticate] },
    async (req, reply) => {
      const name = req.params.name
      if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
        return reply.code(400).send({ success: false, error: 'Invalid container name' })
      }

      const numLines = Math.min(Math.max(parseInt(req.query.lines || '100', 10), 10), 500)

      try {
        const { stdout, stderr } = await execAsync(`sudo docker logs --tail ${numLines} ${name} 2>&1`, {
          timeout: 6000,
          maxBuffer: 1024 * 1024
        })
        return reply.send({ success: true, logs: stdout || stderr || 'No log entries found.' })
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message })
      }
    }
  )

  // 8. Service & Gateway Connection Latency Matrix
  app.get('/api/server/connections/matrix', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const targets = [
        { id: 'core-api', name: 'Core API Service', port: 3001, url: 'http://127.0.0.1:3001/health', type: 'api' },
        { id: 'wallet', name: 'Wallet Service', port: 3003, url: 'http://127.0.0.1:3003/health', type: 'api' },
        { id: 'gateway-1', name: 'Game Gateway #1', port: 3004, url: 'http://127.0.0.1:3004/health', type: 'gateway' },
        { id: 'gateway-2', name: 'Game Gateway #2', port: 3021, url: 'http://127.0.0.1:3021/health', type: 'gateway' },
        { id: 'gateway-3', name: 'Game Gateway #3', port: 3022, url: 'http://127.0.0.1:3022/health', type: 'gateway' },
        { id: 'admin', name: 'Admin Control Service', port: 3008, url: 'http://127.0.0.1:3008/health', type: 'admin' },
        { id: 'rummy', name: 'Rummy Engine', port: 3009, url: 'http://127.0.0.1:3009/health', type: 'engine' },
        { id: 'teen-patti', name: 'Teen Patti Engine (Go)', port: 3010, url: 'http://127.0.0.1:3010/health', type: 'engine' },
        { id: 'ludo', name: 'Ludo Engine', port: 3011, url: 'http://127.0.0.1:3011/health', type: 'engine' },
        { id: 'aviator', name: 'Aviator Engine', port: 3005, url: 'http://127.0.0.1:3005/health', type: 'engine' },
        { id: 'app-monitor', name: 'App Monitor & Telemetry', port: 3015, url: 'http://127.0.0.1:3015/health', type: 'service' },
        { id: 'risk-service', name: 'Risk & Fraud Shield', port: 3006, url: 'http://127.0.0.1:3006/health', type: 'service' },
        { id: 'public-gateway', name: 'Public Nginx Gateway', port: 443, url: 'https://game.myonlinejoker.com/health', type: 'public' }
      ]

      // Concurrent HTTP ping checks
      const httpChecks = await Promise.all(
        targets.map(async (t) => {
          const res = await pingHttp(t.url, 2000)
          return {
            id: t.id,
            name: t.name,
            port: t.port,
            type: t.type,
            latencyMs: res.latencyMs,
            status: res.ok ? 'ONLINE' : 'OFFLINE',
            httpCode: res.status,
            error: res.error || null
          }
        })
      )

      // Database ping
      let dbCheck: any = { id: 'postgres', name: 'PostgreSQL Database', port: 5432, type: 'database', status: 'OFFLINE', latencyMs: 0 }
      const dbStart = Date.now()
      try {
        await db.query('SELECT 1')
        dbCheck = { id: 'postgres', name: 'PostgreSQL Database', port: 5432, type: 'database', status: 'ONLINE', latencyMs: Date.now() - dbStart, httpCode: 200 }
      } catch (err: any) {
        dbCheck.error = err.message
      }

      // Redis ping
      let redisCheck: any = { id: 'redis', name: 'Redis Cache & Pub/Sub', port: 6379, type: 'database', status: 'OFFLINE', latencyMs: 0 }
      const redisStart = Date.now()
      try {
        const pong = await redis.ping()
        redisCheck = { id: 'redis', name: 'Redis Cache & Pub/Sub', port: 6379, type: 'database', status: pong === 'PONG' ? 'ONLINE' : 'DEGRADED', latencyMs: Date.now() - redisStart, httpCode: 200 }
      } catch (err: any) {
        redisCheck.error = err.message
      }

      const results = [...httpChecks, dbCheck, redisCheck]
      const onlineCount = results.filter(r => r.status === 'ONLINE').length

      return reply.send({
        success: true,
        data: {
          totalServices: results.length,
          onlineServices: onlineCount,
          healthScore: Math.round((onlineCount / results.length) * 100),
          matrix: results,
          checkedAt: new Date().toISOString()
        }
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // 9. Kubernetes & Architecture Status
  app.get('/api/server/k8s/status', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      let isInstalled = false
      let clusterOutput = null
      try {
        const { stdout } = await execAsync('which kubectl 2>/dev/null && kubectl cluster-info 2>/dev/null', { timeout: 3000 })
        if (stdout && stdout.trim()) {
          isInstalled = true
          clusterOutput = stdout.trim()
        }
      } catch {}

      return reply.send({
        success: true,
        data: {
          installed: isInstalled,
          clusterInfo: clusterOutput,
          orchestrationMode: isInstalled ? 'Kubernetes Native' : 'Standalone High-Performance VM (PM2 + Docker Engine)',
          hostAddress: '35.244.3.210',
          architectureNotes: 'All 21 production microservices operate as dedicated PM2 cluster processes with Docker isolation for Postgres, Redis, and Webmail.'
        }
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // 10. Master PIN Verification
  app.post<{ Body: { pin: string } }>('/api/server/verify-pin', { onRequest: [authenticate] }, async (req, reply) => {
    const { pin } = req.body || {}
    const valid = Boolean(pin && pin === MASTER_PIN)
    return reply.send({ success: true, valid })
  })

  // 11. System Reboot with Double Confirmation & Master PIN
  app.post<{ Body: { pin: string; confirmation: string } }>(
    '/api/server/system/reboot',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const { pin, confirmation } = req.body || {}

      if (!pin || pin !== MASTER_PIN) {
        return reply.code(403).send({ success: false, error: 'Invalid Master PIN' })
      }

      if (confirmation !== 'REBOOT_HOST_SERVER') {
        return reply.code(400).send({ success: false, error: 'Confirmation string must match REBOOT_HOST_SERVER exactly.' })
      }

      app.log.warn('[SERVER_REBOOT] Superadmin initiated system reboot.')

      // Schedule reboot in background so HTTP response returns first
      setTimeout(() => {
        exec('sudo shutdown -r +1 "Scheduled reboot via Server Dashboard"', (err) => {
          if (err) app.log.error(`Reboot error: ${err.message}`)
        })
      }, 1000)

      return reply.send({
        success: true,
        message: 'System reboot scheduled in 60 seconds. Services will restart automatically.'
      })
    }
  )
}
