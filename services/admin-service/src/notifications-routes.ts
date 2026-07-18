import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'

const ROLE_INDEX: Record<string, number> = { readonly: 0, employee: 1, support: 2, finance: 3, superadmin: 4 }

export function hasRoleAtLeast(actual: string | undefined, required: string): boolean {
  if (!actual || !(actual in ROLE_INDEX) || !(required in ROLE_INDEX)) return false
  return ROLE_INDEX[actual] >= ROLE_INDEX[required]
}

export function registerNotificationRoutes(app: FastifyInstance, db: Pool, authenticate: any) {
  // GET /api/admin/notifications?since=<iso>&limit=<n> — role-scoped history + unread count
  app.get('/api/admin/notifications', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const q = req.query as { since?: string; limit?: string }
    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200)

    // Every role the caller's role satisfies (e.g. superadmin satisfies target_role in ['readonly','employee','support','finance','superadmin'])
    const satisfiedRoles = Object.keys(ROLE_INDEX).filter(r => hasRoleAtLeast(role, r))

    const params: any[] = [satisfiedRoles, limit]
    let sql = `SELECT id, type, title, body, severity, target_role, ref_table, ref_id, read_by, created_at
               FROM admin_notifications WHERE target_role = ANY($1)`
    if (q.since) {
      params.push(q.since)
      sql += ` AND created_at > $3`
    }
    sql += ` ORDER BY created_at DESC LIMIT $2`

    const rows = await db.query(sql, params)
    const unreadCount = await db.query(
      `SELECT COUNT(*)::int AS c FROM admin_notifications WHERE target_role = ANY($1) AND NOT (read_by @> $2::jsonb)`,
      [satisfiedRoles, JSON.stringify([me.id])]
    )
    return reply.send({ notifications: rows.rows, unread_count: unreadCount.rows[0].c })
  })

  // PATCH /api/admin/notifications/:id/read — mark one notification read by this admin
  app.patch('/api/admin/notifications/:id/read', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const { id } = req.params as { id: string }
    await db.query(
      `UPDATE admin_notifications SET read_by = read_by || $2::jsonb WHERE id = $1 AND NOT (read_by @> $2::jsonb)`,
      [id, JSON.stringify([me.id])]
    )
    return reply.send({ success: true })
  })

  // PATCH /api/admin/notifications/read-all — mark every notification visible to this admin as read
  app.patch('/api/admin/notifications/read-all', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const satisfiedRoles = Object.keys(ROLE_INDEX).filter(r => hasRoleAtLeast(role, r))
    await db.query(
      `UPDATE admin_notifications SET read_by = read_by || $2::jsonb
       WHERE target_role = ANY($1) AND NOT (read_by @> $2::jsonb)`,
      [satisfiedRoles, JSON.stringify([me.id])]
    )
    return reply.send({ success: true })
  })
}
