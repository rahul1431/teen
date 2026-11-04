import { describe, it, expect, vi } from 'vitest'
import { RetentionManager } from '../bot-retention/retention-manager'
import { DEFAULT_PLAYER_MEMORY } from '../bot-memory/player-memory'

describe('Dynamic Difficulty Adjustment & Retention AI (DDAS)', () => {
  it('should activate soft_pacing when player has 3+ consecutive losses', () => {
    const memory = {
      ...DEFAULT_PLAYER_MEMORY,
      userId: 'struggling-user',
      consecutiveLosses: 3,
      tiltScore: 1.2,
      lastActionAt: new Date(),
    }

    const evaluation = RetentionManager.evaluateMemory(memory)
    expect(evaluation.mode).toBe('soft_pacing')
    expect(evaluation.isNearMissActive).toBe(true)
    expect(evaluation.reason).toContain('loss streak')
  })

  it('should activate soft_pacing when player is severely tilted', () => {
    const memory = {
      ...DEFAULT_PLAYER_MEMORY,
      userId: 'tilted-user',
      consecutiveLosses: 1,
      tiltScore: 2.2, // Tilted!
      lastActionAt: new Date(),
    }

    const evaluation = RetentionManager.evaluateMemory(memory)
    expect(evaluation.mode).toBe('soft_pacing')
    expect(evaluation.isNearMissActive).toBe(true)
  })

  it('should activate shark_mode when player is on a winning run with high confidence', () => {
    const memory = {
      ...DEFAULT_PLAYER_MEMORY,
      userId: 'pro-user',
      gamesAnalyzed: 5,
      consecutiveLosses: 0,
      vpipRate: 70.0,
      tiltScore: 1.0,
      lastActionAt: new Date(),
    }

    const evaluation = RetentionManager.evaluateMemory(memory)
    expect(evaluation.mode).toBe('shark_mode')
    expect(evaluation.isNearMissActive).toBe(false)
  })

  it('should de-escalate Teen Patti aggression in soft_pacing mode', () => {
    const base = {
      fold_probability: 0.30,
      call_probability: 0.45,
      raise_probability: 0.25,
    }
    const retention = {
      userId: 'struggling-user',
      mode: 'soft_pacing' as const,
      consecutiveLosses: 4,
      tiltScore: 1.5,
      isNearMissActive: true,
      reason: 'test',
    }

    const adapted = RetentionManager.adaptTeenPattiForRetention(base, retention)
    // Less raises, more calls/folds to give player breathing room
    expect(adapted.raise_probability).toBeLessThan(base.raise_probability)
    expect(adapted.call_probability).toBeGreaterThan(base.call_probability)
  })

  it('should relax Rummy open draw starvation in soft_pacing mode', () => {
    const base = {
      difficulty: 'hard' as const,
      win_rate_target: 0.5,
      drop_probability: 0.20,
      open_draw_probability: 0.70,
      declare_speed_factor: 1.0,
      avg_decision_delay_ms: 3000,
      aggression_score: null,
    }
    const retention = {
      userId: 'struggling-user',
      mode: 'soft_pacing' as const,
      consecutiveLosses: 3,
      tiltScore: 1.4,
      isNearMissActive: true,
      reason: 'test',
    }

    const adapted = RetentionManager.adaptRummyForRetention(base, retention)
    expect(adapted.open_draw_probability).toBeLessThan(base.open_draw_probability)
    expect(adapted.drop_probability).toBeLessThan(base.drop_probability)
    expect(adapted.difficulty).toBe('hard') // Preserves full typing
  })
})

