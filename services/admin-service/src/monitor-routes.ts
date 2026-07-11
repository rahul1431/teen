import { FastifyInstance } from 'fastify'
import axios from 'axios'

const MONITOR_URL = process.env.APP_MONITOR_SERVICE_URL || 'http://localhost:3015'
const MONITOR_TIMEOUT_MS = 10000 // 10 second timeout for all monitor API calls

export async function registerMonitorRoutes(
  app: FastifyInstance,
  authenticate: any,
  requireRole: any
) {
  // All monitor routes are read-only observability data accessible to any
  // authenticated admin. requireRole is accepted for signature compatibility
  // but not applied here by design.
  app.get('/api/admin/monitor/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${MONITOR_URL}/api/monitor/stats`, { timeout: MONITOR_TIMEOUT_MS })
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(
        err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
      )
    }
  })

  app.get('/api/admin/monitor/uptime', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${MONITOR_URL}/api/monitor/uptime`, { timeout: MONITOR_TIMEOUT_MS })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/errors`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/api-health`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/ws-health`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/sessions`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/screen-funnel`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
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
      const res = await axios.get(`${MONITOR_URL}/api/monitor/server-health`, { timeout: MONITOR_TIMEOUT_MS })
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(
        err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
      )
    }
  })

  // Player tracking routes (superadmin only - PII + location data)
  app.get('/api/admin/monitor/live-players',
    { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/live-players`, { timeout: MONITOR_TIMEOUT_MS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  app.get<{ Params: { userId: string } }>('/api/admin/monitor/player/:userId',
    { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/player/${encodeURIComponent(req.params.userId)}`, { timeout: MONITOR_TIMEOUT_MS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  app.get('/api/admin/monitor/geo-distribution',
    { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/geo-distribution`, { timeout: MONITOR_TIMEOUT_MS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  app.get<{ Querystring: { hours?: string } }>('/api/admin/monitor/engagement',
    { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/engagement`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  // Alerts raised by the app-monitor alert engine
  app.get<{ Querystring: { limit?: string } }>('/api/admin/monitor/alerts',
    { onRequest: [authenticate] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/alerts`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  app.get<{ Querystring: { limit?: string } }>('/api/admin/monitor/remediations',
    { onRequest: [authenticate] }, async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/remediations`, { params: req.query, timeout: MONITOR_TIMEOUT_MS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })

  app.post<{ Params: { id: string } }>('/api/admin/monitor/alerts/:id/ack',
    { onRequest: [authenticate] }, async (req, reply) => {
      try {
        const res = await axios.post(`${MONITOR_URL}/api/monitor/alerts/${encodeURIComponent(req.params.id)}/ack`, {}, { timeout: MONITOR_TIMEOUT_MS })
        return reply.send(res.data)
      }
      catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' })
      }
    })
}
