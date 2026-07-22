import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Public, unauthenticated click tracking for the /join?ref=CODE referral
// landing page (infra/web/join/index.html). See
// docs/superpowers/specs/2026-07-22-agent-referral-management-design.md
export function referralPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    // POST /referral/click — logs a hit for any ref_code, no validation
    // against agents/users (intentionally blind and cheap; the reader in
    // agent-portal-routes.ts filters by the exact code it cares about).
    app.post('/referral/click', async (req, reply) => {
      const body = z.object({
        ref_code: z.string().min(1).max(20),
      }).parse(req.body)

      await db.query(
        `INSERT INTO referral_clicks (ref_code) VALUES ($1)`,
        [body.ref_code]
      )
      return reply.send({ success: true })
    })
  }
}
