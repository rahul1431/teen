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

class MockRedisCache {
  private cache = new Map<string, string>()
  set(key: string, value: object) { this.cache.set(key, JSON.stringify(value)) }
  async get(key: string) { return this.cache.get(key) ?? null }
  async setex() {}
}

const mockHub = { sendToUser: () => {} } as any

async function run() {
  const pool = new MockPool()
  const mockRedis = new MockRedisCache() as any
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

  // Ludo trained-profile resolution: seed the Redis cache (what getBotProfile
  // checks first) with a per-difficulty-tier profile, then confirm each bot
  // gets the profile matching ITS OWN resolved difficulty.
  mockRedis.set('bot:profile:ludo:hard', { fold_probability: 0, call_probability: 0, raise_probability: 0, avg_decision_delay_ms: 1000, capture_probability: 0.8, safe_play_probability: 0.95 })
  mockRedis.set('bot:profile:ludo:medium', { fold_probability: 0, call_probability: 0, raise_probability: 0, avg_decision_delay_ms: 2000, capture_probability: 0.5, safe_play_probability: null })

  const ludoProfiles = await (service as any).resolveLudoTrainedProfiles(resolved)
  assert('bot-1 (hard) gets the hard tier\'s trained profile', ludoProfiles.get('bot-1')?.capture_probability === 0.8 && ludoProfiles.get('bot-1')?.safe_play_probability === 0.95)
  assert('bot-2 (medium, via fallback) gets the medium tier\'s trained profile', ludoProfiles.get('bot-2')?.capture_probability === 0.5 && ludoProfiles.get('bot-2')?.safe_play_probability === null)

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} bot-difficulty resolution tests passed.`)
}

run()
