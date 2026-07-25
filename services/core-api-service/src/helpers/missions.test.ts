import { describe, it, expect } from 'vitest'
import { getCurrentPeriod, computeCompletionsAvailable } from './missions'

describe('getCurrentPeriod', () => {
  it('one_time always returns the "lifetime" key', () => {
    const p = getCurrentPeriod('one_time', new Date('2026-07-25T10:00:00Z'))
    expect(p.key).toBe('lifetime')
  })

  it('monthly returns the IST calendar month, even near a UTC month boundary', () => {
    // 2026-07-31T19:00:00Z = 2026-08-01T00:30 IST -> already August in IST
    const p = getCurrentPeriod('monthly', new Date('2026-07-31T19:00:00Z'))
    expect(p.key).toBe('2026-08')
  })

  it('monthly period start/end bracket the whole IST month', () => {
    const p = getCurrentPeriod('monthly', new Date('2026-07-15T10:00:00Z'))
    expect(p.key).toBe('2026-07')
    // July 1 00:00 IST = June 30 18:30 UTC
    expect(p.start.toISOString()).toBe('2026-06-30T18:30:00.000Z')
    // Aug 1 00:00 IST = July 31 18:30 UTC
    expect(p.end.toISOString()).toBe('2026-07-31T18:30:00.000Z')
  })

  it('weekly resets Monday 00:00 IST', () => {
    // Monday 2026-07-20 is the ISO week start; check a Sunday just before IST midnight rollover
    // 2026-07-19T19:00:00Z = 2026-07-20T00:30 IST -> Monday already in IST
    const p = getCurrentPeriod('weekly', new Date('2026-07-19T19:00:00Z'))
    expect(p.key).toBe('2026-W30')
    expect(p.start.toISOString()).toBe('2026-07-19T18:30:00.000Z') // Mon 00:00 IST
    expect(p.end.toISOString()).toBe('2026-07-26T18:30:00.000Z')   // next Mon 00:00 IST
  })

  it('weekly stays in the same week for a Sunday morning IST', () => {
    // 2026-07-25 (Sat) 10:00 UTC = 15:30 IST, still week of 2026-W30 (Mon 07-20 to Sun 07-26)
    const p = getCurrentPeriod('weekly', new Date('2026-07-25T10:00:00Z'))
    expect(p.key).toBe('2026-W30')
  })
})

describe('computeCompletionsAvailable', () => {
  it('caps at 1 for a single-completion mission ("play 1 Teen Patti game")', () => {
    expect(computeCompletionsAvailable(1, 1, 1, 0)).toBe(1)
    expect(computeCompletionsAvailable(5, 1, 1, 0)).toBe(1) // extra games don't multiply the reward
    expect(computeCompletionsAvailable(1, 1, 1, 1)).toBe(0) // already claimed this period
  })

  it('is uncapped for repeatable missions ("invite a friend")', () => {
    expect(computeCompletionsAvailable(3, 1, null, 0)).toBe(3)
    expect(computeCompletionsAvailable(3, 1, null, 2)).toBe(1)
  })

  it('handles a large threshold with a cap ("100 referrals -> reward once")', () => {
    expect(computeCompletionsAvailable(37, 100, 1, 0)).toBe(0)
    expect(computeCompletionsAvailable(150, 100, 1, 0)).toBe(1) // floor(150/100)=1, capped at 1 anyway
  })

  it('never returns a negative number', () => {
    expect(computeCompletionsAvailable(0, 1000, 1, 0)).toBe(0)
    expect(computeCompletionsAvailable(1, 1, 1, 5)).toBe(0) // claimed more than available (shouldn't happen, but must not go negative)
  })
})
