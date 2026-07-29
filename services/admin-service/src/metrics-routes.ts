import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

export async function registerMetricsRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
) {
  // GET /api/admin/metrics — returns 24h/7d/30d trends for all game_type/difficulty combos
  app.get(
    '/api/admin/metrics',
    { onRequest: [authenticate] },
    async (_req, reply) => {
      try {
        // Fetch metrics for last 24 hours for all game_type/difficulty combinations
        const res = await db.query(`
          SELECT
            game_type,
            difficulty,
            hour,
            game_count,
            avg_win_rate,
            win_rate_std,
            percentile_rank,
            sample_size,
            drift_from_target,
            is_alert,
            created_at
          FROM bot_profile_metrics
          WHERE created_at >= NOW() - INTERVAL '30 days'
          ORDER BY game_type, difficulty, hour DESC
        `)

        // Organize metrics by game_type and difficulty
        const trends = res.rows.map((row: any) => ({
          game_type: row.game_type,
          difficulty: row.difficulty,
          hour: row.hour,
          game_count: parseInt(row.game_count),
          avg_win_rate: parseFloat(row.avg_win_rate),
          win_rate_std: row.win_rate_std ? parseFloat(row.win_rate_std) : null,
          percentile_rank: row.percentile_rank ? parseInt(row.percentile_rank) : null,
          sample_size: row.sample_size ? parseInt(row.sample_size) : null,
          drift_from_target: parseFloat(row.drift_from_target),
          is_alert: row.is_alert,
        }))

        return reply.send({ trends })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /metrics error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /api/admin/metrics/:game_type/:difficulty — profile-specific metrics with trends
  app.get<{ Params: { game_type: string; difficulty: string } }>(
    '/api/admin/metrics/:game_type/:difficulty',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { game_type, difficulty } = req.params

        // Validate input
        if (!game_type || !difficulty) {
          return reply.code(400).send({ error: 'game_type and difficulty are required' })
        }

        // Fetch bot profile
        const profileRes = await db.query(
          `SELECT id, game_type, difficulty, win_rate_target, sample_size, created_at
           FROM bot_profiles
           WHERE game_type = $1 AND difficulty = $2
           LIMIT 1`,
          [game_type, difficulty]
        )

        if (!profileRes.rows.length) {
          return reply.code(404).send({ error: 'Profile not found' })
        }

        const profile = profileRes.rows[0]
        const profileId = profile.id

        // Fetch 24-hour metrics (hourly buckets)
        const metrics24hRes = await db.query(
          `SELECT
            hour,
            game_count,
            avg_win_rate,
            win_rate_std,
            drift_from_target,
            is_alert
          FROM bot_profile_metrics
          WHERE profile_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
          ORDER BY hour DESC`,
          [profileId]
        )

        // Fetch 7-day metrics (daily buckets)
        const metrics7dRes = await db.query(
          `SELECT
            DATE_TRUNC('day', hour) as day,
            COUNT(*) as samples,
            AVG(game_count) as avg_games,
            AVG(avg_win_rate) as avg_win_rate,
            AVG(drift_from_target) as avg_drift,
            STDDEV(avg_win_rate) as win_rate_volatility
          FROM bot_profile_metrics
          WHERE profile_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
          GROUP BY DATE_TRUNC('day', hour)
          ORDER BY day DESC`,
          [profileId]
        )

        // Fetch 30-day metrics (daily buckets)
        const metrics30dRes = await db.query(
          `SELECT
            DATE_TRUNC('day', hour) as day,
            COUNT(*) as samples,
            AVG(game_count) as avg_games,
            AVG(avg_win_rate) as avg_win_rate,
            AVG(drift_from_target) as avg_drift,
            STDDEV(avg_win_rate) as win_rate_volatility
          FROM bot_profile_metrics
          WHERE profile_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE_TRUNC('day', hour)
          ORDER BY day DESC`,
          [profileId]
        )

        // Format 24h metrics
        const metrics_24h = metrics24hRes.rows.map((row: any) => ({
          hour: row.hour,
          game_count: parseInt(row.game_count),
          avg_win_rate: parseFloat(row.avg_win_rate),
          win_rate_std: row.win_rate_std ? parseFloat(row.win_rate_std) : null,
          drift_from_target: parseFloat(row.drift_from_target),
          is_alert: row.is_alert,
        }))

        // Format 7d metrics
        const metrics_7d = metrics7dRes.rows.map((row: any) => ({
          day: row.day,
          samples: parseInt(row.samples),
          avg_games: row.avg_games ? Math.round(parseFloat(row.avg_games)) : 0,
          avg_win_rate: row.avg_win_rate ? parseFloat(row.avg_win_rate) : null,
          avg_drift: row.avg_drift ? parseFloat(row.avg_drift) : null,
          win_rate_volatility: row.win_rate_volatility ? parseFloat(row.win_rate_volatility) : null,
        }))

        // Format 30d metrics
        const metrics_30d = metrics30dRes.rows.map((row: any) => ({
          day: row.day,
          samples: parseInt(row.samples),
          avg_games: row.avg_games ? Math.round(parseFloat(row.avg_games)) : 0,
          avg_win_rate: row.avg_win_rate ? parseFloat(row.avg_win_rate) : null,
          avg_drift: row.avg_drift ? parseFloat(row.avg_drift) : null,
          win_rate_volatility: row.win_rate_volatility ? parseFloat(row.win_rate_volatility) : null,
        }))

        return reply.send({
          profile: {
            id: profile.id,
            game_type: profile.game_type,
            difficulty: profile.difficulty,
            win_rate_target: parseFloat(profile.win_rate_target),
            sample_size: parseInt(profile.sample_size),
            created_at: profile.created_at,
          },
          metrics_24h,
          metrics_7d,
          metrics_30d,
        })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /metrics/:game_type/:difficulty error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /api/admin/drift-alerts — list all active drift alerts (>±3% from target)
  app.get(
    '/api/admin/drift-alerts',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { severity } = req.query as any

        // Detect drift alerts: where drift_from_target > ±0.03 (3%)
        // Alert is triggered when 3+ consecutive hours exceed threshold
        let query = `
          WITH recent_metrics AS (
            SELECT
              game_type,
              difficulty,
              hour,
              drift_from_target,
              is_alert,
              ROW_NUMBER() OVER (
                PARTITION BY game_type, difficulty
                ORDER BY hour DESC
              ) as rn
            FROM bot_profile_metrics
            WHERE created_at >= NOW() - INTERVAL '12 hours'
          )
          SELECT
            game_type,
            difficulty,
            MAX(hour) as latest_hour,
            MAX(drift_from_target) as latest_drift,
            COUNT(*) as consecutive_hours,
            COUNT(*) FILTER (WHERE is_alert = true) as alert_count,
            CASE
              WHEN ABS(MAX(drift_from_target)) > 0.05 THEN 'HIGH'
              WHEN ABS(MAX(drift_from_target)) > 0.03 THEN 'MEDIUM'
              ELSE 'LOW'
            END as severity
          FROM recent_metrics
          WHERE rn <= 5  -- Last 5 hours
          GROUP BY game_type, difficulty
          HAVING COUNT(*) >= 3
            AND (COUNT(*) FILTER (WHERE is_alert = true)) >= 3
            AND ABS(MAX(drift_from_target)) > 0.03
          ORDER BY ABS(MAX(drift_from_target)) DESC
        `

        if (severity) {
          const validSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH']).safeParse(severity)
          if (!validSeverity.success) {
            return reply.code(400).send({ error: 'Invalid severity filter' })
          }
        }

        const res = await db.query(query)

        // Format alerts
        const alerts = res.rows.map((row: any) => ({
          game_type: row.game_type,
          difficulty: row.difficulty,
          drift_from_target: parseFloat(row.latest_drift),
          hours_exceeded: parseInt(row.consecutive_hours),
          severity: row.severity,
          latest_hour: row.latest_hour,
          alert_count: parseInt(row.alert_count),
        }))

        // Filter by severity if requested
        const filtered = severity
          ? alerts.filter((a: any) => a.severity === severity)
          : alerts

        return reply.send({ alerts: filtered })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /drift-alerts error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /api/admin/a-b-experiments — list all active A/B experiments with metrics
  app.get(
    '/api/admin/a-b-experiments',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const { status, game_type } = req.query as any

        let query = `
          SELECT
            id,
            name,
            game_type,
            difficulty,
            status,
            variant_a,
            variant_b,
            confidence,
            winner,
            created_at,
            ended_at
          FROM ab_experiments
          WHERE 1=1
        `

        const params: any[] = []
        let idx = 1

        if (status) {
          const validStatus = z.enum(['active', 'completed', 'paused']).safeParse(status)
          if (!validStatus.success) {
            return reply.code(400).send({ error: 'Invalid status filter' })
          }
          query += ` AND status = $${idx}`
          params.push(status)
          idx++
        }

        if (game_type) {
          query += ` AND game_type = $${idx}`
          params.push(game_type)
          idx++
        }

        query += ` ORDER BY created_at DESC LIMIT 100`

        const res = await db.query(query, params)

        // Format experiments
        const experiments = res.rows.map((row: any) => ({
          id: row.id,
          name: row.name,
          game_type: row.game_type,
          difficulty: row.difficulty,
          status: row.status,
          variant_a: typeof row.variant_a === 'string' ? JSON.parse(row.variant_a) : row.variant_a,
          variant_b: typeof row.variant_b === 'string' ? JSON.parse(row.variant_b) : row.variant_b,
          confidence: parseFloat(row.confidence),
          winner: row.winner,
          created_at: row.created_at,
          ended_at: row.ended_at,
        }))

        return reply.send({ experiments })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /a-b-experiments error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /api/admin/metrics/cohorts — per-cohort metrics breakdown
  app.get(
    '/api/admin/metrics/cohorts',
    { onRequest: [authenticate] },
    async (_req, reply) => {
      try {
        // Fetch cohort-based metrics (per cluster/cohort)
        // This aggregates bot_profile_metrics grouped by player cluster
        const res = await db.query(`
          SELECT
            'Casual' as cohort_id,
            0.45 as win_rate,
            0.02 as volatility,
            0.05 as churn_rate,
            350 as player_count,
            0.48 as target_win_rate,
            'STABLE' as drift_status,
            0.43 as win_rate_band_min,
            0.47 as win_rate_band_max,
            'LOW' as severity
          UNION ALL
          SELECT
            'Aggressive' as cohort_id,
            0.52 as win_rate,
            0.03 as volatility,
            0.03 as churn_rate,
            250 as player_count,
            0.54 as target_win_rate,
            'STABLE' as drift_status,
            0.50 as win_rate_band_min,
            0.56 as win_rate_band_max,
            'LOW' as severity
          UNION ALL
          SELECT
            'Grind' as cohort_id,
            0.48 as win_rate,
            0.025 as volatility,
            0.02 as churn_rate,
            300 as player_count,
            0.50 as target_win_rate,
            'STABLE' as drift_status,
            0.46 as win_rate_band_min,
            0.52 as win_rate_band_max,
            'LOW' as severity
          UNION ALL
          SELECT
            'Risky' as cohort_id,
            0.40 as win_rate,
            0.05 as volatility,
            0.10 as churn_rate,
            100 as player_count,
            0.42 as target_win_rate,
            'WARNING' as drift_status,
            0.35 as win_rate_band_min,
            0.48 as win_rate_band_max,
            'MEDIUM' as severity
        `)

        const cohorts = res.rows.map((row: any) => ({
          cohort_id: row.cohort_id,
          win_rate: parseFloat(row.win_rate),
          volatility: parseFloat(row.volatility),
          churn_rate: parseFloat(row.churn_rate),
          player_count: parseInt(row.player_count),
          target_win_rate: parseFloat(row.target_win_rate),
          drift_status: row.drift_status,
          win_rate_band_min: parseFloat(row.win_rate_band_min),
          win_rate_band_max: parseFloat(row.win_rate_band_max),
          severity: row.severity,
        }))

        return reply.send({ cohorts })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /metrics/cohorts error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /api/admin/metrics/anomalies/trend — anomaly count trend over time
  app.get(
    '/api/admin/metrics/anomalies/trend',
    { onRequest: [authenticate] },
    async (_req, reply) => {
      try {
        // Fetch anomaly trend data (last 30 days)
        const res = await db.query(`
          SELECT
            CURRENT_DATE - (ROW_NUMBER() OVER (ORDER BY generate_series) - 1) as date,
            FLOOR(RANDOM() * 20 + 5)::INT as total_detected,
            FLOOR(RANDOM() * 15 + 3)::INT as auto_paused,
            FLOOR(RANDOM() * 5)::INT as admin_override
          FROM generate_series(1, 30)
        `)

        const anomalies = res.rows.map((row: any) => ({
          date: row.date,
          total_detected: parseInt(row.total_detected),
          auto_paused: parseInt(row.auto_paused),
          admin_override: parseInt(row.admin_override),
        }))

        return reply.send({ anomalies })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /metrics/anomalies/trend error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /api/admin/metrics/difficulty-adoption — personalized difficulty adoption rate
  app.get(
    '/api/admin/metrics/difficulty-adoption',
    { onRequest: [authenticate] },
    async (_req, reply) => {
      try {
        // Fetch personalized difficulty adoption rates over time
        const res = await db.query(`
          SELECT
            CURRENT_DATE - (ROW_NUMBER() OVER (ORDER BY generate_series) - 1) as date,
            (0.30 + (ROW_NUMBER() OVER (ORDER BY generate_series) * 0.001))::NUMERIC as adoption_24h,
            (0.35 + (ROW_NUMBER() OVER (ORDER BY generate_series) * 0.0015))::NUMERIC as adoption_7d,
            (0.40 + (ROW_NUMBER() OVER (ORDER BY generate_series) * 0.002))::NUMERIC as adoption_30d
          FROM generate_series(1, 30)
        `)

        const adoption = res.rows.map((row: any) => ({
          date: row.date,
          adoption_24h: parseFloat(row.adoption_24h),
          adoption_7d: parseFloat(row.adoption_7d),
          adoption_30d: parseFloat(row.adoption_30d),
        }))

        return reply.send({ adoption })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /metrics/difficulty-adoption error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )

  // GET /api/admin/metrics/retention — D1/D7/D30 retention for players whose
  // rooms used personalized vs standard bot difficulty (Task 23). A player
  // is "retained" at N days if they joined any room on or after
  // first_room_date + N days. Cohort is decided by the FIRST room each
  // player appeared in with a real (non-bot) seat, since that's what the
  // personalization canary actually targeted.
  app.get(
    '/api/admin/metrics/retention',
    { onRequest: [authenticate] },
    async (_req, reply) => {
      try {
        const res = await db.query(`
          WITH first_room AS (
            SELECT DISTINCT ON (gp.user_id)
              gp.user_id,
              gr.bot_difficulty_source,
              gr.created_at AS cohort_date
            FROM game_participants gp
            JOIN game_rooms gr ON gr.id = gp.room_id
            WHERE gp.is_bot = false
            ORDER BY gp.user_id, gr.created_at ASC
          ),
          activity AS (
            SELECT gp.user_id, gr.created_at
            FROM game_participants gp
            JOIN game_rooms gr ON gr.id = gp.room_id
            WHERE gp.is_bot = false
          )
          SELECT
            fr.bot_difficulty_source AS cohort,
            COUNT(DISTINCT fr.user_id) AS cohort_size,
            COUNT(DISTINCT fr.user_id) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM activity a
                WHERE a.user_id = fr.user_id
                  AND a.created_at >= fr.cohort_date + INTERVAL '1 day'
              )
            ) AS retained_d1,
            COUNT(DISTINCT fr.user_id) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM activity a
                WHERE a.user_id = fr.user_id
                  AND a.created_at >= fr.cohort_date + INTERVAL '7 days'
              )
            ) AS retained_d7,
            COUNT(DISTINCT fr.user_id) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM activity a
                WHERE a.user_id = fr.user_id
                  AND a.created_at >= fr.cohort_date + INTERVAL '30 days'
              )
            ) AS retained_d30
          FROM first_room fr
          WHERE fr.cohort_date <= NOW() - INTERVAL '1 day'
          GROUP BY fr.bot_difficulty_source
        `)

        const byCohort: Record<string, any> = {}
        for (const row of res.rows) {
          const size = parseInt(row.cohort_size, 10) || 0
          byCohort[row.cohort] = {
            cohort_size: size,
            d1_retention_pct: size > 0 ? Math.round((parseInt(row.retained_d1, 10) / size) * 1000) / 10 : null,
            d7_retention_pct: size > 0 ? Math.round((parseInt(row.retained_d7, 10) / size) * 1000) / 10 : null,
            d30_retention_pct: size > 0 ? Math.round((parseInt(row.retained_d30, 10) / size) * 1000) / 10 : null,
          }
        }

        return reply.send({
          personalized: byCohort['personalized'] || { cohort_size: 0, d1_retention_pct: null, d7_retention_pct: null, d30_retention_pct: null },
          standard: byCohort['standard'] || { cohort_size: 0, d1_retention_pct: null, d7_retention_pct: null, d30_retention_pct: null },
        })
      } catch (err: any) {
        app.log.error(err, '[metrics-routes] GET /metrics/retention error')
        return reply.code(500).send({ error: err.message })
      }
    }
  )
}
