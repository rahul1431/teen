import { Redis } from 'ioredis'
import { Pool } from 'pg'

/**
 * Player Episodic Cognitive Memory Interface
 * 
 * Represents the persistent behavioral fingerprint of a human player,
 * tracked across multiple sessions and games in PostgreSQL and cached in Redis.
 * Bots use this memory to remember player leaks, playstyles, and psychological states.
 */
export interface PlayerEpisodicMemory {
  userId: string
  gamesAnalyzed: number
  vpipRate: number              // % of hands voluntarily entered (0-100)
  foldToRaiseRatio: number      // % folds against aggressive raises (0-100)
  bluffCallTendency: number     // % of calls made at showdown (calling station metric)
  tiltScore: number             // 1.0 = baseline calm, 2.0+ = tilted / reckless
  consecutiveLosses: number     // loss streak
  biggestLossRecent: number     // highest recent pot loss in INR
  rummyDiscardPreference: Record<string, number> // frequency of discarded card ranks/suits
  teenPattiBlindRatio: number   // % hands played blind
  ludoAggressionFactor: number  // 1.0 = normal, 1.5+ = hunter/aggressive capture
  lastGameType?: string
  lastActionAt: Date | string
}

export interface PlayerActionEvent {
  userId: string
  gameType: 'teen_patti' | 'rummy' | 'ludo'
  action: string
  isBlind?: boolean
  isRaise?: boolean
  isFold?: boolean
  isCall?: boolean
  cardDiscarded?: { rank: string; suit: string }
  ludoMoveType?: 'capture' | 'safe_star' | 'advance'
}

export interface PlayerGameOutcome {
  userId: string
  gameType: 'teen_patti' | 'rummy' | 'ludo'
  isWin: boolean
  amountWonOrLost: number
  stake: number
}

export interface BotDecisionLogEntry {
  gameType: string
  roomId: string
  botUserId: string
  targetUserId?: string
  decisionType: string
  stateSnapshot: Record<string, any>
  actionChosen: string
  evEstimate?: number
  wasSuccessful?: boolean
}

export const DEFAULT_PLAYER_MEMORY: Omit<PlayerEpisodicMemory, 'userId' | 'lastActionAt'> = {
  gamesAnalyzed: 0,
  vpipRate: 50.0,
  foldToRaiseRatio: 50.0,
  bluffCallTendency: 50.0,
  tiltScore: 1.0,
  consecutiveLosses: 0,
  biggestLossRecent: 0.0,
  rummyDiscardPreference: {},
  teenPattiBlindRatio: 30.0,
  ludoAggressionFactor: 1.0,
}

const REDIS_KEY_PREFIX = 'bot:memory:player:'
const MEMORY_TTL_SECONDS = 86400 // 24 hours in Redis cache

export class PlayerMemoryManager {
  /**
   * Fetch episodic memory for a player. Checks Redis cache first, then PostgreSQL.
   * If player is new/untracked, returns baseline default memory.
   */
  static async getPlayerMemory(
    redis: Redis,
    db: Pool,
    userId: string
  ): Promise<PlayerEpisodicMemory> {
    if (!userId) {
      return { ...DEFAULT_PLAYER_MEMORY, userId: 'anonymous', lastActionAt: new Date() }
    }

    const cacheKey = `${REDIS_KEY_PREFIX}${userId}`

    // 1. Check Redis cache
    try {
      if (redis) {
        const cached = await redis.get(cacheKey)
        if (cached) {
          return JSON.parse(cached) as PlayerEpisodicMemory
        }
      }
    } catch {
      // Non-blocking fallback to DB
    }

    // 2. Query PostgreSQL bot_player_memories
    try {
      if (db) {
        const res = await db.query(
          `SELECT 
             user_id, games_analyzed, vpip_rate, fold_to_raise_ratio,
             bluff_call_tendency, tilt_score, consecutive_losses,
             biggest_loss_recent, rummy_discard_preference, teen_patti_blind_ratio,
             ludo_aggression_factor, last_game_type, last_action_at
           FROM bot_player_memories
           WHERE user_id = $1`,
          [userId]
        )

        if (res.rows && res.rows.length > 0) {
          const row = res.rows[0]
          const memory: PlayerEpisodicMemory = {
            userId: row.user_id,
            gamesAnalyzed: parseInt(row.games_analyzed, 10) || 0,
            vpipRate: parseFloat(row.vpip_rate) || 50.0,
            foldToRaiseRatio: parseFloat(row.fold_to_raise_ratio) || 50.0,
            bluffCallTendency: parseFloat(row.bluff_call_tendency) || 50.0,
            tiltScore: parseFloat(row.tilt_score) || 1.0,
            consecutiveLosses: parseInt(row.consecutive_losses, 10) || 0,
            biggestLossRecent: parseFloat(row.biggest_loss_recent) || 0.0,
            rummyDiscardPreference: row.rummy_discard_preference || {},
            teenPattiBlindRatio: parseFloat(row.teen_patti_blind_ratio) || 30.0,
            ludoAggressionFactor: parseFloat(row.ludo_aggression_factor) || 1.0,
            lastGameType: row.last_game_type || undefined,
            lastActionAt: row.last_action_at || new Date(),
          }

          // Cache in Redis
          if (redis) {
            void redis.setex(cacheKey, MEMORY_TTL_SECONDS, JSON.stringify(memory)).catch(() => {})
          }
          return memory
        }
      }
    } catch (e) {
      // If table does not exist or DB error, fall back to default
      console.warn(`[PlayerMemoryManager] Failed to read memory for user ${userId}:`, (e as Error).message)
    }

    // 3. Fallback to default memory for new player
    const defaultMemory: PlayerEpisodicMemory = {
      ...DEFAULT_PLAYER_MEMORY,
      userId,
      lastActionAt: new Date(),
    }

    if (redis) {
      void redis.setex(cacheKey, MEMORY_TTL_SECONDS, JSON.stringify(defaultMemory)).catch(() => {})
    }

    return defaultMemory
  }

  /**
   * Update memory based on an action taken by a real player during a live game.
   */
  static async recordPlayerAction(
    redis: Redis,
    db: Pool,
    event: PlayerActionEvent
  ): Promise<void> {
    if (!event.userId) return

    try {
      const current = await this.getPlayerMemory(redis, db, event.userId)
      const games = current.gamesAnalyzed || 1
      const alpha = Math.min(0.2, 1.0 / (games + 1)) // Exponential moving average weight

      // Update VPIP (Voluntarily Put $ in Pot)
      if (event.isCall || event.isRaise) {
        current.vpipRate = Math.min(100, Math.max(0, current.vpipRate * (1 - alpha) + 100 * alpha))
      } else if (event.isFold) {
        current.vpipRate = Math.min(100, Math.max(0, current.vpipRate * (1 - alpha) + 0 * alpha))
      }

      // Update Fold to Raise Ratio
      if (event.isRaise) {
        // Player raised back against aggression
        current.foldToRaiseRatio = Math.min(100, Math.max(0, current.foldToRaiseRatio * (1 - alpha) + 0 * alpha))
      } else if (event.isFold) {
        current.foldToRaiseRatio = Math.min(100, Math.max(0, current.foldToRaiseRatio * (1 - alpha) + 100 * alpha))
      }

      // Teen Patti Blind ratio
      if (event.gameType === 'teen_patti' && typeof event.isBlind === 'boolean') {
        const blindVal = event.isBlind ? 100 : 0
        current.teenPattiBlindRatio = Math.min(100, Math.max(0, current.teenPattiBlindRatio * (1 - alpha) + blindVal * alpha))
      }

      // Rummy Discard Preference
      if (event.gameType === 'rummy' && event.cardDiscarded) {
        const suit = event.cardDiscarded.suit
        current.rummyDiscardPreference = current.rummyDiscardPreference || {}
        current.rummyDiscardPreference[suit] = (current.rummyDiscardPreference[suit] || 0) + 1
      }

      // Ludo Aggression
      if (event.gameType === 'ludo' && event.ludoMoveType) {
        if (event.ludoMoveType === 'capture') {
          current.ludoAggressionFactor = Math.min(3.0, current.ludoAggressionFactor + 0.1)
        } else if (event.ludoMoveType === 'safe_star') {
          current.ludoAggressionFactor = Math.max(0.5, current.ludoAggressionFactor - 0.05)
        }
      }

      current.lastGameType = event.gameType
      current.lastActionAt = new Date()

      // Save to Redis cache immediately
      const cacheKey = `${REDIS_KEY_PREFIX}${event.userId}`
      if (redis) {
        await redis.setex(cacheKey, MEMORY_TTL_SECONDS, JSON.stringify(current))
      }

      // Asynchronously upsert to PostgreSQL
      if (db) {
        void db.query(
          `INSERT INTO bot_player_memories (
             user_id, games_analyzed, vpip_rate, fold_to_raise_ratio,
             bluff_call_tendency, tilt_score, consecutive_losses,
             biggest_loss_recent, rummy_discard_preference, teen_patti_blind_ratio,
             ludo_aggression_factor, last_game_type, last_action_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             games_analyzed = EXCLUDED.games_analyzed,
             vpip_rate = EXCLUDED.vpip_rate,
             fold_to_raise_ratio = EXCLUDED.fold_to_raise_ratio,
             rummy_discard_preference = EXCLUDED.rummy_discard_preference,
             teen_patti_blind_ratio = EXCLUDED.teen_patti_blind_ratio,
             ludo_aggression_factor = EXCLUDED.ludo_aggression_factor,
             last_game_type = EXCLUDED.last_game_type,
             last_action_at = NOW(),
             updated_at = NOW()`,
          [
            current.userId,
            current.gamesAnalyzed,
            current.vpipRate.toFixed(2),
            current.foldToRaiseRatio.toFixed(2),
            current.bluffCallTendency.toFixed(2),
            current.tiltScore.toFixed(2),
            current.consecutiveLosses,
            current.biggestLossRecent.toFixed(2),
            JSON.stringify(current.rummyDiscardPreference),
            current.teenPattiBlindRatio.toFixed(2),
            current.ludoAggressionFactor.toFixed(2),
            current.lastGameType,
          ]
        ).catch(() => {})
      }
    } catch {
      // Non-blocking
    }
  }

  /**
   * Record game outcome for psychological modeling and tilt detection.
   * If a player suffers consecutive losses or loses a large pot (> 30% of stake),
   * their tilt score increases, allowing bots to trap them.
   */
  static async recordPlayerOutcome(
    redis: Redis,
    db: Pool,
    outcome: PlayerGameOutcome
  ): Promise<void> {
    if (!outcome.userId) return

    try {
      const current = await this.getPlayerMemory(redis, db, outcome.userId)
      current.gamesAnalyzed = (current.gamesAnalyzed || 0) + 1

      if (outcome.isWin) {
        // Winning cools down tilt and resets loss streak
        current.consecutiveLosses = 0
        current.tiltScore = Math.max(1.0, current.tiltScore * 0.7)
      } else {
        // Loss increases tilt score
        current.consecutiveLosses = (current.consecutiveLosses || 0) + 1
        const lossAmount = Math.abs(outcome.amountWonOrLost)
        if (lossAmount > current.biggestLossRecent) {
          current.biggestLossRecent = lossAmount
        }

        // Tilt calculation
        let tiltIncrement = 0.15
        if (current.consecutiveLosses >= 3) {
          tiltIncrement += 0.35 // Frustration bonus
        }
        if (outcome.stake > 0 && lossAmount >= outcome.stake * 0.8) {
          tiltIncrement += 0.50 // Big pot loss shock
        }

        current.tiltScore = Math.min(3.0, current.tiltScore + tiltIncrement)
      }

      current.lastGameType = outcome.gameType
      current.lastActionAt = new Date()

      // Refresh Redis
      const cacheKey = `${REDIS_KEY_PREFIX}${outcome.userId}`
      if (redis) {
        await redis.setex(cacheKey, MEMORY_TTL_SECONDS, JSON.stringify(current))
      }

      // Upsert to DB
      if (db) {
        await db.query(
          `INSERT INTO bot_player_memories (
             user_id, games_analyzed, vpip_rate, fold_to_raise_ratio,
             bluff_call_tendency, tilt_score, consecutive_losses,
             biggest_loss_recent, rummy_discard_preference, teen_patti_blind_ratio,
             ludo_aggression_factor, last_game_type, last_action_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             games_analyzed = EXCLUDED.games_analyzed,
             tilt_score = EXCLUDED.tilt_score,
             consecutive_losses = EXCLUDED.consecutive_losses,
             biggest_loss_recent = EXCLUDED.biggest_loss_recent,
             last_game_type = EXCLUDED.last_game_type,
             last_action_at = NOW(),
             updated_at = NOW()`,
          [
            current.userId,
            current.gamesAnalyzed,
            current.vpipRate.toFixed(2),
            current.foldToRaiseRatio.toFixed(2),
            current.bluffCallTendency.toFixed(2),
            current.tiltScore.toFixed(2),
            current.consecutiveLosses,
            current.biggestLossRecent.toFixed(2),
            JSON.stringify(current.rummyDiscardPreference),
            current.teenPattiBlindRatio.toFixed(2),
            current.ludoAggressionFactor.toFixed(2),
            current.lastGameType,
          ]
        )
      }
    } catch {
      // Non-blocking
    }
  }

  /**
   * Asynchronously log bot decisions for offline ML training, self-learning evaluation,
   * and win-rate analysis against real humans.
   */
  static logBotDecision(db: Pool, log: BotDecisionLogEntry): void {
    if (!db) return
    void db.query(
      `INSERT INTO bot_decision_logs (
         game_type, room_id, bot_user_id, target_user_id,
         decision_type, state_snapshot, action_chosen, ev_estimate, was_successful, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        log.gameType,
        log.roomId,
        log.botUserId,
        log.targetUserId || null,
        log.decisionType,
        JSON.stringify(log.stateSnapshot || {}),
        log.actionChosen,
        log.evEstimate || null,
        typeof log.wasSuccessful === 'boolean' ? log.wasSuccessful : null,
      ]
    ).catch(() => {})
  }

  /**
   * Dynamically adapts Teen Patti bot probabilities based on the target human's episodic memory.
   * Exploits human leaks:
   *  - Against 'nits' (high fold-to-raise): increase raise / bluff rate.
   *  - Against 'calling stations' (low fold-to-raise): zero bluffs, heavy value betting.
   *  - Against 'tilted players' (high tilt score): trap them with calls on medium hands.
   */
  static adaptTeenPattiProfile(
    baseProfile: { fold_probability: number; call_probability: number; raise_probability: number },
    memory: PlayerEpisodicMemory
  ): { fold_probability: number; call_probability: number; raise_probability: number } {
    let { fold_probability, call_probability, raise_probability } = baseProfile

    // 1. Nit exploitation: Human folds easily to raises
    if (memory.foldToRaiseRatio > 65) {
      // Steal pots with higher raise rate
      const boost = 0.15
      raise_probability = Math.min(0.80, raise_probability + boost)
      call_probability = Math.max(0.10, call_probability - boost * 0.5)
      fold_probability = Math.max(0.05, fold_probability - boost * 0.5)
    }

    // 2. Calling station exploitation: Human never folds
    if (memory.foldToRaiseRatio < 35 || memory.bluffCallTendency > 65) {
      // Don't bluff; wait for solid hands and call/value bet
      const shift = 0.12
      raise_probability = Math.max(0.10, raise_probability - shift)
      call_probability = Math.min(0.75, call_probability + shift)
    }

    // 3. Tilted player exploitation: Human is betting recklessly
    if (memory.tiltScore >= 1.8) {
      // Call wider to pick off reckless bluffs
      const tiltShift = 0.10
      call_probability = Math.min(0.75, call_probability + tiltShift)
      fold_probability = Math.max(0.05, fold_probability - tiltShift)
    }

    // Normalize so sum equals 1.0
    const total = fold_probability + call_probability + raise_probability
    return {
      fold_probability: parseFloat((fold_probability / total).toFixed(3)),
      call_probability: parseFloat((call_probability / total).toFixed(3)),
      raise_probability: parseFloat((raise_probability / total).toFixed(3)),
    }
  }
}

