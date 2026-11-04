import type { Redis } from 'ioredis'

export type OpponentTendency = 'tight_folder' | 'calling_station' | 'maniac_aggressor' | 'balanced'

export interface OpponentStats {
  actionsCount: number
  foldCount: number
  callCount: number
  raiseCount: number
  showCount: number
  tendency: OpponentTendency
}

const REDIS_KEY_PREFIX = 'opponent:model:'
const TTL_SECONDS = 7 * 24 * 3600 // 7 days rolling memory

export class OpponentModeler {
  /**
   * Record an action taken by a real player.
   */
  static async recordPlayerAction(
    redis: Redis,
    userId: string,
    action: string
  ): Promise<void> {
    if (!userId || !redis) return
    const key = `${REDIS_KEY_PREFIX}${userId}`
    const norm = (action || '').toLowerCase().trim()

    try {
      const pipeline = redis.pipeline()
      pipeline.hincrby(key, 'actions_count', 1)
      if (norm === 'fold' || norm === 'drop') {
        pipeline.hincrby(key, 'fold_count', 1)
      } else if (norm === 'raise') {
        pipeline.hincrby(key, 'raise_count', 1)
      } else if (norm === 'call' || norm === 'chaal') {
        pipeline.hincrby(key, 'call_count', 1)
      } else if (norm === 'show') {
        pipeline.hincrby(key, 'show_count', 1)
      }
      pipeline.expire(key, TTL_SECONDS)
      await pipeline.exec()
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Determine the opponent tendency based on observed frequencies.
   */
  static async getOpponentTendency(
    redis: Redis,
    userId: string
  ): Promise<OpponentTendency> {
    if (!userId || !redis) return 'balanced'
    try {
      const key = `${REDIS_KEY_PREFIX}${userId}`
      const data = await redis.hgetall(key)
      if (!data || !data.actions_count) return 'balanced'

      const total = parseInt(data.actions_count, 10) || 0
      if (total < 4) return 'balanced'

      const folds = parseInt(data.fold_count, 10) || 0
      const calls = parseInt(data.call_count, 10) || 0
      const raises = parseInt(data.raise_count, 10) || 0

      const foldRate = folds / total
      const raiseRate = raises / total
      const callRate = calls / total

      if (raiseRate >= 0.40) {
        return 'maniac_aggressor'
      }
      if (callRate >= 0.50) {
        return 'calling_station'
      }
      if (foldRate >= 0.35) {
        return 'tight_folder'
      }
      return 'balanced'
    } catch {
      return 'balanced'
    }
  }

  /**
   * Classify tendencies from raw counts synchronously (used for unit testing and fast evaluation).
   */
  static classifyTendency(counts: {
    actionsCount: number
    foldCount: number
    callCount: number
    raiseCount: number
  }): OpponentTendency {
    const total = counts.actionsCount || 0
    if (total < 4) return 'balanced'

    const foldRate = (counts.foldCount || 0) / total
    const raiseRate = (counts.raiseCount || 0) / total
    const callRate = (counts.callCount || 0) / total

    if (raiseRate >= 0.40) {
      return 'maniac_aggressor'
    }
    if (callRate >= 0.50) {
      return 'calling_station'
    }
    if (foldRate >= 0.35) {
      return 'tight_folder'
    }
    return 'balanced'
  }

  /**
   * Get the primary human opponent tendency for a room given the room's players.
   */
  static async getRoomOpponentTendency(
    redis: Redis,
    players: Array<{ user_id?: string; userId?: string; is_bot?: boolean; isBot?: boolean }>
  ): Promise<OpponentTendency> {
    if (!players || !Array.isArray(players)) return 'balanced'
    const human = players.find(p => !(p.is_bot || p.isBot))
    if (!human) return 'balanced'
    const humanId = human.user_id ?? human.userId
    if (!humanId) return 'balanced'
    return OpponentModeler.getOpponentTendency(redis, humanId)
  }
}
