import { describe, it, expect, vi } from 'vitest'
import { playChime } from './notificationSound'

describe('playChime', () => {
  it('creates an AudioContext and starts an oscillator without throwing', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const connect = vi.fn()
    const oscillator = { connect, start, stop, frequency: { setValueAtTime: vi.fn() }, type: 'sine' }
    const gainNode = { connect, gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }

    class MockAudioContext {
      currentTime = 0
      destination = {}
      createOscillator = () => oscillator
      createGain = () => gainNode
    }

    // @ts-expect-error test stub
    window.AudioContext = MockAudioContext

    expect(() => playChime()).not.toThrow()
    expect(start).toHaveBeenCalled()
  })
})
