// services/app-monitor-service/src/ingestor.enrich.test.ts
import { describe, it, expect } from 'vitest'
import { deriveLastScreenGame, isValidLocationEvent, eventPropertiesJson } from './monitor-ingestor'

describe('deriveLastScreenGame', () => {
  it('takes the most recent screen_view screen and game_event action', () => {
    const out = deriveLastScreenGame([
      { event_type: 'screen_view', screen: 'home', ts: '2026-07-03T10:00:00Z' } as any,
      { event_type: 'game_event', action: 'tp_join_room', ts: '2026-07-03T10:01:00Z' } as any,
      { event_type: 'screen_view', screen: 'teen_patti', ts: '2026-07-03T10:02:00Z' } as any,
    ])
    expect(out).toEqual({ last_screen: 'teen_patti', last_game: 'tp_join_room' })
  })
  it('returns nulls when absent', () => {
    expect(deriveLastScreenGame([{ event_type: 'error' } as any]))
      .toEqual({ last_screen: null, last_game: null })
  })
})

describe('isValidLocationEvent', () => {
  it('accepts a location event with both lat and lon as numbers', () => {
    const e = { event_type: 'location', lat: 40.7128, lon: -74.0060 } as any
    expect(isValidLocationEvent(e)).toBe(true)
  })
  it('rejects a location event with lat but missing lon', () => {
    const e = { event_type: 'location', lat: 40.7128 } as any
    expect(isValidLocationEvent(e)).toBe(false)
  })
  it('rejects a location event with lon but missing lat', () => {
    const e = { event_type: 'location', lon: -74.0060 } as any
    expect(isValidLocationEvent(e)).toBe(false)
  })
  it('rejects a location event with neither lat nor lon', () => {
    const e = { event_type: 'location' } as any
    expect(isValidLocationEvent(e)).toBe(false)
  })
  it('rejects a location event with non-numeric lat', () => {
    const e = { event_type: 'location', lat: '40.7128', lon: -74.0060 } as any
    expect(isValidLocationEvent(e)).toBe(false)
  })
  it('rejects a location event with non-numeric lon', () => {
    const e = { event_type: 'location', lat: 40.7128, lon: '-74.0060' } as any
    expect(isValidLocationEvent(e)).toBe(false)
  })
  it('rejects a non-location event even with lat and lon', () => {
    const e = { event_type: 'screen_view', lat: 40.7128, lon: -74.0060 } as any
    expect(isValidLocationEvent(e)).toBe(false)
  })
})

describe('eventPropertiesJson', () => {
  it('stores a game_event action with no properties as {"action": ...}', () => {
    const e = { event_type: 'game_event', action: 'tp_join_room' } as any
    expect(eventPropertiesJson(e)).toBe(JSON.stringify({ action: 'tp_join_room' }))
  })
  it('merges action into existing properties', () => {
    const e = {
      event_type: 'game_event', action: 'tp_join_room',
      properties: { room_id: 'r1', stake: 100 },
    } as any
    expect(eventPropertiesJson(e)).toBe(
      JSON.stringify({ room_id: 'r1', stake: 100, action: 'tp_join_room' })
    )
  })
  it('leaves properties unchanged when there is no action', () => {
    const e = { event_type: 'screen_view', properties: { screen: 'home' } } as any
    expect(eventPropertiesJson(e)).toBe(JSON.stringify({ screen: 'home' }))
  })
  it('returns null when there is neither action nor properties', () => {
    const e = { event_type: 'lifecycle' } as any
    expect(eventPropertiesJson(e)).toBeNull()
  })
})
