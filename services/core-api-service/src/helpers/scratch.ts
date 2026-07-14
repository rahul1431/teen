export type ScratchPayout = {
  outcome: 'cash' | 'coupon' | 'no_win'
  amount?: number
  promo_code_id?: string
  probability: number
}

export type ScratchResult = {
  outcome: 'cash' | 'coupon' | 'no_win'
  amount: number
  promo_code_id: string | null
}

// Rolls a single outcome against a product's payout table using
// cumulative probability — each payout's `probability` is a percentage
// (0-100) and the full set for one product must sum to 100 (enforced at
// creation time, see betting.ts's /internal/lottery/scratch/create).
// Independent roll per purchase — no shared pool, no finite stock.
export function rollOutcome(payouts: ScratchPayout[]): ScratchResult {
  const roll = Math.random() * 100
  let cumulative = 0
  for (const p of payouts) {
    cumulative += p.probability
    if (roll < cumulative) {
      return {
        outcome: p.outcome,
        amount: p.outcome === 'cash' ? Number(p.amount) : 0,
        promo_code_id: p.outcome === 'coupon' ? (p.promo_code_id || null) : null,
      }
    }
  }
  // Floating-point rounding safety net — probabilities summing to
  // 99.999...% or a roll landing exactly at the boundary falls through
  // here; treat as the last configured payout rather than throwing.
  const last = payouts[payouts.length - 1]
  return {
    outcome: last.outcome,
    amount: last.outcome === 'cash' ? Number(last.amount) : 0,
    promo_code_id: last.outcome === 'coupon' ? (last.promo_code_id || null) : null,
  }
}
