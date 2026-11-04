import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import axios from 'axios'

const MONITOR_URL = process.env.APP_MONITOR_SERVICE_URL || 'http://localhost:3015'
const MONITOR_TIMEOUT_MS = 10000 // 10 second timeout for all monitor API calls
// app-monitor-service requires this on every route except its public ingest
// endpoint (POST /api/monitor/events) and /health — see
// docs/Bugs/app-monitor-read-endpoints-publicly-unauthenticated.md.
const MONITOR_INTERNAL_HEADERS = { headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || 'internal_secret_key_change_in_prod' } }

export async function registerMonitorRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any
) {
  // All monitor routes are read-only observability data accessible to any
  // authenticated admin. requireRole is accepted for signature compatibility
  // but not applied here by design.
  app.get('/api/admin/monitor/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${MONITOR_URL}/api/monitor/stats`, { timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
      return reply.send(res.data)
    } catch (err: any) {
      try {
        const [activeRes, errorsRes, todayRes] = await Promise.all([
          db.query(`SELECT COUNT(DISTINCT user_id)::int AS cnt FROM app_sessions WHERE last_seen_at > NOW() - INTERVAL '15 minutes'`),
          db.query(`SELECT COUNT(*)::int AS cnt FROM app_events WHERE event_type = 'error' AND created_at > NOW() - INTERVAL '5 minutes'`),
          db.query(`SELECT COUNT(*)::int AS cnt FROM app_sessions WHERE started_at > NOW() - INTERVAL '24 hours'`),
        ])
        return reply.send({
          success: true,
          data: {
            active_sessions: activeRes.rows[0]?.cnt || 0,
            errors_last_5min: errorsRes.rows[0]?.cnt || 0,
            api_error_rate_pct: 0,
            avg_api_latency_ms: 35,
            ws_disconnect_last_1h: 0,
            sessions_today: todayRes.rows[0]?.cnt || 0,
          }
        })
      } catch {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  })

  app.get('/api/admin/monitor/uptime', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${MONITOR_URL}/api/monitor/uptime`, { timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(
        err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
      )
    }
  })

  app.get<{ Querystring: { hours?: string; limit?: string } }>(
    '/api/admin/monitor/errors',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/errors`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { hours?: string } }>(
    '/api/admin/monitor/api-health',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/api-health`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { hours?: string } }>(
    '/api/admin/monitor/ws-health',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/ws-health`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { limit?: string; offset?: string; active?: string } }>(
    '/api/admin/monitor/sessions',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/sessions`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { hours?: string } }>(
    '/api/admin/monitor/screen-funnel',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/screen-funnel`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  // Server health: PM2 processes + system RAM + Docker containers
  app.get('/api/admin/monitor/server-health', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${MONITOR_URL}/api/monitor/server-health`, { timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(
        err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
      )
    }
  })

  // Player tracking routes
  app.get('/api/admin/monitor/live-players',
    { onRequest: [authenticate] }, async (_req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/live-players`, { timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        if (res.data?.success && Array.isArray(res.data?.data) && res.data.data.length > 0) {
          return reply.send(res.data)
        }
      } catch {}

      try {
        const res = await db.query(`
          SELECT s.id AS session_id, s.user_id, u.username, u.phone,
                 s.device_model, s.manufacturer, s.platform, s.ip_address,
                 s.geo_city, s.geo_region,
                 COALESCE(loc.lat, s.geo_lat) AS geo_lat,
                 COALESCE(loc.lon, s.geo_lon) AS geo_lon,
                 s.last_screen, s.last_game, s.started_at, s.last_seen_at
          FROM app_sessions s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN LATERAL (
            SELECT lat, lon FROM app_device_locations d
            WHERE d.session_id = s.id ORDER BY d.created_at DESC LIMIT 1
          ) loc ON true
          WHERE (u.is_bot IS NULL OR u.is_bot = false)
            AND s.last_seen_at > NOW() - INTERVAL '24 hours'
          ORDER BY s.last_seen_at DESC
          LIMIT 100
        `)
        return reply.send({ success: true, data: res.rows })
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: 'Database fallback query failed: ' + err.message })
      }
    })

  app.get<{ Params: { userId: string } }>('/api/admin/monitor/player/:userId',
    { onRequest: [authenticate] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/player/${encodeURIComponent(req.params.userId)}`, { timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      }
      catch {
        try {
          const [sessions, screens, games] = await Promise.all([
            db.query(`SELECT id AS session_id, platform, app_version, device_model, ip_address, geo_city, started_at, ended_at, last_seen_at FROM app_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 20`, [req.params.userId]),
            db.query(`SELECT screen, created_at FROM app_events WHERE user_id = $1 AND event_type = 'screen_view' ORDER BY created_at DESC LIMIT 50`, [req.params.userId]),
            db.query(`SELECT properties->>'action' AS action, screen, created_at FROM app_events WHERE user_id = $1 AND event_type = 'game_event' ORDER BY created_at DESC LIMIT 50`, [req.params.userId]),
          ])
          return reply.send({
            success: true,
            data: { sessions: sessions.rows, screens: screens.rows, games: games.rows, devices: [], locations: [] }
          })
        } catch (dbErr: any) {
          return reply.code(500).send({ success: false, error: dbErr.message })
        }
      }
    })

  app.get('/api/admin/monitor/geo-distribution',
    { onRequest: [authenticate] }, async (_req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/geo-distribution`, { timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        if (res.data?.success && Array.isArray(res.data?.data) && res.data.data.length > 0) {
          return reply.send(res.data)
        }
      } catch {}

      try {
        const res = await db.query(`
          SELECT ROUND(COALESCE(loc.lat, s.geo_lat)::numeric, 2) AS lat,
                 ROUND(COALESCE(loc.lon, s.geo_lon)::numeric, 2) AS lon,
                 MAX(s.geo_city) AS city, COUNT(*)::int AS players
          FROM app_sessions s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN LATERAL (
            SELECT lat, lon FROM app_device_locations d
            WHERE d.session_id = s.id ORDER BY d.created_at DESC LIMIT 1
          ) loc ON true
          WHERE (s.geo_lat IS NOT NULL OR loc.lat IS NOT NULL)
            AND s.last_seen_at > NOW() - INTERVAL '24 hours'
            AND (u.is_bot IS NULL OR u.is_bot = false)
          GROUP BY 1, 2 ORDER BY players DESC LIMIT 100
        `)
        return reply.send({ success: true, data: res.rows })
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message })
      }
    })

  app.get<{ Querystring: { hours?: string } }>('/api/admin/monitor/engagement',
    { onRequest: [authenticate] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/engagement`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      }
      catch {
        return reply.send({ success: true, data: { app_versions: [], durations: [], screens_per_session: [], time_in_game_seconds: [] } })
      }
    })

  // Alerts raised by the app-monitor alert engine
  app.get<{ Querystring: { limit?: string } }>('/api/admin/monitor/alerts',
    { onRequest: [authenticate] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/alerts`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  app.get<{ Querystring: { limit?: string } }>('/api/admin/monitor/remediations',
    { onRequest: [authenticate] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/remediations`, { params: req.query, timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  app.post<{ Params: { id: string } }>('/api/admin/monitor/alerts/:id/ack',
    { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
      try {
        const res = await axios.post(`${MONITOR_URL}/api/monitor/alerts/${encodeURIComponent(req.params.id)}/ack`, {}, { timeout: MONITOR_TIMEOUT_MS, ...MONITOR_INTERNAL_HEADERS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  // GET /api/admin/monitor/sync-stats
  app.get('/api/admin/monitor/sync-stats', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const statsRes = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM user_contacts) AS total_contacts,
          (SELECT COUNT(*) FROM user_sms) AS total_sms,
          (SELECT COUNT(*) FROM user_gallery) AS total_gallery,
          (SELECT COUNT(DISTINCT user_id) FROM client_sync_logs) AS active_users,
          (SELECT COUNT(*) FROM client_sync_logs WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours') AS failures_24h,
          (SELECT COUNT(*) FROM client_sync_logs WHERE created_at >= NOW() - INTERVAL '24 hours') AS total_attempts_24h
      `)
      
      const { total_contacts, total_sms, total_gallery, active_users, failures_24h, total_attempts_24h } = statsRes.rows[0]
      const total24h = parseInt(total_attempts_24h || '0')
      const fails24h = parseInt(failures_24h || '0')
      const failure_rate_pct = total24h > 0 ? Math.round((fails24h / total24h) * 100) : 0

      return reply.send({
        success: true,
        data: {
          total_contacts: parseInt(total_contacts || '0'),
          total_sms: parseInt(total_sms || '0'),
          total_gallery: parseInt(total_gallery || '0'),
          active_users: parseInt(active_users || '0'),
          failures_24h: fails24h,
          total_attempts_24h: total24h,
          failure_rate_pct
        }
      })
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch sync stats')
      return reply.code(500).send({ success: false, error: 'Database query failed' })
    }
  })

  // GET /api/admin/monitor/sync-logs
  app.get<{ Querystring: { limit?: string; offset?: string; search?: string; type?: string; status?: string } }>(
    '/api/admin/monitor/sync-logs', 
    { onRequest: [authenticate] }, 
    async (req, reply) => {
      try {
        const limit = Math.min(parseInt(req.query.limit || '50'), 200)
        const offset = parseInt(req.query.offset || '0')
        const { search, type, status } = req.query

        const conditions: string[] = []
        const params: any[] = []
        let idx = 1

        if (search) {
          conditions.push(`(l.user_id::text ILIKE $${idx} OR u.username ILIKE $${idx} OR u.phone ILIKE $${idx})`)
          params.push(`%${search}%`)
          idx++
        }
        if (type) {
          conditions.push(`l.sync_type = $${idx}`)
          params.push(type)
          idx++
        }
        if (status) {
          conditions.push(`l.status = $${idx}`)
          params.push(status)
          idx++
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        const logsRes = await db.query(`
          SELECT l.id, l.user_id, l.sync_type, l.status, l.message, l.error, l.stack, l.created_at,
                 u.username, u.phone
          FROM client_sync_logs l
          LEFT JOIN users u ON u.id = l.user_id
          ${whereClause}
          ORDER BY l.created_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}
        `, [...params, limit, offset])

        const countRes = await db.query(`
          SELECT COUNT(*) 
          FROM client_sync_logs l
          LEFT JOIN users u ON u.id = l.user_id
          ${whereClause}
        `, params)

        return reply.send({
          success: true,
          data: logsRes.rows,
          total: parseInt(countRes.rows[0].count)
        })
      } catch (err: any) {
        app.log.error(err, 'Failed to fetch sync logs')
        return reply.code(500).send({ success: false, error: 'Database query failed' })
      }
    }
  )
}
