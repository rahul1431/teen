// services/admin-service/src/mission-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Backs the Missions admin page (admin-panel/src/pages/Missions.tsx).
// Named "mission" to avoid colliding with the unrelated employee task-tracker
// (tasks/task_comments, registerTaskRoutes in task-routes.ts).
// See docs/superpowers/specs/2026-07-25-daily-bonus-removal-task-system-design.md

const missionBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  emoji: z.string().max(10).default('🎯'),
  category: z.enum(['weekly', 'monthly', 'one_time']),
  metric_type: z.enum(['deposit_amount', 'referral_count', 'game_played', 'telegram_join', 'manual_proof']),
  game_type: z.string().max(20).optional(),
  min_stake: z.number().min(0).optional(),
  target_value: z.number().positive(),
  reward_amount: z.number().positive(),
  reward_wallet_type: z.enum(['real', 'bonus']).default('bonus'),
  max_completions_per_period: z.number().int().positive().nullable().default(1),
  verification_type: z.enum(['auto', 'telegram_bot', 'manual_review']),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
})

export async function registerMissionRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  app.get('/api/admin/missions', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query(`SELECT * FROM player_missions ORDER BY category, sort_order, created_at`)
    return reply.send(res.rows)
  })

  app.post('/api/admin/missions', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const b = missionBodySchema.parse(req.body)
    const res = await db.query(
      `INSERT INTO player_missions
       (title, description, emoji, category, metric_type, game_type, min_stake, target_value, reward_amount, reward_wallet_type, max_completions_per_period, verification_type, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [b.title, b.description ?? null, b.emoji, b.category, b.metric_type, b.game_type ?? null, b.min_stake ?? null,
       b.target_value, b.reward_amount, b.reward_wallet_type, b.max_completions_per_period, b.verification_type, b.is_active, b.sort_order],
    )
    return reply.code(201).send(res.rows[0])
  })

  app.put('/api/admin/missions/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = missionBodySchema.parse(req.body)
    const res = await db.query(
      `UPDATE player_missions SET
         title=$1, description=$2, emoji=$3, category=$4, metric_type=$5, game_type=$6, min_stake=$7,
         target_value=$8, reward_amount=$9, reward_wallet_type=$10, max_completions_per_period=$11,
         verification_type=$12, is_active=$13, sort_order=$14, updated_at=NOW()
       WHERE id = $15 RETURNING *`,
      [b.title, b.description ?? null, b.emoji, b.category, b.metric_type, b.game_type ?? null, b.min_stake ?? null,
       b.target_value, b.reward_amount, b.reward_wallet_type, b.max_completions_per_period, b.verification_type, b.is_active, b.sort_order, id],
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Mission not found' })
    return reply.send(res.rows[0])
  })

  // "Delete" deactivates rather than removing the row, so mission history in
  // user_mission_completions (and its FK) stays intact.
  app.delete('/api/admin/missions/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const res = await db.query(`UPDATE player_missions SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [id])
    if (!res.rows.length) return reply.code(404).send({ error: 'Mission not found' })
    return reply.send({ success: true })
  })
}
