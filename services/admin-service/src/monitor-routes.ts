import { FastifyInstance } from 'fastify'
import axios from 'axios'

const MONITOR_URL = process.env.APP_MONITOR_SERVICE_URL || 'http://localhost:3015'

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
      const res = await axios.get(`${MONITOR_URL}/api/monitor/stats`)
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/errors`, { params: req.query })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/api-health`, { params: req.query })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/ws-health`, { params: req.query })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/sessions`, { params: req.query })
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
        const res = await axios.get(`${MONITOR_URL}/api/monitor/screen-funnel`, { params: req.query })
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
      const res = await axios.get(`${MONITOR_URL}/api/monitor/server-health`)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(
        err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
      )
    }
  })
}
