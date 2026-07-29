import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Backs the Player Anomalies Dashboard (admin-panel/src/pages/PlayerAnomaliesPage.tsx).
// Reads/writes the player_anomalies + admin_anomaly_overrides tables from
// migrations 055/056, and the users.is_anomaly_whitelisted flag from 058.
export async function registerPlayerAnomaliesRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  // GET /api/admin/player-anomalies — filtered, paginated list for the table
  app.get('/api/admin/player-anomalies', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const q = z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        confidence_min: z.coerce.number().min(0).max(100).default(0),
        confidence_max: z.coerce.number().min(0).max(100).default(100),
        anomaly_types: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      }).parse(req.query)

      const conditions: string[] = []
      const params: any[] = []

      conditions.push(`pa.confidence >= $${params.length + 1}`)
      params.push(q.confidence_min / 100)
      conditions.push(`pa.confidence <= $${params.length + 1}`)
      params.push(q.confidence_max / 100)

      const types = q.anomaly_types?.split(',').map((t) => t.trim()).filter(Boolean)
      if (types?.length) {
        conditions.push(`pa.anomaly_type = ANY($${params.length + 1})`)
        params.push(types)
      }

      if (q.start_date) {
        conditions.push(`pa.created_at >= $${params.length + 1}`)
        params.push(q.start_date)
      }
      if (q.end_date) {
        conditions.push(`pa.created_at <= $${params.length + 1}`)
        params.push(q.end_date)
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`

      const countRes = await db.query(
        `SELECT COUNT(*)::int AS count FROM player_anomalies pa ${whereClause}`,
        params
      )

      const offset = (q.page - 1) * q.limit
      const res = await db.query(
        `SELECT
           pa.id, pa.player_id, u.username, pa.anomaly_type,
           pa.confidence, pa.status, pa.details, pa.created_at,
           (SELECT COUNT(*)::int FROM support_tickets st WHERE st.user_id = pa.player_id) AS support_tickets
         FROM player_anomalies pa
         LEFT JOIN users u ON pa.player_id = u.id
         ${whereClause}
         ORDER BY pa.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.limit, offset]
      )

      const data = res.rows.map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        username: row.username,
        anomaly_type: row.anomaly_type,
        confidence: parseFloat(row.confidence) * 100,
        timestamp: row.created_at,
        status: row.status,
        details: row.details,
        support_tickets: row.support_tickets,
      }))

      return reply.send({ success: true, data, total: countRes.rows[0].count })
    } catch (err: any) {
      app.log.error(err, '[player-anomalies-routes] GET /player-anomalies error')
      return reply.code(500).send({ success: false, error: err.message || 'Failed to fetch anomalies' })
    }
  })

  // GET /api/admin/player-anomalies/stats — summary cards
  app.get('/api/admin/player-anomalies/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS d7,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS d30,
          COUNT(*) FILTER (WHERE status = 'paused' AND created_at >= NOW() - INTERVAL '30 days') AS paused,
          COUNT(*) FILTER (WHERE status = 'overridden' AND created_at >= NOW() - INTERVAL '30 days') AS overridden,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS total
        FROM player_anomalies
      `)
      const row = res.rows[0]
      const total = parseInt(row.total, 10) || 0
      const overridden = parseInt(row.overridden, 10) || 0

      return reply.send({
        success: true,
        data: {
          total_detected_today: parseInt(row.today, 10) || 0,
          total_detected_7d: parseInt(row.d7, 10) || 0,
          total_detected_30d: parseInt(row.d30, 10) || 0,
          auto_paused_count: parseInt(row.paused, 10) || 0,
          override_rate_pct: total > 0 ? Math.round((overridden / total) * 1000) / 10 : 0,
        },
      })
    } catch (err: any) {
      app.log.error(err, '[player-anomalies-routes] GET /player-anomalies/stats error')
      return reply.code(500).send({ success: false, error: err.message || 'Failed to fetch stats' })
    }
  })

  // GET /api/admin/player-anomalies/trend?days=N — time series for the chart
  app.get('/api/admin/player-anomalies/trend', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const { days } = z.object({
        days: z.coerce.number().int().min(1).max(90).default(7),
      }).parse(req.query)

      const bucket = days <= 1 ? 'hour' : 'day'

      const res = await db.query(
        `SELECT
           date_trunc('${bucket}', created_at) AS bucket,
           anomaly_type,
           COUNT(*)::int AS count
         FROM player_anomalies
         WHERE created_at >= NOW() - ($1 || ' days')::interval
         GROUP BY bucket, anomaly_type
         ORDER BY bucket ASC`,
        [days]
      )

      const byBucket = new Map<string, any>()
      for (const row of res.rows) {
        const key = new Date(row.bucket).toISOString()
        if (!byBucket.has(key)) byBucket.set(key, { date: key, count: 0 })
        const entry = byBucket.get(key)
        entry[row.anomaly_type] = row.count
        entry.count += row.count
      }

      return reply.send({ success: true, data: Array.from(byBucket.values()) })
    } catch (err: any) {
      app.log.error(err, '[player-anomalies-routes] GET /player-anomalies/trend error')
      return reply.code(500).send({ success: false, error: err.message || 'Failed to fetch trend' })
    }
  })

  // POST /api/admin/player-anomalies/:anomalyId/review — mark reviewed
  app.post(
    '/api/admin/player-anomalies/:anomalyId/review',
    { onRequest: [authenticate, requireRole('support')] },
    async (req, reply) => {
      try {
        const { anomalyId } = req.params as any
        const admin = req.user as any

        const result = await db.query(
          `UPDATE player_anomalies
           SET status = 'responded', updated_at = NOW()
           WHERE id = $1
           RETURNING id, player_id, anomaly_type`,
          [anomalyId]
        )

        if (!result.rows.length) {
          return reply.code(404).send({ success: false, error: 'Anomaly not found' })
        }

        await db.query(
          `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [admin.sub, 'anomaly_reviewed', 'player_anomaly', anomalyId, JSON.stringify({})]
        )

        return reply.send({ success: true, data: { anomalyId, status: 'responded' } })
      } catch (err: any) {
        app.log.error(err, '[player-anomalies-routes] POST /player-anomalies/:id/review error')
        return reply.code(500).send({ success: false, error: err.message || 'Failed to review anomaly' })
      }
    }
  )

  // GET /api/admin/player/:playerId/support-tickets — for the profile drawer
  app.get('/api/admin/player/:playerId/support-tickets', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const { playerId } = req.params as any
      const { priority, limit } = z.object({
        priority: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(10),
      }).parse(req.query)

      const conditions = ['st.user_id = $1']
      const params: any[] = [playerId]

      if (priority) {
        conditions.push(`st.priority = $${params.length + 1}`)
        params.push(priority)
      }
      params.push(limit)

      const res = await db.query(
        `SELECT
           st.id, st.subject, st.category, st.status, st.priority, st.created_at,
           (SELECT sm.body FROM support_messages sm WHERE sm.ticket_id = st.id ORDER BY sm.created_at ASC LIMIT 1) AS message
         FROM support_tickets st
         WHERE ${conditions.join(' AND ')}
         ORDER BY st.created_at DESC
         LIMIT $${params.length}`,
        params
      )

      return reply.send({ success: true, data: res.rows })
    } catch (err: any) {
      app.log.error(err, '[player-anomalies-routes] GET /player/:id/support-tickets error')
      return reply.code(500).send({ success: false, error: err.message || 'Failed to fetch support tickets' })
    }
  })

  // POST /api/admin/player/:playerId/whitelist — exclude player from anomaly auto-pause
  app.post(
    '/api/admin/player/:playerId/whitelist',
    { onRequest: [authenticate, requireRole('support')] },
    async (req, reply) => {
      try {
        const { playerId } = req.params as any
        const admin = req.user as any

        const result = await db.query(
          `UPDATE users SET is_anomaly_whitelisted = true, updated_at = NOW() WHERE id = $1 RETURNING id`,
          [playerId]
        )

        if (!result.rows.length) {
          return reply.code(404).send({ success: false, error: 'Player not found' })
        }

        await db.query(
          `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [admin.sub, 'player_whitelisted', 'user', playerId, JSON.stringify({})]
        )

        return reply.send({ success: true, data: { playerId, whitelisted: true } })
      } catch (err: any) {
        app.log.error(err, '[player-anomalies-routes] POST /player/:id/whitelist error')
        return reply.code(500).send({ success: false, error: err.message || 'Failed to whitelist player' })
      }
    }
  )
}
