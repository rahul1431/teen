import { describe, it, expect, vi } from 'vitest'
import { CollusionSentinelSwarm } from '../bot-sentinel/collusion-sentinel'

describe('CollusionSentinelSwarm', () => {
  const mockRedis: any = {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  }

  const mockDb: any = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }

  const sentinel = new CollusionSentinelSwarm(mockRedis, mockDb)

  it('tracks interaction between players without alert on early clean hands', async () => {
    const alert = await sentinel.recordTableInteraction({
      roomId: 'room_1',
      gameType: 'teen_patti',
      playerAId: 'user_a',
      playerBId: 'user_b',
      actionA: 'call',
      actionB: 'raise',
      potAmount: 100,
      thirdPartyInPot: true,
      isWhipsaw: false,
      isPassiveCheckdown: false,
    })

    expect(alert).toBeNull()
  })

  it('flags and triggers alert when players exhibit repeated whipsaw squeezes', async () => {
    // Record 3 whipsaw interactions between user_x and user_y
    await sentinel.recordTableInteraction({
      roomId: 'room_2',
      gameType: 'teen_patti',
      playerAId: 'user_x',
      playerBId: 'user_y',
      actionA: 'raise',
      actionB: 'raise',
      potAmount: 400,
      thirdPartyInPot: true,
      isWhipsaw: true,
      isPassiveCheckdown: false,
    })

    await sentinel.recordTableInteraction({
      roomId: 'room_3',
      gameType: 'teen_patti',
      playerAId: 'user_x',
      playerBId: 'user_y',
      actionA: 'raise',
      actionB: 'raise',
      potAmount: 500,
      thirdPartyInPot: true,
      isWhipsaw: true,
      isPassiveCheckdown: false,
    })

    const alert = await sentinel.recordTableInteraction({
      roomId: 'room_4',
      gameType: 'teen_patti',
      playerAId: 'user_x',
      playerBId: 'user_y',
      actionA: 'raise',
      actionB: 'raise',
      potAmount: 600,
      thirdPartyInPot: true,
      isWhipsaw: true,
      isPassiveCheckdown: false,
    })

    expect(alert).not.toBeNull()
    expect(alert?.collusionScore).toBeGreaterThanOrEqual(0.65)
    expect(alert?.whipsawCount).toBe(3)
  })

  it('checkMatchmakingCollusion allows independent players', async () => {
    mockRedis.get.mockResolvedValue(null)
    const res = await sentinel.checkMatchmakingCollusion(['clean_1', 'clean_2', 'clean_3'])
    expect(res.allowed).toBe(true)
  })

  it('checkMatchmakingCollusion blocks quarantined pair from sharing a table', async () => {
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key.includes('bad_1') && key.includes('bad_2')) {
        return JSON.stringify({ status: 'quarantined' })
      }
      return null
    })

    const res = await sentinel.checkMatchmakingCollusion(['clean_1', 'bad_1', 'bad_2'])
    expect(res.allowed).toBe(false)
    expect(res.conflictingPair).toBeDefined()
    expect(res.reason).toContain('Suspected collusion syndicate quarantined')
  })

  it('getBotSentinelDirective arms bots to protect table against syndicates', () => {
    const directiveNormal = sentinel.getBotSentinelDirective(false)
    expect(directiveNormal.aggressiveDefense).toBe(false)
    expect(directiveNormal.neverFoldPremium).toBe(false)

    const directiveAlert = sentinel.getBotSentinelDirective(true)
    expect(directiveAlert.aggressiveDefense).toBe(true)
    expect(directiveAlert.neverFoldPremium).toBe(true)
  })
})

