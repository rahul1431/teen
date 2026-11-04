import { Redis } from 'ioredis'
import { Pool } from 'pg'
import { PlayerMemoryManager, PlayerEpisodicMemory } from '../bot-memory/player-memory'

export type RetentionMode = 'soft_pacing' | 'normal' | 'shark_mode'

export interface RetentionEvaluation {
  userId: string
  mode: RetentionMode
  consecutiveLosses: number
  tiltScore: number
  isNearMissActive: boolean
  reason: string
}

/**
 * Dynamic Difficulty Adjustment & Churn Retention AI (DDAS)
 * 
 * Balances table economics and player psychology. A bot that wins 100% of the time
 * causes rage-quits and uninstalls. DDAS monitors player psychological fatigue,
 * loss streaks, and tilt to orchestrate dramatic near-misses and comeback pacing.
 */
export class RetentionManager {
  /**
   * Evaluates the human player's psychological state and determines the appropriate retention mode.
   */
  static async evaluateRetention(
    redis: Redis,
    db: Pool,
    userId?: string
  ): Promise<RetentionEvaluation> {
    if (!userId) {
      return {
        userId: 'anonymous',
        mode: 'normal',
        consecutiveLosses: 0,
        tiltScore: 1.0,
        isNearMissActive: false,
        reason: 'Anonymous player - baseline mode',
      }
    }

    try {
      const memory = await PlayerMemoryManager.getPlayerMemory(redis, db, userId)
      return this.evaluateMemory(memory)
    } catch {
      return {
        userId,
        mode: 'normal',
        consecutiveLosses: 0,
        tiltScore: 1.0,
        isNearMissActive: false,
        reason: 'Error fetching memory - fallback baseline',
      }
    }
  }

  /**
   * Synchronous evaluation from an existing PlayerEpisodicMemory object.
   */
  static evaluateMemory(memory: PlayerEpisodicMemory): RetentionEvaluation {
    const losses = memory.consecutiveLosses || 0
    const tilt = memory.tiltScore || 1.0

    // 1. Soft Pacing Mode (Churn / Rage-Quit Interception)
    // Triggered when human has lost 3+ consecutive games or is highly tilted (tilt >= 1.8)
    if (losses >= 3 || tilt >= 1.8) {
      return {
        userId: memory.userId,
        mode: 'soft_pacing',
        consecutiveLosses: losses,
        tiltScore: tilt,
        isNearMissActive: true,
        reason: `Player on ${losses}-loss streak (tilt: ${tilt.toFixed(2)}) - activating soft pacing & dramatic near-miss comeback`,
      }
    }

    // 2. Shark Mode (Skill Challenge)
    // Triggered when human is on a winning run and playing comfortably
    if (losses === 0 && memory.gamesAnalyzed >= 3 && memory.vpipRate >= 60 && tilt <= 1.2) {
      return {
        userId: memory.userId,
        mode: 'shark_mode',
        consecutiveLosses: 0,
        tiltScore: tilt,
        isNearMissActive: false,
        reason: 'Winning player with confident VPIP - activating skill challenge shark mode',
      }
    }

    // 3. Normal Mode
    return {
      userId: memory.userId,
      mode: 'normal',
      consecutiveLosses: losses,
      tiltScore: tilt,
      isNearMissActive: false,
      reason: 'Normal balanced gameplay',
    }
  }

  /**
   * Adapts Teen Patti bot betting probabilities for retention.
   * In soft pacing mode, bots reduce aggressive raises so struggling players aren't priced out.
   */
  static adaptTeenPattiForRetention(
    profile: { fold_probability: number; call_probability: number; raise_probability: number },
    retention: RetentionEvaluation
  ): { fold_probability: number; call_probability: number; raise_probability: number } {
    let { fold_probability, call_probability, raise_probability } = profile

    if (retention.mode === 'soft_pacing') {
      // De-escalate aggression: lower raise rate, allow human to see cheap showdowns
      const relief = 0.12
      raise_probability = Math.max(0.08, raise_probability - relief)
      call_probability = Math.min(0.70, call_probability + relief * 0.6)
      fold_probability = Math.min(0.35, fold_probability + relief * 0.4)
    } else if (retention.mode === 'shark_mode') {
      // Test player skill with sharper value raises
      const test = 0.08
      raise_probability = Math.min(0.65, raise_probability + test)
      call_probability = Math.max(0.20, call_probability - test)
    }

    const total = fold_probability + call_probability + raise_probability
    return {
      fold_probability: parseFloat((fold_probability / total).toFixed(3)),
      call_probability: parseFloat((call_probability / total).toFixed(3)),
      raise_probability: parseFloat((raise_probability / total).toFixed(3)),
    }
  }

  /**
   * Adapts Rummy bot draw and drop probabilities for retention.
   * In soft pacing mode, bots do not ruthlessly starve the human or instantly drop on good tables.
   */
  static adaptRummyForRetention<T extends { drop_probability: number; open_draw_probability: number }>(
    profile: T,
    retention: RetentionEvaluation
  ): T {
    let { drop_probability, open_draw_probability } = profile

    if (retention.mode === 'soft_pacing') {
      // Relax open-pile starvation: give human access to discarded runs
      open_draw_probability = Math.max(0.15, open_draw_probability - 0.15)
      // Slightly more willing to play the hand instead of instant drop
      drop_probability = Math.max(0.05, drop_probability - 0.10)
    } else if (retention.mode === 'shark_mode') {
      // Aggressive card denial
      open_draw_probability = Math.min(0.85, open_draw_probability + 0.10)
    }

    return {
      ...profile,
      drop_probability: parseFloat(drop_probability.toFixed(3)),
      open_draw_probability: parseFloat(open_draw_probability.toFixed(3)),
    }
  }
}
