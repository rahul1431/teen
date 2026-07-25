import { describe, it, expect } from 'vitest'
import { buildCampaignsFilter, resolveCampaignsLimit, computeReadRate } from '../src/notification-campaigns-query'

describe('buildCampaignsFilter', () => {
  it('returns no clause when nothing is provided', () => {
    expect(buildCampaignsFilter()).toEqual({ clause: '', params: [] })
  })

  it('filters by type only', () => {
    expect(buildCampaignsFilter('promotion')).toEqual({ clause: 'WHERE type = $1', params: ['promotion'] })
  })

  it('filters by date range only', () => {
    expect(buildCampaignsFilter(undefined, '2026-07-01', '2026-07-31')).toEqual({
      clause: 'WHERE created_at >= $1 AND created_at <= $2',
      params: ['2026-07-01', '2026-07-31'],
    })
  })

  it('combines type and date range with correctly numbered params', () => {
    expect(buildCampaignsFilter('general', '2026-07-01', '2026-07-31')).toEqual({
      clause: 'WHERE type = $1 AND created_at >= $2 AND created_at <= $3',
      params: ['general', '2026-07-01', '2026-07-31'],
    })
  })
})

describe('resolveCampaignsLimit', () => {
  it('defaults to 20 when raw is missing', () => {
    expect(resolveCampaignsLimit(undefined)).toBe(20)
  })

  it('parses a numeric string', () => {
    expect(resolveCampaignsLimit('50')).toBe(50)
  })

  it('clamps values above 100 down to 100', () => {
    expect(resolveCampaignsLimit('9999')).toBe(100)
  })

  it('clamps values below 1 up to 1', () => {
    expect(resolveCampaignsLimit('0')).toBe(1)
    expect(resolveCampaignsLimit('-5')).toBe(1)
  })

  it('defaults to 20 when raw is not a number', () => {
    expect(resolveCampaignsLimit('not-a-number')).toBe(20)
  })
})

describe('computeReadRate', () => {
  it('returns 0 when total recipients is 0', () => {
    expect(computeReadRate(0, 0)).toBe(0)
  })

  it('computes a fraction', () => {
    expect(computeReadRate(25, 100)).toBe(0.25)
  })

  it('returns 1 when everyone read it', () => {
    expect(computeReadRate(50, 50)).toBe(1)
  })
})
