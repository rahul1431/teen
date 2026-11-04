import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function registerServerStatsRoutes(
  app: FastifyInstance,
  redis: Redis,
  db: Pool,
  authenticate: any,
  requireRole: any
) {
  // GET /api/admin/server/health
  app.get('/api/admin/server/health', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      // 1. Get Uptime & Load
      const load = os.loadavg()
      const cores = os.cpus().length || 1
      const cpuUsage = Math.min(Math.round((load[0] / cores) * 100), 100)
      const sysUptime = os.uptime() // seconds

      // 2. Get Disk Space (df -h)
      let diskUsage: any[] = []
      try {
        const { stdout } = await execAsync('df -h', { timeout: 3000 })
        const lines = stdout.trim().split('\n')
        // Skip header line
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
        app.log.warn(`df -h execution failed: ${err.message}`)
      }

      // 3. Get RAM Details (free -m)
      let ramDetails = {
        total: Math.round(os.totalmem() / 1024 / 1024),
        free: Math.round(os.freemem() / 1024 / 1024),
        used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
        buffCache: 0,
        available: Math.round(os.freemem() / 1024 / 1024)
      }

      try {
        const { stdout } = await execAsync('free -m', { timeout: 3000 })
        const lines = stdout.trim().split('\n')
        const memLine = lines.find(l => l.startsWith('Mem:'))
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
      } catch (err: any) {
        app.log.warn(`free -m execution failed: ${err.message}`)
      }

      return reply.send({
        success: true,
        data: {
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
          uptime: sysUptime,
          checkedAt: new Date().toISOString()
        }
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // GET /api/admin/server/processes
  app.get('/api/admin/server/processes', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      // Run ps aux
      const { stdout } = await execAsync('ps aux', { timeout: 5000 })
      const lines = stdout.trim().split('\n')
      const processes: any[] = []

      // Headers: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const parts = line.split(/\s+/)
        if (parts.length >= 11) {
          processes.push({
            user: parts[0],
            pid: parts[1],
            cpu: parts[2],
            mem: parts[3],
            vsz: parts[4],
            rss: parts[5],
            tty: parts[6],
            stat: parts[7],
            start: parts[8],
            time: parts[9],
            command: parts.slice(10).join(' ')
          })
        }
      }

      return reply.send({ success: true, data: processes })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // GET /api/admin/server/network
  app.get('/api/admin/server/network', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      // Run ss -tulwn
      const { stdout } = await execAsync('ss -tulwn', { timeout: 5000 })
      const lines = stdout.trim().split('\n')
      const connections: any[] = []

      // Headers: Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const parts = line.split(/\s+/)
        if (parts.length >= 5) {
          connections.push({
            netid: parts[0],
            state: parts[1],
            recvQ: parts[2],
            sendQ: parts[3],
            local: parts[4],
            peer: parts[5] || '',
            process: parts.slice(6).join(' ')
          })
        }
      }

      return reply.send({ success: true, data: connections })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })
}
