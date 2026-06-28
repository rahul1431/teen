import { Pool } from 'pg'
import Redis from 'ioredis'

export interface HourlySummary {
  hour: string
  game_type: string | null
  active_players: number
  games_started: number
  games_completed: number
  total_stake: number
  total_rake: number
  total_prize: number
  new_players: number
}

export interface GGRPoint {
  day: string
  game_type: string
  games_played: number
  ggr: number
  total_wagered: number
}

export interface SessionStats {
  avg_duration_sec: number
  total_sessions: number
  p50_duration_sec: number
}

export class Aggregator {
  constructor(private db: Pool, private redis: Redis) {}

  /** Compute and upsert hourly rollup for a given hour window */
  async rollupHour(hour: Date): Promise<void> {
    const hourStr = hour.toISOString()

    // Aggregate game rooms that started in this hour
    const gamesResult = await this.db.query(
      `SELECT
         game_type,
         COUNT(*) FILTER (WHERE started_at >= $1 AND started_at < $1 + INTERVAL '1 hour') AS games_started,
         COUNT(*) FILTER (WHERE status = 'completed' AND ended_at >= $1 AND ended_at < $1 + INTERVAL '1 hour') AS games_completed,
         COALESCE(SUM(prize_pool) FILTER (WHERE started_at >= $1 AND started_at < $1 + INTERVAL '1 hour'), 0) AS total_stake,
         COALESCE(SUM(platform_fee) FILTER (WHERE ended_at >= $1 AND ended_at < $1 + INTERVAL '1 hour' AND status = 'completed'), 0) AS total_rake,
         COALESCE(SUM(prize_pool - platform_fee) FILTER (WHERE ended_at >= $1 AND ended_at < $1 + INTERVAL '1 hour' AND status = 'completed'), 0) AS total_prize
       FROM game_rooms
       WHERE (started_at >= $1 AND started_at < $1 + INTERVAL '1 hour')
          OR (ended_at >= $1 AND ended_at < $1 + INTERVAL '1 hour')
       GROUP BY game_type`,
      [hourStr]
    )

    // Count unique active players
    const playersResult = await this.db.query(
      `SELECT gr.game_type, COUNT(DISTINCT gp.user_id) AS active_players
       FROM game_participants gp
       JOIN game_rooms gr ON gr.id = gp.room_id
       WHERE gr.started_at >= $1 AND gr.started_at < $1 + INTERVAL '1 hour'
       GROUP BY gr.game_type`,
      [hourStr]
    )

    // New registrations this hour
    const newUsersResult = await this.db.query(
      `SELECT COUNT(*) AS new_players FROM users
       WHERE created_at >= $1 AND created_at < $1 + INTERVAL '1 hour' AND is_bot = false`,
      [hourStr]
    )
    const newPlayers = parseInt(newUsersResult.rows[0]?.new_players || '0')

    const playersByGame: Record<string, number> = {}
    for (const row of playersResult.rows) {
      playersByGame[row.game_type] = parseInt(row.active_players)
    }

    for (const row of gamesResult.rows) {
      await this.db.query(
        `INSERT INTO analytics_hourly
           (hour, game_type, active_players, games_started, games_completed, total_stake, total_rake, total_prize, new_players, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (hour, COALESCE(game_type, ''))
         DO UPDATE SET
           active_players  = EXCLUDED.active_players,
           games_started   = EXCLUDED.games_started,
           games_completed = EXCLUDED.games_completed,
           total_stake     = EXCLUDED.total_stake,
           total_rake      = EXCLUDED.total_rake,
           total_prize     = EXCLUDED.total_prize,
           new_players     = EXCLUDED.new_players,
           updated_at      = NOW()`,
        [
          hourStr,
          row.game_type,
          playersByGame[row.game_type] || 0,
          parseInt(row.games_started || '0'),
          parseInt(row.games_completed || '0'),
          parseFloat(row.total_stake || '0'),
          parseFloat(row.total_rake || '0'),
          parseFloat(row.total_prize || '0'),
          newPlayers,
        ]
      )
    }
  }

  /** GGR over last N days, from the ggr_daily view */
  async getGGRTrend(days: number = 7): Promise<GGRPoint[]> {
    const cacheKey = `analytics:ggr:${days}`
    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const result = await this.db.query(
      `SELECT day::text, game_type, games_played, ggr::float, total_wagered::float, unique_winners
       FROM ggr_daily
       WHERE day > NOW() - ($1 || ' days')::interval
       ORDER BY day ASC, game_type`,
      [days]
    )

    const data = result.rows
    await this.redis.setex(cacheKey, 300, JSON.stringify(data)) // cache 5 min
    return data
  }

  /** Summary stats for admin dashboard */
  async getLiveSummary(): Promise<any> {
    const cacheKey = 'analytics:live_summary'
    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const [ggrToday, activePlayers, retention, fraudCount] = await Promise.all([
      this.db.query(
        `SELECT COALESCE(SUM(platform_fee), 0)::float AS ggr_today,
                COALESCE(SUM(prize_pool), 0)::float AS wagered_today,
                COUNT(*) AS games_today
         FROM game_rooms
         WHERE status = 'completed' AND ended_at > CURRENT_DATE`
      ),
      this.db.query(
        `SELECT COUNT(DISTINCT user_id) AS active
         FROM game_participants gp
         JOIN game_rooms gr ON gr.id = gp.room_id
         WHERE gr.started_at > NOW() - INTERVAL '1 hour'`
      ),
      this.db.query(
        `SELECT
           COUNT(*) FILTER (WHERE created_at > CURRENT_DATE) AS new_today,
           COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '24 hours') AS dau
         FROM users WHERE is_bot = false`
      ),
      this.db.query(
        `SELECT COUNT(*) AS cnt FROM fraud_events
         WHERE created_at > CURRENT_DATE AND action IN ('slow_lane','block')`
      ),
    ])

    const summary = {
      ggr_today: parseFloat(ggrToday.rows[0].ggr_today),
      wagered_today: parseFloat(ggrToday.rows[0].wagered_today),
      games_today: parseInt(ggrToday.rows[0].games_today),
      active_players_1h: parseInt(activePlayers.rows[0].active),
      new_players_today: parseInt(retention.rows[0].new_today),
      dau: parseInt(retention.rows[0].dau),
      fraud_alerts_today: parseInt(fraudCount.rows[0].cnt),
      timestamp: new Date().toISOString(),
    }

    await this.redis.setex(cacheKey, 60, JSON.stringify(summary))
    return summary
  }

  /** Per-game-type breakdown for today */
  async getGameBreakdown(): Promise<any[]> {
    const result = await this.db.query(
      `SELECT
         game_type,
         COUNT(*) AS games,
         COALESCE(SUM(platform_fee), 0)::float AS rake,
         COALESCE(SUM(prize_pool), 0)::float AS wagered,
         COUNT(DISTINCT winner_id) AS unique_winners
       FROM game_rooms
       WHERE status = 'completed' AND ended_at > CURRENT_DATE
       GROUP BY game_type
       ORDER BY rake DESC`
    )
    return result.rows
  }

  /** Churn risk users (inactive >= 7 days) */
  async getChurnRisk(limit: number = 20): Promise<any[]> {
    const cacheKey = `analytics:churn:${limit}`
    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const result = await this.db.query(
      `SELECT id, username, email,
              last_played_at::text,
              total_games::int,
              total_prize_won::float,
              EXTRACT(EPOCH FROM inactive_duration)::int AS inactive_seconds
       FROM churn_risk_users
       LIMIT $1`,
      [limit]
    )

    await this.redis.setex(cacheKey, 600, JSON.stringify(result.rows)) // cache 10 min
    return result.rows
  }

  /** Hourly trend for last 24h from analytics_hourly */
  async getHourlyTrend(gameType?: string): Promise<any[]> {
    const params: any[] = []
    let gameFilter = ''
    if (gameType && gameType !== 'all') {
      params.push(gameType)
      gameFilter = 'AND game_type = $1'
    }

    const result = await this.db.query(
      `SELECT
         hour::text,
         game_type,
         active_players,
         games_started,
         games_completed,
         total_stake::float,
         total_rake::float
       FROM analytics_hourly
       WHERE hour > NOW() - INTERVAL '24 hours'
         ${gameFilter}
       ORDER BY hour ASC`,
      params
    )
    return result.rows
  }
}
