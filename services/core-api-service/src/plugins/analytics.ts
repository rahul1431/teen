import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import { evaluateFlag, FeatureFlag } from '../flag-evaluation'

// Player-facing event tracking + feature-flag evaluation. See
// docs/superpowers/specs/2026-07-21-product-analytics-design.md
export function analyticsPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    // POST /events tolerates an unauthenticated caller (pre-login events,
    // e.g. "app_opened" before signup) — user_id is nullable, so we attempt
    // jwtVerify but never reject on failure, unlike app.authenticate.
    app.post('/events', async (req, reply) => {
      const body = z.object({
        event_name: z.string().min(1).max(100),
        properties: z.record(z.any()).optional(),
      }).parse(req.body)

      let userId: string | null = null
      try {
        await req.jwtVerify()
        userId = (req.user as any)?.sub ?? null
      } catch {
        // Not logged in — user_id stays null, which the schema allows.
      }

      await db.query(
        `INSERT INTO product_events (user_id, event_name, properties, source) VALUES ($1, $2, $3, 'mobile')`,
        [userId, body.event_name, JSON.stringify(body.properties || {})]
      )
      return reply.send({ success: true })
    })

    // GET /flags requires a logged-in player — evaluated once per app launch
    // and cached client-side, not called per screen/check.
    app.get('/flags', { onRequest: [app.authenticate] }, async (req, reply) => {
      const userId = (req.user as any).sub
      const flagsRes = await db.query(
        `SELECT key, enabled, rollout_percent, enabled_user_ids, variants FROM feature_flags`
      )
      const results: Record<string, { enabled: boolean; variant?: string }> = {}
      for (const row of flagsRes.rows) {
        const flag: FeatureFlag = {
          key: row.key,
          enabled: row.enabled,
          rolloutPercent: row.rollout_percent,
          enabledUserIds: row.enabled_user_ids || [],
          variants: row.variants,
        }
        results[row.key] = evaluateFlag(flag, userId)
      }
      return reply.send(results)
    })
  }
}
