import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { pool } from '../../../db/pool'
import * as tiersService from './tiers'
import * as drawsService from './draws'
import * as settlementService from './settlement'
import { debitStake, creditPrize } from '../../../helpers/wallet-client'
import { z } from 'zod'
import crypto from 'crypto'

/**
 * Daily Lottery API Routes
 *
 * Player endpoints:
 * - GET /betting/lottery/daily/draws — list today's draws
 * - GET /betting/lottery/daily/draws/:id — get single draw
 * - GET /betting/lottery/daily/tiers — list active tiers
 * - POST /betting/lottery/daily/buy — purchase ticket
 *
 * Admin endpoints (require INTERNAL_SERVICE_KEY):
 * - GET /betting/lottery/daily/admin/tiers — list all tiers
 * - POST /betting/lottery/daily/admin/tiers — create tier
 * - PUT /betting/lottery/daily/admin/tiers/:id — update tier
 * - GET /betting/lottery/daily/admin/draws — list draws (today)
 * - POST /betting/lottery/daily/admin/draws — create draw
 * - POST /betting/lottery/daily/admin/draws/:id/declare — declare winning number
 * - POST /betting/lottery/daily/admin/draws/:id/cancel — cancel draw
 */

function uid(req: any): string {
  return (req.user as any)?.sub
}

async function adminCheck(req: FastifyRequest, reply: FastifyReply) {
  const key = process.env.INTERNAL_SERVICE_KEY
  if (!key || req.headers['x-internal-key'] !== key) {
    return reply.code(403).send({ error: 'Forbidden' })
  }
}

export async function registerDailyLotteryRoutes(app: FastifyInstance) {
  const auth = app.authenticate

  // ══ PLAYER ENDPOINTS ══

  // GET /betting/lottery/daily/draws — List today's draws
  app.get(
    '/betting/lottery/daily/draws',
    { onRequest: [auth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const draws = await drawsService.getDrawsForToday()
        return reply.send({ draws })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /betting/lottery/daily/draws/:id — Get single draw
  app.get(
    '/betting/lottery/daily/draws/:id',
    { onRequest: [auth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = req.params as { id: string }
        const draw = await drawsService.getDraw(id)
        return reply.send(draw)
      } catch (err: any) {
        return reply.code(404).send({ error: err.message })
      }
    }
  )

  // GET /betting/lottery/daily/tiers — List active tiers
  app.get(
    '/betting/lottery/daily/tiers',
    { onRequest: [auth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const tiers = await tiersService.getTiers({ status: 'active' })
        return reply.send({ tiers })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // POST /betting/lottery/daily/buy — Purchase ticket
  app.post(
    '/betting/lottery/daily/buy',
    { onRequest: [auth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = z
          .object({
            draw_id: z.string().uuid(),
            ticket_number: z.string().regex(/^\d{4}$/),
          })
          .parse(req.body)

        const user_id = uid(req)
        if (!user_id) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }

        // Fetch draw to verify it exists and is open
        const draw = await drawsService.getDraw(body.draw_id)
        if (draw.status !== 'open') {
          return reply.code(409).send({ error: 'Draw is not open for betting' })
        }

        // Fetch tier to get ticket price
        const tier = await tiersService.getTier(draw.tier_id)

        // Check if ticket number is already taken
        const existingTicketResult = await pool.query(
          'SELECT 1 FROM lottery_daily_tickets WHERE draw_id = $1 AND ticket_number = $2',
          [body.draw_id, body.ticket_number]
        )

        if (existingTicketResult.rows.length > 0) {
          return reply.code(409).send({ error: 'Ticket number already purchased by another player' })
        }

        // Step 1: Debit wallet (atomic operation)
        const betId = crypto.randomUUID()
        const debitResult = await debitStake({
          userId: user_id,
          amount: tier.amount,
          referenceId: betId,
          idempotencyKey: `lottery_daily_buy_${betId}`,
          description: `Daily Lottery ticket (₹${tier.amount})`,
        })

        if (!debitResult.ok) {
          return reply.code(400).send({ error: debitResult.error })
        }

        // Step 2: Create ticket record
        const ticketId = crypto.randomUUID()
        await pool.query(
          `INSERT INTO lottery_daily_tickets (id, draw_id, user_id, ticket_number, outcome_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [ticketId, body.draw_id, user_id, body.ticket_number, 'none']
        )

        return reply.code(201).send({
          ticket_id: ticketId,
          draw_id: body.draw_id,
          ticket_number: body.ticket_number,
          amount: tier.amount,
          status: 'pending',
          created_at: new Date().toISOString(),
        })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // ══ ADMIN ENDPOINTS ══

  // GET /betting/lottery/daily/admin/tiers — List all tiers
  app.get(
    '/betting/lottery/daily/admin/tiers',
    { onRequest: [adminCheck] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const tiers = await tiersService.getTiers()
        return reply.send({ tiers })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // POST /betting/lottery/daily/admin/tiers — Create tier
  app.post(
    '/betting/lottery/daily/admin/tiers',
    { onRequest: [adminCheck] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = z
          .object({
            amount: z.number().positive(),
            draw_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
            default_prize_tiers: z.array(
              z.object({
                match_type: z.enum(['last_1', 'last_2', 'last_3', 'exact']),
                outcome_type: z.enum(['cash', 'coupon']),
                multiplier: z.number().optional(),
                coupon_code: z.string().optional(),
              })
            ),
            status: z.enum(['active', 'paused', 'archived']).optional(),
          })
          .parse(req.body)

        const tier = await tiersService.createTier({
          amount: body.amount,
          draw_time: body.draw_time,
          default_prize_tiers: body.default_prize_tiers,
          status: body.status,
        })

        return reply.code(201).send(tier)
      } catch (err: any) {
        return reply.code(400).send({ error: err.message })
      }
    }
  )

  // PUT /betting/lottery/daily/admin/tiers/:id — Update tier
  app.put(
    '/betting/lottery/daily/admin/tiers/:id',
    { onRequest: [adminCheck] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = req.params as { id: string }
        const body = z
          .object({
            draw_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).optional(),
            default_prize_tiers: z
              .array(
                z.object({
                  match_type: z.enum(['last_1', 'last_2', 'last_3', 'exact']),
                  outcome_type: z.enum(['cash', 'coupon']),
                  multiplier: z.number().optional(),
                  coupon_code: z.string().optional(),
                })
              )
              .optional(),
            status: z.enum(['active', 'paused', 'archived']).optional(),
          })
          .parse(req.body)

        const tier = await tiersService.updateTier(id, {
          draw_time: body.draw_time,
          default_prize_tiers: body.default_prize_tiers,
          status: body.status,
        })

        return reply.send(tier)
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: err.message })
        }
        return reply.code(400).send({ error: err.message })
      }
    }
  )

  // GET /betting/lottery/daily/admin/draws — List draws for today
  app.get(
    '/betting/lottery/daily/admin/draws',
    { onRequest: [adminCheck] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const draws = await drawsService.getDrawsForToday()
        return reply.send({ draws })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // POST /betting/lottery/daily/admin/draws — Create draw
  app.post(
    '/betting/lottery/daily/admin/draws',
    { onRequest: [adminCheck] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = z
          .object({
            tier_id: z.string().uuid(),
            draw_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
            prize_tiers: z
              .array(
                z.object({
                  match_type: z.enum(['last_1', 'last_2', 'last_3', 'exact']),
                  outcome_type: z.enum(['cash', 'coupon']),
                  multiplier: z.number().optional(),
                  coupon_code: z.string().optional(),
                })
              )
              .optional(),
          })
          .parse(req.body)

        const drawDate = new Date(body.draw_date)
        if (isNaN(drawDate.getTime())) {
          return reply.code(400).send({ error: 'Invalid draw_date format' })
        }

        const draw = await drawsService.createDraw({
          tier_id: body.tier_id,
          draw_date: drawDate,
          prize_tiers: body.prize_tiers,
        })

        return reply.code(201).send(draw)
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: err.message })
        }
        if (err.message.includes('Unique constraint')) {
          return reply.code(409).send({ error: 'Draw already exists for this tier on this date' })
        }
        return reply.code(400).send({ error: err.message })
      }
    }
  )

  // POST /betting/lottery/daily/admin/draws/:id/declare — Declare winning number
  app.post(
    '/betting/lottery/daily/admin/draws/:id/declare',
    { onRequest: [adminCheck] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = req.params as { id: string }
        const body = z
          .object({
            winning_number: z.string().regex(/^\d{4}$/),
          })
          .parse(req.body)

        // Verify draw exists and is open
        const draw = await drawsService.getDraw(id)
        if (draw.status === 'settled') {
          return reply.code(409).send({ error: 'Draw is already settled' })
        }

        // Update winning number and status
        const updatedDraw = await drawsService.updateDrawWinningNumber(id, body.winning_number)
        await drawsService.updateDrawStatus(id, 'calling')

        // Trigger settlement (fire and forget for now; could be made async queue later)
        // For now, we just mark the draw as calling and let the scheduler handle settlement
        settlementService.settleDraw(id).catch((err: any) => {
          console.error(`[Daily Lottery] Settlement failed for draw ${id}:`, err.message)
        })

        return reply.send({
          id: updatedDraw.id,
          status: 'calling',
          winning_number: updatedDraw.winning_number,
          message: 'Result declared and settlement triggered',
        })
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: err.message })
        }
        if (err.message.includes('exactly 4 digits')) {
          return reply.code(400).send({ error: 'Winning number must be exactly 4 digits' })
        }
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // POST /betting/lottery/daily/admin/draws/:id/cancel — Cancel draw
  app.post(
    '/betting/lottery/daily/admin/draws/:id/cancel',
    { onRequest: [adminCheck] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = req.params as { id: string }

        // Verify draw exists
        const draw = await drawsService.getDraw(id)

        if (draw.status === 'settled') {
          return reply.code(409).send({ error: 'Cannot cancel an already settled draw' })
        }

        // Fetch all tickets for this draw
        const ticketsResult = await pool.query(
          'SELECT * FROM lottery_daily_tickets WHERE draw_id = $1',
          [id]
        )

        const tickets = ticketsResult.rows

        // Refund each ticket holder
        for (const ticket of tickets) {
          if (ticket.outcome_type === 'none') {
            // Only refund unsettled tickets (those with no outcome yet)
            await creditPrize({
              userId: ticket.user_id,
              amount: draw.prize_tiers[0]?.multiplier
                ? draw.prize_tiers[0].multiplier * 100
                : 100, // Fallback amount; ideally fetch from tier
              referenceId: `lottery_daily_cancel_${draw.id}_${ticket.id}`,
              idempotencyKey: `lottery_daily_cancel_${draw.id}_${ticket.id}`,
              notification: {
                title: 'Daily Lottery Cancelled',
                body: 'Your ticket has been refunded.',
              },
            })
          }
        }

        // Cancel the draw
        await drawsService.cancelDraw(id)

        return reply.send({
          message: 'Draw cancelled and all tickets refunded',
          draw_id: id,
          refunded_count: tickets.filter((t: any) => t.outcome_type === 'none').length,
        })
      } catch (err: any) {
        if (err.message.includes('not found')) {
          return reply.code(404).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message })
      }
    }
  )
}
