import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'
import { runRummySelfPlay, RummySimulationResult } from './self-play'
import { cloneEliteRummyPlayers, RummyBehavioralCloneResult } from './behavioral-cloning'

export const GAME_TYPE = 'rummy'
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export interface RummyBotProfile {
  difficulty: Difficulty
  win_rate_target: number | null
  drop_probability: number
  open_draw_probability: number
  declare_speed_factor: number
  avg_decision_delay_ms: number
  avg_stake_preference: number | null
  aggression_score: number | null
  sample_size: number
  last_rebuilt_at?: string
}

export interface TrainingConfig {
  rebuild_hour: number
  stream_lookback_days: number
  history_lookback_days: number
  min_sample_size: number
  easy_percentile_max: number
  medium_percentile_min: number
  medium_percentile_max: number
  hard_percentile_min: number
}

const DEFAULT_CONFIG: TrainingConfig = {
  rebuild_hour: 2,
  stream_lookback_days: 7,
  history_lookback_days: 30,
  min_sample_size: 50,
  easy_percentile_max: 25,
  medium_percentile_min: 40,
  medium_percentile_max: 60,
  hard_percentile_min: 75,
}

export const cacheKey = (difficulty: string) => `bot:profile:${GAME_TYPE}:${difficulty}`

export class RummyTrainer {
  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger
  ) {}

  async getConfig(): Promise<TrainingConfig> {
    const res = await this.pool.query(
      'SELECT key, value FROM bot_training_config WHERE game_type = $1',
      [GAME_TYPE]
    )
    const raw: Record<string, string> = {}
    for (const row of res.rows) raw[row.key] = row.value

    return {
      rebuild_hour: parseInt(raw.rebuild_hour ?? `${DEFAULT_CONFIG.rebuild_hour}`, 10),
      stream_lookback_days: parseInt(raw.stream_lookback_days ?? `${DEFAULT_CONFIG.stream_lookback_days}`, 10),
      history_lookback_days: parseInt(raw.history_lookback_days ?? `${DEFAULT_CONFIG.history_lookback_days}`, 10),
      min_sample_size: parseInt(raw.min_sample_size ?? `${DEFAULT_CONFIG.min_sample_size}`, 10),
      easy_percentile_max: parseInt(raw.easy_percentile_max ?? `${DEFAULT_CONFIG.easy_percentile_max}`, 10),
      medium_percentile_min: parseInt(raw.medium_percentile_min ?? `${DEFAULT_CONFIG.medium_percentile_min}`, 10),
      medium_percentile_max: parseInt(raw.medium_percentile_max ?? `${DEFAULT_CONFIG.medium_percentile_max}`, 10),
      hard_percentile_min: parseInt(raw.hard_percentile_min ?? `${DEFAULT_CONFIG.hard_percentile_min}`, 10),
    }
  }

  async updateConfig(updates: Record<string, string>): Promise<void> {
    for (const [key, val] of Object.entries(updates)) {
      await this.pool.query(
        `INSERT INTO bot_training_config (game_type, key, value, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (game_type, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [GAME_TYPE, key, String(val)]
      )
    }
  }

  async getProfile(difficulty: Difficulty): Promise<RummyBotProfile | null> {
    const cached = await this.redis.get(cacheKey(difficulty)).catch(() => null)
    if (cached) {
      try { return JSON.parse(cached) } catch {}
    }

    const res = await this.pool.query(
      `SELECT difficulty, win_rate_target, drop_probability, open_draw_probability, declare_speed_factor,
              avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size, last_rebuilt_at
       FROM rummy_bot_profiles WHERE difficulty = $1`,
      [difficulty]
    )
    if (!res.rows.length) return null

    const row = res.rows[0]
    const profile: RummyBotProfile = {
      difficulty: row.difficulty,
      win_rate_target: row.win_rate_target ? parseFloat(row.win_rate_target) : null,
      drop_probability: parseFloat(row.drop_probability || '0.25'),
      open_draw_probability: parseFloat(row.open_draw_probability || '0.60'),
      declare_speed_factor: parseFloat(row.declare_speed_factor || '0.70'),
      avg_decision_delay_ms: parseInt(row.avg_decision_delay_ms || '2000', 10),
      avg_stake_preference: row.avg_stake_preference ? parseFloat(row.avg_stake_preference) : null,
      aggression_score: row.aggression_score ? parseFloat(row.aggression_score) : null,
      sample_size: parseInt(row.sample_size || '0', 10),
      last_rebuilt_at: row.last_rebuilt_at?.toISOString(),
    }

    await this.redis.setex(cacheKey(difficulty), 3600, JSON.stringify(profile)).catch(() => {})
    return profile
  }

  async getProfiles(): Promise<RummyBotProfile[]> {
    const list: RummyBotProfile[] = []
    for (const d of DIFFICULTIES) {
      const p = await this.getProfile(d)
      if (p) list.push(p)
    }
    return list
  }

  async overrideProfile(difficulty: Difficulty, updates: Partial<RummyBotProfile>): Promise<void> {
    const fields: string[] = []
    const values: any[] = []
    let idx = 1

    for (const [key, val] of Object.entries(updates)) {
      if (key === 'difficulty' || key === 'last_rebuilt_at') continue
      fields.push(`${key} = $${idx++}`)
      values.push(val)
    }

    if (!fields.length) return
    values.push(difficulty)

    await this.pool.query(
      `UPDATE rummy_bot_profiles SET ${fields.join(', ')}, last_rebuilt_at = NOW() WHERE difficulty = $${idx}`,
      values
    )
    await this.redis.del(cacheKey(difficulty)).catch(() => {})
  }

  async runRebuild(): Promise<{ rebuilt: string[]; skipped: string[] }> {
    this.logger.info('Starting nightly Rummy bot profiles rebuild...')
    const cfg = await this.getConfig()

    // Sample player outcomes from game_events & completed rooms
    const q = `
      SELECT
        COUNT(*) as total_actions,
        COUNT(CASE WHEN event_type = 'rummy_drop' THEN 1 END)::float / NULLIF(COUNT(*), 0) as empirical_drop_rate
      FROM game_events
      WHERE game_type = 'rummy' AND created_at >= NOW() - INTERVAL '30 days'
    `
    const statsRes = await this.pool.query(q).catch(() => ({ rows: [] }))
    const totalActions = parseInt(statsRes.rows[0]?.total_actions || '0', 10)

    if (totalActions < cfg.min_sample_size) {
      this.logger.info({ totalActions, min: cfg.min_sample_size }, 'Sample size below threshold; running autonomous self-play retraining (100 games)')
      await this.runSelfPlayTraining(100, true, 'insufficient_human_data')
      return { rebuilt: [...DIFFICULTIES], skipped: [] }
    }

    // Refresh last_rebuilt_at timestamp
    await this.pool.query(`UPDATE rummy_bot_profiles SET last_rebuilt_at = NOW(), sample_size = $1`, [totalActions])
    for (const d of DIFFICULTIES) {
      await this.redis.del(cacheKey(d)).catch(() => {})
    }

    this.logger.info('Rummy bot profiles rebuild complete')
    return { rebuilt: [...DIFFICULTIES], skipped: [] }
  }

  /**
   * Run Monte Carlo autonomous self-play simulation batch for Rummy.
   * Calibrates drop_probability, open_draw_probability, declare_speed_factor,
   * updates rummy_bot_profiles, invalidates Redis caches, and records audit telemetry.
   */
  async runSelfPlayTraining(
    totalGames: number = 100,
    applyUpdates: boolean = true,
    triggerSource: string = 'admin_api'
  ): Promise<RummySimulationResult> {
    this.logger.info({ totalGames, applyUpdates, triggerSource }, 'Starting Rummy self-play simulation training...')
    const result = runRummySelfPlay(totalGames)

    if (applyUpdates) {
      for (const difficulty of DIFFICULTIES) {
        const calibrated = result.calibratedProfiles[difficulty]
        if (!calibrated) continue

        await this.overrideProfile(difficulty, {
          drop_probability: calibrated.drop_probability,
          open_draw_probability: calibrated.open_draw_probability,
          declare_speed_factor: calibrated.declare_speed_factor,
          win_rate_target: calibrated.win_rate_target,
          avg_decision_delay_ms: calibrated.avg_decision_delay_ms,
          aggression_score: calibrated.aggression_score,
          sample_size: totalGames,
        })

        await this.redis.del(cacheKey(difficulty)).catch(() => {})
      }

      await this.redis
        .publish('bot:profiles:rebuilt', JSON.stringify({
          game_type: GAME_TYPE,
          mode: 'self_play',
          gamesSimulated: totalGames,
          timestamp: new Date().toISOString()
        }))
        .catch(() => {})

      // Audit and telemetry in bot_self_play_runs
      await this.pool.query(
        `INSERT INTO bot_self_play_runs
           (game_type, games_simulated, duration_ms, trigger_source, results_summary, calibrated_profiles, applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          GAME_TYPE,
          totalGames,
          result.durationMs,
          triggerSource,
          JSON.stringify({
            winDistribution: result.winDistribution,
            totalTurns: result.totalTurns,
            avgTurnsPerGame: result.avgTurnsPerGame,
            totalDeclares: result.totalDeclares,
            declareRatePct: result.declareRatePct,
            totalDrops: result.totalDrops,
          }),
          JSON.stringify(result.calibratedProfiles),
          true,
        ]
      ).catch(err => this.logger.warn({ err }, 'Could not record bot_self_play_runs log'))
    }

    this.logger.info(
      { games: totalGames, durationMs: result.durationMs, declares: result.totalDeclares },
      'Rummy self-play simulation training complete'
    )
    return result
  }

  /**
   * Run Behavioral Cloning (Imitation Learning from Top 5% Human Winners).
   * Extracts real decisions and action distributions of top profitable human players,
   * updates policy profiles, invalidates Redis caches, and writes audit record to bot_behavioral_clones.
   */
  async runBehavioralCloning(
    topPercentile: number = 5,
    applyUpdates: boolean = true
  ): Promise<RummyBehavioralCloneResult> {
    this.logger.info({ topPercentile, applyUpdates }, 'Starting Rummy Behavioral Cloning from elite human players...')
    const result = await cloneEliteRummyPlayers(this.pool, this.logger, topPercentile)

    if (applyUpdates) {
      // Apply to hard tier
      const hardClone = result.clonedProfiles.hard
      await this.overrideProfile('hard', {
        drop_probability: hardClone.drop_probability,
        open_draw_probability: hardClone.open_draw_probability,
        declare_speed_factor: hardClone.declare_speed_factor,
        win_rate_target: hardClone.win_rate_target,
        avg_decision_delay_ms: hardClone.avg_decision_delay_ms,
        aggression_score: hardClone.aggression_score,
        sample_size: result.decisionsExtracted,
      })

      // Apply to medium tier
      const medClone = result.clonedProfiles.medium
      await this.overrideProfile('medium', {
        drop_probability: medClone.drop_probability,
        open_draw_probability: medClone.open_draw_probability,
        declare_speed_factor: medClone.declare_speed_factor,
        win_rate_target: medClone.win_rate_target,
        avg_decision_delay_ms: medClone.avg_decision_delay_ms,
        aggression_score: medClone.aggression_score,
        sample_size: result.decisionsExtracted,
      })

      await this.redis.del(cacheKey('hard')).catch(() => {})
      await this.redis.del(cacheKey('medium')).catch(() => {})

      await this.redis
        .publish('bot:profiles:rebuilt', JSON.stringify({
          game_type: GAME_TYPE,
          mode: 'behavioral_cloning',
          elitePlayers: result.elitePlayerCount,
          timestamp: new Date().toISOString()
        }))
        .catch(() => {})

      // Persist in bot_behavioral_clones
      await this.pool.query(
        `INSERT INTO bot_behavioral_clones
           (game_type, tier, top_percentile_cutoff, players_analyzed, elite_player_ids, decisions_extracted, extracted_action_distribution, cloned_weights, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [
          GAME_TYPE,
          'hard',
          topPercentile,
          result.playersAnalyzed,
          JSON.stringify(result.elitePlayerIds),
          result.decisionsExtracted,
          JSON.stringify(result.extractedDistribution),
          JSON.stringify(result.clonedProfiles),
        ]
      ).catch(err => this.logger.warn({ err }, 'Could not record bot_behavioral_clones row'))
    }

    this.logger.info(
      { eliteCount: result.elitePlayerCount, decisions: result.decisionsExtracted },
      'Rummy Behavioral Cloning complete'
    )
    return result
  }
}
