// services/app-monitor-service/src/ingestor.enrich.test.ts
import { describe, it, expect } from 'vitest'
import { deriveLastScreenGame } from './monitor-ingestor'

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
