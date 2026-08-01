import { FastifyInstance } from 'fastify'
import axios from 'axios'

/**
 * Admin proxy for per-game bot training.
 *
 * Each game now has its own trainer process (services/bot-training/<game>), so
 * these routes dispatch on game_type instead of forwarding everything to the
 * single bot-learning-service. The public /api/admin/bots/* paths are
 * unchanged, so the admin panel keeps working across the cutover.
 */

const BOT_SERVICES: Record<string, string> = {
  teen_patti: process.env.TEEN_PATTI_BOT_SERVICE_URL || 'http://localhost:3023',
  ludo:       process.env.LUDO_BOT_SERVICE_URL       || 'http://localhost:3024',
}

const INTERNAL_HEADERS = { headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' } }

const serviceFor = (gameType?: string): string | null =>
  gameType && BOT_SERVICES[gameType] ? BOT_SERVICES[gameType] : null

const failure = (err: any, gameType?: string) => ({
  status: err.response?.status ?? 500,
  body: err.response?.data ?? {
    success: false,
    error: `Bot training service unavailable${gameType ? ` for ${gameType}` : ''}`,
  },
})

export async function registerBotLearningRoutes(app: FastifyInstance, authenticate: any, requireRole: any) {
  app.get<{ Querystring: { game_type?: string; difficulty?: string } }>(
    '/api/admin/bots/profile',
    { onRequest: [authenticate] },
    async (req, reply) => {
      const url = serviceFor(req.query.game_type)
      if (!url) {
        return reply.code(400).send({ success: false, error: 'game_type must be teen_patti or ludo' })
      }
      if (!req.query.difficulty) {
        return reply.code(400).send({ success: false, error: 'difficulty is required' })
      }
      try {
        const res = await axios.get(
          `${url}/api/bot/profile?difficulty=${encodeURIComponent(req.query.difficulty)}`,
          INTERNAL_HEADERS
        )
        return reply.send(res.data)
      } catch (err: any) {
        const { status, body } = failure(err, req.query.game_type)
        return reply.code(status).send(body)
      }
    }
  )

  // Aggregated view across both games. Each service returns rows without a
  // game_type (its table has no such column any more), so it is stamped back on
  // here — the admin panel groups by it. One service being down degrades to a
  // partial list plus an explicit `unavailable` array rather than failing the
  // whole page.
  app.get('/api/admin/bots/profiles', { onRequest: [authenticate] }, async (_req, reply) => {
    const rows: any[] = []
    const unavailable: string[] = []

    await Promise.all(
      Object.entries(BOT_SERVICES).map(async ([gameType, url]) => {
        try {
          const res = await axios.get(`${url}/api/bot/profiles`, INTERNAL_HEADERS)
          for (const row of res.data?.data ?? []) rows.push({ ...row, game_type: gameType })
        } catch {
          unavailable.push(gameType)
        }
      })
    )

    if (unavailable.length === Object.keys(BOT_SERVICES).length) {
      return reply.code(503).send({ success: false, error: 'All bot training services unavailable' })
    }
    return reply.send({ success: true, data: rows, unavailable })
  })

  // Rebuild one game, or both when game_type is omitted. Kept as a fan-out
  // rather than two routes so the existing admin button keeps working.
  app.post<{ Body?: { game_type?: string } }>(
    '/api/admin/bots/rebuild',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const requested = req.body?.game_type
      if (requested && !BOT_SERVICES[requested]) {
        return reply.code(400).send({ success: false, error: 'game_type must be teen_patti or ludo' })
      }
      const targets = requested ? [requested] : Object.keys(BOT_SERVICES)

      const started: string[] = []
      const failed: string[] = []
      await Promise.all(
        targets.map(async gameType => {
          try {
            // A bodyless axios.post sends x-www-form-urlencoded, which Fastify
            // rejects with 415 — send an explicit empty JSON body.
            await axios.post(`${BOT_SERVICES[gameType]}/internal/bot/rebuild`, {}, INTERNAL_HEADERS)
            started.push(gameType)
          } catch {
            failed.push(gameType)
          }
        })
      )

      if (started.length === 0) {
        return reply.code(503).send({ success: false, error: 'No bot training service reachable', failed })
      }
      return reply.send({ success: true, data: { status: 'started', started, failed } })
    }
  )

  app.get<{ Querystring: { game_type?: string } }>(
    '/api/admin/bots/config',
    { onRequest: [authenticate] },
    async (req, reply) => {
      const url = serviceFor(req.query.game_type)
      if (!url) {
        return reply.code(400).send({ success: false, error: 'game_type must be teen_patti or ludo' })
      }
      try {
        const res = await axios.get(`${url}/api/bot/config`, INTERNAL_HEADERS)
        return reply.send(res.data)
      } catch (err: any) {
        const { status, body } = failure(err, req.query.game_type)
        return reply.code(status).send(body)
      }
    }
  )

  app.patch<{ Querystring: { game_type?: string } }>(
    '/api/admin/bots/config',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const url = serviceFor(req.query.game_type)
      if (!url) {
        return reply.code(400).send({ success: false, error: 'game_type must be teen_patti or ludo' })
      }
      try {
        const res = await axios.patch(`${url}/api/bot/config`, req.body, INTERNAL_HEADERS)
        return reply.send(res.data)
      } catch (err: any) {
        const { status, body } = failure(err, req.query.game_type)
        return reply.code(status).send(body)
      }
    }
  )

  app.patch<{ Params: { gameType: string; difficulty: string } }>(
    '/api/admin/bots/profiles/:gameType/:difficulty',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const url = serviceFor(req.params.gameType)
      if (!url) {
        return reply.code(400).send({ success: false, error: 'gameType must be teen_patti or ludo' })
      }
      try {
        const res = await axios.patch(
          `${url}/api/bot/profiles/${req.params.difficulty}`,
          req.body,
          INTERNAL_HEADERS
        )
        return reply.send(res.data)
      } catch (err: any) {
        const { status, body } = failure(err, req.params.gameType)
        return reply.code(status).send(body)
      }
    }
  )

  // Ludo-only: how much human decision data has accumulated, and whether it
  // clears the training threshold. Teen Patti's equivalent lives behind its own
  // ML training panel and is not proxied here yet.
  app.get('/api/admin/bots/ludo/training-status', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${BOT_SERVICES.ludo}/api/bot/training-status`, INTERNAL_HEADERS)
      return reply.send(res.data)
    } catch (err: any) {
      const { status, body } = failure(err, 'ludo')
      return reply.code(status).send(body)
    }
  })
}
