import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'

/**
 * Ludo bot trainer.
 *
 * Learns two things from real Ludo players: how often they take an available
 * capture, and how often they choose a safe square when an exposed move is
 * also on the table. Those rates land in ludo_bot_profiles and are read by the
 * Ludo engine's chooseBotToken (services/game-engines/ludo/src/rules.ts).
 *
 * Split out of bot-learning-service's ProfileBuilder, which trained Ludo and
 * Teen Patti from one class over a shared bot_profiles table whose fold/call/
 * raise columns are meaningless for a roll-and-move game.
 *
 * NULL is a real value here, not missing data. chooseBotToken reads a NULL
 * capture_probability as "no trained data — use the deterministic rule", so
 * this trainer writes NULL rather than a low-confidence number whenever a tier
 * is below min_sample_size. Do not add a numeric default.
 */

export const GAME_TYPE = 'ludo'
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export interface LudoBotProfile {
  difficulty: Difficulty
  win_rate_target: number | null
  capture_probability: number | null
  safe_play_probability: number | null
  avg_decision_delay_ms: number
  avg_stake_preference: number | null
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

const NUMERIC_CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof TrainingConfig)[]

/** Redis key the Ludo engine and gateway read. Unchanged from the merged
 *  service so existing cache lookups keep hitting during the cutover. */
export const cacheKey = (difficulty: string) => `bot:profile:${GAME_TYPE}:${difficulty}`

export class LudoTrainer {
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

    const cfg = { ...DEFAULT_CONFIG }
    for (const key of NUMERIC_CONFIG_KEYS) {
      const parsed = parseInt(raw[key] ?? '', 10)
      if (!isNaN(parsed)) cfg[key] = parsed
    }
    return cfg
  }

  async updateConfig(updates: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(updates)) {
      if (!NUMERIC_CONFIG_KEYS.includes(key as keyof TrainingConfig)) {
        throw new Error(`Unknown config key '${key}'`)
      }
      if (isNaN(parseInt(value, 10))) {
        throw new Error(`Invalid numeric value for config key '${key}': ${value}`)
      }
    }
    if (Object.keys(updates).length === 0) return

    try {
      await this.pool.query('BEGIN')
      for (const [key, value] of Object.entries(updates)) {
        await this.pool.query(
          `INSERT INTO bot_training_config (game_type, key, value, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (game_type, key) DO UPDATE SET value = $3, updated_at = NOW()`,
          [GAME_TYPE, key, value]
        )
      }
      await this.pool.query('COMMIT')
    } catch (err) {
      await this.pool.query('ROLLBACK').catch(rollbackErr =>
        this.logger.error({ rollbackErr }, 'Config rollback failed')
      )
      throw err
    }
  }

  async getProfile(difficulty: string): Promise<LudoBotProfile | null> {
    const res = await this.pool.query(
      `SELECT difficulty, win_rate_target, capture_probability, safe_play_probability,
              avg_decision_delay_ms, avg_stake_preference, sample_size, last_rebuilt_at
       FROM ludo_bot_profiles WHERE difficulty = $1`,
      [difficulty]
    )
    return res.rows[0] ?? null
  }

  async getProfiles(): Promise<LudoBotProfile[]> {
    const res = await this.pool.query(
      `SELECT difficulty, win_rate_target, capture_probability, safe_play_probability,
              avg_decision_delay_ms, avg_stake_preference, sample_size, last_rebuilt_at
       FROM ludo_bot_profiles
       ORDER BY CASE difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
    )
    return res.rows
  }

  /** Admin override of a single tier. Passing null for capture_probability or
   *  safe_play_probability is legitimate — it reverts that tier to the
   *  deterministic rule. */
  async overrideProfile(
    difficulty: string,
    updates: Partial<LudoBotProfile>
  ): Promise<void> {
    const allowed: (keyof LudoBotProfile)[] = [
      'win_rate_target', 'capture_probability', 'safe_play_probability',
      'avg_decision_delay_ms', 'avg_stake_preference',
    ]
    const sets: string[] = []
    const values: unknown[] = [difficulty]
    for (const field of allowed) {
      if (!(field in updates)) continue
      const value = updates[field]
      if ((field === 'capture_probability' || field === 'safe_play_probability') &&
          value != null && (Number(value) < 0 || Number(value) > 1)) {
        throw new Error(`${field} must be between 0 and 1, or null`)
      }
      values.push(value)
      sets.push(`${field} = $${values.length}`)
    }
    if (sets.length === 0) return

    await this.pool.query(
      `UPDATE ludo_bot_profiles SET ${sets.join(', ')} WHERE difficulty = $1`,
      values
    )
    await this.redis.del(cacheKey(difficulty)).catch(() => {})
  }

  async runRebuild(): Promise<{ tiersBuilt: number }> {
    const startedAt = new Date().toISOString()
    const start = Date.now()
    await this.redis
      .set(`bot:rebuild:${GAME_TYPE}:last_job`, JSON.stringify({ status: 'running', startedAt }))
      .catch(() => {})

    const cfg = await this.getConfig()
    let tiersBuilt = 0
    try {
      tiersBuilt = await this.buildProfiles(cfg)
    } catch (err) {
      await this.redis
        .set(
          `bot:rebuild:${GAME_TYPE}:last_job`,
          JSON.stringify({ status: 'failed', startedAt, completedAt: new Date().toISOString() })
        )
        .catch(() => {})
      throw err
    }

    for (const difficulty of DIFFICULTIES) {
      await this.redis.del(cacheKey(difficulty)).catch(() => {})
    }
    await this.redis
      .publish('bot:profiles:rebuilt', JSON.stringify({ game_type: GAME_TYPE, timestamp: new Date().toISOString() }))
      .catch(() => {})
    await this.redis
      .set(
        `bot:rebuild:${GAME_TYPE}:last_job`,
        JSON.stringify({
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          tiersBuilt,
        })
      )
      .catch(() => {})

    this.logger.info({ tiersBuilt }, 'Ludo bot profile rebuild complete')
    return { tiersBuilt }
  }

  private async buildProfiles(cfg: TrainingConfig): Promise<number> {
    const playersRes = await this.pool.query(
      `SELECT
         gp.user_id,
         COUNT(gp.id)::int AS games_played,
         SUM(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee)) AS total_profit,
         COUNT(CASE WHEN gp.prize_won > COALESCE(gp.entry_fee_deducted, gr.entry_fee) THEN 1 END)::int AS wins,
         AVG(gr.entry_fee) AS avg_stake
       FROM game_participants gp
       JOIN game_rooms gr ON gr.id = gp.room_id
       JOIN users u ON u.id = gp.user_id
       WHERE gr.game_type = $1
         AND u.is_bot = false
         AND u.status = 'active'
         AND gp.joined_at > NOW() - INTERVAL '${parseInt(String(cfg.history_lookback_days), 10)} days'
       GROUP BY gp.user_id
       HAVING COUNT(gp.id) >= $2
       ORDER BY total_profit ASC`,
      [GAME_TYPE, cfg.min_sample_size]
    )

    const players = playersRes.rows
    if (players.length < cfg.min_sample_size) {
      this.logger.warn(
        { found: players.length, need: cfg.min_sample_size },
        'Insufficient Ludo data — skipping rebuild, retaining existing profiles'
      )
      return 0
    }

    const total = players.length
    const tiers: Array<{ difficulty: Difficulty; players: typeof players }> = [
      { difficulty: 'easy',   players: players.slice(0, Math.floor(total * cfg.easy_percentile_max / 100)) },
      { difficulty: 'medium', players: players.slice(Math.floor(total * cfg.medium_percentile_min / 100), Math.floor(total * cfg.medium_percentile_max / 100)) },
      { difficulty: 'hard',   players: players.slice(Math.floor(total * cfg.hard_percentile_min / 100)) },
    ]

    let built = 0
    for (const { difficulty, players: tierPlayers } of tiers) {
      if (tierPlayers.length === 0) continue

      const avgStake = tierPlayers.reduce((s, p) => s + parseFloat(p.avg_stake ?? '10'), 0) / tierPlayers.length
      const avgWinRate = tierPlayers.reduce((s, p) => s + (p.wins / p.games_played) * 100, 0) / tierPlayers.length

      const learned = await this.learnMoveRates(tierPlayers.map(p => p.user_id), cfg)

      await this.upsertProfile({
        difficulty,
        win_rate_target: learned.captureRate != null ? round(avgWinRate, 1) : targetWinRateForDifficulty(difficulty),
        capture_probability: learned.captureRate,
        safe_play_probability: learned.safePlayRate,
        avg_decision_delay_ms: delayForDifficulty(difficulty),
        avg_stake_preference: Math.round(avgStake),
        sample_size: tierPlayers.length,
      })
      built++

      this.logger.info(
        {
          difficulty,
          sampleSize: tierPlayers.length,
          trained: learned.captureRate != null,
        },
        'Ludo profile upserted'
      )
    }
    return built
  }

  /**
   * Capture rate = captures taken / captures available. Safe-play rate = safe
   * moves chosen / turns where a safe move was one of several options. Both
   * come from ludo_move_decisions, which the Ludo engine writes for human
   * moves only — bots are excluded so they cannot train on themselves.
   */
  private async learnMoveRates(
    userIds: string[],
    cfg: TrainingConfig
  ): Promise<{ captureRate: number | null; safePlayRate: number | null }> {
    if (userIds.length < cfg.min_sample_size) return { captureRate: null, safePlayRate: null }

    const res = await this.pool.query(
      `SELECT
         COALESCE(SUM(capture_taken::int)::float / NULLIF(SUM(capture_available::int), 0), NULL) AS capture_rate,
         COALESCE(SUM(chose_safe_move::int)::float / NULLIF(SUM(safe_move_available::int), 0), NULL) AS safe_play_rate
       FROM ludo_move_decisions
       WHERE user_id = ANY($1)
         AND created_at > NOW() - INTERVAL '${parseInt(String(cfg.stream_lookback_days), 10)} days'`,
      [userIds]
    )
    const row = res.rows[0]
    return {
      captureRate: row?.capture_rate != null ? parseFloat(row.capture_rate) : null,
      safePlayRate: row?.safe_play_rate != null ? parseFloat(row.safe_play_rate) : null,
    }
  }

  private async upsertProfile(p: Omit<LudoBotProfile, 'last_rebuilt_at'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO ludo_bot_profiles
         (difficulty, win_rate_target, capture_probability, safe_play_probability,
          avg_decision_delay_ms, avg_stake_preference, sample_size, last_rebuilt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (difficulty) DO UPDATE SET
         win_rate_target       = $2,
         capture_probability   = $3,
         safe_play_probability = $4,
         avg_decision_delay_ms = $5,
         avg_stake_preference  = $6,
         sample_size           = $7,
         last_rebuilt_at       = NOW()`,
      [
        p.difficulty, p.win_rate_target, p.capture_probability, p.safe_play_probability,
        p.avg_decision_delay_ms, p.avg_stake_preference, p.sample_size,
      ]
    )
  }
}

export function delayForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 3000 : difficulty === 'medium' ? 3500 : 3700
}

export function targetWinRateForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 25.0 : difficulty === 'medium' ? 50.0 : 80.0
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp
