import { describe, it, expect } from 'vitest'
import { conversionRate, mergeReferralRows } from '../src/referral-metrics'

describe('conversionRate', () => {
  it('is 0 when clicks is 0 (no divide-by-zero)', () => {
    expect(conversionRate(0, 0)).toBe(0)
    expect(conversionRate(5, 0)).toBe(0)
  })

  it('computes signups / clicks otherwise', () => {
    expect(conversionRate(25, 100)).toBe(0.25)
    expect(conversionRate(1, 4)).toBe(0.25)
  })
})

describe('mergeReferralRows', () => {
  it('merges matching dates from both lists', () => {
    const clicks = [{ date: '2026-07-20', clicks: 10 }]
    const signups = [{ date: '2026-07-20', signups: 2 }]
    expect(mergeReferralRows(clicks, signups)).toEqual([
      { date: '2026-07-20', clicks: 10, signups: 2, conversion_rate: 0.2 },
    ])
  })

  it('fills 0 for a date with clicks but no signups', () => {
    const clicks = [{ date: '2026-07-20', clicks: 10 }]
    const signups: { date: string; signups: number }[] = []
    expect(mergeReferralRows(clicks, signups)).toEqual([
      { date: '2026-07-20', clicks: 10, signups: 0, conversion_rate: 0 },
    ])
  })

  it('fills 0 for a date with signups but no clicks (e.g. code shared verbally, no link click)', () => {
    const clicks: { date: string; clicks: number }[] = []
    const signups = [{ date: '2026-07-20', signups: 3 }]
    expect(mergeReferralRows(clicks, signups)).toEqual([
      { date: '2026-07-20', clicks: 0, signups: 3, conversion_rate: 0 },
    ])
  })

  it('sorts merged rows ascending by date', () => {
    const clicks = [
      { date: '2026-07-22', clicks: 5 },
      { date: '2026-07-20', clicks: 10 },
    ]
    const signups = [{ date: '2026-07-21', signups: 1 }]
    const result = mergeReferralRows(clicks, signups)
    expect(result.map((r) => r.date)).toEqual(['2026-07-20', '2026-07-21', '2026-07-22'])
  })
})
