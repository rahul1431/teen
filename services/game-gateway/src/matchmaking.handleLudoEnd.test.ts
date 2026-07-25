// Run: npx tsx src/matchmaking.handleLudoEnd.test.ts
import { MatchmakingService } from './matchmaking'

let testsPassed = 0
let testsFailed = 0

function assert(label: string, condition: boolean, details?: string) {
  if (condition) {
    testsPassed++
    console.log(`✓ ${label}`)
  } else {
    testsFailed++
    console.error(`✗ ${label}${details ? ` — ${details}` : ''}`)
  }
}

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
  async del() {}
  async setex() {}
}

const mockHub = { sendToRoom: () => {}, sendToUser: () => {} } as any

async function run() {
  process.env.WALLET_SERVICE_URL = 'http://wallet.test'
  process.env.INTERNAL_SERVICE_KEY = 'test-key'

  const originalFetch = global.fetch
  global.fetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as any

  const pool = new MockPool()
  const mockRedis = new MockRedisCache() as any
  const service = new MatchmakingService(mockRedis, pool as any, mockHub)

  const partsQuery = 'SELECT user_id, entry_fee_deducted, is_bot FROM game_participants WHERE room_id = $1'
  pool.setQueryResult(partsQuery, ['room-1'], [
    { user_id: 'p1', entry_fee_deducted: '50', is_bot: false },
    { user_id: 'p2', entry_fee_deducted: '50', is_bot: false },
    { user_id: 'p3', entry_fee_deducted: '50', is_bot: false },
    { user_id: 'p4', entry_fee_deducted: '50', is_bot: false },
  ])

  await service.handleLudoEnd('room-1', {
    winner_id: 'p2',
    prize: 190,
    rankings: [
      { user_id: 'p2', finished: 4 },
      { user_id: 'p4', finished: 3 },
      { user_id: 'p1', finished: 1 },
      { user_id: 'p3', finished: 0 },
    ],
  })

  const updates = pool.queries.filter(q => q.sql.includes('UPDATE game_participants') && q.sql.includes('final_rank'))

  assert('writes one UPDATE per player', updates.length === 4, `got ${updates.length}`)

  const forWinner = updates.find(q => q.params.includes('p2'))
  assert('winner (p2) gets final_rank 1', !!forWinner && forWinner.params.includes(1),
    JSON.stringify(forWinner?.params))
  assert('winner (p2) gets prize_won 190', !!forWinner && forWinner.params.includes(190),
    JSON.stringify(forWinner?.params))

  const forRunnerUp = updates.find(q => q.params.includes('p4'))
  assert('runner-up (p4) gets final_rank 2', !!forRunnerUp && forRunnerUp.params.includes(2),
    JSON.stringify(forRunnerUp?.params))
  assert('runner-up (p4) gets prize_won 0 (only winner is paid)', !!forRunnerUp && forRunnerUp.params.includes(0),
    JSON.stringify(forRunnerUp?.params))

  const forLast = updates.find(q => q.params.includes('p3'))
  assert('last place (p3) gets final_rank 4', !!forLast && forLast.params.includes(4),
    JSON.stringify(forLast?.params))

  global.fetch = originalFetch

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} handleLudoEnd result-persistence tests passed.`)
}

run()
