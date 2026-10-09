// services/admin-service/src/analytics-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Enterprise Funnel Analytics, Multi-Stage Attribution & Feature Flags
export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  // GET /api/admin/analytics/funnels/master?days=30
  // Multi-stage complete player acquisition & monetization funnel
  app.get('/api/admin/analytics/funnels/master', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query)

    const [clicksRes, usersRes, ftdRes, betsRes, repeatRes, volumeRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total_clicks,
                COUNT(DISTINCT ip_address)::int AS unique_visitors
         FROM referral_clicks
         WHERE clicked_at >= NOW() - ($1 || ' days')::interval`,
        [days]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total_signups,
                COUNT(*) FILTER (WHERE agent_id IS NOT NULL)::int AS agent_signups,
                COUNT(*) FILTER (WHERE agent_id IS NULL)::int AS organic_signups
         FROM users
         WHERE created_at >= NOW() - ($1 || ' days')::interval`,
        [days]
      ),
      db.query(
        `SELECT COUNT(DISTINCT u.id)::int AS total_ftds,
                COALESCE(SUM(wt.amount), 0)::float AS total_ftd_amount
         FROM users u
         JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'deposit' AND wt.status = 'completed'
         WHERE u.created_at >= NOW() - ($1 || ' days')::interval`,
        [days]
      ),
      db.query(
        `SELECT COUNT(DISTINCT u.id)::int AS total_betters
         FROM users u
         JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'game_debit' AND wt.status = 'completed'
         WHERE u.created_at >= NOW() - ($1 || ' days')::interval`,
        [days]
      ),
      db.query(
        `SELECT COUNT(DISTINCT u.id)::int AS total_repeat_active
         FROM users u
         JOIN (
           SELECT user_id, SUM(amount) AS total_wager, COUNT(DISTINCT created_at::date) AS active_days
           FROM wallet_transactions
           WHERE type = 'game_debit' AND status = 'completed'
           GROUP BY user_id
           HAVING SUM(amount) >= 500 OR COUNT(DISTINCT created_at::date) >= 2
         ) active_p ON active_p.user_id = u.id
         WHERE u.created_at >= NOW() - ($1 || ' days')::interval`,
        [days]
      ),
      db.query(
        `SELECT COALESCE(SUM(CASE WHEN wt.type = 'deposit' THEN wt.amount ELSE 0 END), 0)::float AS total_deposits,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)::float AS total_turnover,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE -wt.amount END), 0)::float AS net_ggr
         FROM users u
         JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.status = 'completed' AND wt.type IN ('deposit', 'game_debit', 'game_credit')
         WHERE u.created_at >= NOW() - ($1 || ' days')::interval`,
        [days]
      ),
    ])

    const clicks = clicksRes.rows[0]?.total_clicks || 0
    const uniqueVisitors = clicksRes.rows[0]?.unique_visitors || 0
    const signups = usersRes.rows[0]?.total_signups || 0
    const ftds = ftdRes.rows[0]?.total_ftds || 0
    const betters = betsRes.rows[0]?.total_betters || 0
    const repeatActive = repeatRes.rows[0]?.total_repeat_active || 0

    const effectiveVisits = Math.max(clicks, signups)

    const stages = [
      {
        key: 'visits',
        label: '1. Link Clicks & Visits',
        count: effectiveVisits,
        conversion_from_prev: 100,
        drop_off: 0,
        icon: '🔗',
      },
      {
        key: 'signups',
        label: '2. Registrations / Signups',
        count: signups,
        conversion_from_prev: effectiveVisits > 0 ? Number(((signups / effectiveVisits) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, effectiveVisits - signups),
        icon: '📝',
      },
      {
        key: 'ftd',
        label: '3. First Deposit (FTD)',
        count: ftds,
        conversion_from_prev: signups > 0 ? Number(((ftds / signups) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, signups - ftds),
        icon: '💳',
      },
      {
        key: 'first_bet',
        label: '4. First Game Bet / Wager',
        count: betters,
        conversion_from_prev: ftds > 0 ? Number(((betters / ftds) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, ftds - betters),
        icon: '🎲',
      },
      {
        key: 'repeat_active',
        label: '5. Retained / Active Wagering',
        count: repeatActive,
        conversion_from_prev: betters > 0 ? Number(((repeatActive / betters) * 100).toFixed(1)) : 0,
        drop_off: Math.max(0, betters - repeatActive),
        icon: '⭐',
      },
    ]

    return reply.send({
      days,
      summary: {
        total_clicks: clicks,
        unique_visitors: uniqueVisitors,
        signups,
        agent_signups: usersRes.rows[0]?.agent_signups || 0,
        organic_signups: usersRes.rows[0]?.organic_signups || 0,
        ftds,
        total_ftd_amount: ftdRes.rows[0]?.total_ftd_amount || 0,
        betters,
        repeat_active: repeatActive,
        total_deposits: volumeRes.rows[0]?.total_deposits || 0,
        total_turnover: volumeRes.rows[0]?.total_turnover || 0,
        net_ggr: volumeRes.rows[0]?.net_ggr || 0,
        overall_conversion_rate: effectiveVisits > 0 ? Number(((ftds / effectiveVisits) * 100).toFixed(2)) : 0,
      },
      stages,
    })
  })

  // GET /api/admin/analytics/funnels/sources?days=30
  // Grouped by UTM Source, Campaign, and Device Type
  app.get('/api/admin/analytics/funnels/sources', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query)

    const [utmRes, deviceRes] = await Promise.all([
      db.query(
        `SELECT COALESCE(rc.utm_source, 'Direct / Referral Link') AS utm_source,
                COUNT(rc.id)::int AS clicks,
                COUNT(DISTINCT rc.converted_user_id)::int AS signups,
                COUNT(DISTINCT wt.user_id)::int AS ftds,
                COALESCE(SUM(CASE WHEN wt.type = 'deposit' THEN wt.amount ELSE 0 END), 0)::float AS deposit_volume,
                COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)::float AS total_turnover
         FROM referral_clicks rc
         LEFT JOIN users u ON u.id = rc.converted_user_id
         LEFT JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.status = 'completed'
         WHERE rc.clicked_at >= NOW() - ($1 || ' days')::interval
         GROUP BY COALESCE(rc.utm_source, 'Direct / Referral Link')
         ORDER BY clicks DESC LIMIT 20`,
        [days]
      ),
      db.query(
        `SELECT COALESCE(rc.device_type, 'mobile') AS device_type,
                COUNT(rc.id)::int AS clicks,
                COUNT(DISTINCT rc.converted_user_id)::int AS signups
         FROM referral_clicks rc
         WHERE rc.clicked_at >= NOW() - ($1 || ' days')::interval
         GROUP BY COALESCE(rc.device_type, 'mobile')`,
        [days]
      ),
    ])

    return reply.send({
      utm_sources: utmRes.rows.map(r => ({
        source: r.utm_source,
        clicks: r.clicks,
        signups: r.signups,
        ftds: r.ftds,
        deposit_volume: r.deposit_volume,
        total_turnover: r.total_turnover,
        signup_conversion_rate: r.clicks > 0 ? Number(((r.signups / r.clicks) * 100).toFixed(1)) : 0,
        ftd_conversion_rate: r.signups > 0 ? Number(((r.ftds / r.signups) * 100).toFixed(1)) : 0,
      })),
      devices: deviceRes.rows,
    })
  })

  // GET /api/admin/analytics/funnels/agent-leaderboard?days=30
  app.get('/api/admin/analytics/funnels/agent-leaderboard', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query)

    const res = await db.query(
      `SELECT a.id, a.username, a.display_name, a.referral_code,
              (SELECT COUNT(*) FROM referral_clicks rc WHERE UPPER(rc.ref_code) = UPPER(a.referral_code) AND rc.clicked_at >= NOW() - ($1 || ' days')::interval)::int AS clicks,
              COUNT(u.id)::int AS signups,
              COUNT(u.id) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type = 'deposit' AND wt.status = 'completed'))::int AS ftds,
              COALESCE(SUM(CASE WHEN wt.type = 'deposit' THEN wt.amount ELSE 0 END), 0)::float AS total_deposits,
              COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)::float AS total_turnover,
              COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE -wt.amount END), 0)::float AS net_ggr
       FROM agents a
       LEFT JOIN users u ON u.agent_id = a.id AND u.created_at >= NOW() - ($1 || ' days')::interval
       LEFT JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.status = 'completed' AND wt.type IN ('deposit', 'game_debit', 'game_credit')
       GROUP BY a.id
       ORDER BY total_turnover DESC LIMIT 25`,
      [days]
    )

    return reply.send(res.rows.map(r => ({
      ...r,
      conversion_rate: r.clicks > 0 ? Number(((r.signups / r.clicks) * 100).toFixed(1)) : (r.signups > 0 ? 100 : 0),
      ftd_rate: r.signups > 0 ? Number(((r.ftds / r.signups) * 100).toFixed(1)) : 0,
    })))
  })

  // GET /api/admin/analytics/retention?days=30
  // Multi-day cohort retention matrix (D1, D3, D7, D14, D30)
  app.get('/api/admin/analytics/retention', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(180).default(30) }).parse(req.query)

    const res = await db.query(
      `SELECT
         (u.agent_id IS NOT NULL) AS is_agent_referred,
         COUNT(*)::int AS cohort_size,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt
           WHERE wt.user_id = u.id AND wt.created_at >= u.created_at + INTERVAL '1 day'
         ))::int AS d1_active,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt
           WHERE wt.user_id = u.id AND wt.created_at >= u.created_at + INTERVAL '3 days'
         ))::int AS d3_active,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt
           WHERE wt.user_id = u.id AND wt.created_at >= u.created_at + INTERVAL '7 days'
         ))::int AS d7_active,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt
           WHERE wt.user_id = u.id AND wt.created_at >= u.created_at + INTERVAL '14 days'
         ))::int AS d14_active,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt
           WHERE wt.user_id = u.id AND wt.created_at >= u.created_at + INTERVAL '30 days'
         ))::int AS d30_active
       FROM users u
       WHERE u.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY is_agent_referred`,
      [days]
    )

    return reply.send(res.rows.map(r => ({
      cohort: r.is_agent_referred ? 'Agent-Referred' : 'Organic / Direct',
      cohort_size: r.cohort_size,
      d1: r.cohort_size > 0 ? Number(((r.d1_active / r.cohort_size) * 100).toFixed(1)) : 0,
      d3: r.cohort_size > 0 ? Number(((r.d3_active / r.cohort_size) * 100).toFixed(1)) : 0,
      d7: r.cohort_size > 0 ? Number(((r.d7_active / r.cohort_size) * 100).toFixed(1)) : 0,
      d14: r.cohort_size > 0 ? Number(((r.d14_active / r.cohort_size) * 100).toFixed(1)) : 0,
      d30: r.cohort_size > 0 ? Number(((r.d30_active / r.cohort_size) * 100).toFixed(1)) : 0,
      raw: {
        d1: r.d1_active,
        d3: r.d3_active,
        d7: r.d7_active,
        d14: r.d14_active,
        d30: r.d30_active,
      }
    })))
  })

  // GET /api/admin/analytics/flags
  app.get('/api/admin/analytics/flags', { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT id, key, description, enabled, rollout_percent, enabled_user_ids, variants, created_at, updated_at FROM feature_flags ORDER BY created_at DESC`
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/analytics/flags
  app.post('/api/admin/analytics/flags', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const body = z.object({
      key: z.string().min(1).max(100),
      description: z.string().optional(),
      enabled: z.boolean().default(false),
      rollout_percent: z.number().min(0).max(100).default(0),
      enabled_user_ids: z.array(z.string().uuid()).default([]),
      variants: z.array(z.object({ key: z.string(), weight: z.number().min(1) })).nullable().optional(),
    }).parse(req.body)

    const existing = await db.query('SELECT 1 FROM feature_flags WHERE key = $1', [body.key])
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Flag key already exists' })

    const res = await db.query(
      `INSERT INTO feature_flags (key, description, enabled, rollout_percent, enabled_user_ids, variants)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.key, body.description || null, body.enabled, body.rollout_percent, JSON.stringify(body.enabled_user_ids), body.variants ? JSON.stringify(body.variants) : null]
    )
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'create_feature_flag', 'feature_flag', $2, $3)`,
      [admin.sub, res.rows[0].id, JSON.stringify(body)]
    )
    return reply.code(201).send(res.rows[0])
  })

  // PATCH /api/admin/analytics/flags/:id
  app.patch('/api/admin/analytics/flags/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      rollout_percent: z.number().min(0).max(100).optional(),
      enabled_user_ids: z.array(z.string().uuid()).optional(),
      variants: z.array(z.object({ key: z.string(), weight: z.number().min(1) })).nullable().optional(),
    }).parse(req.body)

    const sets: string[] = []
    const params: any[] = []
    if (body.description !== undefined) { params.push(body.description); sets.push(`description = $${params.length}`) }
    if (body.enabled !== undefined) { params.push(body.enabled); sets.push(`enabled = $${params.length}`) }
    if (body.rollout_percent !== undefined) { params.push(body.rollout_percent); sets.push(`rollout_percent = $${params.length}`) }
    if (body.enabled_user_ids !== undefined) { params.push(JSON.stringify(body.enabled_user_ids)); sets.push(`enabled_user_ids = $${params.length}`) }
    if (body.variants !== undefined) { params.push(body.variants ? JSON.stringify(body.variants) : null); sets.push(`variants = $${params.length}`) }

    if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' })
    params.push(id)
    sets.push('updated_at = NOW()')

    const res = await db.query(`UPDATE feature_flags SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params)
    if (!res.rows.length) return reply.code(404).send({ error: 'Feature flag not found' })

    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'update_feature_flag', 'feature_flag', $2, $3)`,
      [admin.sub, id, JSON.stringify(body)]
    )
    return reply.send(res.rows[0])
  })

  // DELETE /api/admin/analytics/flags/:id
  app.delete('/api/admin/analytics/flags/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const res = await db.query('DELETE FROM feature_flags WHERE id = $1 RETURNING key', [id])
    if (!res.rows.length) return reply.code(404).send({ error: 'Feature flag not found' })

    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'delete_feature_flag', 'feature_flag', $2, $3)`,
      [admin.sub, id, JSON.stringify({ key: res.rows[0].key })]
    )
    return reply.send({ success: true })
  })
}
