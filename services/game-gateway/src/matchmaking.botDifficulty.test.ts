// Run: npx tsx src/matchmaking.botDifficulty.test.ts
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

const mockRedis = { get: async () => null, setex: async () => {} } as any
const mockHub = { sendToUser: () => {} } as any

async function run() {
  const pool = new MockPool()
  const service = new MatchmakingService(mockRedis, pool as any, mockHub)

  const botDifficultyQuery = `SELECT id, bot_difficulty FROM users WHERE id = ANY($1::uuid[])`
  pool.setQueryResult(botDifficultyQuery, [['bot-1', 'bot-2']], [
    { id: 'bot-1', bot_difficulty: 'hard' },
    { id: 'bot-2', bot_difficulty: null },
  ])

  const resolved = await (service as any).resolveBotDifficulties(['bot-1', 'bot-2'], 'medium')

  assert('bot-1 gets its own override (hard)', resolved.get('bot-1') === 'hard')
  assert('bot-2 falls back to the room-wide default (medium)', resolved.get('bot-2') === 'medium')

  const empty = await (service as any).resolveBotDifficulties([], 'medium')
  assert('an empty bot list resolves to an empty map without querying', empty.size === 0)

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} bot-difficulty resolution tests passed.`)
}

run()
