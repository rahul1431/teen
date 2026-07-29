import { describe, it, expect } from 'vitest'
import { buildWithdrawalsFilter, resolveWithdrawalsLimit } from '../src/withdrawals-query'

describe('buildWithdrawalsFilter', () => {
  it('returns no status clause when status is "all"', () => {
    expect(buildWithdrawalsFilter('all')).toEqual({ clause: '', params: [] })
  })

  it('filters by the given status', () => {
    expect(buildWithdrawalsFilter('paid')).toEqual({ clause: 'AND po.status = $1', params: ['paid'] })
  })

  it('defaults to "created" when status is missing', () => {
    expect(buildWithdrawalsFilter(undefined)).toEqual({ clause: 'AND po.status = $1', params: ['created'] })
  })
})

describe('resolveWithdrawalsLimit', () => {
  it('defaults to 100 when raw is missing', () => {
    expect(resolveWithdrawalsLimit(undefined)).toBe(100)
  })

  it('parses a numeric string', () => {
    expect(resolveWithdrawalsLimit('15')).toBe(15)
  })

  it('clamps values above 500 down to 500', () => {
    expect(resolveWithdrawalsLimit('99999')).toBe(500)
  })

  it('clamps values below 1 up to 1', () => {
    expect(resolveWithdrawalsLimit('0')).toBe(1)
    expect(resolveWithdrawalsLimit('-5')).toBe(1)
  })

  it('defaults to 100 when raw is not a number', () => {
    expect(resolveWithdrawalsLimit('not-a-number')).toBe(100)
  })
})
