import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import os from 'os'

const ML_CONFIG_KEY = 'ml:config'

const DEFAULT_CONFIG = {
  fraudDetection: {
    coLocationThreshold: 3,
    winRateAnomalyThreshold: 95,
    velocityLimitHours: 1,
    referralChainDepth: 2,
    enabled: true,
  },
  churnPrediction: {
    daysSinceLastPlay: 7,
    avgLossStreakWeight: 0.4,
    bonusBalanceWeight: 0.2,
    retrainFrequency: 'daily',
    enabled: true,
  },
  botSettings: {
    maxWinRate: 50,
    difficulty: 'medium',
    decisionTreeDepth: 8,
    aggressionLevel: 5,
    enabled: true,
  },
  rtpOptimizer: {
    minRakePercent: 3,
    maxRakePercent: 7,
    testDuration: 24,
    confidenceThreshold: 0.95,
    enabled: false,
  },
}

export async function registerMLRoutes(
  app: FastifyInstance,
  redis: Redis,
  db: Pool,
  authenticate: any,
) {
  // GET /api/admin/ml/config
  app.get('/api/admin/ml/config', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      // Try Redis first (fast)
      const cached = await redis.get(ML_CONFIG_KEY)
      if (cached) return reply.send({ success: true, data: JSON.parse(cached) })
      // Fall back to DB
      const res = await db.query(`SELECT value FROM admin_config WHERE key = $1`, [ML_CONFIG_KEY])
      const config = res.rows.length ? res.rows[0].value : DEFAULT_CONFIG
      return reply.send({ success: true, data: config })
    } catch {
      return reply.send({ success: true, data: DEFAULT_CONFIG })
    }
  })

  // POST /api/admin/ml/config
  app.post('/api/admin/ml/config', { onRequest: [authenticate] }, async (req, reply) => {
    const config = req.body as any
    try {
      await redis.set(ML_CONFIG_KEY, JSON.stringify(config), 'EX', 86400)
      await db.query(
        `INSERT INTO admin_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [ML_CONFIG_KEY, config]
      )
      await redis.publish('ml:config:change', JSON.stringify(config))
      return reply.send({ success: true, data: config })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // GET /api/admin/ml/metrics — real stats from DB + mock model status
  app.get('/api/admin/ml/metrics', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const [fraud, bots, churn, games, churnAlerts, fraudAlerts, botAlerts] = await Promise.allSettled([
        db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status != 'active') as flagged FROM users WHERE is_bot = false`),
        db.query(`SELECT COUNT(*) as total, ROUND(AVG(CASE WHEN prize_won > 0 THEN 100.0 ELSE 0 END)::numeric, 1) as win_rate
                  FROM game_participants gp JOIN users u ON u.id = gp.user_id WHERE u.is_bot = true`),
        db.query(`SELECT COUNT(*) as at_risk FROM user_churn_scores WHERE risk_level IN ('medium','high')`),
        db.query(`SELECT COUNT(*) as total, COALESCE(ROUND(AVG(pot_amount)::numeric,2),0) as avg_pot
                  FROM game_rooms WHERE created_at > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT user_id as id, 'churn' as type, user_id as target, (score::float / 100.0) as score, 0.85 as confidence, updated_at as timestamp, risk_level as action FROM user_churn_scores ORDER BY updated_at DESC LIMIT 10`),
        db.query(`SELECT id::text, 'fraud' as type, user_id as target, fraud_score::float as score, confidence::float as confidence, created_at as timestamp, action FROM fraud_events ORDER BY created_at DESC LIMIT 10`),
        db.query(`SELECT gp.id::text, 'bot_decision' as type, u.username as target, 0.90 as score, 0.95 as confidence, gp.joined_at as timestamp, 'join_room' as action FROM game_participants gp JOIN users u ON u.id = gp.user_id WHERE u.is_bot = true ORDER BY gp.joined_at DESC LIMIT 10`),
      ])

      const f = fraud.status === 'fulfilled' ? fraud.value.rows[0] : { total: 0, flagged: 0 }
      const b = bots.status === 'fulfilled' ? bots.value.rows[0] : { total: 0, win_rate: 0 }
      const c = churn.status === 'fulfilled' ? churn.value.rows[0] : { at_risk: 0 }
      const g = games.status === 'fulfilled' ? games.value.rows[0] : { total: 0, avg_pot: 0 }
      const ca = churnAlerts.status === 'fulfilled' ? churnAlerts.value.rows : []
      const fa = fraudAlerts.status === 'fulfilled' ? fraudAlerts.value.rows : []
      const ba = botAlerts.status === 'fulfilled' ? botAlerts.value.rows : []

      const formattedChurn = ca.map((row: any) => ({
        id: row.id,
        type: 'churn',
        target: `User: ${row.target.substring(0, 8)}...`,
        score: parseFloat(row.score) || 0,
        confidence: parseFloat(row.confidence) || 0.85,
        timestamp: row.timestamp,
        action: row.action === 'high' ? 'Trigger Bonus' : 'Monitor'
      }))

      const formattedFraud = fa.map((row: any) => ({
        id: row.id,
        type: 'fraud',
        target: `User: ${row.target.substring(0, 8)}...`,
        score: parseFloat(row.score) || 0,
        confidence: parseFloat(row.confidence) || 0.90,
        timestamp: row.timestamp,
        action: row.action.toUpperCase()
      }))

      const formattedBot = ba.map((row: any) => ({
        id: row.id,
        type: 'bot_decision',
        target: `Bot: ${row.target}`,
        score: 0.90,
        confidence: 0.95,
        timestamp: row.timestamp,
        action: 'Join Room'
      }))

      // Calculate system health metrics
      const freeMem = os.freemem()
      const totalMem = os.totalmem()
      const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100)
      const load = os.loadavg()
      const cores = os.cpus().length || 1
      const cpuUsage = Math.min(Math.round((load[0] / cores) * 100), 100)

      return reply.send({
        success: true,
        data: {
          fraud: { totalUsers: parseInt(f.total) || 0, flaggedAccounts: parseInt(f.flagged) || 0 },
          bots: { totalParticipations: parseInt(b.total) || 0, avgWinRate: parseFloat(b.win_rate) || 0 },
          churn: { atRiskUsers: parseInt(c.at_risk) || 0 },
          games: { roomsLast24h: parseInt(g.total) || 0, avgPotSize: parseFloat(g.avg_pot) || 0 },
          models: [
            { name: 'churn_model', status: 'completed', accuracy: 0.88, lastRetrain: new Date(Date.now() - 86400000).toISOString() },
            { name: 'bot_tree', status: 'completed', accuracy: 0.78, lastRetrain: new Date(Date.now() - 172800000).toISOString() },
            { name: 'fraud_scorer', status: 'completed', accuracy: 0.91, lastRetrain: new Date(Date.now() - 3600000).toISOString() },
          ],
          jobs: [
            { id: 'job-1', name: 'Rebuild Bot Profiles', status: 'completed', progress: 100, processed: 9, total: 9, latency: 1540, startTime: new Date(Date.now() - 3600000 * 2).toISOString() },
            { id: 'job-2', name: 'Train Churn RandomForest', status: 'completed', progress: 100, processed: 12, total: 12, latency: 340, startTime: new Date(Date.now() - 3600000 * 4).toISOString() }
          ],
          predictions: [...formattedChurn, ...formattedFraud, ...formattedBot],
          system: {
            cpu: cpuUsage,
            memory: memUsage,
            latency_p50: 12,
            latency_p95: 45,
            model_speed: 15
          }
        },
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })

  // POST /api/admin/ml/query — simple keyword-based DB analytics
  app.post('/api/admin/ml/query', { onRequest: [authenticate] }, async (req, reply) => {
    const { query } = req.body as any
    if (!query) return reply.code(400).send({ success: false, error: 'query required' })

    const q = (query as string).toLowerCase()
    const start = Date.now()
    try {
      let result: any
      let answer: string

      if (q.includes('user') && (q.includes('total') || q.includes('count') || q.includes('how many'))) {
        const res = await db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_bot=false) as real_users, COUNT(*) FILTER (WHERE is_bot=true) as bots FROM users`)
        const r = res.rows[0]
        result = r
        answer = `Total users: ${r.total} (${r.real_users} real players, ${r.bots} bots)`
      } else if (q.includes('revenue') || q.includes('rake') || q.includes('ggr')) {
        const res = await db.query(`SELECT COALESCE(ROUND(SUM(platform_fee_collected)::numeric,2),0) as total_rake, COUNT(*) as games FROM game_rooms WHERE status='completed'`)
        const r = res.rows[0]
        result = r
        answer = `Total rake collected: ₹${r.total_rake} from ${r.games} completed games`
      } else if (q.includes('deposit')) {
        const res = await db.query(`SELECT COUNT(*) as txns, COALESCE(ROUND(SUM(amount)::numeric,2),0) as total FROM wallet_transactions WHERE type='deposit' AND created_at > NOW() - INTERVAL '7 days'`)
        const r = res.rows[0]
        result = r
        answer = `Last 7 days: ${r.txns} deposits totalling ₹${r.total}`
      } else if (q.includes('game') || q.includes('room') || q.includes('patti')) {
        const res = await db.query(`SELECT game_type, COUNT(*) as rooms, COUNT(*) FILTER (WHERE status='completed') as completed FROM game_rooms GROUP BY game_type ORDER BY rooms DESC`)
        result = res.rows
        answer = res.rows.map((r: any) => `${r.game_type}: ${r.rooms} rooms (${r.completed} completed)`).join(', ') || 'No games found'
      } else if (q.includes('fraud') || q.includes('flag') || q.includes('block')) {
        const res = await db.query(`SELECT status, COUNT(*) as count FROM users WHERE status != 'active' AND is_bot=false GROUP BY status`)
        result = res.rows
        answer = res.rows.length ? res.rows.map((r: any) => `${r.status}: ${r.count} users`).join(', ') : 'No flagged users'
      } else if (q.includes('churn') || q.includes('at risk') || q.includes('inactive')) {
        const res = await db.query(`SELECT risk_level, COUNT(*) as count FROM user_churn_scores GROUP BY risk_level ORDER BY count DESC`).catch(() => ({ rows: [] as any[] }))
        result = res.rows
        answer = res.rows.length ? res.rows.map((r: any) => `${r.risk_level}: ${r.count} users`).join(', ') : 'No churn scores yet'
      } else {
        result = null
        answer = 'Try asking about: users, revenue, deposits, games, fraud, or churn users.'
      }

      return reply.send({
        success: true,
        data: { query, answer, result, executionTime: Date.now() - start, confidence: 0.9 },
      })
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err.message })
    }
  })
}
