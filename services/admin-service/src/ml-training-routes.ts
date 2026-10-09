import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Backs the Ludo/Teen Patti admin panels' "ML Training" tab: personalized-
// difficulty canary rollout status/control, manual retrain trigger, and the
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

const SUPPORTED_GAME_TYPES = ['ludo', 'teen_patti', 'rummy'] as const
type SupportedGameType = (typeof SUPPORTED_GAME_TYPES)[number]

const TRAINING_DATA_CUTOVER: Record<SupportedGameType, string> = {
  ludo: '2026-07-25 06:04:03+00',
  teen_patti: '2026-07-31 17:00:00+00',
  rummy: '2026-08-01 00:00:00+00',
}
const MIN_TRAINING_ROWS = 200

function parseGameType(req: any, reply: any): SupportedGameType | null {
  const gameType = (req.params as any)?.gameType
  if (!SUPPORTED_GAME_TYPES.includes(gameType)) {
    reply.code(400).send({ error: `gameType must be one of: ${SUPPORTED_GAME_TYPES.join(', ')}` })
    return null
  }
  return gameType
}

export async function registerMlTrainingRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  // GET /api/admin/:gameType/ml-training/status
  app.get('/api/admin/:gameType/ml-training/status', { onRequest: [authenticate] }, async (req, reply) => {
    const gameType = parseGameType(req, reply)
    if (!gameType) return
    try {
      const isLudo = gameType === 'ludo'
      const isRummy = gameType === 'rummy'
      const [configRes, volumeRes, healthRes, playstyleRes, decisionsLoggedRes] = await Promise.all([
        db.query(
          `SELECT personalization_canary_pct FROM game_configs WHERE game_type = $1`,
          [gameType]
        ),
        db.query(
          `SELECT COUNT(DISTINCT gp.user_id)::int AS rows FROM game_participants gp
           JOIN game_rooms gr ON gr.id = gp.room_id
           WHERE gr.game_type = $1 AND gr.status = 'completed'
             AND gp.joined_at >= $2`,
          [gameType, TRAINING_DATA_CUTOVER[gameType]]
        ),
        fetch(`${CHURN_ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        isLudo
          ? db.query(
              `SELECT difficulty, capture_probability, safe_play_probability, sample_size, win_rate_target, avg_decision_delay_ms
               FROM ludo_bot_profiles ORDER BY CASE difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
            )
          : isRummy
          ? db.query(
              `SELECT difficulty, drop_probability as fold_probability, open_draw_probability as call_probability, declare_speed_factor as raise_probability, aggression_score, sample_size, win_rate_target, avg_decision_delay_ms
               FROM rummy_bot_profiles ORDER BY CASE difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
            )
          : db.query(
              `SELECT difficulty, fold_probability, call_probability, raise_probability, aggression_score, sample_size, win_rate_target, avg_decision_delay_ms
               FROM teen_patti_bot_profiles ORDER BY CASE difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
            ),
        isLudo
          ? db.query(`SELECT COUNT(*)::int AS rows FROM ludo_move_decisions`)
          : isRummy
          ? db.query(`SELECT COUNT(*)::int AS rows FROM bot_learning_sessions WHERE game_type = 'rummy'`).catch(() => ({ rows: [{ rows: 0 }] }))
          : db.query(`SELECT COUNT(*)::int AS rows FROM teen_patti_move_decisions`).catch(() => ({ rows: [{ rows: 0 }] })),
      ])

      const postCutoverRows = volumeRes.rows[0]?.rows ?? 0

      return reply.send({
        game_type: gameType,
        canary_pct: configRes.rows[0]?.personalization_canary_pct ?? 0,
        post_cutover_rows: postCutoverRows,
        min_training_rows_required: MIN_TRAINING_ROWS,
        training_ready: postCutoverRows >= MIN_TRAINING_ROWS,
        difficulty_model_trained: healthRes?.difficulty_model_trained ?? null,
        difficulty_model_test_accuracy: healthRes?.difficulty_model_test_accuracy ?? null,
        churn_ml_service_reachable: healthRes !== null,
        playstyle_tiers: playstyleRes.rows.map((r: any) => ({
          difficulty: r.difficulty,
          win_rate_target: r.win_rate_target !== null ? parseFloat(r.win_rate_target) : null,
          avg_decision_delay_ms: r.avg_decision_delay_ms !== null ? parseInt(r.avg_decision_delay_ms, 10) : null,
          capture_probability: r.capture_probability !== null && r.capture_probability !== undefined ? parseFloat(r.capture_probability) : null,
          safe_play_probability: r.safe_play_probability !== null && r.safe_play_probability !== undefined ? parseFloat(r.safe_play_probability) : null,
          fold_probability: r.fold_probability !== null && r.fold_probability !== undefined ? parseFloat(r.fold_probability) : null,
          call_probability: r.call_probability !== null && r.call_probability !== undefined ? parseFloat(r.call_probability) : null,
          raise_probability: r.raise_probability !== null && r.raise_probability !== undefined ? parseFloat(r.raise_probability) : null,
          aggression_score: r.aggression_score !== null && r.aggression_score !== undefined ? parseFloat(r.aggression_score) : null,
          sample_size: r.sample_size !== null ? parseInt(r.sample_size, 10) : null,
        })),
        move_decisions_logged: decisionsLoggedRes.rows[0]?.rows ?? 0,
        supports_playstyle_ml: true,
      })
    } catch (err: any) {
      app.log.error(err, '[ml-training-routes] GET status error')
      return reply.code(500).send({ error: err.message || 'Failed to fetch ML training status' })
    }
  })

  // PATCH /api/admin/:gameType/ml-training/canary — { pct: 0-100 }
  app.patch(
    '/api/admin/:gameType/ml-training/canary',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const gameType = parseGameType(req, reply)
      if (!gameType) return
      try {
        const { pct } = z.object({ pct: z.coerce.number().int().min(0).max(100) }).parse(req.body)
        const admin = req.user as any
        await db.query(
          `UPDATE game_configs SET personalization_canary_pct = $1, updated_by = $2, updated_at = NOW()
           WHERE game_type = $3`,
          [pct, admin.sub, gameType]
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

  // POST /api/admin/:gameType/ml-training/train-difficulty — proxies
  // churn-ml-service. The underlying model is trained once across every game
  // type (game_type is just a feature column), so gameType here is only used
  // for route validation/consistency, not passed through. Surfaces the
  // volume-gate / accuracy-gate ValueError message verbatim so the admin
  // sees exactly why training was refused, not a generic 500.
  app.post(
    '/api/admin/:gameType/ml-training/train-difficulty',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      if (!parseGameType(req, reply)) return
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

  // POST /api/admin/:gameType/ml-training/run-anomaly-detection — proxies
  // churn-ml-service's Isolation Forest sweep. Populates player_anomalies,
  // reviewable at the existing Player Anomalies dashboard.
  app.post(
    '/api/admin/:gameType/ml-training/run-anomaly-detection',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      if (!parseGameType(req, reply)) return
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

  // POST /api/admin/:gameType/ml-training/trigger-rebuild — triggers immediate
  // profile rebuild on the game-specific bot-training daemon (3023 for TP, 3024 for Ludo).
  app.post(
    '/api/admin/:gameType/ml-training/trigger-rebuild',
    { onRequest: [authenticate, requireRole('superadmin')] },
    async (req, reply) => {
      const gameType = parseGameType(req, reply)
      if (!gameType) return
      try {
        const port = gameType === 'teen_patti' ? (process.env.TP_BOT_TRAINING_PORT || 3023) : (process.env.LUDO_BOT_TRAINING_PORT || 3024)
        const res = await fetch(`http://127.0.0.1:${port}/internal/bot/rebuild`, {
          method: 'POST',
          headers: {
            'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '',
          },
          signal: AbortSignal.timeout(10000),
        })
        const body = await res.json().catch(() => null)
        return reply.code(res.status).send(body || { success: res.ok, message: 'Rebuild triggered' })
      } catch (err: any) {
        app.log.error(err, '[ml-training-routes] POST trigger-rebuild error')
        return reply.code(502).send({ error: `Bot training daemon for ${gameType} unavailable` })
      }
    }
  )
}

