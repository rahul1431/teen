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
  it('leaves a bare IPv4 unchanged', () => {
    expect(parseClientIp({}, '203.0.113.9')).toBe('203.0.113.9')
  })
  it('strips the port from IPv4:port', () => {
    expect(parseClientIp({}, '203.0.113.9:54321')).toBe('203.0.113.9')
  })
  it('strips ipv6-mapped prefix for ::ffff:198.51.100.7', () => {
    expect(parseClientIp({}, '::ffff:198.51.100.7')).toBe('198.51.100.7')
  })
  it('leaves ::1 unchanged (does not strip trailing hextet)', () => {
    expect(parseClientIp({}, '::1')).toBe('::1')
  })
  it('leaves a full bare IPv6 address unchanged', () => {
    expect(parseClientIp({}, '2405:200:1630:abcd:1234:5678:9abc:def0')).toBe(
      '2405:200:1630:abcd:1234:5678:9abc:def0'
    )
  })
  it('extracts a bracketed IPv6 with port', () => {
    expect(parseClientIp({}, '[2001:db8::1]:443')).toBe('2001:db8::1')
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
