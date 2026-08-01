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
  async rpush() {}
}

let broadcasts: any[] = []
const mockHub = {
  sendToRoom: (roomId: string, event: string, payload: any) => { broadcasts.push({ roomId, event, payload }) },
  sendToUser: () => {},
} as any

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

  const resultBroadcast = broadcasts.find(b => b.event === 'game:result' && b.roomId === 'room-1')
  assert('game:result was broadcast to the room', !!resultBroadcast)

  // --- A null winner (abandoned game) must not write a misleading rank ---
  broadcasts = []
  const pool2 = new MockPool()
  const service2 = new MatchmakingService(mockRedis, pool2 as any, mockHub)
  pool2.setQueryResult(partsQuery, ['room-2'], [
    { user_id: 'q1', entry_fee_deducted: '50', is_bot: false },
    { user_id: 'q2', entry_fee_deducted: '50', is_bot: true },
  ])
  await service2.handleLudoEnd('room-2', {
    winner_id: null,
    prize: 0,
    rankings: [
      { user_id: 'q1', finished: 0 },
      { user_id: 'q2', finished: 0 },
    ],
  })
  const noWinnerUpdates = pool2.queries.filter(q => q.sql.includes('UPDATE game_participants') && q.sql.includes('final_rank'))
  const forQ1 = noWinnerUpdates.find(q => q.params.includes('q1'))
  assert('abandoned game: final_rank is NULL, not a tie-broken rank', !!forQ1 && forQ1.params[1] === null,
    JSON.stringify(forQ1?.params))
  assert('abandoned game: prize_won is 0', !!forQ1 && forQ1.params[0] === 0,
    JSON.stringify(forQ1?.params))
  const q2ResultBroadcast = broadcasts.find(b => b.event === 'game:result' && b.roomId === 'room-2')
  assert('game:result still broadcast for a null-winner game', !!q2ResultBroadcast)

  // --- A throwing settle-game call must not block the result broadcast or ---
  // --- the ranking-persistence write that follows it.                    ---
  broadcasts = []
  global.fetch = (async () => { throw new Error('ECONNREFUSED (simulated)') }) as any
  const pool3 = new MockPool()
  const service3 = new MatchmakingService(mockRedis, pool3 as any, mockHub)
  pool3.setQueryResult(partsQuery, ['room-3'], [
    { user_id: 'r1', entry_fee_deducted: '50', is_bot: false },
  ])
  await service3.handleLudoEnd('room-3', {
    winner_id: 'r1',
    prize: 95,
    rankings: [{ user_id: 'r1', finished: 4 }],
  })
  const r3ResultBroadcast = broadcasts.find(b => b.event === 'game:result' && b.roomId === 'room-3')
  assert('game:result still broadcast when settle-game throws', !!r3ResultBroadcast)
  const r3Updates = pool3.queries.filter(q => q.sql.includes('UPDATE game_participants') && q.sql.includes('final_rank'))
  const forR1 = r3Updates.find(q => q.params.includes('r1'))
  assert('ranking is still persisted when settle-game throws (the historical bug)',
    !!forR1 && forR1.params[0] === 95 && forR1.params[1] === 1, JSON.stringify(forR1?.params))

  global.fetch = originalFetch

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} handleLudoEnd result-persistence tests passed.`)
}

run()
