import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'

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
      const [fraud, bots, churn, games] = await Promise.allSettled([
        db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status != 'active') as flagged FROM users WHERE is_bot = false`),
        db.query(`SELECT COUNT(*) as total, ROUND(AVG(CASE WHEN prize_won > 0 THEN 100.0 ELSE 0 END)::numeric, 1) as win_rate
                  FROM game_participants gp JOIN users u ON u.id = gp.user_id WHERE u.is_bot = true`),
        db.query(`SELECT COUNT(*) as at_risk FROM user_churn_scores WHERE risk_level IN ('medium','high')`),
        db.query(`SELECT COUNT(*) as total, COALESCE(ROUND(AVG(pot_amount)::numeric,2),0) as avg_pot
                  FROM game_rooms WHERE created_at > NOW() - INTERVAL '24 hours'`),
      ])

      const f = fraud.status === 'fulfilled' ? fraud.value.rows[0] : { total: 0, flagged: 0 }
      const b = bots.status === 'fulfilled' ? bots.value.rows[0] : { total: 0, win_rate: 0 }
      const c = churn.status === 'fulfilled' ? churn.value.rows[0] : { at_risk: 0 }
      const g = games.status === 'fulfilled' ? games.value.rows[0] : { total: 0, avg_pot: 0 }

      return reply.send({
        success: true,
        data: {
          fraud: { totalUsers: parseInt(f.total) || 0, flaggedAccounts: parseInt(f.flagged) || 0 },
          bots: { totalParticipations: parseInt(b.total) || 0, avgWinRate: parseFloat(b.win_rate) || 0 },
          churn: { atRiskUsers: parseInt(c.at_risk) || 0 },
          games: { roomsLast24h: parseInt(g.total) || 0, avgPotSize: parseFloat(g.avg_pot) || 0 },
          models: [
            { name: 'churn_model', status: 'active', accuracy: 0.82, lastRetrain: new Date(Date.now() - 86400000).toISOString() },
            { name: 'bot_tree', status: 'active', accuracy: 0.78, lastRetrain: new Date(Date.now() - 172800000).toISOString() },
            { name: 'fraud_scorer', status: 'active', accuracy: 0.91, lastRetrain: new Date(Date.now() - 3600000).toISOString() },
          ],
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
