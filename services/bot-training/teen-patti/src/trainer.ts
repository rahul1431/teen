import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'

/**
 * Teen Patti bot trainer.
 *
 * Learns how real Teen Patti players bet — how often they pack, chaal, or
 * raise — and writes one profile per difficulty tier into
 * teen_patti_bot_profiles. The gateway reads those profiles to drive bot
 * betting (see game-gateway/src/bot-profile/teen-patti.ts).
 *
 * This was extracted from bot-learning-service's ProfileBuilder, which trained
 * both games from one class over a shared bot_profiles table. Teen Patti and
 * Ludo have no decision vocabulary in common — fold/call/raise is meaningless
 * for a roll-and-move game — so the shared version carried an if/else on
 * game_type through every step and a table where half of each row was always
 * NULL. Keeping the two apart means a change to Ludo's tuning can no longer
 * alter what Teen Patti bots do.
 */

export const GAME_TYPE = 'teen_patti'
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export interface TeenPattiBotProfile {
  difficulty: Difficulty
  win_rate_target: number | null
  fold_probability: number
  call_probability: number
  raise_probability: number
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

const NUMERIC_CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof TrainingConfig)[]

/** Redis key the gateway reads. Unchanged from the merged service so the
 *  gateway's existing cache lookups keep hitting during the cutover. */
export const cacheKey = (difficulty: string) => `bot:profile:${GAME_TYPE}:${difficulty}`

export class TeenPattiTrainer {
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

  async getProfile(difficulty: string): Promise<TeenPattiBotProfile | null> {
    const res = await this.pool.query(
      `SELECT difficulty, win_rate_target, fold_probability, call_probability,
              raise_probability, avg_decision_delay_ms, avg_stake_preference,
              aggression_score, sample_size, last_rebuilt_at
       FROM teen_patti_bot_profiles WHERE difficulty = $1`,
      [difficulty]
    )
    return res.rows[0] ?? null
  }

  async getProfiles(): Promise<TeenPattiBotProfile[]> {
    const res = await this.pool.query(
      `SELECT difficulty, win_rate_target, fold_probability, call_probability,
              raise_probability, avg_decision_delay_ms, avg_stake_preference,
              aggression_score, sample_size, last_rebuilt_at
       FROM teen_patti_bot_profiles
       ORDER BY CASE difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
    )
    return res.rows
  }

  /** Admin override of a single tier. Writes straight through and invalidates
   *  the gateway's cache so the change takes effect on the next bot decision
   *  rather than up to an hour later. */
  async overrideProfile(
    difficulty: string,
    updates: Partial<TeenPattiBotProfile>
  ): Promise<void> {
    const allowed: (keyof TeenPattiBotProfile)[] = [
      'win_rate_target', 'fold_probability', 'call_probability', 'raise_probability',
      'avg_decision_delay_ms', 'avg_stake_preference', 'aggression_score',
    ]
    const sets: string[] = []
    const values: unknown[] = [difficulty]
    for (const field of allowed) {
      if (updates[field] === undefined) continue
      values.push(updates[field])
      sets.push(`${field} = $${values.length}`)
    }
    if (sets.length === 0) return

    await this.pool.query(
      `UPDATE teen_patti_bot_profiles SET ${sets.join(', ')} WHERE difficulty = $1`,
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

    this.logger.info({ tiersBuilt }, 'Teen Patti bot profile rebuild complete')
    return { tiersBuilt }
  }

  /** Bucket real players by profitability, then learn each tier's betting rates. */
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
      // Retain the existing profiles rather than overwriting trained values
      // with a small, noisy sample.
      this.logger.warn(
        { found: players.length, need: cfg.min_sample_size },
        'Insufficient Teen Patti data — skipping rebuild, retaining existing profiles'
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

      // Prefer rates learned from what players actually did. The Go engine logs
      // every human pack/chaal/raise into teen_patti_move_decisions; below the
      // sample threshold we fall back to deriving from win rate.
      const learned = await this.learnDecisionRates(tierPlayers.map(p => p.user_id), cfg)
      const foldProb = learned.foldRate ?? deriveFromWinRate(avgWinRate, 'fold')
      const callProb = learned.callRate ?? deriveFromWinRate(avgWinRate, 'call')

      const fold = clamp(foldProb, 0.05, 0.70)
      const call = clamp(callProb, 0.15, 0.75)
      const raise = Math.max(0, 1 - fold - call)
      const aggression = (raise / (call + fold)) * 10

      await this.upsertProfile({
        difficulty,
        win_rate_target: round(avgWinRate, 1),
        fold_probability: round(fold, 4),
        call_probability: round(call, 4),
        raise_probability: round(raise, 4),
        avg_decision_delay_ms: delayForDifficulty(difficulty),
        avg_stake_preference: Math.round(avgStake),
        aggression_score: round(aggression, 1),
        sample_size: tierPlayers.length,
      })
      built++

      this.logger.info(
        { difficulty, sampleSize: tierPlayers.length, learned: learned.foldRate != null },
        'Teen Patti profile upserted'
      )
    }
    return built
  }

  private async learnDecisionRates(
    userIds: string[],
    cfg: TrainingConfig
  ): Promise<{ foldRate: number | null; callRate: number | null }> {
    if (userIds.length < cfg.min_sample_size) return { foldRate: null, callRate: null }

    const res = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE action = 'fold')::float / NULLIF(COUNT(*), 0) AS fold_rate,
         COUNT(*) FILTER (WHERE action = 'call')::float / NULLIF(COUNT(*), 0) AS call_rate
       FROM teen_patti_move_decisions
       WHERE user_id = ANY($1)
         AND created_at > NOW() - INTERVAL '${parseInt(String(cfg.stream_lookback_days), 10)} days'`,
      [userIds]
    )
    const row = res.rows[0]
    return {
      foldRate: row?.fold_rate != null ? parseFloat(row.fold_rate) : null,
      callRate: row?.call_rate != null ? parseFloat(row.call_rate) : null,
    }
  }

  private async upsertProfile(p: Omit<TeenPattiBotProfile, 'last_rebuilt_at'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO teen_patti_bot_profiles
         (difficulty, win_rate_target, fold_probability, call_probability, raise_probability,
          avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size, last_rebuilt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (difficulty) DO UPDATE SET
         win_rate_target       = $2,
         fold_probability      = $3,
         call_probability      = $4,
         raise_probability     = $5,
         avg_decision_delay_ms = $6,
         avg_stake_preference  = $7,
         aggression_score      = $8,
         sample_size           = $9,
         last_rebuilt_at       = NOW()`,
      [
        p.difficulty, p.win_rate_target, p.fold_probability, p.call_probability,
        p.raise_probability, p.avg_decision_delay_ms, p.avg_stake_preference,
        p.aggression_score, p.sample_size,
      ]
    )
  }
}

/** Higher win rate → folds less, calls less (raises more). */
export function deriveFromWinRate(winRate: number, type: 'fold' | 'call'): number {
  if (type === 'fold') return Math.max(0.15, 0.60 - winRate / 200)
  return Math.max(0.20, 0.55 - winRate / 500)
}

export function delayForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 2800 : difficulty === 'medium' ? 2000 : 1400
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp
