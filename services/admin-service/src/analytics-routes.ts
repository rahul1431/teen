// services/admin-service/src/analytics-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Staff-facing dashboards + feature-flag CRUD. See
// docs/superpowers/specs/2026-07-21-product-analytics-design.md
export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  // GET /api/admin/analytics/funnels/deposit?days=7
  app.get('/api/admin/analytics/funnels/deposit', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(90).default(7) }).parse(req.query)
    const res = await db.query(
      `SELECT event_name, COUNT(*)::int AS count
       FROM product_events
       WHERE source = 'mobile'
         AND event_name IN ('deposit_screen_opened', 'deposit_submitted')
         AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY event_name`,
      [days]
    )
    const opened = res.rows.find(r => r.event_name === 'deposit_screen_opened')?.count || 0
    const submitted = res.rows.find(r => r.event_name === 'deposit_submitted')?.count || 0
    return reply.send({
      days,
      deposit_screen_opened: opened,
      deposit_submitted: submitted,
      conversion_rate: opened > 0 ? Number((submitted / opened * 100).toFixed(1)) : 0,
    })
  })

  // GET /api/admin/analytics/funnels/onboarding?days=30
  // Computed entirely from existing tables — no product_events involved.
  app.get('/api/admin/analytics/funnels/onboarding', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(180).default(30) }).parse(req.query)
    const res = await db.query(
      `SELECT
         COUNT(*)::int AS signups,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type = 'deposit'
         ))::int AS deposited,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type = 'game_debit'
         ))::int AS placed_bet
       FROM users u
       WHERE u.created_at >= NOW() - ($1 || ' days')::interval`,
      [days]
    )
    const row = res.rows[0]
    return reply.send({
      days,
      signups: row.signups,
      deposited: row.deposited,
      placed_bet: row.placed_bet,
      signup_to_deposit_rate: row.signups > 0 ? Number((row.deposited / row.signups * 100).toFixed(1)) : 0,
      deposit_to_bet_rate: row.deposited > 0 ? Number((row.placed_bet / row.deposited * 100).toFixed(1)) : 0,
    })
  })

  // GET /api/admin/analytics/retention?days=30
  // Agent-referred vs. direct-signup retention — computed entirely from
  // existing tables, no product_events involved.
  app.get('/api/admin/analytics/retention', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(180).default(30) }).parse(req.query)
    const res = await db.query(
      `SELECT
         (u.agent_id IS NOT NULL) AS is_agent_referred,
         COUNT(*)::int AS cohort_size,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt
           WHERE wt.user_id = u.id AND wt.created_at >= u.created_at + INTERVAL '7 days'
         ))::int AS active_after_week_1
       FROM users u
       WHERE u.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY is_agent_referred`,
      [days]
    )
    return reply.send(res.rows.map(r => ({
      cohort: r.is_agent_referred ? 'agent_referred' : 'direct_signup',
      cohort_size: r.cohort_size,
      active_after_week_1: r.active_after_week_1,
      retention_rate: r.cohort_size > 0 ? Number((r.active_after_week_1 / r.cohort_size * 100).toFixed(1)) : 0,
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
      key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers, underscores only'),
      description: z.string().optional(),
      enabled: z.boolean().default(false),
      rollout_percent: z.number().min(0).max(100).default(0),
      enabled_user_ids: z.array(z.string().uuid()).default([]),
      variants: z.array(z.object({ key: z.string(), weight: z.number().min(1) })).nullable().optional(),
    }).parse(req.body)

    // Input-validation gap found during Task 2 review: flag-evaluation's
    // variant assignment silently breaks (some variants become unreachable)
    // if weights don't sum to 100. Enforce it here at flag-creation time.
    if (body.variants && body.variants.length > 0) {
      const totalWeight = body.variants.reduce((sum, v) => sum + v.weight, 0)
      if (totalWeight !== 100) {
        return reply.code(400).send({ error: `Variant weights must sum to 100 (got ${totalWeight})` })
      }
    }

    const existing = await db.query('SELECT id FROM feature_flags WHERE key = $1', [body.key])
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Flag key already exists' })

    const res = await db.query(
      `INSERT INTO feature_flags (key, description, enabled, rollout_percent, enabled_user_ids, variants, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [body.key, body.description || null, body.enabled, body.rollout_percent, body.enabled_user_ids, body.variants ? JSON.stringify(body.variants) : null, admin.sub]
    )
    return reply.code(201).send({ id: res.rows[0].id })
  })

  // PATCH /api/admin/analytics/flags/:id
  app.patch('/api/admin/analytics/flags/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
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
    const colFor: Record<string, string> = { description: 'description', enabled: 'enabled', rollout_percent: 'rollout_percent', enabled_user_ids: 'enabled_user_ids', variants: 'variants' }
    for (const [key, col] of Object.entries(colFor)) {
      const val = (body as any)[key]
      if (val !== undefined) {
        params.push(key === 'variants' ? (val ? JSON.stringify(val) : null) : val)
        sets.push(`${col} = $${params.length}`)
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' })
    sets.push('updated_at = NOW()')
    params.push(id)
    const res = await db.query(`UPDATE feature_flags SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
    if (res.rowCount === 0) return reply.code(404).send({ error: 'Flag not found' })
    return reply.send({ success: true })
  })

  // GET /api/admin/analytics/ab-results/:flagKey
  // Compares conversion (deposit_submitted) rate per variant, tagged on
  // events by the mobile client after calling GET /flags.
  app.get('/api/admin/analytics/ab-results/:flagKey', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { flagKey } = req.params as any
    const res = await db.query(
      `SELECT properties->>'variant' AS variant,
              COUNT(*) FILTER (WHERE event_name = 'deposit_screen_opened')::int AS exposures,
              COUNT(*) FILTER (WHERE event_name = 'deposit_submitted')::int AS conversions
       FROM product_events
       WHERE properties->>'flag_key' = $1
       GROUP BY variant`,
      [flagKey]
    )
    return reply.send(res.rows.map(r => ({
      variant: r.variant,
      exposures: r.exposures,
      conversions: r.conversions,
      conversion_rate: r.exposures > 0 ? Number((r.conversions / r.exposures * 100).toFixed(1)) : 0,
    })))
  })

  // POST /api/admin/analytics/events — admin-panel usage tracking
  app.post('/api/admin/analytics/events', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const body = z.object({ event_name: z.string().min(1).max(100), properties: z.record(z.any()).optional() }).parse(req.body)
    await db.query(
      `INSERT INTO product_events (user_id, event_name, properties, source) VALUES ($1, $2, $3, 'admin_panel')`,
      [admin.sub, body.event_name, JSON.stringify(body.properties || {})]
    )
    return reply.send({ success: true })
  })
}
