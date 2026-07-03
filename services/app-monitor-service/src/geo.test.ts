import { describe, it, expect } from 'vitest'
import { parseClientIp, GeoLookup } from './geo'

describe('parseClientIp', () => {
  it('takes the first hop from x-forwarded-for', () => {
    expect(parseClientIp({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })).toBe('203.0.113.9')
  })
  it('falls back to socket remote and strips ipv6-mapped prefix', () => {
    expect(parseClientIp({}, '::ffff:198.51.100.7')).toBe('198.51.100.7')
  })
  it('returns null when nothing usable', () => {
    expect(parseClientIp({}, undefined)).toBeNull()
  })
})

describe('GeoLookup without a db file', () => {
  it('is not ready and returns all-null', () => {
    const g = new GeoLookup('/nonexistent/GeoLite2-City.mmdb')
    expect(g.ready()).toBe(false)
    expect(g.lookup('203.0.113.9')).toEqual(
      { city: null, region: null, country: null, lat: null, lon: null }
    )
  })
})
