import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'

export interface CohortTarget {
  cluster_id: number
  cluster_name?: string
  player_count: number
  avg_win_rate: number
  cohort_target_win_rate: number
}

const GAME_TYPES = ['teen_patti', 'ludo', 'aviator', 'matka'] as const
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
const COHORT_TARGET_BOOST = 0.02 // Add 2% to player average

export class AdaptiveThresholds {
  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger
  ) {}

  /**
   * Calculate cohort targets for a specific game_type and difficulty
   * by querying player clusters and computing mean win rates + 2%
   */
  async calculateCohortTargets(gameType: string, difficulty: string): Promise<CohortTarget[]> {
    try {
      // Query player clusters with their average win rates for this game_type/difficulty
      const res = await this.pool.query(
        `SELECT
           bpp.cluster_id,
           bpp.cluster_name,
           COUNT(DISTINCT bpp.player_id)::int AS player_count,
           AVG(CAST(COALESCE(gp.prize_won, 0) - COALESCE(gp.entry_fee_deducted, gr.entry_fee) > 0 THEN 1.0 ELSE 0.0 END))::NUMERIC(5,3) AS avg_win_rate
         FROM bot_player_profiles bpp
         LEFT JOIN game_participants gp ON gp.user_id = bpp.player_id
         LEFT JOIN game_rooms gr ON gr.id = gp.room_id
         WHERE gr.game_type = $1 AND gr.difficulty = $2
           AND bpp.cluster_id IS NOT NULL
           AND gp.joined_at > NOW() - INTERVAL '30 days'
         GROUP BY bpp.cluster_id, bpp.cluster_name
         ORDER BY bpp.cluster_id`,
        [gameType, difficulty]
      )

      const cohorts: CohortTarget[] = res.rows.map((row: any) => ({
        cluster_id: row.cluster_id,
        cluster_name: row.cluster_name,
        player_count: row.player_count,
        avg_win_rate: parseFloat(row.avg_win_rate ?? '0.50'),
        cohort_target_win_rate: Math.round((parseFloat(row.avg_win_rate ?? '0.50') + COHORT_TARGET_BOOST) * 1000) / 1000,
      }))

      this.logger.info(
        { gameType, difficulty, cohortCount: cohorts.length },
        'Calculated cohort targets'
      )

      return cohorts
    } catch (err) {
      this.logger.error({ err, gameType, difficulty }, 'Failed to calculate cohort targets')
      return []
    }
  }

  /**
   * Store cohort targets in bot_profiles_cohort_targets table
   */
  async storeCohortTargets(gameType: string, difficulty: string, targets: CohortTarget[]): Promise<void> {
    if (targets.length === 0) {
      this.logger.warn({ gameType, difficulty }, 'No cohort targets to store')
      return
    }

    try {
      for (const target of targets) {
        await this.pool.query(
          `INSERT INTO bot_profiles_cohort_targets
             (game_type, difficulty, cluster_id, cluster_name, cohort_target_win_rate, player_count, avg_win_rate, last_calculated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (game_type, difficulty, cluster_id) DO UPDATE SET
             cohort_target_win_rate = $5,
             player_count = $6,
             avg_win_rate = $7,
             last_calculated_at = NOW()`,
          [gameType, difficulty, target.cluster_id, target.cluster_name, target.cohort_target_win_rate, target.player_count, target.avg_win_rate]
        )
      }

      this.logger.info(
        { gameType, difficulty, count: targets.length },
        'Stored cohort targets'
      )
    } catch (err) {
      this.logger.error({ err, gameType, difficulty }, 'Failed to store cohort targets')
      throw err
    }
  }

  /**
   * Update bot_profiles with the dominant cohort target for each (game_type, difficulty)
   * The dominant cohort is the one with the most players
   */
  async updateBotProfilesWithCohortTargets(gameType: string, difficulty: string): Promise<void> {
    try {
      // Get the dominant cohort (most players) for this game_type/difficulty
      const res = await this.pool.query(
        `SELECT cluster_id, cohort_target_win_rate
         FROM bot_profiles_cohort_targets
         WHERE game_type = $1 AND difficulty = $2
         ORDER BY player_count DESC
         LIMIT 1`,
        [gameType, difficulty]
      )

      if (res.rows.length === 0) {
        this.logger.warn({ gameType, difficulty }, 'No cohort targets found to update bot_profiles')
        return
      }

      const dominantCohort = res.rows[0]

      // Update bot_profiles with the dominant cohort's target
      await this.pool.query(
        `UPDATE bot_profiles
         SET cohort_id = $1, cohort_target_win_rate = $2
         WHERE game_type = $3 AND difficulty = $4`,
        [dominantCohort.cluster_id, dominantCohort.cohort_target_win_rate, gameType, difficulty]
      )

      this.logger.info(
        { gameType, difficulty, cohort_id: dominantCohort.cluster_id, target: dominantCohort.cohort_target_win_rate },
        'Updated bot_profiles with cohort target'
      )
    } catch (err) {
      this.logger.error({ err, gameType, difficulty }, 'Failed to update bot_profiles with cohort targets')
      throw err
    }
  }

  /**
   * Recalculate all cohort targets daily
   * Runs at 02:00 UTC after the nightly rebuild
   */
  async recalculateCohortTargetsDaily(): Promise<void> {
    try {
      this.logger.info('Cohort target recalculation started')

      // Get all unique game_type/difficulty combinations
      const res = await this.pool.query(
        `SELECT DISTINCT game_type, difficulty FROM bot_profiles ORDER BY game_type, difficulty`
      )

      let totalUpdated = 0

      for (const { game_type, difficulty } of res.rows) {
        try {
          // Calculate cohort targets
          const targets = await this.calculateCohortTargets(game_type, difficulty)

          if (targets.length > 0) {
            // Store in bot_profiles_cohort_targets
            await this.storeCohortTargets(game_type, difficulty, targets)

            // Update bot_profiles with dominant cohort target
            await this.updateBotProfilesWithCohortTargets(game_type, difficulty)

            totalUpdated++
          }
        } catch (err) {
          this.logger.error({ err, game_type, difficulty }, 'Failed to update cohort targets for profile')
        }
      }

      // Invalidate cache for all profiles
      for (const gameType of GAME_TYPES) {
        for (const difficulty of DIFFICULTIES) {
          await this.redis.del(`bot:profile:${gameType}:${difficulty}`)
        }
      }

      await this.redis.publish('bot:cohort_targets:updated', JSON.stringify({
        timestamp: new Date().toISOString(),
        profilesUpdated: totalUpdated,
      }))

      this.logger.info({ profilesUpdated: totalUpdated }, 'Cohort target recalculation completed')
    } catch (err) {
      this.logger.error({ err }, 'Cohort target recalculation failed')
      throw err
    }
  }

  /**
   * Get cohort target win rate for a specific bot profile
   */
  async getCohortTargetForProfile(gameType: string, difficulty: string): Promise<number> {
    try {
      const res = await this.pool.query(
        `SELECT cohort_target_win_rate FROM bot_profiles
         WHERE game_type = $1 AND difficulty = $2`,
        [gameType, difficulty]
      )

      if (res.rows.length === 0) {
        this.logger.warn({ gameType, difficulty }, 'Profile not found, returning default cohort target')
        return 0.50
      }

      const target = parseFloat(res.rows[0].cohort_target_win_rate ?? '0.50')
      return target
    } catch (err) {
      this.logger.error({ err, gameType, difficulty }, 'Failed to get cohort target for profile')
      return 0.50
    }
  }

  /**
   * Calculate drift using cohort target instead of global target
   * Drift = actual_win_rate - cohort_target_win_rate
   */
  async calculateDriftWithCohortTarget(gameType: string, difficulty: string, actualWinRate: number): Promise<number> {
    try {
      const cohortTarget = await this.getCohortTargetForProfile(gameType, difficulty)
      const drift = actualWinRate - cohortTarget
      return Math.round(drift * 10000) / 10000
    } catch (err) {
      this.logger.error({ err, gameType, difficulty }, 'Failed to calculate drift with cohort target')
      return 0
    }
  }

  /**
   * Get detailed cohort statistics for a profile
   */
  async getCohortStats(gameType: string, difficulty: string): Promise<CohortTarget[]> {
    try {
      const res = await this.pool.query(
        `SELECT
           cluster_id,
           cluster_name,
           player_count,
           avg_win_rate,
           cohort_target_win_rate
         FROM bot_profiles_cohort_targets
         WHERE game_type = $1 AND difficulty = $2
         ORDER BY player_count DESC`,
        [gameType, difficulty]
      )

      return res.rows.map((row: any) => ({
        cluster_id: row.cluster_id,
        cluster_name: row.cluster_name,
        player_count: row.player_count,
        avg_win_rate: parseFloat(row.avg_win_rate),
        cohort_target_win_rate: parseFloat(row.cohort_target_win_rate),
      }))
    } catch (err) {
      this.logger.error({ err, gameType, difficulty }, 'Failed to get cohort stats')
      return []
    }
  }
}
