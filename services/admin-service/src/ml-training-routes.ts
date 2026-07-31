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

const SUPPORTED_GAME_TYPES = ['ludo', 'teen_patti'] as const
type SupportedGameType = (typeof SUPPORTED_GAME_TYPES)[number]

// The cutover per game is the point after which game_participants rows for
// that game are trustworthy training data — before it, prize_won/final_rank
// were silently never written (a different root cause per game: Ludo's own
// completion write was simply missing; Teen Patti's engine had the write but
// it was failing against a stale DB password, and a bot's raise could exceed
// the pot-limit cap and force-end the hand with a null winner — both fixed
// 2026-07-31). Mirrors these constants in
// services/churn-ml-service/src/difficulty_predictor.py by hand, since these
// two services don't share a package.
const TRAINING_DATA_CUTOVER: Record<SupportedGameType, string> = {
  ludo: '2026-07-25 06:04:03+00',
  teen_patti: '2026-07-31 17:00:00+00',
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
      // Ludo has its own per-move probability training (captures/safe-play,
      // see coordination.ts) fed by ludo_move_decisions — no other game logs
      // that table, so the "Bot Playstyle ML" figures only apply to Ludo.
      const isLudo = gameType === 'ludo'
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
              `SELECT difficulty, capture_probability, safe_play_probability, sample_size
               FROM bot_profiles WHERE game_type = 'ludo' ORDER BY difficulty`
            )
          : Promise.resolve({ rows: [] }),
        isLudo
          ? db.query(`SELECT COUNT(*)::int AS rows FROM ludo_move_decisions`)
          : Promise.resolve({ rows: [{ rows: 0 }] }),
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
          capture_probability: r.capture_probability !== null ? parseFloat(r.capture_probability) : null,
          safe_play_probability: r.safe_play_probability !== null ? parseFloat(r.safe_play_probability) : null,
          sample_size: r.sample_size !== null ? parseInt(r.sample_size, 10) : null,
        })),
        move_decisions_logged: decisionsLoggedRes.rows[0]?.rows ?? 0,
        supports_playstyle_ml: isLudo,
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
  // reviewable at the existing Player Anomalies dashboard. Cross-game, same
  // note as train-difficulty above re: gameType only gating the route.
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
}
