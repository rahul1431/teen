import { Redis } from 'ioredis'
import { Database } from '../db'

export interface BotStats {
  lifetimeGames: number
  lifetimeWins: number
  lifetimeWinRate: number
  gamesAsWinner: number
  gamesAsWinnerSuccess: number
  vsRpWinRate: number
  avgBlocksOnRp: number
  moveEfficiency: number
  last10Games: Array<{ won: boolean; opponentType: string; date: string }>
}

const STATS_REDIS_KEY = (botId: string) => `bot:stats:${botId}`
const STATS_CACHE_TTL = 300 // 5 minutes

export class BotStatsLoader {
  constructor(
    private redis: Redis,
    private db: Database,
  ) {}

  async loadBotStats(botId: string): Promise<BotStats> {
    // Try Redis cache first
    const cached = await this.redis.get(STATS_REDIS_KEY(botId))
    if (cached) {
      return JSON.parse(cached)
    }

    // Compute from database
    const stats = await this.computeBotStats(botId)

    // Cache in Redis
    await this.redis.setex(STATS_REDIS_KEY(botId), STATS_CACHE_TTL, JSON.stringify(stats))

    return stats
  }

  private async computeBotStats(botId: string): Promise<BotStats> {
    // Count lifetime games where this bot participated
    const lifetimeResult = await this.db.query(
      `SELECT
        COUNT(*) as total_games,
        SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as total_wins,
        SUM(CASE WHEN winner_bot_id = $1 AND coordination_success = true THEN 1 ELSE 0 END) as winner_successes,
        SUM(CASE WHEN winner_bot_id = $1 THEN 1 ELSE 0 END) as chosen_as_winner,
        AVG((bot_performance::jsonb -> ($1::text) -> 'blocks_on_rp')::numeric) as avg_blocks,
        AVG((bot_performance::jsonb -> ($1::text) -> 'move_efficiency')::numeric) as avg_efficiency
      FROM bot_learning_sessions
      WHERE bot_ids @> $2::jsonb`,
      [botId, JSON.stringify([botId])]
    )

    const lifeRow = lifetimeResult.rows[0] || {}
    const lifetimeGames = parseInt(lifeRow.total_games) || 0
    const lifetimeWins = parseInt(lifeRow.total_wins) || 0
    const lifetimeWinRate = lifetimeGames > 0 ? lifetimeWins / lifetimeGames : 0

    // Win rate specifically vs real players
    const vsRpResult = await this.db.query(
      `SELECT
        COUNT(*) as rp_games,
        SUM(CASE WHEN actual_winner_id = $1 THEN 1 ELSE 0 END) as rp_wins
      FROM bot_learning_sessions
      WHERE bot_ids @> $2::jsonb`,
      [botId, JSON.stringify([botId])]
    )

    const rpRow = vsRpResult.rows[0] || {}
    const rpGames = parseInt(rpRow.rp_games) || 0
    const rpWins = parseInt(rpRow.rp_wins) || 0
    const vsRpWinRate = rpGames > 0 ? rpWins / rpGames : 0

    // Get last 10 games
    const lastGamesResult = await this.db.query(
      `SELECT
        actual_winner_id,
        created_at
      FROM bot_learning_sessions
      WHERE bot_ids @> $1::jsonb
      ORDER BY created_at DESC
      LIMIT 10`,
      [JSON.stringify([botId])]
    )

    const last10Games = lastGamesResult.rows.map((row: any) => ({
      won: row.actual_winner_id === botId,
      opponentType: 'rp',
      date: row.created_at,
    }))

    return {
      lifetimeGames,
      lifetimeWins,
      lifetimeWinRate: parseFloat(lifetimeWinRate.toFixed(2)),
      gamesAsWinner: parseInt(lifeRow.chosen_as_winner) || 0,
      gamesAsWinnerSuccess: parseInt(lifeRow.winner_successes) || 0,
      vsRpWinRate: parseFloat(vsRpWinRate.toFixed(2)),
      avgBlocksOnRp: parseFloat(lifeRow.avg_blocks) || 0,
      moveEfficiency: parseFloat(lifeRow.avg_efficiency) || 0.5,
      last10Games,
    }
  }

  async invalidateStats(botId: string): Promise<void> {
    await this.redis.del(STATS_REDIS_KEY(botId))
  }
}
