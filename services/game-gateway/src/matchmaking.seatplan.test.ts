// Standalone spec test for planTeenPattiSeats, planRummySeats, planLudoSeats, and getStakeBotRules
// Run: npx tsx src/matchmaking.seatplan.test.ts
import { planTeenPattiSeats, planRummySeats, planLudoSeats, getStakeBotRules } from './matchmaking'

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

// ── Teen Patti Rules ──
// 10: Min 1RP, 50: Min 2RP, 100: Min 3RP, 500+: Only RP no bots

// Stake 10 (1 RP required)
check(`TeenPatti ₹10 · 1 RP → 1RP+3B`, planTeenPattiSeats(1, 10), { start: true, reals: 1, bots: 3, requeue: false })
check(`TeenPatti ₹10 · 2 RP → 2RP+2B`, planTeenPattiSeats(2, 10), { start: true, reals: 2, bots: 2, requeue: false })

// Stake 50 (2 RP required)
check(`TeenPatti ₹50 · 1 RP → requeue`, planTeenPattiSeats(1, 50), { start: false, reals: 0, bots: 0, requeue: true })
check(`TeenPatti ₹50 · 2 RP → 2RP+2B`, planTeenPattiSeats(2, 50), { start: true, reals: 2, bots: 2, requeue: false })

// Stake 100 (3 RP required)
check(`TeenPatti ₹100 · 2 RP → requeue`, planTeenPattiSeats(2, 100), { start: false, reals: 0, bots: 0, requeue: true })
check(`TeenPatti ₹100 · 3 RP → 3RP+1B`, planTeenPattiSeats(3, 100), { start: true, reals: 3, bots: 1, requeue: false })

// Stake 500 (Only RP, no bots, min 2 RP)
check(`TeenPatti ₹500 · 1 RP → requeue`, planTeenPattiSeats(1, 500), { start: false, reals: 0, bots: 0, requeue: true })
check(`TeenPatti ₹500 · 2 RP → 2RP+0B (no bots)`, planTeenPattiSeats(2, 500), { start: true, reals: 2, bots: 0, requeue: false })
check(`TeenPatti ₹500 · 4 RP → 4RP+0B (no bots)`, planTeenPattiSeats(4, 500), { start: true, reals: 4, bots: 0, requeue: false })

// Stake 1000 (Only RP, no bots, min 2 RP)
check(`TeenPatti ₹1000 · 1 RP → requeue`, planTeenPattiSeats(1, 1000), { start: false, reals: 0, bots: 0, requeue: true })
check(`TeenPatti ₹1000 · 2 RP → 2RP+0B (no bots)`, planTeenPattiSeats(2, 1000), { start: true, reals: 2, bots: 0, requeue: false })

// Caps & edge cases
check(`TeenPatti ₹10 · 7 RP → capped 6RP`, planTeenPattiSeats(7, 10), { start: true, reals: 6, bots: 0, requeue: false })
check(`TeenPatti ₹10 · 0 RP → no start`, planTeenPattiSeats(0, 10), { start: false, reals: 0, bots: 0, requeue: false })


// ── Rummy Rules ──
// 100: Min 1RP, 500: Min 2RP, 1000: Min 3RP, 2000+: Only RP no bots

// Stake 100 (1 RP required, target table size 4)
check(`Rummy ₹100 · 1 RP (target 4) → 1RP+3B`, planRummySeats(1, 100, 4), { start: true, reals: 1, bots: 3, requeue: false, targetTableSize: 4 })

// Stake 500 (2 RP required, target table size 4)
check(`Rummy ₹500 · 1 RP (target 4) → requeue`, planRummySeats(1, 500, 4), { start: false, reals: 0, bots: 0, requeue: true, targetTableSize: 4 })
check(`Rummy ₹500 · 2 RP (target 4) → 2RP+2B`, planRummySeats(2, 500, 4), { start: true, reals: 2, bots: 2, requeue: false, targetTableSize: 4 })

// Stake 1000 (3 RP required, target table size 4)
check(`Rummy ₹1000 · 2 RP (target 4) → requeue`, planRummySeats(2, 1000, 4), { start: false, reals: 0, bots: 0, requeue: true, targetTableSize: 4 })
check(`Rummy ₹1000 · 3 RP (target 4) → 3RP+1B`, planRummySeats(3, 1000, 4), { start: true, reals: 3, bots: 1, requeue: false, targetTableSize: 4 })

// Stake 2000+ (Only RP, no bots, min 2 RP)
check(`Rummy ₹2000 · 1 RP → requeue`, planRummySeats(1, 2000, 4), { start: false, reals: 0, bots: 0, requeue: true, targetTableSize: 4 })
check(`Rummy ₹2000 · 2 RP → 2RP+0B (no bots)`, planRummySeats(2, 2000, 4), { start: true, reals: 2, bots: 0, requeue: false, targetTableSize: 4 })
check(`Rummy ₹5000 · 2 RP → 2RP+0B (no bots)`, planRummySeats(2, 5000, 4), { start: true, reals: 2, bots: 0, requeue: false, targetTableSize: 4 })
check(`Rummy ₹10000 · 2 RP → 2RP+0B (no bots)`, planRummySeats(2, 10000, 4), { start: true, reals: 2, bots: 0, requeue: false, targetTableSize: 4 })


// ── Ludo Rules ──
// 100: Min 1RP, 500: Min 2RP, 1000: Min 3RP, 2000+: Only RP no bots

// Stake 100 (1 RP required, target table size 4)
check(`Ludo ₹100 · 1 RP → 1RP+3B`, planLudoSeats(1, 100), { start: true, reals: 1, bots: 3, requeue: false, targetTableSize: 4 })

// Stake 500 (2 RP required, target table size 4)
check(`Ludo ₹500 · 1 RP → requeue`, planLudoSeats(1, 500), { start: false, reals: 0, bots: 0, requeue: true, targetTableSize: 4 })
check(`Ludo ₹500 · 2 RP → 2RP+2B`, planLudoSeats(2, 500), { start: true, reals: 2, bots: 2, requeue: false, targetTableSize: 4 })

// Stake 1000 (3 RP required, target table size 4)
check(`Ludo ₹1000 · 2 RP → requeue`, planLudoSeats(2, 1000), { start: false, reals: 0, bots: 0, requeue: true, targetTableSize: 4 })
check(`Ludo ₹1000 · 3 RP → 3RP+1B`, planLudoSeats(3, 1000), { start: true, reals: 3, bots: 1, requeue: false, targetTableSize: 4 })

// Stake 2000+ (Only RP, no bots, min 2 RP)
check(`Ludo ₹2000 · 1 RP → requeue`, planLudoSeats(1, 2000), { start: false, reals: 0, bots: 0, requeue: true, targetTableSize: 4 })
check(`Ludo ₹2000 · 2 RP → 2RP+0B (no bots)`, planLudoSeats(2, 2000), { start: true, reals: 2, bots: 0, requeue: false, targetTableSize: 4 })
check(`Ludo ₹5000 · 2 RP → 2RP+0B (no bots)`, planLudoSeats(2, 5000), { start: true, reals: 2, bots: 0, requeue: false, targetTableSize: 4 })
check(`Ludo ₹10000 · 2 RP → 2RP+0B (no bots)`, planLudoSeats(2, 10000), { start: true, reals: 2, bots: 0, requeue: false, targetTableSize: 4 })


// ── Bot Rules Helper Tests ──
check(`BotRules TP 10`, getStakeBotRules('teen_patti', 10, 4), { requiredReals: 1, allowBots: true, maxBots: 3 })
check(`BotRules TP 50`, getStakeBotRules('teen_patti', 50, 4), { requiredReals: 2, allowBots: true, maxBots: 2 })
check(`BotRules TP 100`, getStakeBotRules('teen_patti', 100, 4), { requiredReals: 3, allowBots: true, maxBots: 1 })
check(`BotRules TP 500`, getStakeBotRules('teen_patti', 500, 4), { requiredReals: 2, allowBots: false, maxBots: 0 })

check(`BotRules Rummy 100`, getStakeBotRules('rummy', 100, 4), { requiredReals: 1, allowBots: true, maxBots: 3 })
check(`BotRules Rummy 500`, getStakeBotRules('rummy', 500, 4), { requiredReals: 2, allowBots: true, maxBots: 2 })
check(`BotRules Rummy 1000`, getStakeBotRules('rummy', 1000, 4), { requiredReals: 3, allowBots: true, maxBots: 1 })
check(`BotRules Rummy 2000`, getStakeBotRules('rummy', 2000, 4), { requiredReals: 2, allowBots: false, maxBots: 0 })

check(`BotRules Ludo 100`, getStakeBotRules('ludo', 100, 4), { requiredReals: 1, allowBots: true, maxBots: 3 })
check(`BotRules Ludo 500`, getStakeBotRules('ludo', 500, 4), { requiredReals: 2, allowBots: true, maxBots: 2 })
check(`BotRules Ludo 1000`, getStakeBotRules('ludo', 1000, 4), { requiredReals: 3, allowBots: true, maxBots: 1 })
check(`BotRules Ludo 2000`, getStakeBotRules('ludo', 2000, 4), { requiredReals: 2, allowBots: false, maxBots: 0 })

if (failures) {
  console.error(`\n${failures} test(s) FAILED`)
  process.exit(1)
}
console.log('\nAll seat-plan and bot-rules tests passed.')
