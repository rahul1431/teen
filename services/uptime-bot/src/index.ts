// Uptime monitoring bot: periodically tests service connectivity and writes status to JSON file
// Tests: PostgreSQL, Redis, WebSocket handshakes, system TCP ports
// Runs every 30 seconds, writes to /opt/teen-prod/uptime-status.json

import 'dotenv/config'
import { Pool } from 'pg'
import Redis from 'ioredis'
import * as net from 'net'
import * as https from 'https'
import * as crypto from 'crypto'
import fs from 'fs'
import path from 'path'

interface ServiceStatus {
  up: boolean
  latency: number
}

interface UptimeStatus {
  timestamp: string
  database: ServiceStatus
  redis: ServiceStatus
  publicWebsockets: {
    gateway: ServiceStatus
    aviator: ServiceStatus
  }
  services: Record<string, ServiceStatus>
  checked_at: string
}

const logger = {
  info: (msg: string) => console.log(`[uptime-bot] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[uptime-bot] ${msg}`, err?.message || ''),
}

const OUTPUT_FILE = process.env.UPTIME_STATUS_FILE || '/opt/teen-prod/uptime-status.json'
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || '30000', 10)

// Test PostgreSQL connection latency
async function testPostgreSQL(db: Pool): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    await db.query('SELECT 1')
    return { up: true, latency: Date.now() - start }
  } catch (err) {
    logger.error('PostgreSQL check failed', err)
    return { up: false, latency: 0 }
  }
}

// Test Redis connection latency
async function testRedis(redis: Redis): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    await redis.ping()
    return { up: true, latency: Date.now() - start }
  } catch (err) {
    logger.error('Redis check failed', err)
    return { up: false, latency: 0 }
  }
}

// Test WebSocket handshake to public URL. A plain HTTPS GET never upgrades
// (nginx returns 404/400 for a WS-only route with no Upgrade header), so this
// sends the actual WebSocket handshake headers and looks for 101.
async function testWebSocketHandshake(wsUrl: string): Promise<ServiceStatus> {
  return new Promise((resolve) => {
    const start = Date.now()
    const timeout = setTimeout(() => {
      resolve({ up: false, latency: 0 })
    }, 5000)

    try {
      const httpsUrl = new URL(wsUrl)
      httpsUrl.protocol = 'https:'

      const req = https.request(httpsUrl, {
        timeout: 5000,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
          'Sec-WebSocket-Version': '13',
        },
      })

      req.on('upgrade', (res) => {
        clearTimeout(timeout)
        resolve({ up: res.statusCode === 101, latency: Date.now() - start })
      })

      req.on('response', (res) => {
        clearTimeout(timeout)
        // Server responded without upgrading — not up as a WebSocket endpoint
        res.destroy()
        resolve({ up: false, latency: Date.now() - start })
      })

      req.on('error', () => {
        clearTimeout(timeout)
        resolve({ up: false, latency: 0 })
      })

      req.on('timeout', () => {
        clearTimeout(timeout)
        req.destroy()
        resolve({ up: false, latency: 0 })
      })

      req.end()
    } catch (err) {
      clearTimeout(timeout)
      resolve({ up: false, latency: 0 })
    }
  })
}

// Test TCP port connectivity
async function testTcpPort(host: string, port: number): Promise<ServiceStatus> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve({ up: false, latency: 0 })
    }, 3000)

    socket.connect(port, host, () => {
      clearTimeout(timeout)
      const latency = Date.now() - start
      socket.destroy()
      resolve({ up: true, latency })
    })

    socket.on('error', () => {
      clearTimeout(timeout)
      resolve({ up: false, latency: 0 })
    })
  })
}

async function runHealthCheck(): Promise<UptimeStatus> {
  logger.info('Starting health check...')

  const db = new Pool({ connectionString: process.env.DATABASE_URL!, idleTimeoutMillis: 5000 })
  const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })

  try {
    if (redis.status === 'wait') await redis.connect()

    const [dbStatus, redisStatus, gatewayWs, aviatorWs] = await Promise.all([
      testPostgreSQL(db),
      testRedis(redis),
      testWebSocketHandshake('wss://game.myonlinejoker.com/ws'),
      testWebSocketHandshake('wss://game.myonlinejoker.com/ws/aviator'),
    ])

    // Test internal TCP ports
    const services: Record<string, ServiceStatus> = {}
    const ports = [
      { name: 'core-api', port: 3001 },
      { name: 'wallet', port: 3003 },
      { name: 'gateway', port: 3004 },
      { name: 'aviator', port: 3005 },
      { name: 'risk', port: 3006 },
      { name: 'admin-svc', port: 3008 },
      { name: 'tp-engine', port: 3010 },
      { name: 'ludo-engine', port: 3011 },
      { name: 'churn', port: 3013 },
      { name: 'bot-learning', port: 3014 },
      { name: 'app-monitor', port: 3015 },
      { name: 'monitoring', port: 3017 },
      { name: 'churn-ml', port: 3020 },
    ]

    for (const { name, port } of ports) {
      services[name] = await testTcpPort('127.0.0.1', port)
    }

    const status: UptimeStatus = {
      timestamp: new Date().toISOString(),
      database: dbStatus,
      redis: redisStatus,
      publicWebsockets: {
        gateway: gatewayWs,
        aviator: aviatorWs,
      },
      services,
      checked_at: new Date().toISOString(),
    }

    logger.info(`Health check complete: DB=${dbStatus.up ? '✓' : '✗'} Redis=${redisStatus.up ? '✓' : '✗'} Gateway=${gatewayWs.up ? '✓' : '✗'} Aviator=${aviatorWs.up ? '✓' : '✗'}`)
    return status
  } finally {
    await db.end()
    await redis.quit()
  }
}

async function writeStatusFile(status: UptimeStatus): Promise<void> {
  try {
    const dir = path.dirname(OUTPUT_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(status, null, 2))
    logger.info(`Status written to ${OUTPUT_FILE}`)
  } catch (err) {
    logger.error(`Failed to write status file: ${OUTPUT_FILE}`, err)
  }
}

async function start(): Promise<void> {
  logger.info(`Starting uptime bot (check interval: ${CHECK_INTERVAL_MS}ms, output: ${OUTPUT_FILE})`)

  // Run first check immediately
  try {
    const status = await runHealthCheck()
    await writeStatusFile(status)
  } catch (err) {
    logger.error('First health check failed', err)
  }

  // Then repeat at interval
  setInterval(async () => {
    try {
      const status = await runHealthCheck()
      await writeStatusFile(status)
    } catch (err) {
      logger.error('Health check error', err)
    }
  }, CHECK_INTERVAL_MS)
}

start().catch((err) => {
  logger.error('Failed to start uptime bot', err)
  process.exit(1)
})

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down')
  process.exit(0)
})
