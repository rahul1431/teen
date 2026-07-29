// Test suite for ABExperimentRouter
// Run: npx tsx src/a-b-router.test.ts

import { ABExperimentRouter, ABExperiment, BotProfile } from './a-b-router'
import { Pool } from 'pg'

interface MockQueryResult {
  rows: any[]
}

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

function assertEquals(label: string, got: unknown, want: unknown) {
  const success = JSON.stringify(got) === JSON.stringify(want)
  if (success) {
    testsPassed++
    console.log(`✓ ${label}`)
  } else {
    testsFailed++
    console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`)
  }
}

// ────────────────────────────────────────────────────────────────
// Mock Database
// ────────────────────────────────────────────────────────────────

class MockPool {
  private queryMap: Map<string, MockQueryResult> = new Map()

  query(sql: string, params?: any[]): Promise<MockQueryResult> {
    // Build a simple key for lookup
    let key = sql
    if (params && params.length > 0) {
      key += JSON.stringify(params)
    }

    const result = this.queryMap.get(key)
    if (!result) {
      return Promise.resolve({ rows: [] })
    }
    return Promise.resolve(result)
  }

  setQueryResult(sql: string, params: any[] | undefined, rows: any[]) {
    let key = sql
    if (params && params.length > 0) {
      key += JSON.stringify(params)
    }
    this.queryMap.set(key, { rows })
  }

  clearResults() {
    this.queryMap.clear()
  }
}

// ────────────────────────────────────────────────────────────────
// Test Data
// ────────────────────────────────────────────────────────────────

const mockControlProfile: BotProfile = {
  id: 'control-profile-1',
  game_type: 'teen_patti',
  difficulty: 'medium',
  win_rate_target: 50.0,
  fold_probability: 0.3,
  call_probability: 0.47,
  raise_probability: 0.23,
  avg_decision_delay_ms: 2000,
  avg_stake_preference: 50.0,
  aggression_score: 3.5,
}

const mockExperimentalProfile: BotProfile = {
  id: 'experimental-profile-1',
  game_type: 'teen_patti',
  difficulty: 'medium',
  win_rate_target: 55.0,
  fold_probability: 0.25,
  call_probability: 0.5,
  raise_probability: 0.25,
  avg_decision_delay_ms: 1800,
  avg_stake_preference: 55.0,
  aggression_score: 3.8,
}

const mockExperiment: ABExperiment = {
  id: 'exp-1',
  name: 'Test Experiment',
  game_type: 'teen_patti',
  difficulty: 'medium',
  control_profile_id: 'control-profile-1',
  experimental_profile_id: 'experimental-profile-1',
  traffic_allocation_pct: 50,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
}

// ────────────────────────────────────────────────────────────────
// Test: Consistent routing for same player
// ────────────────────────────────────────────────────────────────

async function testConsistentRouting() {
  console.log('\n► Test: should route consistently for same player')

  const mockDb = new MockPool()
  const router = new ABExperimentRouter(mockDb as any)

  // Set up mocks
  const getActiveExperimentQuery = `
      SELECT * FROM a_b_experiments
      WHERE game_type = $1
        AND difficulty = $2
        AND status = 'active'
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      LIMIT 1
    `
  ;(mockDb as any).setQueryResult(
    getActiveExperimentQuery,
    ['teen_patti', 'medium'],
    [mockExperiment]
  )

  const getProfileQuery = 'SELECT * FROM bot_profiles WHERE id = $1 LIMIT 1'
  ;(mockDb as any).setQueryResult(getProfileQuery, ['control-profile-1'], [mockControlProfile])
  ;(mockDb as any).setQueryResult(getProfileQuery, ['experimental-profile-1'], [mockExperimentalProfile])

  // Route the same player multiple times
  const playerId = 'player-123'
  const result1 = await router.routePlayer(playerId, 'teen_patti', 'medium')
  const result2 = await router.routePlayer(playerId, 'teen_patti', 'medium')
  const result3 = await router.routePlayer(playerId, 'teen_patti', 'medium')

  // All results should be the same profile
  assertEquals('First call result', result1.id, result2.id)
  assertEquals('Second call equals third', result2.id, result3.id)

  // The player should be consistently routed to either control or experimental
  const isExperimental = result1.id === 'experimental-profile-1'
  assert('Player is routed to either control or experimental',
    isExperimental || result1.id === 'control-profile-1',
    `Got profile: ${result1.id}`
  )
}

// ────────────────────────────────────────────────────────────────
// Test: Traffic allocation percentage
// ────────────────────────────────────────────────────────────────

async function testTrafficAllocation() {
  console.log('\n► Test: should allocate correct percentage of traffic')

  const mockDb = new MockPool()
  const router = new ABExperimentRouter(mockDb as any)

  // Set up mocks with 30% traffic allocation
  const experimentWith30Pct = { ...mockExperiment, traffic_allocation_pct: 30 }

  const getActiveExperimentQuery = `
      SELECT * FROM a_b_experiments
      WHERE game_type = $1
        AND difficulty = $2
        AND status = 'active'
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      LIMIT 1
    `
  ;(mockDb as any).setQueryResult(
    getActiveExperimentQuery,
    ['teen_patti', 'medium'],
    [experimentWith30Pct]
  )

  const getProfileQuery = 'SELECT * FROM bot_profiles WHERE id = $1 LIMIT 1'
  ;(mockDb as any).setQueryResult(getProfileQuery, ['control-profile-1'], [mockControlProfile])
  ;(mockDb as any).setQueryResult(getProfileQuery, ['experimental-profile-1'], [mockExperimentalProfile])

  // Route 100 different players
  let experimentalCount = 0
  for (let i = 0; i < 100; i++) {
    const playerId = `player-${i}`
    const profile = await router.routePlayer(playerId, 'teen_patti', 'medium')
    if (profile.id === 'experimental-profile-1') {
      experimentalCount++
    }
  }

  // Should be approximately 30% in experimental group (allow 10-15% variance)
  const percentage = (experimentalCount / 100) * 100
  const isReasonable = percentage >= 15 && percentage <= 45
  assert(
    'Traffic allocation within reasonable range (15-45% for 30% target)',
    isReasonable,
    `Got ${percentage}% (count: ${experimentalCount}/100)`
  )
}

// ────────────────────────────────────────────────────────────────
// Test: Use control profile if no experiment
// ────────────────────────────────────────────────────────────────

async function testControlProfileFallback() {
  console.log('\n► Test: should use control profile if no experiment')

  const mockDb = new MockPool()
  const router = new ABExperimentRouter(mockDb as any)

  // Set up mocks with no active experiment
  const getActiveExperimentQuery = `
      SELECT * FROM a_b_experiments
      WHERE game_type = $1
        AND difficulty = $2
        AND status = 'active'
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      LIMIT 1
    `
  ;(mockDb as any).setQueryResult(getActiveExperimentQuery, ['teen_patti', 'medium'], [])

  const getProfileQuery = 'SELECT * FROM bot_profiles WHERE game_type = $1 AND difficulty = $2 LIMIT 1'
  ;(mockDb as any).setQueryResult(getProfileQuery, ['teen_patti', 'medium'], [mockControlProfile])

  // Route a player when no experiment is active
  const profile = await router.routePlayer('player-456', 'teen_patti', 'medium')

  assertEquals('Returned control profile when no experiment', profile.id, 'control-profile-1')
}

// ────────────────────────────────────────────────────────────────
// Test: Hash determinism
// ────────────────────────────────────────────────────────────────

async function testHashDeterminism() {
  console.log('\n► Test: hash function is deterministic')

  const mockDb = new MockPool()
  const router = new ABExperimentRouter(mockDb as any)

  // Create a private method to test the hash function
  // We'll test it indirectly through routing
  const getActiveExperimentQuery = `
      SELECT * FROM a_b_experiments
      WHERE game_type = $1
        AND difficulty = $2
        AND status = 'active'
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      LIMIT 1
    `
  ;(mockDb as any).setQueryResult(
    getActiveExperimentQuery,
    ['teen_patti', 'medium'],
    [mockExperiment]
  )

  const getProfileQuery = 'SELECT * FROM bot_profiles WHERE id = $1 LIMIT 1'
  ;(mockDb as any).setQueryResult(getProfileQuery, ['control-profile-1'], [mockControlProfile])
  ;(mockDb as any).setQueryResult(getProfileQuery, ['experimental-profile-1'], [mockExperimentalProfile])

  // Route same player in different instances
  const router2 = new ABExperimentRouter(mockDb as any)
  const playerId = 'determinism-test-player'

  const profile1 = await router.routePlayer(playerId, 'teen_patti', 'medium')
  const profile2 = await router2.routePlayer(playerId, 'teen_patti', 'medium')

  assertEquals('Hash is deterministic across instances', profile1.id, profile2.id)
}

// ────────────────────────────────────────────────────────────────
// Run all tests
// ────────────────────────────────────────────────────────────────

async function runTests() {
  try {
    await testConsistentRouting()
    await testTrafficAllocation()
    await testControlProfileFallback()
    await testHashDeterminism()

    console.log(`\n${'─'.repeat(50)}`)
    console.log(`Tests passed: ${testsPassed}`)
    console.log(`Tests failed: ${testsFailed}`)
    console.log('─'.repeat(50))

    if (testsFailed > 0) {
      process.exit(1)
    } else {
      console.log('\n✓ All A/B router tests passed!')
    }
  } catch (error) {
    console.error('Test execution failed:', error)
    process.exit(1)
  }
}

runTests()
