import { FastifyInstance } from 'fastify'
import axios from 'axios'

const BOT_URL = process.env.BOT_LEARNING_SERVICE_URL || 'http://localhost:3014'
const INTERNAL_HEADERS = { headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' } }

export async function registerBotLearningRoutes(app: FastifyInstance, authenticate: any, requireRole: any) {
  app.get<{ Querystring: { game_type?: string; difficulty?: string } }>(
    '/api/admin/bots/profile',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const params = new URLSearchParams()
        if (req.query.game_type) params.set('game_type', req.query.game_type)
        if (req.query.difficulty) params.set('difficulty', req.query.difficulty)
        const res = await axios.get(`${BOT_URL}/api/bots/profile?${params.toString()}`, INTERNAL_HEADERS)
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Bot learning service unavailable' })
      }
    }
  )

  app.get('/api/admin/bots/profiles', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${BOT_URL}/api/bots/profiles`, INTERNAL_HEADERS)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Bot learning service unavailable' })
    }
  })

  app.post('/api/admin/bots/rebuild', { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    try {
      // Bodyless axios.post sends x-www-form-urlencoded, which Fastify rejects
      // with 415 — send an explicit empty JSON body instead.
      const res = await axios.post(`${BOT_URL}/api/bots/rebuild`, {}, INTERNAL_HEADERS)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Bot learning service unavailable' })
    }
  })

  app.get('/api/admin/bots/config', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${BOT_URL}/api/bots/config`, INTERNAL_HEADERS)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Bot learning service unavailable' })
    }
  })

  app.patch('/api/admin/bots/config', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    try {
      const res = await axios.patch(`${BOT_URL}/api/bots/config`, req.body, INTERNAL_HEADERS)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Bot learning service unavailable' })
    }
  })

  app.patch<{ Params: { gameType: string; difficulty: string } }>(
    '/api/admin/bots/profiles/:gameType/:difficulty',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      try {
        const res = await axios.patch(
          `${BOT_URL}/api/bots/profiles/${req.params.gameType}/${req.params.difficulty}`,
          req.body,
          INTERNAL_HEADERS
        )
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'Bot learning service unavailable' })
      }
    }
  )
}
