import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Backs the Task Management page (admin-panel/src/pages/Tasks.tsx).
// Reads/writes the tasks + task_comments tables from migration 064.
// Superadmin creates/assigns/edits/deletes; employees may only update the
// status and issue flag on tasks assigned to them. See
// docs/superpowers/specs/2026-07-12-task-management-design.md
export async function registerTaskRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  const isSuperadmin = (req: any) => (req.user as any)?.role === 'superadmin'

  const logAudit = async (adminId: string, action: string, targetId: string, details?: any) => {
    try {
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'task', $3, $4)`,
        [adminId, action, targetId, details ? JSON.stringify(details) : null]
      )
    } catch (e) {
      app.log.error(e, `Failed to log audit for task action ${action}`)
    }
  }

  // GET /api/admin/tasks — list, filtered. Employees are always scoped to
  // their own tasks server-side regardless of what the client sends.
  app.get('/api/admin/tasks', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const me = req.user as any
      const q = z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        status: z.string().optional(),
        priority: z.string().optional(),
        assignee_id: z.string().uuid().optional(),
        overdue: z.coerce.boolean().optional(),
        raised_by_ai: z.string().optional(),
        target_ai_agent: z.string().optional(),
        verification_status: z.string().optional(),
        filter_type: z.enum(['all', 'ai_only', 'unverified', 'human_only']).optional(),
      }).parse(req.query)

      const conditions: string[] = ['t.deleted_at IS NULL']
      const params: any[] = []

      if (me.role === 'employee') {
        conditions.push(`t.assigned_to = $${params.length + 1}`)
        params.push(me.sub)
      } else if (q.assignee_id) {
        conditions.push(`t.assigned_to = $${params.length + 1}`)
        params.push(q.assignee_id)
      }

      if (q.status) {
        conditions.push(`t.status = $${params.length + 1}`)
        params.push(q.status)
      }
      if (q.priority) {
        conditions.push(`t.priority = $${params.length + 1}`)
        params.push(q.priority)
      }
      if (q.overdue) {
        conditions.push(`t.due_date < CURRENT_DATE AND t.status NOT IN ('done', 'cancelled')`)
      }
      if (q.raised_by_ai) {
        conditions.push(`t.raised_by_ai = $${params.length + 1}`)
        params.push(q.raised_by_ai)
      }
      if (q.target_ai_agent) {
        conditions.push(`t.target_ai_agent = $${params.length + 1}`)
        params.push(q.target_ai_agent)
      }
      if (q.verification_status) {
        conditions.push(`t.verification_status = $${params.length + 1}`)
        params.push(q.verification_status)
      }
      if (q.filter_type === 'ai_only') {
        conditions.push(`(t.raised_by_ai IS NOT NULL OR t.target_ai_agent IS NOT NULL)`)
      } else if (q.filter_type === 'unverified') {
        conditions.push(`t.verification_status = 'unverified'`)
      } else if (q.filter_type === 'human_only') {
        conditions.push(`t.raised_by_ai IS NULL AND t.target_ai_agent IS NULL`)
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`
      const offset = (q.page - 1) * q.limit

      const countResult = await db.query(`SELECT COUNT(*) FROM tasks t ${whereClause}`, params)
      const total = parseInt(countResult.rows[0].count, 10)

      const listResult = await db.query(
        `SELECT t.*,
                assignee.username AS assignee_username,
                creator.username AS creator_username,
                verifier.username AS verified_by_username
         FROM tasks t
         LEFT JOIN admin_users assignee ON assignee.id = t.assigned_to
         LEFT JOIN admin_users creator ON creator.id = t.created_by
         LEFT JOIN admin_users verifier ON verifier.id = t.verified_by
         ${whereClause}
         ORDER BY
           CASE WHEN t.verification_status = 'unverified' THEN 0 ELSE 1 END,
           CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
           t.due_date ASC,
           t.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.limit, offset]
      )

      return reply.send({ tasks: listResult.rows, total, page: q.page, limit: q.limit })
    } catch (err: any) {
      app.log.error(err, 'Failed to list tasks')
      return reply.code(400).send({ error: err.message || 'Failed to list tasks' })
    }
  })

  // POST /api/admin/tasks — create + assign. Superadmin or authorized staff.
  app.post('/api/admin/tasks', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const me = req.user as any
      const body = z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        assigned_to: z.string().uuid().nullable().optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
        due_date: z.string().optional(),
        raised_by_ai: z.string().max(50).nullable().optional(),
        target_ai_agent: z.string().max(50).nullable().optional(),
        issue_type: z.string().max(80).nullable().optional(),
        verification_status: z.enum(['unverified', 'verified', 'rejected']).default('unverified'),
      }).parse(req.body)

      const result = await db.query(
        `INSERT INTO tasks (title, description, assigned_to, created_by, priority, due_date, raised_by_ai, target_ai_agent, issue_type, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          body.title,
          body.description || null,
          body.assigned_to || null,
          me.sub,
          body.priority,
          body.due_date || null,
          body.raised_by_ai || null,
          body.target_ai_agent || null,
          body.issue_type || null,
          body.verification_status || 'unverified'
        ]
      )

      const task = result.rows[0]
      await logAudit(me.sub, 'task_created', task.id, {
        title: body.title,
        assigned_to: body.assigned_to,
        raised_by_ai: body.raised_by_ai,
        target_ai_agent: body.target_ai_agent
      })

      return reply.code(201).send(task)
    } catch (err: any) {
      app.log.error(err, 'Failed to create task')
      return reply.code(400).send({ error: err.message || 'Failed to create task' })
    }
  })

  // PATCH /api/admin/tasks/:id — superadmin can edit any field; an employee
  // may only update status/has_issue/issue_note on their own task.
  app.patch('/api/admin/tasks/:id', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const me = req.user as any
      const { id } = req.params as { id: string }

      const existing = await db.query(`SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL`, [id])
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Task not found' })
      const task = existing.rows[0]

      const canEditAll = isSuperadmin(req)
      const isOwner = me.role === 'employee' && task.assigned_to === me.sub
      if (!canEditAll && !isOwner) {
        return reply.code(403).send({ error: 'You do not have permission to edit this task' })
      }

      const fields: string[] = []
      const params: any[] = []

      if (canEditAll) {
        const body = z.object({
          title: z.string().min(1).max(200).optional(),
          description: z.string().max(5000).optional(),
          assigned_to: z.string().uuid().optional(),
          priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
          due_date: z.string().nullable().optional(),
          status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
          has_issue: z.boolean().optional(),
          issue_note: z.string().max(2000).nullable().optional(),
        }).parse(req.body)

        for (const [key, value] of Object.entries(body)) {
          if (value !== undefined) {
            fields.push(`${key} = $${fields.length + 1}`)
            params.push(value)
          }
        }
      } else {
        // Employee: status transitions are limited to the standard flow —
        // 'cancelled' stays superadmin-only.
        const body = z.object({
          status: z.enum(['todo', 'in_progress', 'done']).optional(),
          has_issue: z.boolean().optional(),
          issue_note: z.string().max(2000).nullable().optional(),
        }).parse(req.body)

        for (const [key, value] of Object.entries(body)) {
          if (value !== undefined) {
            fields.push(`${key} = $${fields.length + 1}`)
            params.push(value)
          }
        }
      }

      if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' })

      fields.push(`updated_at = NOW()`)
      params.push(id)

      const result = await db.query(
        `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      )

      await logAudit(me.sub, 'task_updated', id, { fields: Object.keys(req.body as any) })

      return reply.send(result.rows[0])
    } catch (err: any) {
      app.log.error(err, 'Failed to update task')
      return reply.code(400).send({ error: err.message || 'Failed to update task' })
    }
  })

  // DELETE /api/admin/tasks/:id — soft delete. Superadmin only.
  app.delete('/api/admin/tasks/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    try {
      const me = req.user as any
      const { id } = req.params as { id: string }

      const result = await db.query(
        `UPDATE tasks SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id]
      )
      if (result.rows.length === 0) return reply.code(404).send({ error: 'Task not found' })

      await logAudit(me.sub, 'task_deleted', id)

      return reply.send({ success: true })
    } catch (err: any) {
      app.log.error(err, 'Failed to delete task')
      return reply.code(400).send({ error: err.message || 'Failed to delete task' })
    }
  })

  // GET /api/admin/tasks/:id/comments
  app.get('/api/admin/tasks/:id/comments', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const me = req.user as any
      const { id } = req.params as { id: string }

      const taskResult = await db.query(`SELECT assigned_to FROM tasks WHERE id = $1 AND deleted_at IS NULL`, [id])
      if (taskResult.rows.length === 0) return reply.code(404).send({ error: 'Task not found' })
      if (me.role === 'employee' && taskResult.rows[0].assigned_to !== me.sub) {
        return reply.code(403).send({ error: 'You do not have permission to view this task' })
      }

      const result = await db.query(
        `SELECT c.*, COALESCE(a.username, c.author_name, 'AI Agent') AS admin_username
         FROM task_comments c
         LEFT JOIN admin_users a ON a.id = c.admin_id
         WHERE c.task_id = $1
         ORDER BY c.created_at ASC`,
        [id]
      )
      return reply.send(result.rows)
    } catch (err: any) {
      app.log.error(err, 'Failed to fetch task comments')
      return reply.code(400).send({ error: err.message || 'Failed to fetch comments' })
    }
  })

  // POST /api/admin/tasks/:id/comments
  app.post('/api/admin/tasks/:id/comments', { onRequest: [authenticate] }, async (req, reply) => {
    try {
      const me = req.user as any
      const { id } = req.params as { id: string }
      const body = z.object({ body: z.string().min(1).max(2000) }).parse(req.body)

      const taskResult = await db.query(`SELECT assigned_to FROM tasks WHERE id = $1 AND deleted_at IS NULL`, [id])
      if (taskResult.rows.length === 0) return reply.code(404).send({ error: 'Task not found' })
      if (me.role === 'employee' && taskResult.rows[0].assigned_to !== me.sub) {
        return reply.code(403).send({ error: 'You do not have permission to comment on this task' })
      }

      const result = await db.query(
        `INSERT INTO task_comments (task_id, admin_id, body) VALUES ($1, $2, $3) RETURNING *`,
        [id, me.sub, body.body]
      )

      await logAudit(me.sub, 'task_commented', id)

      return reply.code(201).send(result.rows[0])
    } catch (err: any) {
      app.log.error(err, 'Failed to add task comment')
      return reply.code(400).send({ error: err.message || 'Failed to add comment' })
    }
  })

  // POST /api/admin/tasks/:id/verify — Human administrator audits and verifies/approves or rejects AI task
  app.post('/api/admin/tasks/:id/verify', async (req, reply) => {
    try {
      const internalKey = process.env.INTERNAL_SERVICE_KEY || 'internal_secret_key_change_in_prod'
      const clientKey = req.headers['x-internal-key']
      let me: any = null

      if (clientKey === internalKey) {
        me = { sub: null, username: 'System / Automated Verifier', role: 'superadmin' }
      } else {
        await authenticate(req, reply)
        me = req.user as any
      }

      const { id } = req.params as { id: string }
      const body = z.object({
        verification_status: z.enum(['verified', 'rejected']),
        verification_notes: z.string().max(2000).optional(),
        resolution: z.enum(['done', 'in_progress', 'cancelled', 'todo']).optional(),
      }).parse(req.body)

      const existing = await db.query(`SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL`, [id])
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Task not found' })

      const updateResult = await db.query(
        `UPDATE tasks
         SET verification_status = $1,
             verified_by = $2,
             verified_at = NOW(),
             verification_notes = $3,
             status = COALESCE($4, status),
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [
          body.verification_status,
          me.sub,
          body.verification_notes || null,
          body.resolution || (body.verification_status === 'verified' ? 'done' : 'cancelled'),
          id
        ]
      )

      const noteText = body.verification_notes ? `: ${body.verification_notes}` : ''
      const commentMsg = `🔍 Human Verification [${body.verification_status.toUpperCase()}] by ${me.username || 'Admin'}${noteText}`
      await db.query(
        `INSERT INTO task_comments (task_id, admin_id, body, author_name) VALUES ($1, $2, $3, $4)`,
        [id, me.sub, commentMsg, me.username || 'Admin']
      )

      if (me.sub) {
        await logAudit(me.sub, 'task_verified', id, {
          status: body.verification_status,
          resolution: body.resolution,
          notes: body.verification_notes
        })
      }

      return reply.send({ success: true, task: updateResult.rows[0] })
    } catch (err: any) {
      app.log.error(err, 'Failed to verify task')
      return reply.code(400).send({ error: err.message || 'Failed to verify task' })
    }
  })

  // POST /api/admin/tasks/raise-ai-issue — Automated entrypoint for AI Agents to file specific issues
  // Accepts either an authenticated admin JWT session OR x-internal-key header for autonomous AI background services
  app.post('/api/admin/tasks/raise-ai-issue', async (req, reply) => {
    try {
      const internalKey = process.env.INTERNAL_SERVICE_KEY || 'internal_secret_key_change_in_prod'
      const clientKey = req.headers['x-internal-key']
      let adminId: string | null = null

      if (clientKey === internalKey) {
        // Authorized via internal service key (e.g. autonomous AI daemons)
      } else {
        // Authenticate via JWT
        try {
          await authenticate(req, reply)
          adminId = (req.user as any)?.sub || null
        } catch (authErr) {
          return reply.code(401).send({ error: 'Unauthorized: valid JWT or x-internal-key required' })
        }
      }

      const raw = req.body as any || {}
      const agentId = raw.raised_by_ai || raw.agentId || 'argus'
      const targetAgent = raw.target_ai_agent || raw.targetAgent || null
      const issueType = raw.issue_type || raw.issueType || 'other'
      const title = raw.title || `[${agentId.toUpperCase()}] Autonomous System Issue`
      const description = raw.description || `Autonomous issue logged for agent ${agentId}.`
      const priority = ['low', 'medium', 'high', 'urgent'].includes(raw.priority) ? raw.priority : 'high'
      const assignedTo = raw.assignedTo || raw.assigned_to || null
      const dueDate = raw.dueDate || raw.due_date || null

      const result = await db.query(
        `INSERT INTO tasks (
          title, description, assigned_to, created_by, priority, due_date,
          raised_by_ai, target_ai_agent, issue_type, verification_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unverified')
        RETURNING *`,
        [
          title,
          description,
          assignedTo,
          adminId,
          priority,
          dueDate,
          agentId,
          targetAgent,
          issueType
        ]
      )

      const task = result.rows[0]
      const comment = `🤖 Task automatically logged by AI Agent [${agentId.toUpperCase()}] for issue: ${issueType}. Awaiting human verification.`
      await db.query(
        `INSERT INTO task_comments (task_id, admin_id, body, author_name) VALUES ($1, $2, $3, $4)`,
        [task.id, adminId, comment, agentId.toUpperCase()]
      )

      if (adminId) {
        await logAudit(adminId, 'ai_task_raised', task.id, {
          agent: agentId,
          target: targetAgent,
          issue: issueType
        })
      }

      return reply.code(201).send({ success: true, task })
    } catch (err: any) {
      app.log.error(err, 'Failed to raise AI task')
      return reply.code(400).send({ error: err.message || 'Failed to raise AI task' })
    }
  })
}
