import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { buildCampaignsFilter, resolveCampaignsLimit } from './notification-campaigns-query'

export function registerNotificationCampaignRoutes(app: FastifyInstance, db: Pool, authenticate: any, requireRole: any) {
  // GET /api/admin/notifications/campaigns — paginated history of admin-initiated sends
  app.get('/api/admin/notifications/campaigns', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const q = req.query as { type?: string; startDate?: string; endDate?: string; page?: string; limit?: string }
    const limit = resolveCampaignsLimit(q.limit)
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1)
    const offset = (page - 1) * limit

    const { clause, params } = buildCampaignsFilter(q.type, q.startDate, q.endDate)
    const listParams = [...params, limit, offset]

    const rows = await db.query(
      `SELECT c.id, c.title, c.type, c.target_type, c.target_user_id, c.total_recipients,
              c.delivered_count, c.created_at, au.username AS sent_by_username,
              (SELECT COUNT(*)::int FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) AS read_count
       FROM notification_campaigns c
       LEFT JOIN admin_users au ON au.id = c.sent_by
       ${clause}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    )

    const countRes = await db.query(`SELECT COUNT(*)::int AS c FROM notification_campaigns ${clause}`, params)

    return reply.send({
      campaigns: rows.rows.map((r: any) => ({
        ...r,
        read_rate: r.total_recipients > 0 ? r.read_count / r.total_recipients : 0,
      })),
      total: countRes.rows[0].c,
      page,
      limit,
    })
  })

  // GET /api/admin/notifications/analytics?days=30 — daily send/read-rate trend + per-type breakdown
  app.get('/api/admin/notifications/analytics', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { days = '30' } = req.query as any
    const daysInt = parseInt(days, 10) || 30

    const trendRes = await db.query(
      `SELECT date_trunc('day', c.created_at) AS day,
              COUNT(*)::int AS campaigns_sent,
              AVG(CASE WHEN c.total_recipients > 0
                THEN (SELECT COUNT(*)::float FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) / c.total_recipients
                ELSE 0 END) AS avg_read_rate
       FROM notification_campaigns c
       WHERE c.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day ASC`,
      [daysInt],
    )

    const typeRes = await db.query(
      `SELECT c.type,
              COUNT(*)::int AS campaigns_sent,
              AVG(CASE WHEN c.total_recipients > 0
                THEN (SELECT COUNT(*)::float FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) / c.total_recipients
                ELSE 0 END) AS avg_read_rate
       FROM notification_campaigns c
       WHERE c.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY c.type
       ORDER BY campaigns_sent DESC`,
      [daysInt],
    )

    return reply.send({
      trend: trendRes.rows.map((r: any) => ({
        date: r.day,
        campaignsSent: r.campaigns_sent,
        avgReadRate: parseFloat(r.avg_read_rate) || 0,
      })),
      byType: typeRes.rows.map((r: any) => ({
        type: r.type,
        campaignsSent: r.campaigns_sent,
        avgReadRate: parseFloat(r.avg_read_rate) || 0,
      })),
    })
  })
}
