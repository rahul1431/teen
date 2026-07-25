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
  // A Ludo-only canary var, set to 50%. The legacy shared var stays 0 —
  // proves Ludo's rollout doesn't depend on the old global knob at all.
  process.env.PERSONALIZATION_CANARY_PCT_LUDO = '50'
  process.env.PERSONALIZATION_CANARY_PCT = '0'

  // Re-require so the module reads the env vars set above (module-level consts).
  delete require.cache[require.resolve('./personalized-difficulty-client')]
  const { isInPersonalizationCanary } = require('./personalized-difficulty-client')

  const inBucket = findIdWithPercent(10)   // 10 < 50 → in Ludo canary
  const outOfBucket = findIdWithPercent(90) // 90 >= 50 → out

  assert(
    'a player hashing under the Ludo pct is in the canary for ludo',
    isInPersonalizationCanary(inBucket, 'ludo') === true
  )
  assert(
    'a player hashing over the Ludo pct is NOT in the canary for ludo',
    isInPersonalizationCanary(outOfBucket, 'ludo') === false
  )
  assert(
    'the same in-bucket player is NOT in the canary for teen_patti (legacy var is 0)',
    isInPersonalizationCanary(inBucket, 'teen_patti') === false
  )

  if (testsFailed) {
    console.error(`\n${testsFailed} test(s) FAILED`)
    process.exit(1)
  }
  console.log(`\nAll ${testsPassed} personalized-difficulty canary-scoping tests passed.`)
}

run()
