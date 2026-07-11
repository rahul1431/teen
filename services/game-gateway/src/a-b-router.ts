import crypto from 'crypto'
import { Pool } from 'pg'

export interface ABExperiment {
  id: string
  name: string
  game_type: string
  difficulty: string
  control_profile_id: string
  experimental_profile_id: string
  traffic_allocation_pct: number
  start_date: string
  end_date: string
  status: string
  control_retention?: number
  control_avg_roi?: number
  experimental_retention?: number
  experimental_avg_roi?: number
  winner?: string | null
  created_at: string
}

export interface BotProfile {
  id: string
  game_type: string
  difficulty: string
  win_rate_target?: number
  fold_probability?: number
  call_probability?: number
  raise_probability?: number
  avg_decision_delay_ms?: number
  avg_stake_preference?: number
  aggression_score?: number
  sample_size?: number
  last_rebuilt_at?: string
  created_at?: string
}

/**
 * ABExperimentRouter routes players deterministically to control or experimental profiles
 * based on active A/B experiments.
 */
export class ABExperimentRouter {
  constructor(private db: Pool) {}

  /**
   * Deterministically hash a player_id to a value between 0-99
   * Uses SHA256 for consistent, distributed hashing.
   */
  private hashPlayerId(playerId: string): number {
    const hash = crypto.createHash('sha256').update(playerId).digest('hex')
    const hashNum = parseInt(hash.substring(0, 8), 16)
    return hashNum % 100
  }

  /**
   * Get the active experiment for a given game_type and difficulty.
   * Returns null if no active experiment exists.
   */
  async getActiveExperiment(gameType: string, difficulty: string): Promise<ABExperiment | null> {
    const query = `
      SELECT * FROM a_b_experiments
      WHERE game_type = $1
        AND difficulty = $2
        AND status = 'active'
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      LIMIT 1
    `
    const result = await this.db.query(query, [gameType, difficulty])
    return result.rows.length > 0 ? result.rows[0] : null
  }

  /**
   * Route a player to either control or experimental profile based on:
   * 1. Active experiment existence
   * 2. Deterministic hash-based assignment (hash % 100 < traffic_allocation_pct)
   *
   * Returns the assigned profile (control or experimental).
   * If no experiment, returns the control profile as fallback.
   */
  async routePlayer(
    playerId: string,
    gameType: string,
    difficulty: string
  ): Promise<BotProfile> {
    // Check for active experiment
    const experiment = await this.getActiveExperiment(gameType, difficulty)

    if (!experiment) {
      // No experiment: fetch and return default control profile
      return this.getProfile(null, gameType, difficulty)
    }

    // Deterministically assign to control or experimental
    const playerHash = this.hashPlayerId(playerId)
    const isExperimental = playerHash < experiment.traffic_allocation_pct

    const profileId = isExperimental ? experiment.experimental_profile_id : experiment.control_profile_id

    return this.getProfile(profileId, gameType, difficulty)
  }

  /**
   * Fetch a profile by ID, or fall back to fetching default profile by game_type and difficulty.
   */
  private async getProfile(
    profileId: string | null,
    gameType: string,
    difficulty: string
  ): Promise<BotProfile> {
    if (profileId) {
      const query = 'SELECT * FROM bot_profiles WHERE id = $1 LIMIT 1'
      const result = await this.db.query(query, [profileId])
      if (result.rows.length > 0) {
        return result.rows[0]
      }
    }

    // Fallback: fetch default profile by game_type and difficulty
    const query = 'SELECT * FROM bot_profiles WHERE game_type = $1 AND difficulty = $2 LIMIT 1'
    const result = await this.db.query(query, [gameType, difficulty])

    if (result.rows.length === 0) {
      throw new Error(`No profile found for game_type=${gameType}, difficulty=${difficulty}`)
    }

    return result.rows[0]
  }

  /**
   * Get all active experiments (for admin dashboard).
   */
  async getActiveExperiments(): Promise<ABExperiment[]> {
    const query = `
      SELECT * FROM a_b_experiments
      WHERE status = 'active'
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      ORDER BY created_at DESC
    `
    const result = await this.db.query(query)
    return result.rows
  }

  /**
   * Mark an experiment as completed and record the winner.
   */
  async completeExperiment(
    experimentId: string,
    winner: 'control' | 'experimental' | 'inconclusive'
  ): Promise<void> {
    const query = `
      UPDATE a_b_experiments
      SET status = 'completed', winner = $1
      WHERE id = $2
    `
    await this.db.query(query, [winner, experimentId])
  }
}
