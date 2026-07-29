import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

export function seoMarketingPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    // GET /seo/pages/:slug
    app.get('/seo/pages/:slug', async (req, reply) => {
      const { slug } = req.params as any
      const res = await db.query(
        `SELECT slug, title, body_md, is_published, meta_title, meta_description, meta_keywords, og_title, og_description, og_image
         FROM cms_pages
         WHERE slug = $1 AND is_published = true`,
        [slug]
      )
      if (!res.rows.length) {
        return reply.code(404).send({ error: 'Page not found' })
      }
      return reply.send(res.rows[0])
    })

    // GET /seo/global
    app.get('/seo/global', async (req, reply) => {
      const res = await db.query('SELECT key, value FROM seo_settings')
      const settings: Record<string, string> = {}
      for (const row of res.rows) {
        settings[row.key] = row.value || ''
      }
      return reply.send(settings)
    })

    // POST /marketing/track
    app.post('/marketing/track', async (req, reply) => {
      const body = z.object({
        utm_source: z.string().min(1).max(50),
        utm_medium: z.string().max(50).optional().nullable(),
        utm_campaign: z.string().max(50).optional().nullable(),
      }).parse(req.body)

      // Find if we have a campaign matching these parameters
      const campaignRes = await db.query(
        `SELECT id FROM marketing_campaigns
         WHERE utm_source = $1
           AND COALESCE(utm_medium, '') = COALESCE($2, '')
           AND COALESCE(utm_campaign, '') = COALESCE($3, '')
           AND is_active = true`,
        [body.utm_source, body.utm_medium || null, body.utm_campaign || null]
      )

      if (campaignRes.rows.length > 0) {
        const campaignId = campaignRes.rows[0].id
        // Increment clicks
        await db.query(
          `UPDATE marketing_campaigns
           SET clicks = clicks + 1, updated_at = NOW()
           WHERE id = $1`,
          [campaignId]
        )
        return reply.send({ success: true, campaign_id: campaignId })
      }

      return reply.send({ success: true, campaign_id: null })
    })
  }
}
