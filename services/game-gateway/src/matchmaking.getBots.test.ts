// Run: npx tsx src/matchmaking.getBots.test.ts
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

const mockRedis = {} as any
const mockHub = {} as any

async function run() {
  const pool = new MockPool()
  const service = new MatchmakingService(mockRedis, pool as any, mockHub)

  const teenPattiBotsQuery = `SELECT u.id, u.username
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND u.preferred_game_type = $1 AND w.real_balance >= $2
       ORDER BY RANDOM() LIMIT $3`
  pool.setQueryResult(teenPattiBotsQuery, ['teen_patti', 10, 3], [
    { id: 'bot-1', username: 'Seema_Bot' },
    { id: 'bot-2', username: 'Anjali_Bot' },
  ])

  const result = await (service as any).getBots('teen_patti', 3, 10)

  assert('getBots returns the mocked Teen Patti bots', result.length === 2)
  assert('getBots maps id/username correctly', result[0].userId === 'bot-1' && result[0].username === 'Seema_Bot')

  // autoRefillBots() runs first and issues a similarly-shaped query (FROM users u
  // JOIN wallets), so disambiguate on 'ORDER BY RANDOM()', unique to bot selection.
  const botsCall = pool.queries.find(q => q.sql.includes('ORDER BY RANDOM()'))
  assert('the bot-fill query filters on preferred_game_type', !!botsCall && botsCall.sql.includes('u.preferred_game_type = $1'))
  assert('gameType is passed as the first param (not stake)', botsCall?.params[0] === 'teen_patti')

  // A Ludo call against a pool with only Teen-Patti-tagged mock data returns nothing —
  // proves the filter actually excludes cross-game bots rather than ignoring the param.
  const ludoResult = await (service as any).getBots('ludo', 3, 10)
  assert('ludo call does not return teen_patti-tagged mock bots', ludoResult.length === 0)

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} getBots tests passed.`)
}

run()
