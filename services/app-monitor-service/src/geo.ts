import fs from 'fs'
import { Reader, CityResponse } from 'maxmind'

export type GeoResult = {
  city: string | null; region: string | null; country: string | null
  lat: number | null; lon: number | null
}
const NULL_GEO: GeoResult = { city: null, region: null, country: null, lat: null, lon: null }

export function parseClientIp(
  headers: Record<string, unknown>,
  socketRemote?: string
): string | null {
  const xff = headers['x-forwarded-for']
  const raw = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff : '')
  const first = raw.split(',')[0]?.trim()
  const pick = first || socketRemote || ''
  const cleaned = pick.replace(/^::ffff:/, '').replace(/:\d+$/, '').trim()
  return cleaned.length ? cleaned : null
}

export class GeoLookup {
  private reader: Reader<CityResponse> | null = null
  constructor(dbPath?: string) {
    try {
      if (dbPath && fs.existsSync(dbPath)) {
        const buf = fs.readFileSync(dbPath)
        this.reader = new Reader<CityResponse>(buf)
      }
    } catch { this.reader = null }
  }
  ready(): boolean { return this.reader !== null }
  lookup(ip: string | null): GeoResult {
    if (!this.reader || !ip) return { ...NULL_GEO }
    try {
      const r = this.reader.get(ip)
      if (!r) return { ...NULL_GEO }
      return {
        city:    r.city?.names?.en ?? null,
        region:  r.subdivisions?.[0]?.names?.en ?? null,
        country: r.country?.names?.en ?? null,
        lat:     r.location?.latitude ?? null,
        lon:     r.location?.longitude ?? null,
      }
    } catch { return { ...NULL_GEO } }
  }
}
