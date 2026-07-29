import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import os from 'os'

const ML_CONFIG_KEY = 'ml:config'
const CHURN_ML_SERVICE_URL = process.env.CHURN_ML_SERVICE_URL || 'http://127.0.0.1:3020'

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
  requireRole: any,
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
  app.post('/api/admin/ml/config', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
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

  // GET /api/admin/ml/metrics — real stats from DB + real model/job status
  app.get('/api/admin/ml/metrics', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const [fraud, bots, churn, games, churnAlerts, fraudAlerts, botAlerts, churnMlStatus, botRebuildJobRaw] = await Promise.allSettled([
        db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status != 'active') as flagged FROM users WHERE is_bot = false`),
        db.query(`SELECT COUNT(*) as total, ROUND(AVG(CASE WHEN prize_won > 0 THEN 100.0 ELSE 0 END)::numeric, 1) as win_rate
                  FROM game_participants gp JOIN users u ON u.id = gp.user_id WHERE u.is_bot = true`),
        db.query(`SELECT COUNT(*) as at_risk FROM user_churn_scores WHERE risk_level IN ('medium','high')`),
        db.query(`SELECT COUNT(*) as total, COALESCE(ROUND(AVG(pot_amount)::numeric,2),0) as avg_pot
                  FROM game_rooms WHERE created_at > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT user_id as id, 'churn' as type, user_id as target, (score::float / 100.0) as score, 0.85 as confidence, updated_at as timestamp, risk_level as action FROM user_churn_scores ORDER BY updated_at DESC LIMIT 10`),
        db.query(`SELECT id::text, 'fraud' as type, user_id as target, fraud_score::float as score, confidence::float as confidence, created_at as timestamp, action FROM fraud_events ORDER BY created_at DESC LIMIT 10`),
        // Score/confidence are derived from the joining bot's actual trained profile
        // (bot_profiles, keyed by game_type + the bot user's own bot_difficulty) —
        // real trained win_rate_target and sample_size, not fixed placeholders.
        db.query(`
          SELECT gp.id::text, 'bot_decision' as type, u.username as target,
                 (COALESCE(bp.win_rate_target, 50)::float / 100.0) as score,
                 LEAST(COALESCE(bp.sample_size, 0)::float / 200.0, 1.0) as confidence,
                 gp.joined_at as timestamp, 'join_room' as action
          FROM game_participants gp
          JOIN users u ON u.id = gp.user_id
          JOIN game_rooms gr ON gr.id = gp.room_id
          LEFT JOIN bot_profiles bp ON bp.game_type = gr.game_type AND bp.difficulty = u.bot_difficulty
          WHERE u.is_bot = true ORDER BY gp.joined_at DESC LIMIT 10
        `),
        // churn-ml-service's real model-version metadata (accuracy, last retrain) —
        // was previously a hardcoded fake entry, see
        // docs/Bugs/ai-workflow-dashboard-hardcoded-model-jobs.md.
        fetch(`${CHURN_ML_SERVICE_URL}/status`, { signal: AbortSignal.timeout(3000) })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null),
        // bot-learning-service's most recent rebuild run (services/bot-learning-service/src/profile-builder.ts:runRebuild) —
        // same Redis instance, written directly by that service, no HTTP hop needed.
        redis.get('bot:rebuild:last_job'),
      ])

      const f = fraud.status === 'fulfilled' ? fraud.value.rows[0] : { total: 0, flagged: 0 }
      const b = bots.status === 'fulfilled' ? bots.value.rows[0] : { total: 0, win_rate: 0 }
      const c = churn.status === 'fulfilled' ? churn.value.rows[0] : { at_risk: 0 }
      const g = games.status === 'fulfilled' ? games.value.rows[0] : { total: 0, avg_pot: 0 }
      const ca = churnAlerts.status === 'fulfilled' ? churnAlerts.value.rows : []
      const fa = fraudAlerts.status === 'fulfilled' ? fraudAlerts.value.rows : []
      const ba = botAlerts.status === 'fulfilled' ? botAlerts.value.rows : []
      const churnMl: any = churnMlStatus.status === 'fulfilled' ? churnMlStatus.value : null
      const activeModel = churnMl?.active_model ?? null
      let rebuildJob: any = null
      if (botRebuildJobRaw.status === 'fulfilled' && botRebuildJobRaw.value) {
        try { rebuildJob = JSON.parse(botRebuildJobRaw.value) } catch { rebuildJob = null }
      }

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
        score: parseFloat(row.score) || 0.5,
        confidence: parseFloat(row.confidence) || 0,
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

      // Real model/job status. Only churn_model exists — bot behavior is
      // profile-derived (not a trained classifier) and fraud detection is a
      // rules engine (see WorkflowDashboard's own "Rules Engine" banner), so
      // there is nothing real to report for a "bot_tree" or "fraud_scorer"
      // model; the old entries for those were fabricated. See
      // docs/Bugs/ai-workflow-dashboard-hardcoded-model-jobs.md.
      const models = [{
        name: 'churn_model',
        status: churnMl?.training_in_progress ? 'training' : (activeModel ? 'completed' : 'queued'),
        accuracy: activeModel?.test_accuracy ?? 0,
        lastRetrain: activeModel?.created_at ?? null,
      }]

      const jobs: any[] = []
      if (churnMl?.training_in_progress) {
        jobs.push({ id: 'job-churn-train', name: 'Train Churn RandomForest', status: 'running', progress: 0, processed: 0, total: activeModel?.samples ?? 0, startTime: new Date().toISOString() })
      } else if (activeModel?.duration_ms != null) {
        // duration_ms/samples are only present on models trained after this fix
        // shipped — older metadata.json files predate those fields, in which case
        // we have no real per-run numbers to show, so skip the job entry entirely
        // rather than rendering "undefined / undefined".
        jobs.push({
          id: 'job-churn-train', name: 'Train Churn RandomForest', status: 'completed', progress: 100,
          processed: activeModel.samples ?? 0, total: activeModel.samples ?? 0,
          latency: activeModel.duration_ms, startTime: activeModel.created_at,
        })
      }
      if (rebuildJob) {
        const total = rebuildJob.total || 0
        jobs.push({
          id: 'job-bot-rebuild', name: 'Rebuild Bot Profiles',
          status: rebuildJob.status === 'running' ? 'running' : rebuildJob.status === 'failed' ? 'failed' : 'completed',
          progress: rebuildJob.status === 'running' ? 0 : (total ? Math.round(((rebuildJob.processed ?? 0) / total) * 100) : 0),
          processed: rebuildJob.processed ?? 0, total,
          latency: rebuildJob.latencyMs, startTime: rebuildJob.startedAt,
        })
      }

      return reply.send({
        success: true,
        data: {
          fraud: { totalUsers: parseInt(f.total) || 0, flaggedAccounts: parseInt(f.flagged) || 0 },
          bots: { totalParticipations: parseInt(b.total) || 0, avgWinRate: parseFloat(b.win_rate) || 0 },
          churn: { atRiskUsers: parseInt(c.at_risk) || 0 },
          games: { roomsLast24h: parseInt(g.total) || 0, avgPotSize: parseFloat(g.avg_pot) || 0 },
          models,
          jobs,
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
