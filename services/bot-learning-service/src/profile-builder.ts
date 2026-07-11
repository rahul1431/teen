import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'
import { AuditLogger } from './audit-logger'

export type { AuditLogger }

// No-op audit logger for when one is not provided
class NoOpAuditLogger {
  async logProfileChange(
    _gameType: string,
    _difficulty: string,
    _changes: Record<string, any>,
    _adminUserId: string | null,
    _reason: string
  ): Promise<void> {
    // No-op
  }

  async getAuditLog(): Promise<any[]> {
    return []
  }

  async getRecentChanges(): Promise<any[]> {
    return []
  }
}

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
  active_profile_version?: number
}

export interface ProfileVersion {
  version: number
  created_at: string
  is_active: boolean
}

const MIN_SAMPLE_SIZE = 50

const GAME_TYPES = ['teen_patti', 'ludo', 'aviator'] as const
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
const PROFILE_CACHE_TTL = 3600 // 1 hour

export class ProfileBuilder {
  private configOverrides: Partial<BotLearningConfig>
  private auditLogger: AuditLogger | NoOpAuditLogger

  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger,
    config?: Partial<BotLearningConfig>,
    auditLogger?: AuditLogger
  ) {
    this.configOverrides = config ?? {}
    this.auditLogger = auditLogger ?? new NoOpAuditLogger()
  }

  async getConfig(): Promise<BotLearningConfig> {
    const res = await this.pool.query('SELECT key, value FROM bot_learning_config')
    const raw: Record<string, string> = {}
    for (const row of res.rows) raw[row.key] = row.value
    return {
      rebuild_hour:          parseInt(raw.rebuild_hour          ?? '2'),
      stream_lookback_days:  parseInt(raw.stream_lookback_days  ?? '7'),
      history_lookback_days: parseInt(raw.history_lookback_days ?? '30'),
      min_sample_size:       parseInt(raw.min_sample_size       ?? String(MIN_SAMPLE_SIZE)),
      easy_percentile_max:   parseInt(raw.easy_percentile_max   ?? '25'),
      medium_percentile_min: parseInt(raw.medium_percentile_min ?? '40'),
      medium_percentile_max: parseInt(raw.medium_percentile_max ?? '60'),
      hard_percentile_min:   parseInt(raw.hard_percentile_min   ?? '75'),
      active_profile_version: parseInt(raw.active_profile_version ?? '0'),
    }
  }

  private async getNextProfileVersion(): Promise<number> {
    const cfg = await this.getConfig()
    return (cfg.active_profile_version ?? 0) + 1
  }

  async updateConfig(updates: Record<string, string>): Promise<void> {
    // C2: Validate numeric keys before persisting — reject non-integer strings
    const numericKeys = [
      'rebuild_hour', 'stream_lookback_days', 'history_lookback_days', 'min_sample_size',
      'easy_percentile_max', 'medium_percentile_min', 'medium_percentile_max', 'hard_percentile_min',
    ]

    // Validate all keys first (before transaction)
    for (const [key, value] of Object.entries(updates)) {
      if (numericKeys.includes(key)) {
        const parsed = parseInt(value, 10)
        if (isNaN(parsed)) throw new Error(`Invalid numeric value for config key '${key}': ${value}`)
      }
    }

    // Return early if no updates to process
    if (Object.keys(updates).length === 0) {
      return
    }

    // Begin transaction
    try {
      await this.pool.query('BEGIN')

      // Execute all updates within transaction
      for (const [key, value] of Object.entries(updates)) {
        await this.pool.query(
          `INSERT INTO bot_learning_config (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, value]
        )
      }

      // Commit transaction
      await this.pool.query('COMMIT')

      // Log the change after successful commit
      await this.auditLogger.logProfileChange('system', 'config', updates, null, 'Config updated via API')
    } catch (error) {
      // Rollback transaction on any error
      try {
        await this.pool.query('ROLLBACK')
      } catch (rollbackError) {
        this.logger.error({ rollbackError }, 'Failed to rollback transaction')
      }
      // Re-throw the original error
      throw error
    }
  }

  async runRebuild(): Promise<void> {
    this.logger.info('Bot profile rebuild started')
    const cfg = await this.getConfig()
    const nextVersion = await this.getNextProfileVersion()

    // Step 1: Create new versioned table
    await this.createProfileVersionTable(nextVersion)

    for (const gameType of GAME_TYPES) {
      try {
        await this.buildProfiles(gameType, cfg, nextVersion)
      } catch (err) {
        this.logger.error({ err, gameType }, 'Rebuild failed for game type')
      }
    }

    // Step 2: Update active version in config
    await this.updateConfig({ active_profile_version: String(nextVersion) })

    // Step 3: Cleanup old versions (keep last 5)
    await this.cleanupOldVersions()

    // Invalidate Redis cache so game-gateway fetches fresh profiles
    for (const gameType of GAME_TYPES) {
      for (const difficulty of DIFFICULTIES) {
        await this.redis.del(`bot:profile:${gameType}:${difficulty}`)
      }
    }

    await this.redis.publish('bot:profiles:rebuilt', JSON.stringify({ timestamp: new Date().toISOString(), version: nextVersion }))
    this.logger.info({ version: nextVersion }, 'Bot profile rebuild complete')
  }

  // Alias for compatibility with callers expecting rebuildAllProfiles
  async rebuildAllProfiles(): Promise<void> {
    return this.runRebuild()
  }

  private async createProfileVersionTable(version: number): Promise<void> {
    const tableName = `bot_profiles_v${version}`
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          game_type             VARCHAR(30) NOT NULL,
          difficulty            VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
          win_rate_target       NUMERIC(5,2),
          fold_probability      NUMERIC(5,4),
          call_probability      NUMERIC(5,4),
          raise_probability     NUMERIC(5,4),
          avg_decision_delay_ms INTEGER,
          avg_stake_preference  NUMERIC(10,2),
          aggression_score      NUMERIC(4,2),
          sample_size           INTEGER DEFAULT 0,
          last_rebuilt_at       TIMESTAMPTZ,
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT uq_${tableName}_game_difficulty UNIQUE (game_type, difficulty)
        )
      `)
      this.logger.info({ version }, 'Created version table')
    } catch (err) {
      this.logger.error({ err, version }, 'Failed to create version table')
      throw err
    }
  }

  private async buildProfiles(gameType: string, cfg: BotLearningConfig, version?: number): Promise<void> {
    // Step 1: Get real player stats from game_results + game_participants (last N days)
    const playersRes = await this.pool.query(
      `SELECT
         gp.user_id,
         COUNT(gp.id)::int            AS games_played,
         SUM(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee))          AS total_profit,
         AVG(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee))          AS avg_profit,
         COUNT(CASE WHEN gp.prize_won > COALESCE(gp.entry_fee_deducted, gr.entry_fee) THEN 1 END)::int AS wins,
         AVG(gr.entry_fee)            AS avg_stake
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

      // Fetch current profile to capture old values for audit log
      const oldProfile = await this.pool.query(
        `SELECT win_rate_target, fold_probability, call_probability, raise_probability,
                avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size
         FROM bot_profiles WHERE game_type = $1 AND difficulty = $2`,
        [gameType, difficulty]
      )

      const currentValues = oldProfile.rows.length > 0 ? oldProfile.rows[0] : null
      const changes: Record<string, any> = {}

      // Track what changed
      const newValues = {
        win_rate_target: Math.round(avgWinRate * 10) / 10,
        fold_probability: Math.round(normalizedFold  * 10000) / 10000,
        call_probability: Math.round(normalizedCall  * 10000) / 10000,
        raise_probability: Math.round(normalizedRaise * 10000) / 10000,
        avg_decision_delay_ms: Math.round(delayMs),
        avg_stake_preference: Math.round(avgStake),
        aggression_score: Math.round(aggression * 10) / 10,
        sample_size: tierPlayers.length,
      }

      // Only log changes if profile existed before
      if (currentValues) {
        for (const [key, newVal] of Object.entries(newValues)) {
          const oldVal = (currentValues as any)[key]
          if (oldVal !== newVal) {
            changes[key] = { old: oldVal, new: newVal }
          }
        }
      }

      const tableName = version ? `bot_profiles_v${version}` : 'bot_profiles'
      await this.pool.query(
        `INSERT INTO ${tableName}
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
          newValues.win_rate_target,
          newValues.fold_probability,
          newValues.call_probability,
          newValues.raise_probability,
          newValues.avg_decision_delay_ms,
          newValues.avg_stake_preference,
          newValues.aggression_score,
          newValues.sample_size,
        ]
      )

      // Log profile change if there were updates
      if (Object.keys(changes).length > 0) {
        await this.auditLogger.logProfileChange(
          gameType,
          difficulty,
          changes,
          null,
          `Automatic rebuild from ${tierPlayers.length} players`
        )
      }

      this.logger.info({ gameType, difficulty, sampleSize: tierPlayers.length, winRate: avgWinRate.toFixed(1) }, 'Profile upserted')
    }
  }

  private async getStreamActionData(_gameType: string, _lookbackDays: number): Promise<Record<string, any>> {
    // Phase 4: enrich profiles from Redis stream events
    return {}
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
    const cfg = await this.getConfig()
    const version = cfg.active_profile_version ?? 0
    const tableName = version > 0 ? `bot_profiles_v${version}` : 'bot_profiles'

    const res = await this.pool.query(
      `SELECT * FROM ${tableName} ORDER BY game_type, difficulty`
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

    const cfg = await this.getConfig()
    const version = cfg.active_profile_version ?? 0
    const tableName = version > 0 ? `bot_profiles_v${version}` : 'bot_profiles'

    const res = await this.pool.query(
      `SELECT * FROM ${tableName} WHERE game_type = $1 AND difficulty = $2`,
      [gameType, difficulty]
    )
    if (!res.rows.length) return null

    const profile = res.rows[0] as BotProfile
    await this.redis.setex(cacheKey, PROFILE_CACHE_TTL, JSON.stringify(profile))
    return profile
  }

  async overrideProfile(gameType: string, difficulty: string, fields: Partial<BotProfile>, adminUserId?: string | null): Promise<void> {
    const allowed = ['win_rate_target', 'fold_probability', 'call_probability', 'raise_probability',
                     'avg_decision_delay_ms', 'avg_stake_preference', 'aggression_score']

    // Fetch current profile to capture old values for audit log
    const currentProfile = await this.getProfile(gameType, difficulty)
    const changes: Record<string, any> = {}

    const sets: string[] = []
    const params: any[] = [gameType, difficulty]
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) {
        // Track the change for audit logging
        const oldValue = (currentProfile as any)?.[k]
        if (oldValue !== v) {
          changes[k] = { old: oldValue, new: v }
        }

        sets.push(`${k} = $${params.length + 1}`)
        params.push(v)
      }
    }
    if (!sets.length) return

    await this.pool.query(
      `UPDATE bot_profiles SET ${sets.join(', ')} WHERE game_type = $1 AND difficulty = $2`,
      params
    )

    // Log the profile change to audit log
    if (Object.keys(changes).length > 0) {
      await this.auditLogger.logProfileChange(
        gameType,
        difficulty,
        changes,
        adminUserId ?? null,
        'Manual profile override'
      )
    }

    await this.redis.del(`bot:profile:${gameType}:${difficulty}`)
  }

  async getStats(): Promise<object> {
    const cfg = await this.getConfig()
    const version = cfg.active_profile_version ?? 0
    const tableName = version > 0 ? `bot_profiles_v${version}` : 'bot_profiles'

    const res = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE difficulty = 'easy')   AS easy_count,
        COUNT(*) FILTER (WHERE difficulty = 'medium') AS medium_count,
        COUNT(*) FILTER (WHERE difficulty = 'hard')   AS hard_count,
        MAX(last_rebuilt_at)                          AS last_rebuilt_at,
        MIN(sample_size)                              AS min_sample_size,
        MAX(sample_size)                              AS max_sample_size
      FROM ${tableName}
    `)
    return res.rows[0]
  }

  async rollbackProfile(targetVersion: string): Promise<void> {
    const cfg = await this.getConfig()
    const currentVersion = cfg.active_profile_version ?? 0
    const targetVer = parseInt(targetVersion, 10)

    if (isNaN(targetVer)) {
      this.logger.error({ targetVersion }, 'Invalid version number')
      throw new Error(`Invalid version number: ${targetVersion}`)
    }

    if (targetVer === currentVersion) {
      this.logger.warn({ targetVer }, 'Target version is same as current version')
      return
    }

    // Verify target version table exists
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = $1
        )
      `, [`bot_profiles_v${targetVer}`])

      if (!result.rows[0].exists && targetVer > 0) {
        this.logger.error({ targetVer }, 'Target version table does not exist')
        throw new Error(`Version ${targetVer} does not exist`)
      }

      // Update active version
      await this.updateConfig({ active_profile_version: String(targetVer) })

      // Invalidate cache
      for (const gameType of GAME_TYPES) {
        for (const difficulty of DIFFICULTIES) {
          await this.redis.del(`bot:profile:${gameType}:${difficulty}`)
        }
      }

      this.logger.info({ from: currentVersion, to: targetVer }, 'Rolled back to version')
    } catch (err) {
      this.logger.error({ err, targetVer }, 'Failed to rollback to version')
      throw err
    }
  }

  async getProfileVersionHistory(): Promise<ProfileVersion[]> {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'profile_versions'
        )
      `)

      if (!result.rows[0].exists) {
        // Return versions based on existing tables
        const tablesResult = await this.pool.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_name LIKE 'bot_profiles_v%'
          ORDER BY table_name
        `)

        const cfg = await this.getConfig()
        const activeVersion = cfg.active_profile_version ?? 0

        return tablesResult.rows.map((row: any) => {
          const match = row.table_name.match(/bot_profiles_v(\d+)/)
          const version = match ? parseInt(match[1], 10) : 0
          return {
            version,
            created_at: new Date().toISOString(),
            is_active: version === activeVersion,
          }
        })
      }

      const result2 = await this.pool.query(`
        SELECT version, created_at, is_active
        FROM profile_versions
        ORDER BY version DESC
      `)

      return result2.rows
    } catch (err) {
      this.logger.error({ err }, 'Failed to get profile version history')
      throw err
    }
  }

  async cleanupOldVersions(): Promise<void> {
    try {
      const cfg = await this.getConfig()
      const activeVersion = cfg.active_profile_version ?? 0

      // Get all version tables
      const tablesResult = await this.pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name LIKE 'bot_profiles_v%'
        ORDER BY table_name
      `)

      const versions = tablesResult.rows
        .map((row: any) => {
          const match = row.table_name.match(/bot_profiles_v(\d+)/)
          return match ? parseInt(match[1], 10) : null
        })
        .filter((v: number | null) => v !== null)
        .sort((a: number, b: number) => b - a) // Sort descending

      // Keep last 5 versions
      const RETENTION_COUNT = 5
      const toDelete = versions.slice(RETENTION_COUNT)

      for (const version of toDelete) {
        if (version === activeVersion) {
          this.logger.warn({ version }, 'Skipping deletion of active version')
          continue
        }

        try {
          await this.pool.query(`DROP TABLE IF EXISTS bot_profiles_v${version}`)
          this.logger.info({ version }, 'Deleted old version table')
        } catch (err) {
          this.logger.error({ err, version }, 'Failed to delete version table')
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to cleanup old versions')
      throw err
    }
  }

  async rebuildProfilesIncremental(gameType: string, difficulty: string): Promise<void> {
    try {
      this.logger.info({ gameType, difficulty }, 'Starting incremental 6-hourly profile rebuild')
      const cfg = await this.getConfig()

      // Query last 6 hours of game participants
      const playersRes = await this.pool.query(
        `SELECT
           gp.user_id,
           COUNT(gp.id)::int            AS games_played,
           SUM(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee))          AS total_profit,
           AVG(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee))          AS avg_profit,
           COUNT(CASE WHEN gp.prize_won > COALESCE(gp.entry_fee_deducted, gr.entry_fee) THEN 1 END)::int AS wins,
           AVG(gr.entry_fee)            AS avg_stake
         FROM game_participants gp
         JOIN game_rooms gr ON gr.id = gp.room_id
         JOIN users u ON u.id = gp.user_id
         WHERE gr.game_type = $1
           AND u.is_bot = false
           AND u.status = 'active'
           AND gp.joined_at > DATE_TRUNC('hour', NOW()) - INTERVAL '6 hours'
         GROUP BY gp.user_id
         HAVING COUNT(gp.id) >= 1
         ORDER BY total_profit ASC`,
        [gameType]
      )

      const players = playersRes.rows
      if (players.length < cfg.min_sample_size) {
        this.logger.warn(
          { gameType, difficulty, found: players.length, need: cfg.min_sample_size },
          'Insufficient 6-hour data — skipping incremental rebuild'
        )
        return
      }

      this.logger.info({ gameType, difficulty, playerCount: players.length }, 'Building incremental profile from 6-hour data')

      // Fetch current profile
      const currentRes = await this.pool.query(
        `SELECT * FROM bot_profiles WHERE game_type = $1 AND difficulty = $2`,
        [gameType, difficulty]
      )

      if (currentRes.rows.length === 0) {
        this.logger.warn({ gameType, difficulty }, 'Profile not found — skipping incremental rebuild')
        return
      }

      const currentProfile = currentRes.rows[0]

      // Calculate metrics from 6-hour window
      const avgStake = players.reduce((s: number, p: any) => s + parseFloat(p.avg_stake ?? '10'), 0) / players.length
      const avgWinRate = players.reduce((s: number, p: any) => s + (p.wins / p.games_played) * 100, 0) / players.length

      // Calculate win_rate_std (standard deviation of win rates)
      const winRates = players.map((p: any) => (p.wins / p.games_played) * 100)
      const meanWinRate = avgWinRate
      const variance = winRates.reduce((sum: number, wr: number) => sum + Math.pow(wr - meanWinRate, 2), 0) / winRates.length
      const winRateStd = Math.sqrt(variance)

      // Calculate percentile_rank for this difficulty
      const difficultyPlayers = players
      const rank = difficultyPlayers.length
      const percentileRank = Math.round((rank / Math.max(rank, 1)) * 100)

      // Derive behavioral parameters from win rate (same logic as buildProfiles)
      const foldProb = this.deriveFromWinRate(avgWinRate, 'fold')
      const callProb = this.deriveFromWinRate(avgWinRate, 'call')
      const raiseProb = 1 - foldProb - callProb
      const delayMs = this.deriveDelayFromDifficulty(difficulty)

      const normalizedFold = Math.max(0.05, Math.min(0.70, foldProb))
      const normalizedCall = Math.max(0.15, Math.min(0.75, callProb))
      const normalizedRaise = Math.max(0, 1 - normalizedFold - normalizedCall)
      const aggression = normalizedRaise / (normalizedCall + normalizedFold) * 10

      // Merge: smooth update towards new values (weighted average: 70% old, 30% new for stability)
      const smoothingFactor = 0.3
      const mergedWinRate = currentProfile.win_rate_target * (1 - smoothingFactor) + Math.round(avgWinRate * 10) / 10 * smoothingFactor
      const mergedFold = currentProfile.fold_probability * (1 - smoothingFactor) + Math.round(normalizedFold * 10000) / 10000 * smoothingFactor
      const mergedCall = currentProfile.call_probability * (1 - smoothingFactor) + Math.round(normalizedCall * 10000) / 10000 * smoothingFactor
      const mergedRaise = currentProfile.raise_probability * (1 - smoothingFactor) + Math.round(normalizedRaise * 10000) / 10000 * smoothingFactor
      const mergedDelay = Math.round(currentProfile.avg_decision_delay_ms * (1 - smoothingFactor) + delayMs * smoothingFactor)
      const mergedStake = Math.round(currentProfile.avg_stake_preference * (1 - smoothingFactor) + avgStake * smoothingFactor)
      const mergedAggression = currentProfile.aggression_score * (1 - smoothingFactor) + Math.round(aggression * 10) / 10 * smoothingFactor

      // Update profile in bot_profiles table
      await this.pool.query(
        `UPDATE bot_profiles
         SET win_rate_target = $1,
             fold_probability = $2,
             call_probability = $3,
             raise_probability = $4,
             avg_decision_delay_ms = $5,
             avg_stake_preference = $6,
             aggression_score = $7,
             sample_size = $8,
             last_rebuilt_at = NOW()
         WHERE game_type = $9 AND difficulty = $10`,
        [
          mergedWinRate,
          mergedFold,
          mergedCall,
          mergedRaise,
          mergedDelay,
          mergedStake,
          mergedAggression,
          players.length,
          gameType,
          difficulty,
        ]
      )

      // Invalidate cache
      await this.redis.del(`bot:profile:${gameType}:${difficulty}`)

      this.logger.info(
        { gameType, difficulty, sampleSize: players.length, winRate: avgWinRate.toFixed(1), winRateStd: winRateStd.toFixed(2), percentileRank },
        'Incremental profile updated'
      )
    } catch (err) {
      this.logger.error({ err, gameType, difficulty }, 'Failed to rebuild profile incrementally')
      throw err
    }
  }
}
