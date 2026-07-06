import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

export function supportPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    const authenticate = async (req: any, reply: any) => {
      try {
        await req.jwtVerify()
      } catch {
        reply.code(401).send({ error: 'Unauthorized' })
      }
    }

    const uid = (req: any) => req.user.sub

    // GET /support/tickets — list logged-in user's tickets
    app.get('/support/tickets', { onRequest: [authenticate] }, async (req, reply) => {
      const userId = uid(req)
      const res = await db.query(
        `SELECT t.id, t.subject, t.category, t.status, t.priority, t.created_at, t.updated_at,
                (SELECT COUNT(*)::int FROM support_messages WHERE ticket_id = t.id AND is_internal = false) AS message_count
         FROM support_tickets t
         WHERE t.user_id = $1
         ORDER BY t.updated_at DESC`,
        [userId]
      )
      return reply.send({ tickets: res.rows })
    })

    // GET /support/tickets/:id — get ticket details + messages
    app.get('/support/tickets/:id', { onRequest: [authenticate] }, async (req, reply) => {
      const userId = uid(req)
      const { id } = req.params as any

      const ticketRes = await db.query(
        `SELECT id, subject, category, status, priority, created_at, updated_at
         FROM support_tickets
         WHERE id = $1 AND user_id = $2`,
        [id, userId]
      )
      if (!ticketRes.rows.length) {
        return reply.code(404).send({ error: 'Ticket not found' })
      }

      const messagesRes = await db.query(
        `SELECT m.id, m.sender_type, m.sender_id, m.body, m.created_at,
                COALESCE(u.username, 'Admin') AS sender_username
         FROM support_messages m
         LEFT JOIN users u ON u.id = m.sender_id AND m.sender_type = 'user'
         WHERE m.ticket_id = $1 AND m.is_internal = false
         ORDER BY m.created_at ASC`,
        [id]
      )

      return reply.send({
        ticket: ticketRes.rows[0],
        messages: messagesRes.rows,
      })
    })

    // POST /support/tickets — raise a new ticket
    app.post('/support/tickets', { onRequest: [authenticate] }, async (req, reply) => {
      const userId = uid(req)
      const body = z.object({
        subject: z.string().min(1).max(200),
        category: z.string().min(1).max(50).default('general'),
        message: z.string().min(1).max(5000),
      }).parse(req.body)

      const client = await db.connect()
      try {
        await client.query('BEGIN')

        const ticketRes = await client.query(
          `INSERT INTO support_tickets (user_id, subject, category, status, priority)
           VALUES ($1, $2, $3, 'open', 'normal') RETURNING id`,
          [userId, body.subject, body.category]
        )
        const ticketId = ticketRes.rows[0].id

        await client.query(
          `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body, is_internal)
           VALUES ($1, 'user', $2, $3, false)`,
          [ticketId, userId, body.message]
        )

        await client.query('COMMIT')
        return reply.send({ success: true, ticket_id: ticketId })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    })

    // POST /support/tickets/:id/messages — send a message on a ticket
    app.post('/support/tickets/:id/messages', { onRequest: [authenticate] }, async (req, reply) => {
      const userId = uid(req)
      const { id } = req.params as any
      const body = z.object({
        body: z.string().min(1).max(5000),
      }).parse(req.body)

      const ticketRes = await db.query(
        `SELECT status FROM support_tickets WHERE id = $1 AND user_id = $2`,
        [id, userId]
      )
      if (!ticketRes.rows.length) {
        return reply.code(404).send({ error: 'Ticket not found' })
      }

      const client = await db.connect()
      try {
        await client.query('BEGIN')

        const msgRes = await client.query(
          `INSERT INTO support_messages (ticket_id, sender_type, sender_id, body, is_internal)
           VALUES ($1, 'user', $2, $3, false) RETURNING id, created_at`,
          [id, userId, body.body]
        )

        // Set status to open when the user replies
        await client.query(
          `UPDATE support_tickets
           SET status = 'open', updated_at = NOW()
           WHERE id = $1`,
          [id]
        )

        await client.query('COMMIT')
        return reply.send({ success: true, id: msgRes.rows[0].id, created_at: msgRes.rows[0].created_at })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    })
  }
}
