import { describe, it, expect, vi } from 'vitest'
import { BanterEngine } from '../bot-persona/banter-engine'
import { triggerBotReaction } from '../botCoordination/botReactions'

describe('In-Game Table Banter & Chat Persona Engine', () => {
  it('should assign a deterministic personality to a bot user ID', () => {
    const p1 = BanterEngine.getBotPersonality('bot-alice-123')
    const p2 = BanterEngine.getBotPersonality('bot-alice-123')
    const p3 = BanterEngine.getBotPersonality('bot-bob-456')

    expect(p1).toBe(p2) // Deterministic
    expect(['witty_chatter', 'cool_grinder', 'hype_beast', 'calm_veteran']).toContain(p1)
    expect(['witty_chatter', 'cool_grinder', 'hype_beast', 'calm_veteran']).toContain(p3)
  })

  it('should pick authentic contextual banter lines', () => {
    const winLine = BanterEngine.pickBanterLine('win')
    const nearMissLine = BanterEngine.pickBanterLine('near_miss')
    const captureLine = BanterEngine.pickBanterLine('capture')

    expect(typeof winLine).toBe('string')
    expect(winLine.length).toBeGreaterThan(0)
    expect(typeof nearMissLine).toBe('string')
    expect(typeof captureLine).toBe('string')
  })

  it('should broadcast room:chat with human typing delay', async () => {
    vi.useFakeTimers()
    const mockHub: any = {
      sendToRoom: vi.fn(),
    }

    BanterEngine.triggerBanter(
      mockHub,
      'test-room',
      { userId: 'bot-1', username: 'Rahul_Bot' },
      'win',
      1.0 // 100% trigger probability for test
    )

    // Initially not sent immediately (simulating human typing)
    expect(mockHub.sendToRoom).not.toHaveBeenCalled()

    // Advance timer past typing delay (4500ms max)
    vi.advanceTimersByTime(5000)

    expect(mockHub.sendToRoom).toHaveBeenCalledWith(
      'test-room',
      'room:chat',
      expect.objectContaining({
        user_id: 'bot-1',
        username: 'Rahul_Bot',
        type: 'emoji', // Rendered as floating table reaction on mobile client
        message: expect.any(String),
      })
    )

    vi.useRealTimers()
  })

  it('should respect cooldowns and not flood chat', () => {
    const mockHub: any = {
      sendToRoom: vi.fn(),
    }

    // First trigger
    BanterEngine.triggerBanter(
      mockHub,
      'test-room',
      { userId: 'bot-cooldown-user', username: 'Bot_Cooldown' },
      'win',
      1.0
    )

    // Immediate second trigger on same bot within 20s should be ignored
    BanterEngine.triggerBanter(
      mockHub,
      'test-room',
      { userId: 'bot-cooldown-user', username: 'Bot_Cooldown' },
      'declare',
      1.0
    )

    // Only one should have been scheduled
    expect(mockHub.sendToRoom).not.toHaveBeenCalled()
  })
})

