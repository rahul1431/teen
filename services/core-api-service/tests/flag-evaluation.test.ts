import { describe, it, expect } from 'vitest'
import { evaluateFlag, FeatureFlag } from '../src/flag-evaluation'

const baseFlag = (overrides: Partial<FeatureFlag> = {}): FeatureFlag => ({
  key: 'test_flag',
  enabled: true,
  rolloutPercent: 0,
  enabledUserIds: [],
  variants: null,
  ...overrides,
})

describe('evaluateFlag', () => {
  it('is off when the flag is master-disabled, regardless of rollout percent', () => {
    const flag = baseFlag({ enabled: false, rolloutPercent: 100 })
    expect(evaluateFlag(flag, 'user-1')).toEqual({ enabled: false })
  })

  it('is off for everyone at 0% rollout with no allowlist', () => {
    const flag = baseFlag({ rolloutPercent: 0 })
    for (const userId of ['user-1', 'user-2', 'user-3']) {
      expect(evaluateFlag(flag, userId)).toEqual({ enabled: false })
    }
  })

  it('is on for everyone at 100% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 100 })
    for (const userId of ['user-1', 'user-2', 'user-3']) {
      expect(evaluateFlag(flag, userId).enabled).toBe(true)
    }
  })

  it('is on for an allowlisted user even at 0% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 0, enabledUserIds: ['user-1'] })
    expect(evaluateFlag(flag, 'user-1')).toEqual({ enabled: true })
  })

  it('is off for a non-allowlisted user at 0% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 0, enabledUserIds: ['user-1'] })
    expect(evaluateFlag(flag, 'user-2')).toEqual({ enabled: false })
  })

  it('is deterministic — the same user gets the same result across repeated calls', () => {
    const flag = baseFlag({ rolloutPercent: 50 })
    const first = evaluateFlag(flag, 'user-42')
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag, 'user-42')).toEqual(first)
    }
  })

  it('produces a roughly even split across many users at 50% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 50 })
    let onCount = 0
    const total = 2000
    for (let i = 0; i < total; i++) {
      if (evaluateFlag(flag, `user-${i}`).enabled) onCount++
    }
    // Not exactly 50% — hash-based bucketing has natural variance — but should
    // land in a sane range, proving the percentage actually gates rather than
    // being all-on or all-off.
    expect(onCount).toBeGreaterThan(total * 0.35)
    expect(onCount).toBeLessThan(total * 0.65)
  })

  it('assigns a variant when the flag is on and variants are configured', () => {
    const flag = baseFlag({
      rolloutPercent: 100,
      variants: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }],
    })
    const result = evaluateFlag(flag, 'user-1')
    expect(result.enabled).toBe(true)
    expect(['a', 'b']).toContain(result.variant)
  })

  it('never assigns a variant when the flag is off', () => {
    const flag = baseFlag({
      rolloutPercent: 0,
      variants: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }],
    })
    const result = evaluateFlag(flag, 'user-1')
    expect(result.enabled).toBe(false)
    expect(result.variant).toBeUndefined()
  })

  it('is deterministic for variant assignment across repeated calls', () => {
    const flag = baseFlag({
      rolloutPercent: 100,
      variants: [{ key: 'a', weight: 30 }, { key: 'b', weight: 70 }],
    })
    const first = evaluateFlag(flag, 'user-99').variant
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag, 'user-99').variant).toBe(first)
    }
  })

  it('produces a roughly weighted split across variants at configured weights', () => {
    const flag = baseFlag({
      rolloutPercent: 100,
      variants: [{ key: 'a', weight: 20 }, { key: 'b', weight: 80 }],
    })
    let bCount = 0
    const total = 2000
    for (let i = 0; i < total; i++) {
      if (evaluateFlag(flag, `user-${i}`).variant === 'b') bCount++
    }
    // Expect roughly 80% — allow a wide band for hash variance.
    expect(bCount).toBeGreaterThan(total * 0.65)
    expect(bCount).toBeLessThan(total * 0.95)
  })
})
