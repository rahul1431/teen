// Standalone spec test for planTeenPattiSeats (no test framework in this
// service). Run: npx tsx src/matchmaking.seatplan.test.ts
import { planTeenPattiSeats } from './matchmaking'

let failures = 0
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g !== w) {
    failures++
    console.error(`✗ ${label}\n    got:  ${g}\n    want: ${w}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

// ── Stake-based minimum real player rules for Teen Patti ──

// Stake 10 (1 RP required)
check(`₹10 · 1 RP → 1RP+3B`, planTeenPattiSeats(1, 10), { start: true, reals: 1, bots: 3, requeue: false })
check(`₹10 · 2 RP → 2RP+2B`, planTeenPattiSeats(2, 10), { start: true, reals: 2, bots: 2, requeue: false })

// Stake 50 (2 RP required)
check(`₹50 · 1 RP → requeue`, planTeenPattiSeats(1, 50), { start: false, reals: 0, bots: 0, requeue: true })
check(`₹50 · 2 RP → 2RP+2B`, planTeenPattiSeats(2, 50), { start: true, reals: 2, bots: 2, requeue: false })

// Stake 100 (3 RP required)
check(`₹100 · 2 RP → requeue`, planTeenPattiSeats(2, 100), { start: false, reals: 0, bots: 0, requeue: true })
check(`₹100 · 3 RP → 3RP+1B`, planTeenPattiSeats(3, 100), { start: true, reals: 3, bots: 1, requeue: false })

// Stake 500 (4 RP required)
check(`₹500 · 3 RP → requeue`, planTeenPattiSeats(3, 500), { start: false, reals: 0, bots: 0, requeue: true })
check(`₹500 · 4 RP → 4RP+0B`, planTeenPattiSeats(4, 500), { start: true, reals: 4, bots: 0, requeue: false })

// Stake 1000 (4 RP required)
check(`₹1000 · 3 RP → requeue`, planTeenPattiSeats(3, 1000), { start: false, reals: 0, bots: 0, requeue: true })
check(`₹1000 · 4 RP → 4RP+0B`, planTeenPattiSeats(4, 1000), { start: true, reals: 4, bots: 0, requeue: false })

// General caps and limits
check(`₹10 · 7 RP → capped 6RP`, planTeenPattiSeats(7, 10), { start: true, reals: 6, bots: 0, requeue: false })
check(`₹10 · 0 RP → no start`, planTeenPattiSeats(0, 10), { start: false, reals: 0, bots: 0, requeue: false })

if (failures) {
  console.error(`\n${failures} test(s) FAILED`)
  process.exit(1)
}
console.log('\nAll seat-plan tests passed.')
