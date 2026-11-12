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
              c.delivered_count, c.created_at, c.scheduled_for, c.status, c.image_url, c.segment_type,
              c.clicked_count, c.converted_count, c.conversion_revenue, c.quiet_hours_enabled,
              c.skipped_fatigue_count, c.frequency_cap, c.action_buttons,
              c.delivery_channels, c.whatsapp_sent_count, c.sms_sent_count, c.fallback_triggered_count,
              au.username AS sent_by_username,
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
        clicked_count: r.clicked_count || 0,
        click_rate: r.total_recipients > 0 ? (r.clicked_count || 0) / r.total_recipients : 0,
        converted_count: r.converted_count || 0,
        conversion_rate: r.total_recipients > 0 ? (r.converted_count || 0) / r.total_recipients : 0,
        conversion_revenue: parseFloat(r.conversion_revenue || '0'),
        skipped_fatigue_count: r.skipped_fatigue_count || 0,
        whatsapp_sent_count: r.whatsapp_sent_count || 0,
        sms_sent_count: r.sms_sent_count || 0,
        fallback_triggered_count: r.fallback_triggered_count || 0,
        read_rate: r.total_recipients > 0 ? r.read_count / r.total_recipients : 0,
      })),
      total: countRes.rows[0].c,
      page,
      limit,
    })
  })

  // GET /api/admin/notifications/analytics?days=30 — daily send/read-rate trend + per-type breakdown + attribution KPIs
  app.get('/api/admin/notifications/analytics', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { days = '30' } = req.query as any
    const daysInt = parseInt(days, 10) || 30

    const totalsRes = await db.query(
      `SELECT COUNT(*)::int AS total_campaigns,
              COALESCE(SUM(c.total_recipients), 0)::int AS total_recipients,
              COALESCE(SUM(c.delivered_count), 0)::int AS total_delivered,
              COALESCE(SUM(c.clicked_count), 0)::int AS total_clicks,
              COALESCE(SUM(c.converted_count), 0)::int AS total_conversions,
              COALESCE(SUM(c.skipped_fatigue_count), 0)::int AS total_fatigue_protected,
              COALESCE(SUM(c.whatsapp_sent_count), 0)::int AS total_whatsapp,
              COALESCE(SUM(c.sms_sent_count), 0)::int AS total_sms,
              COALESCE(SUM(c.fallback_triggered_count), 0)::int AS total_fallbacks,
              COALESCE(SUM(c.conversion_revenue), 0)::float AS total_revenue
       FROM notification_campaigns c
       WHERE c.created_at >= NOW() - ($1 || ' days')::interval`,
      [daysInt]
    )

    const trendRes = await db.query(
      `SELECT date_trunc('day', c.created_at) AS day,
              COUNT(*)::int AS campaigns_sent,
              AVG(CASE WHEN c.total_recipients > 0
                THEN (SELECT COUNT(*)::float FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) / c.total_recipients
                ELSE 0 END) AS avg_read_rate,
              AVG(CASE WHEN c.total_recipients > 0
                THEN COALESCE(c.clicked_count, 0)::float / c.total_recipients
                ELSE 0 END) AS avg_click_rate,
              SUM(COALESCE(c.conversion_revenue, 0))::float AS daily_revenue
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
                ELSE 0 END) AS avg_read_rate,
              AVG(CASE WHEN c.total_recipients > 0
                THEN COALESCE(c.clicked_count, 0)::float / c.total_recipients
                ELSE 0 END) AS avg_click_rate,
              SUM(COALESCE(c.conversion_revenue, 0))::float AS total_revenue
       FROM notification_campaigns c
       WHERE c.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY c.type
       ORDER BY campaigns_sent DESC`,
      [daysInt],
    )

    const totals = totalsRes.rows[0] || {}
    const ctr = totals.total_recipients > 0 ? (totals.total_clicks / totals.total_recipients) * 100 : 0
    const cvr = totals.total_recipients > 0 ? (totals.total_conversions / totals.total_recipients) * 100 : 0

    return reply.send({
      totals: {
        totalCampaigns: totals.total_campaigns || 0,
        totalRecipients: totals.total_recipients || 0,
        totalDelivered: totals.total_delivered || 0,
        totalClicks: totals.total_clicks || 0,
        ctr: parseFloat(ctr.toFixed(1)),
        totalConversions: totals.total_conversions || 0,
        cvr: parseFloat(cvr.toFixed(1)),
        totalFatigueProtected: totals.total_fatigue_protected || 0,
        totalWhatsapp: totals.total_whatsapp || 0,
        totalSms: totals.total_sms || 0,
        totalFallbacks: totals.total_fallbacks || 0,
        totalRevenue: parseFloat(totals.total_revenue || 0),
      },
      trend: trendRes.rows.map((r: any) => ({
        date: r.day,
        campaignsSent: r.campaigns_sent,
        avgReadRate: parseFloat(r.avg_read_rate) || 0,
        avgClickRate: parseFloat(r.avg_click_rate) || 0,
        dailyRevenue: parseFloat(r.daily_revenue) || 0,
      })),
      byType: typeRes.rows.map((r: any) => ({
        type: r.type,
        campaignsSent: r.campaigns_sent,
        avgReadRate: parseFloat(r.avg_read_rate) || 0,
        avgClickRate: parseFloat(r.avg_click_rate) || 0,
        totalRevenue: parseFloat(r.total_revenue) || 0,
      })),
    })
  })

  // GET /api/admin/notifications/read-time-analytics?days=30 — how many
  // notifications get opened at each hour of the day (IST), across all
  // notifications (not just campaign sends) -- helps pick send times that
  // land when users are actually likely to open them.
  app.get('/api/admin/notifications/read-time-analytics', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { days = '30' } = req.query as any
    const daysInt = parseInt(days, 10) || 30

    const hourRes = await db.query(
      `SELECT EXTRACT(HOUR FROM read_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*)::int AS reads
       FROM notifications
       WHERE read = true AND read_at >= NOW() - ($1 || ' days')::interval
       GROUP BY hour
       ORDER BY hour`,
      [daysInt],
    )

    const byHour = new Map<number, number>(hourRes.rows.map((r: any) => [r.hour, r.reads]))
    const readsByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, reads: byHour.get(hour) ?? 0 }))

    return reply.send({ readsByHour })
  })

  // GET /api/admin/notifications/campaigns/:id — single campaign details
  app.get('/api/admin/notifications/campaigns/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT c.*, au.username as sent_by_username,
              (SELECT COUNT(*)::int FROM notifications n WHERE n.campaign_id = c.id AND n.read = true) AS read_count
       FROM notification_campaigns c
       LEFT JOIN admin_users au ON au.id = c.sent_by
       WHERE c.id = $1`,
      [id]
    )
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Campaign not found' })
    const r = res.rows[0]
    return reply.send({
      ...r,
      clicked_count: r.clicked_count || 0,
      click_rate: r.total_recipients > 0 ? (r.clicked_count || 0) / r.total_recipients : 0,
      converted_count: r.converted_count || 0,
      conversion_rate: r.total_recipients > 0 ? (r.converted_count || 0) / r.total_recipients : 0,
      conversion_revenue: parseFloat(r.conversion_revenue || '0'),
      skipped_fatigue_count: r.skipped_fatigue_count || 0,
      whatsapp_sent_count: r.whatsapp_sent_count || 0,
      sms_sent_count: r.sms_sent_count || 0,
      fallback_triggered_count: r.fallback_triggered_count || 0,
      read_rate: r.total_recipients > 0 ? r.read_count / r.total_recipients : 0,
    })
  })

  // DELETE /api/admin/notifications/campaigns/:id — cancel/delete campaign
  app.delete('/api/admin/notifications/campaigns/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query(`DELETE FROM notification_campaigns WHERE id = $1`, [id])
    return reply.send({ success: true })
  })

  // GET /api/admin/notifications/templates — list saved templates
  app.get('/api/admin/notifications/templates', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const res = await db.query(`SELECT * FROM notification_templates ORDER BY created_at DESC`)
    return reply.send(res.rows)
  })

  // POST /api/admin/notifications/templates — save new template
  app.post('/api/admin/notifications/templates', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { name, title, body, type = 'general', route, image_url, action_buttons } = req.body as any
    if (!name || !title || !body) {
      return reply.code(400).send({ error: 'name, title, and body are required' })
    }
    const res = await db.query(
      `INSERT INTO notification_templates (name, title, body, type, route, image_url, action_buttons)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, title, body, type, route || null, image_url || null, action_buttons ? JSON.stringify(action_buttons) : null]
    )
    return reply.send(res.rows[0])
  })

  // PUT /api/admin/notifications/templates/:id — update template
  app.put('/api/admin/notifications/templates/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const { name, title, body, type = 'general', route, image_url, action_buttons } = req.body as any
    const res = await db.query(
      `UPDATE notification_templates
       SET name = COALESCE($1, name),
           title = COALESCE($2, title),
           body = COALESCE($3, body),
           type = COALESCE($4, type),
           route = $5,
           image_url = $6,
           action_buttons = $7
       WHERE id = $8
       RETURNING *`,
      [name, title, body, type, route || null, image_url || null, action_buttons ? JSON.stringify(action_buttons) : null, id]
    )
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Template not found' })
    return reply.send(res.rows[0])
  })

  // DELETE /api/admin/notifications/templates/:id — delete template
  app.delete('/api/admin/notifications/templates/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query(`DELETE FROM notification_templates WHERE id = $1`, [id])
    return reply.send({ success: true })
  })
}
