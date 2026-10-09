import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Public, unauthenticated click tracking for the /join?ref=CODE referral landing page
export function referralPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    app.post('/referral/click', async (req, reply) => {
      const body = z.object({
        ref_code: z.string().min(1).max(20),
        device_type: z.string().optional(),
        utm_source: z.string().optional(),
        utm_medium: z.string().optional(),
        utm_campaign: z.string().optional(),
        referrer_url: z.string().optional(),
      }).parse(req.body)

      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null
      const userAgent = (req.headers['user-agent'] as string) || null

      let device = body.device_type
      if (!device && userAgent) {
        if (/mobile|android|iphone|ipad|phone/i.test(userAgent)) {
          device = /tablet|ipad/i.test(userAgent) ? 'tablet' : 'mobile'
        } else {
          device = 'desktop'
        }
      }

      await db.query(
        `INSERT INTO referral_clicks (ref_code, user_agent, ip_address, device_type, utm_source, utm_medium, utm_campaign, referrer_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          body.ref_code.toUpperCase(),
          userAgent,
          ip,
          device || 'mobile',
          body.utm_source || null,
          body.utm_medium || null,
          body.utm_campaign || null,
          body.referrer_url || null,
        ]
      )
      return reply.send({ success: true })
    })
  }
}
