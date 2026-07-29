// services/game-gateway/src/matchmaking.tieredHardWins.test.ts
// Run: npx vitest run src/matchmaking.tieredHardWins.test.ts
import { describe, it, expect } from 'vitest'
import { MatchmakingService } from './matchmaking'

class MockPool {
  public queries: Array<{ sql: string; params: any[] }> = []
  private queryMap: Map<string, { rows: any[] }> = new Map()

  query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    this.queries.push({ sql, params })
    const key = sql + JSON.stringify(params)
    return Promise.resolve(this.queryMap.get(key) ?? { rows: [] })
  }

  setQueryResult(sql: string, params: any[], rows: any[]) {
    this.queryMap.set(sql + JSON.stringify(params), { rows })
  }

  connect() {
    return Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => {} })
  }
}

class MockRedisCache {
  private cache = new Map<string, string>()
  async get() { return null }
  async setex() {}
}

const mockHub = { sendToUser: () => {} } as any

const TIER_QUERY = `SELECT u.id, u.username
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND u.bot_difficulty = $1
         AND u.preferred_game_type = $2 AND w.real_balance >= $3
       ORDER BY RANDOM() LIMIT 1`

describe('tiered hard-wins bot selection', () => {
  it('returns exactly one bot per tier when all three exist', async () => {
    const pool = new MockPool()
    const mockRedis = new MockRedisCache() as any
    const service = new MatchmakingService(mockRedis, pool as any, mockHub)

    pool.setQueryResult(TIER_QUERY, ['easy', 'ludo', 10], [{ id: 'bot-easy', username: 'EasyBot' }])
    pool.setQueryResult(TIER_QUERY, ['medium', 'ludo', 10], [{ id: 'bot-medium', username: 'MediumBot' }])
    pool.setQueryResult(TIER_QUERY, ['hard', 'ludo', 10], [{ id: 'bot-hard', username: 'HardBot' }])

    const bots = await (service as any).getTierDiverseBots('ludo', 10)
    expect(bots?.length).toBe(3)
    expect(bots?.[0]?.userId).toBe('bot-easy')
    expect(bots?.[1]?.userId).toBe('bot-medium')
    expect(bots?.[2]?.userId).toBe('bot-hard')
  })

  it('returns null when any tier is missing', async () => {
    const pool2 = new MockPool()
    const mockRedis = new MockRedisCache() as any
    const service2 = new MatchmakingService(mockRedis, pool2 as any, mockHub)
    pool2.setQueryResult(TIER_QUERY, ['easy', 'ludo', 10], [{ id: 'bot-easy', username: 'EasyBot' }])
    pool2.setQueryResult(TIER_QUERY, ['medium', 'ludo', 10], [{ id: 'bot-medium', username: 'MediumBot' }])
    // No hard-tier row seeded -> query returns { rows: [] } -> should yield null
    const incomplete = await (service2 as any).getTierDiverseBots('ludo', 10)
    expect(incomplete).toBe(null)
  })
})
