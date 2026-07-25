import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { Client } from 'pg'
import jwt from 'jsonwebtoken'

const ROLE_INDEX: Record<string, number> = { readonly: 0, employee: 1, support: 2, finance: 3, superadmin: 4 }

export function hasRoleAtLeast(actual: string | undefined, required: string): boolean {
  if (!actual || !(actual in ROLE_INDEX) || !(required in ROLE_INDEX)) return false
  return ROLE_INDEX[actual] >= ROLE_INDEX[required]
}

// Every role the caller's role satisfies (e.g. superadmin satisfies target_role in ['readonly','employee','support','finance','superadmin'])
export function satisfiedRolesFor(role: string): string[] {
  return Object.keys(ROLE_INDEX).filter(r => hasRoleAtLeast(role, r))
}

export function registerNotificationRoutes(app: FastifyInstance, db: Pool, authenticate: any) {
  // GET /api/admin/notifications?since=<iso>&limit=<n> — role-scoped history + unread count
  app.get('/api/admin/notifications', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const q = req.query as { since?: string; limit?: string }
    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200)

    const satisfiedRoles = satisfiedRolesFor(role)

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
      [satisfiedRoles, JSON.stringify([me.sub])]
    )
    return reply.send({ notifications: rows.rows, unread_count: unreadCount.rows[0].c })
  })

  // PATCH /api/admin/notifications/:id/read — mark one notification read by this admin
  app.patch('/api/admin/notifications/:id/read', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const { id } = req.params as { id: string }
    const satisfiedRoles = satisfiedRolesFor(role)
    await db.query(
      `UPDATE admin_notifications SET read_by = read_by || $3::jsonb
       WHERE id = $1 AND target_role = ANY($2) AND NOT (read_by @> $3::jsonb)`,
      [id, satisfiedRoles, JSON.stringify([me.sub])]
    )
    return reply.send({ success: true })
  })

  // PATCH /api/admin/notifications/read-all — mark every notification visible to this admin as read
  app.patch('/api/admin/notifications/read-all', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const satisfiedRoles = satisfiedRolesFor(role)
    await db.query(
      `UPDATE admin_notifications SET read_by = read_by || $2::jsonb
       WHERE target_role = ANY($1) AND NOT (read_by @> $2::jsonb)`,
      [satisfiedRoles, JSON.stringify([me.sub])]
    )
    return reply.send({ success: true })
  })

  // GET /api/admin/notifications/bell-trend?days=30 — daily alert volume by type,
  // for spotting spikes (e.g. a run of payment issues) instead of reacting one at a time.
  app.get('/api/admin/notifications/bell-trend', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const satisfiedRoles = satisfiedRolesFor(role)
    const { days = '30' } = req.query as any
    const daysInt = parseInt(days, 10) || 30

    const rows = await db.query(
      `SELECT date_trunc('day', created_at) AS day, type, COUNT(*)::int AS count
       FROM admin_notifications
       WHERE target_role = ANY($1) AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY day, type
       ORDER BY day ASC`,
      [satisfiedRoles, daysInt],
    )

    return reply.send({
      trend: rows.rows.map((r: any) => ({ date: r.day, type: r.type, count: r.count })),
    })
  })

  // WebSocket push: one client per browser tab, filtered by role
  const wsClients = new Set<{ socket: any; role: string }>()

  app.get('/ws/admin/notifications', { websocket: true }, (socket: any, req: any) => {
    const token = (req.query as any)?.token
    let role: string | undefined
    try {
      const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET!) as any
      role = payload.role
    } catch {
      socket.close(4001, 'Unauthorized')
      return
    }
    const entry = { socket, role: role! }
    wsClients.add(entry)
    socket.on('close', () => wsClients.delete(entry))
    socket.on('error', () => wsClients.delete(entry))
  })

  // Dedicated LISTEN connection — separate from the pooled `db` since LISTEN
  // must stay bound to one held connection for the process lifetime.
  let reconnecting = false
  function scheduleReconnect(err: unknown) {
    app.log.error(err, 'admin_events LISTEN connection error, reconnecting in 5s')
    if (reconnecting) return
    reconnecting = true
    setTimeout(() => {
      reconnecting = false
      startListener()
    }, 5000)
  }

  async function startListener() {
    try {
      const listenClient = new Client({ connectionString: process.env.DATABASE_URL })
      listenClient.on('error', (err) => {
        scheduleReconnect(err)
      })
      await listenClient.connect()
      await listenClient.query('LISTEN admin_events')
      listenClient.on('notification', async (msg) => {
        try {
          const notifId = msg.payload
          if (!notifId) return
          const row = await db.query(
            `SELECT id, type, title, body, severity, target_role, ref_table, ref_id, created_at
             FROM admin_notifications WHERE id = $1`,
            [notifId]
          )
          if (row.rows.length === 0) return
          const notif = row.rows[0]
          for (const client of wsClients) {
            if (hasRoleAtLeast(client.role, notif.target_role) && client.socket.readyState === 1) {
              client.socket.send(JSON.stringify(notif))
            }
          }
        } catch (err) {
          app.log.error(err, 'Failed to process admin_events notification')
        }
      })
      app.log.info('Listening for admin_events notifications')
    } catch (err) {
      scheduleReconnect(err)
    }
  }
  startListener().catch(err => app.log.error(err, 'Failed to start admin_events listener'))
}
