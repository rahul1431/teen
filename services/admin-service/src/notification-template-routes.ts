import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'

export function registerNotificationTemplateRoutes(app: FastifyInstance, db: Pool, authenticate: any, requireRole: any) {
  // GET /api/admin/notifications/templates
  app.get('/api/admin/notifications/templates', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const res = await db.query('SELECT id, name, title, body, type, route, image_url, created_at FROM notification_templates ORDER BY name ASC')
    return reply.send(res.rows)
  })

  // POST /api/admin/notifications/templates (Create or Update template)
  app.post('/api/admin/notifications/templates', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const schema = z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(100),
      title: z.string().min(1).max(150),
      body: z.string().min(1),
      type: z.string().default('general'),
      route: z.string().nullable().optional(),
      image_url: z.string().nullable().optional(),
    })

    const data = schema.parse(req.body)

    if (data.id) {
      // Update
      const res = await db.query(
        `UPDATE notification_templates 
         SET name = $1, title = $2, body = $3, type = $4, route = $5, image_url = $6
         WHERE id = $7 RETURNING *`,
        [data.name, data.title, data.body, data.type, data.route || null, data.image_url || null, data.id]
      )
      if (!res.rows.length) return reply.code(404).send({ error: 'Template not found' })
      return reply.send(res.rows[0])
    } else {
      // Insert
      const res = await db.query(
        `INSERT INTO notification_templates (name, title, body, type, route, image_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.name, data.title, data.body, data.type, data.route || null, data.image_url || null]
      )
      return reply.send(res.rows[0])
    }
  })

  // DELETE /api/admin/notifications/templates/:id
  app.delete('/api/admin/notifications/templates/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const res = await db.query('DELETE FROM notification_templates WHERE id = $1 RETURNING id', [id])
    if (!res.rows.length) return reply.code(404).send({ error: 'Template not found' })
    return reply.send({ success: true })
  })
}
