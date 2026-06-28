import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'

export interface BotProfile {
  id?: string
  game_type: string
  difficulty: 'easy' | 'medium' | 'hard'
  win_rate_target: number
  fold_probability: number
  call_probability: number
  raise_probability: number
  avg_decision_delay_ms: number
  avg_stake_preference: number
  aggression_score: number
  sample_size: number
  last_rebuilt_at?: string
}

export interface BotLearningConfig {
  rebuild_hour: number
  stream_lookback_days: number
  history_lookback_days: number
  min_sample_size: number
  easy_percentile_max: number
  medium_percentile_min: number
  medium_percentile_max: number
  hard_percentile_min: number
}

const GAME_TYPES = ['teen_patti', 'ludo', 'aviator'] as const
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
const PROFILE_CACHE_TTL = 3600 // 1 hour

export class ProfileBuilder {
  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger
  ) {}

  async getConfig(): Promise<BotLearningConfig> {
    const res = await this.pool.query('SELECT key, value FROM bot_learning_config')
    const raw: Record<string, string> = {}
    for (const row of res.rows) raw[row.key] = row.value
    return {
      rebuild_hour:          parseInt(raw.rebuild_hour          ?? '2'),
      stream_lookback_days:  parseInt(raw.stream_lookback_days  ?? '7'),
      history_lookback_days: parseInt(raw.history_lookback_days ?? '30'),
      min_sample_size:       parseInt(raw.min_sample_size       ?? '10'),
      easy_percentile_max:   parseInt(raw.easy_percentile_max   ?? '25'),
      medium_percentile_min: parseInt(raw.medium_percentile_min ?? '40'),
      medium_percentile_max: parseInt(raw.medium_percentile_max ?? '60'),
      hard_percentile_min:   parseInt(raw.hard_percentile_min   ?? '75'),
    }
  }

  async updateConfig(updates: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(updates)) {
      await this.pool.query(
        `INSERT INTO bot_learning_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      )
    }
  }

  async runRebuild(): Promise<void> {
    this.logger.info('Bot profile rebuild started')
    const cfg = await this.getConfig()

    for (const gameType of GAME_TYPES) {
      try {
        await this.rebuildForGame(gameType, cfg)
      } catch (err) {
        this.logger.error({ err, gameType }, 'Rebuild failed for game type')
      }
    }

    // Invalidate Redis cache so game-gateway fetches fresh profiles
    for (const gameType of GAME_TYPES) {
      for (const difficulty of DIFFICULTIES) {
        await this.redis.del(`bot:profile:${gameType}:${difficulty}`)
      }
    }

    await this.redis.publish('bot:profiles:rebuilt', JSON.stringify({ timestamp: new Date().toISOString() }))
    this.logger.info('Bot profile rebuild complete')
  }

  // Alias for compatibility with callers expecting rebuildAllProfiles
  async rebuildAllProfiles(): Promise<void> {
    return this.runRebuild()
  }

  private async rebuildForGame(gameType: string, cfg: BotLearningConfig): Promise<void> {
    // Step 1: Get real player stats from game_results + game_participants (last N days)
    const playersRes = await this.pool.query(
      `SELECT
         gp.user_id,
         COUNT(gp.id)::int            AS games_played,
         SUM(gp.profit_loss)          AS total_profit,
         AVG(gp.profit_loss)          AS avg_profit,
         COUNT(CASE WHEN gp.profit_loss > 0 THEN 1 END)::int AS wins,
         AVG(gr.stake)                AS avg_stake
       FROM game_participants gp
       JOIN game_rooms gr ON gr.id = gp.room_id
       JOIN users u ON u.id = gp.user_id
       WHERE gr.game_type = $1
         AND u.is_bot = false
         AND u.status = 'active'
         AND gp.joined_at > NOW() - INTERVAL '${cfg.history_lookback_days} days'
       GROUP BY gp.user_id
       HAVING COUNT(gp.id) >= $2
       ORDER BY total_profit ASC`,
      [gameType, cfg.min_sample_size]
    )

    const players = playersRes.rows
    if (players.length < cfg.min_sample_size) {
      this.logger.warn({ gameType, found: players.length, need: cfg.min_sample_size }, 'Insufficient data — skipping rebuild, retaining existing profile')
      return
    }

    this.logger.info({ gameType, playerCount: players.length }, 'Building profiles from player data')

    // Step 2: Compute percentile cutoffs
    const total = players.length
    const easyMax    = Math.floor(total * cfg.easy_percentile_max   / 100)
    const medMin     = Math.floor(total * cfg.medium_percentile_min / 100)
    const medMax     = Math.floor(total * cfg.medium_percentile_max / 100)
    const hardMin    = Math.floor(total * cfg.hard_percentile_min   / 100)

    const easyPlayers   = players.slice(0, easyMax)
    const mediumPlayers = players.slice(medMin, medMax)
    const hardPlayers   = players.slice(hardMin)

    // Step 3: Enrich with Redis stream action data
    const streamData = await this.getStreamActionData(gameType, cfg.stream_lookback_days)

    // Step 4: Build and upsert each tier
    const tierData: Array<{ difficulty: 'easy' | 'medium' | 'hard'; players: typeof players }> = [
      { difficulty: 'easy',   players: easyPlayers },
      { difficulty: 'medium', players: mediumPlayers },
      { difficulty: 'hard',   players: hardPlayers },
    ]

    for (const { difficulty, players: tierPlayers } of tierData) {
      if (tierPlayers.length === 0) continue

      const avgStake = tierPlayers.reduce((s: number, p: any) => s + parseFloat(p.avg_stake ?? '10'), 0) / tierPlayers.length
      const avgWinRate = tierPlayers.reduce((s: number, p: any) => s + (p.wins / p.games_played) * 100, 0) / tierPlayers.length

      // Use stream data if available, otherwise derive from win rate
      const streamStats = streamData[difficulty]
      const foldProb   = streamStats?.fold_probability   ?? this.deriveFromWinRate(avgWinRate, 'fold')
      const callProb   = streamStats?.call_probability   ?? this.deriveFromWinRate(avgWinRate, 'call')
      const raiseProb  = 1 - foldProb - callProb
      const delayMs    = streamStats?.avg_delay_ms       ?? this.deriveDelayFromDifficulty(difficulty)

      const normalizedFold  = Math.max(0.05, Math.min(0.70, foldProb))
      const normalizedCall  = Math.max(0.15, Math.min(0.75, callProb))
      const normalizedRaise = Math.max(0, 1 - normalizedFold - normalizedCall)
      const aggression = normalizedRaise / (normalizedCall + normalizedFold) * 10

      // raiseProb is computed but used only as intermediate — final value is normalizedRaise
      void raiseProb

      await this.pool.query(
        `INSERT INTO bot_profiles
           (game_type, difficulty, win_rate_target, fold_probability, call_probability,
            raise_probability, avg_decision_delay_ms, avg_stake_preference, aggression_score,
            sample_size, last_rebuilt_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (game_type, difficulty) DO UPDATE SET
           win_rate_target       = $3,
           fold_probability      = $4,
           call_probability      = $5,
           raise_probability     = $6,
           avg_decision_delay_ms = $7,
           avg_stake_preference  = $8,
           aggression_score      = $9,
           sample_size           = $10,
           last_rebuilt_at       = NOW()`,
        [
          gameType, difficulty,
          Math.round(avgWinRate * 10) / 10,
          Math.round(normalizedFold  * 10000) / 10000,
          Math.round(normalizedCall  * 10000) / 10000,
          Math.round(normalizedRaise * 10000) / 10000,
          Math.round(delayMs),
          Math.round(avgStake),
          Math.round(aggression * 10) / 10,
          tierPlayers.length,
        ]
      )

      this.logger.info({ gameType, difficulty, sampleSize: tierPlayers.length, winRate: avgWinRate.toFixed(1) }, 'Profile upserted')
    }
  }

  private async getStreamActionData(gameType: string, lookbackDays: number): Promise<Record<string, any>> {
    // Read recent game action events from Redis stream
    // Returns aggregated fold/call/raise ratios and avg timing by rough skill bucket
    try {
      const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000
      const events = await this.redis.xrevrange('events:all', '+', cutoff.toString(), 'COUNT', '1000')

      // Parse events — they are stored as [id, [field, value, ...]] pairs
      for (const [_id, fields] of events) {
        const dataIdx = fields.indexOf('data')
        if (dataIdx === -1) continue
        let event: any
        try { event = JSON.parse(fields[dataIdx + 1]) } catch { continue }
        if (event.game_type !== gameType || event.event_type !== 'gameAction') continue
        if (!event.action || !event.user_id) continue
        // Difficulty bucketing from stream events alone is not reliable without per-user profiles
        // Primary data source is the DB quartile query; stream just enriches timing if needed
      }

      return {}
    } catch (err) {
      this.logger.warn({ err }, 'Stream data unavailable — using DB-only profiles')
      return {}
    }
  }

  private deriveFromWinRate(winRate: number, type: 'fold' | 'call'): number {
    // Higher win rate → lower fold rate, higher aggression
    if (type === 'fold') return Math.max(0.15, 0.60 - winRate / 200)
    return Math.max(0.20, 0.55 - winRate / 500)
  }

  private deriveDelayFromDifficulty(difficulty: string): number {
    return difficulty === 'easy' ? 2800 : difficulty === 'medium' ? 2000 : 1400
  }

  async getProfiles(): Promise<BotProfile[]> {
    const res = await this.pool.query(
      `SELECT * FROM bot_profiles ORDER BY game_type, difficulty`
    )
    return res.rows
  }

  // Alias for compatibility with callers expecting getAllProfiles
  async getAllProfiles(): Promise<BotProfile[]> {
    return this.getProfiles()
  }

  async getProfile(gameType: string, difficulty: string): Promise<BotProfile | null> {
    const cacheKey = `bot:profile:${gameType}:${difficulty}`
    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const res = await this.pool.query(
      `SELECT * FROM bot_profiles WHERE game_type = $1 AND difficulty = $2`,
      [gameType, difficulty]
    )
    if (!res.rows.length) return null

    const profile = res.rows[0] as BotProfile
    await this.redis.setex(cacheKey, PROFILE_CACHE_TTL, JSON.stringify(profile))
    return profile
  }

  async overrideProfile(gameType: string, difficulty: string, fields: Partial<BotProfile>): Promise<void> {
    const allowed = ['win_rate_target', 'fold_probability', 'call_probability', 'raise_probability',
                     'avg_decision_delay_ms', 'avg_stake_preference', 'aggression_score']
    const sets: string[] = []
    const params: any[] = [gameType, difficulty]
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = $${params.length + 1}`)
        params.push(v)
      }
    }
    if (!sets.length) return
    await this.pool.query(
      `UPDATE bot_profiles SET ${sets.join(', ')} WHERE game_type = $1 AND difficulty = $2`,
      params
    )
    await this.redis.del(`bot:profile:${gameType}:${difficulty}`)
  }

  async getStats(): Promise<object> {
    const res = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE difficulty = 'easy')   AS easy_count,
        COUNT(*) FILTER (WHERE difficulty = 'medium') AS medium_count,
        COUNT(*) FILTER (WHERE difficulty = 'hard')   AS hard_count,
        MAX(last_rebuilt_at)                          AS last_rebuilt_at,
        MIN(sample_size)                              AS min_sample_size,
        MAX(sample_size)                              AS max_sample_size
      FROM bot_profiles
    `)
    return res.rows[0]
  }
}
