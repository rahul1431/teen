"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rollOutcome = rollOutcome;
// Rolls a single outcome against a product's payout table using
// cumulative probability — each payout's `probability` is a percentage
// (0-100) and the full set for one product must sum to 100 (enforced at
// creation time, see betting.ts's /internal/lottery/scratch/create).
// Independent roll per purchase — no shared pool, no finite stock.
function rollOutcome(payouts) {
    var roll = Math.random() * 100;
    var cumulative = 0;
    for (var _i = 0, payouts_1 = payouts; _i < payouts_1.length; _i++) {
        var p = payouts_1[_i];
        cumulative += p.probability;
        if (roll < cumulative) {
            return {
                outcome: p.outcome,
                amount: p.outcome === 'cash' ? Number(p.amount) : 0,
                promo_code_id: p.outcome === 'coupon' ? (p.promo_code_id || null) : null,
            };
        }
    }
    // Floating-point rounding safety net — probabilities summing to
    // 99.999...% or a roll landing exactly at the boundary falls through
    // here; treat as the last configured payout rather than throwing.
    var last = payouts[payouts.length - 1];
    return {
        outcome: last.outcome,
        amount: last.outcome === 'cash' ? Number(last.amount) : 0,
        promo_code_id: last.outcome === 'coupon' ? (last.promo_code_id || null) : null,
    };
}
