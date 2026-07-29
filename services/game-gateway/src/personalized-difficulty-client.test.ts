// Run: npx tsx src/personalized-difficulty-client.test.ts
import crypto from 'crypto'

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

/** Same hash scheme as personalized-difficulty-client.ts's hashToPercent, used
 * here to construct player ids that deterministically land in/out of a given
 * percentage bucket without depending on the module's internal function. */
function hashToPercent(id: string): number {
  const hash = crypto.createHash('sha256').update(id).digest('hex')
  return parseInt(hash.substring(0, 8), 16) % 100
}

function findIdWithPercent(target: number): string {
  for (let i = 0; ; i++) {
    const id = `probe-${i}`
    if (hashToPercent(id) === target) return id
  }
}

async function run() {
  const { isInCanaryPercent, isInPersonalizationCanary } = require('./personalized-difficulty-client')

  const inBucket = findIdWithPercent(10)    // 10 < 50 → in a 50% bucket
  const outOfBucket = findIdWithPercent(90) // 90 >= 50 → out of a 50% bucket

  // Ludo's canary is now DB-driven (game_configs.personalization_canary_pct),
  // passed in directly by the caller — no env var involved.
  assert(
    'a player hashing under a DB-sourced pct is in the canary',
    isInCanaryPercent(inBucket, 50) === true
  )
  assert(
    'a player hashing over a DB-sourced pct is NOT in the canary',
    isInCanaryPercent(outOfBucket, 50) === false
  )
  assert('pct of 0 is always out', isInCanaryPercent(inBucket, 0) === false)
  assert('pct of 100 is always in', isInCanaryPercent(outOfBucket, 100) === true)
  assert('negative pct clamps to 0 (always out)', isInCanaryPercent(inBucket, -5) === false)
  assert('pct above 100 clamps to 100 (always in)', isInCanaryPercent(outOfBucket, 500) === true)

  // Every other game type still uses the legacy shared env var, untouched.
  process.env.PERSONALIZATION_CANARY_PCT = '50'
  delete require.cache[require.resolve('./personalized-difficulty-client')]
  const { isInPersonalizationCanary: isInLegacyCanary } = require('./personalized-difficulty-client')
  assert(
    'non-Ludo callers still read the legacy PERSONALIZATION_CANARY_PCT env var',
    isInLegacyCanary(inBucket) === true
  )

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} personalized-difficulty canary tests passed.`)
}

run()
