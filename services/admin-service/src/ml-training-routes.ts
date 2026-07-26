import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Backs the Ludo admin panel's "ML Training" tab: personalized-difficulty
// canary rollout status/control, manual retrain trigger, and the Ludo
// anomaly-detection run trigger. See docs/superpowers/specs/
// 2026-07-25-ludo-personalized-difficulty-canary-design.md for the canary
// design and services/game-gateway/src/matchmaking.ts:startGame for how
// personalization_canary_pct is actually consumed.
//
// The full anomaly *review* surface (list/filter/stats/dismiss) already
// exists at PlayerAnomaliesPage.tsx / player-anomalies-routes.ts — this file
// only adds the missing trigger for the detection pipeline itself, which
// nothing in production ever called before this.
const CHURN_ML_SERVICE_URL = process.env.CHURN_ML_SERVICE_URL || 'http://127.0.0.1:3020'

// Mirrors LUDO_FINAL_RANK_FIX_CUTOVER / MIN_LUDO_TRAINING_ROWS in
// services/churn-ml-service/src/difficulty_predictor.py — kept in sync by
// hand since these two services don't share a package.
const LUDO_FINAL_RANK_FIX_CUTOVER = '2026-07-25 06:04:03+00'
const MIN_LUDO_TRAINING_ROWS = 200

export async function registerMlTrainingRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  // GET /api/admin/ludo/ml-training/status
  app.get('/api/admin/ludo/ml-training/status', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const [configRes, volumeRes, healthRes] = await Promise.all([
        db.query(
          `SELECT personalization_canary_pct FROM game_configs WHERE game_type = 'ludo'`
        ),
        db.query(
          `SELECT COUNT(DISTINCT gp.user_id)::int AS rows FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = 'ludo' AND gr.status = 'completed'
             AND gp.joined_at >= $1`,
          [LUDO_FINAL_RANK_FIX_CUTOVER]
        ),
        fetch(`${CHURN_ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])

      const postCutoverRows = volumeRes.rows[0]?.rows ?? 0

      return reply.send({
        canary_pct: configRes.rows[0]?.personalization_canary_pct ?? 0,
        post_cutover_ludo_rows: postCutoverRows,
        min_training_rows_required: MIN_LUDO_TRAINING_ROWS,
        training_ready: postCutoverRows >= MIN_LUDO_TRAINING_ROWS,
        difficulty_model_trained: healthRes?.difficulty_model_trained ?? null,
        difficulty_model_test_accuracy: healthRes?.difficulty_model_test_accuracy ?? null,
        churn_ml_service_reachable: healthRes !== null,
      })
    } catch (err: any) {
      app.log.error(err, '[ml-training-routes] GET status error')
      return reply.code(500).send({ error: err.message || 'Failed to fetch ML training status' })
    }
  })

  // PATCH /api/admin/ludo/ml-training/canary — { pct: 0-100 }
  app.patch(
    '/api/admin/ludo/ml-training/canary',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      try {
        const { pct } = z.object({ pct: z.coerce.number().int().min(0).max(100) }).parse(req.body)
        const admin = req.user as any
        await db.query(
          `UPDATE game_configs SET personalization_canary_pct = $1, updated_by = $2, updated_at = NOW()
           WHERE game_type = 'ludo'`,
          [pct, admin.sub]
        )
        return reply.send({ canary_pct: pct })
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.code(400).send({ error: 'pct must be an integer between 0 and 100' })
        }
        app.log.error(err, '[ml-training-routes] PATCH canary error')
        return reply.code(500).send({ error: err.message || 'Failed to update canary pct' })
      }
    }
  )

  // POST /api/admin/ludo/ml-training/train-difficulty — proxies churn-ml-service.
  // Surfaces the volume-gate / accuracy-gate ValueError message verbatim so
  // the admin sees exactly why training was refused, not a generic 500.
  app.post(
    '/api/admin/ludo/ml-training/train-difficulty',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (_req, reply) => {
      try {
        const res = await fetch(`${CHURN_ML_SERVICE_URL}/train-difficulty`, {
          method: 'POST',
          signal: AbortSignal.timeout(60000),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          return reply.code(res.status).send({ error: body?.detail || 'Training failed' })
        }
        return reply.send(body)
      } catch (err: any) {
        app.log.error(err, '[ml-training-routes] POST train-difficulty error')
        return reply.code(502).send({ error: 'churn-ml-service unavailable' })
      }
    }
  )

  // POST /api/admin/ludo/ml-training/run-anomaly-detection — proxies
  // churn-ml-service's Isolation Forest sweep. Populates player_anomalies,
  // reviewable at the existing Player Anomalies dashboard.
  app.post(
    '/api/admin/ludo/ml-training/run-anomaly-detection',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (_req, reply) => {
      try {
        const res = await fetch(`${CHURN_ML_SERVICE_URL}/run-anomaly-detection`, {
          method: 'POST',
          signal: AbortSignal.timeout(60000),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          return reply.code(res.status).send({ error: body?.detail || 'Anomaly detection failed' })
        }
        return reply.send(body)
      } catch (err: any) {
        app.log.error(err, '[ml-training-routes] POST run-anomaly-detection error')
        return reply.code(502).send({ error: 'churn-ml-service unavailable' })
      }
    }
  )
}
