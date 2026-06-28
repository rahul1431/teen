import { FastifyInstance } from 'fastify'
import axios from 'axios'

const CHURN_URL = process.env.CHURN_SERVICE_URL || 'http://localhost:3013'

export async function registerChurnRoutes(app: FastifyInstance, authenticate: any, requireRole: any) {
  // GET /api/admin/churn/users — list at-risk users from churn service
  app.get('/api/admin/churn/users', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const res = await axios.get(`${CHURN_URL}/api/churn/users`, { params: (req.query as any) })
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Churn service unavailable' })
    }
  })

  // GET /api/admin/churn/stats — churn aggregate stats
  app.get('/api/admin/churn/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${CHURN_URL}/api/churn/stats`)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Churn service unavailable' })
    }
  })

  // POST /api/admin/churn/re-engage/:userId — trigger re-engagement for a user
  app.post<{ Params: { userId: string } }>(
    '/api/admin/churn/re-engage/:userId',
    { onRequest: [authenticate, requireRole('support')] },
    async (req, reply) => {
      try {
        const res = await axios.post(`${CHURN_URL}/api/churn/re-engage/${req.params.userId}`, req.body)
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Churn service unavailable' })
      }
    }
  )

  // GET /api/admin/churn/config — get churn model configuration
  app.get('/api/admin/churn/config', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${CHURN_URL}/api/churn/config`)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Churn service unavailable' })
    }
  })

  // PATCH /api/admin/churn/config — update churn model configuration (superadmin only)
  app.patch(
    '/api/admin/churn/config',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      try {
        const res = await axios.patch(`${CHURN_URL}/api/churn/config`, req.body)
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Churn service unavailable' })
      }
    }
  )
}
