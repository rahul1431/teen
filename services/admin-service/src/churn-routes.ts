import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import axios from 'axios'

const CHURN_URL = process.env.CHURN_SERVICE_URL || 'http://localhost:3013'

export async function registerChurnRoutes(app: FastifyInstance, db: Pool, authenticate: any, requireRole: any) {
  // GET /api/admin/churn/users — list at-risk users from churn service
  app.get('/api/admin/churn/users', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const res = await axios.get(`${CHURN_URL}/api/churn/users`, { params: (req.query as any), timeout: 5000 })
      return reply.send(res.data)
    } catch (err: any) {
      // Fallback: query database directly
      try {
        const queryParams = (req.query as any) || {}
        let sql = `
          SELECT u.id, u.username, u.phone, cs.score, cs.risk_level, 
                 cs.days_since_deposit, cs.last_deposit_at, cs.action_taken, cs.action_taken_at
          FROM user_churn_scores cs
          JOIN users u ON u.id = cs.user_id
        `
        const vals: any[] = []
        if (queryParams.risk_level) {
          sql += ` WHERE cs.risk_level = $1`
          vals.push(queryParams.risk_level)
        }
        sql += ` ORDER BY cs.score DESC LIMIT 100`
        const res = await db.query(sql, vals)
        return reply.send({ success: true, data: { users: res.rows, total: res.rows.length } })
      } catch (dbErr: any) {
        return reply.code(500).send({ success: false, error: 'Failed to retrieve churn users' })
      }
    }
  })

  // GET /api/admin/churn/stats — churn aggregate stats
  app.get('/api/admin/churn/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${CHURN_URL}/api/churn/stats`, { timeout: 5000 })
      return reply.send(res.data)
    } catch (err: any) {
      // Fallback: calculate stats directly from database
      try {
        const [countsRes, actionsRes] = await Promise.all([
          db.query(`
            SELECT 
              COUNT(*) FILTER (WHERE risk_level IN ('medium', 'high')) as total_at_risk,
              COUNT(*) FILTER (WHERE risk_level = 'low') as low,
              COUNT(*) FILTER (WHERE risk_level = 'medium') as medium,
              COUNT(*) FILTER (WHERE risk_level = 'high') as high
            FROM user_churn_scores
          `),
          db.query(`
            SELECT 
              COUNT(*) FILTER (WHERE action_taken = 'bonus' AND action_taken_at >= CURRENT_DATE) as bonuses_sent,
              COUNT(*) FILTER (WHERE action_taken = 'notification' AND action_taken_at >= CURRENT_DATE) as notifs_sent
            FROM user_churn_scores
          `).catch(() => ({ rows: [{ bonuses_sent: 0, notifs_sent: 0 }] }))
        ])

        const c = countsRes.rows[0] || {}
        const a = actionsRes.rows[0] || {}
        return reply.send({
          success: true,
          data: {
            total_at_risk: parseInt(c.total_at_risk || '0'),
            by_level: {
              low: parseInt(c.low || '0'),
              medium: parseInt(c.medium || '0'),
              high: parseInt(c.high || '0'),
            },
            bonuses_sent_today: parseInt(a.bonuses_sent || '0'),
            notifications_sent_today: parseInt(a.notifs_sent || '0'),
          }
        })
      } catch (dbErr: any) {
        return reply.send({
          success: true,
          data: {
            total_at_risk: 0,
            by_level: { low: 0, medium: 0, high: 0 },
            bonuses_sent_today: 0,
            notifications_sent_today: 0,
          }
        })
      }
    }
  })

  // POST /api/admin/churn/re-engage/:userId — trigger re-engagement for a user
  app.post<{ Params: { userId: string } }>(
    '/api/admin/churn/re-engage/:userId',
    { onRequest: [authenticate, requireRole('support')] },
    async (req, reply) => {
      try {
        const res = await axios.post(`${CHURN_URL}/api/churn/re-engage/${req.params.userId}`, req.body, { timeout: 5000 })
        return reply.send(res.data)
      } catch (err: any) {
        // Fallback: record action in DB
        try {
          const { send_bonus } = (req.body as any) || {}
          const action = send_bonus ? 'bonus' : 'notification'
          await db.query(`
            UPDATE user_churn_scores
            SET action_taken = $1, action_taken_at = NOW(), updated_at = NOW()
            WHERE user_id = $2
          `, [action, req.params.userId])
          return reply.send({ success: true, message: `Re-engagement action (${action}) logged successfully` })
        } catch (dbErr: any) {
          return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Churn service unavailable' })
        }
      }
    }
  )

  // GET /api/admin/churn/config — get churn model configuration
  app.get('/api/admin/churn/config', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${CHURN_URL}/api/churn/config`, { timeout: 5000 })
      return reply.send(res.data)
    } catch (err: any) {
      // Fallback default config
      return reply.send({
        success: true,
        data: {
          low_threshold_days: 7,
          medium_threshold_days: 14,
          high_threshold_days: 30,
          high_bonus_amount: 50,
          action_cooldown_days: 7,
          grace_period_days: 3,
        }
      })
    }
  })

  // PATCH /api/admin/churn/config — update churn model configuration (superadmin only)
  app.patch(
    '/api/admin/churn/config',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      try {
        const res = await axios.patch(`${CHURN_URL}/api/churn/config`, req.body, { timeout: 5000 })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Churn service unavailable' })
      }
    }
  )
}
