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

// ── Low stakes (₹10, ₹50): bot-fill to a 4-seat floor, up to 6 real players ──
for (const stake of [10, 50]) {
  check(`₹${stake} · 1 RP → 1RP+3B`, planTeenPattiSeats(1, stake), { start: true, reals: 1, bots: 3, requeue: false })
  check(`₹${stake} · 2 RP → 2RP+2B`, planTeenPattiSeats(2, stake), { start: true, reals: 2, bots: 2, requeue: false })
  check(`₹${stake} · 3 RP → 3RP+1B`, planTeenPattiSeats(3, stake), { start: true, reals: 3, bots: 1, requeue: false })
  check(`₹${stake} · 4 RP → 4RP+0B`, planTeenPattiSeats(4, stake), { start: true, reals: 4, bots: 0, requeue: false })
  check(`₹${stake} · 5 RP → 5RP+0B`, planTeenPattiSeats(5, stake), { start: true, reals: 5, bots: 0, requeue: false })
  check(`₹${stake} · 6 RP → 6RP+0B`, planTeenPattiSeats(6, stake), { start: true, reals: 6, bots: 0, requeue: false })
  // Never exceed a 6-seat table even if 7 reals somehow queue at once.
  check(`₹${stake} · 7 RP → capped 6RP`, planTeenPattiSeats(7, stake), { start: true, reals: 6, bots: 0, requeue: false })
  // No real players → nothing to start (no all-bot tables).
  check(`₹${stake} · 0 RP → no start`, planTeenPattiSeats(0, stake), { start: false, reals: 0, bots: 0, requeue: false })
}

// ── High stakes (₹100, ₹500, ₹1000): real players only, no bots, ≥2 to start ──
for (const stake of [100, 500, 1000]) {
  check(`₹${stake} · 1 RP → wait`, planTeenPattiSeats(1, stake), { start: false, reals: 1, bots: 0, requeue: true })
  check(`₹${stake} · 2 RP → 2RP+0B`, planTeenPattiSeats(2, stake), { start: true, reals: 2, bots: 0, requeue: false })
  check(`₹${stake} · 3 RP → 3RP+0B`, planTeenPattiSeats(3, stake), { start: true, reals: 3, bots: 0, requeue: false })
  check(`₹${stake} · 4 RP → 4RP+0B`, planTeenPattiSeats(4, stake), { start: true, reals: 4, bots: 0, requeue: false })
  check(`₹${stake} · 5 RP → 5RP+0B`, planTeenPattiSeats(5, stake), { start: true, reals: 5, bots: 0, requeue: false })
  check(`₹${stake} · 6 RP → 6RP+0B`, planTeenPattiSeats(6, stake), { start: true, reals: 6, bots: 0, requeue: false })
  check(`₹${stake} · 7 RP → capped 6RP`, planTeenPattiSeats(7, stake), { start: true, reals: 6, bots: 0, requeue: false })
}

if (failures) {
  console.error(`\n${failures} test(s) FAILED`)
  process.exit(1)
}
console.log('\nAll seat-plan tests passed.')
