# Daily login bonus claim commits the streak and reports success even if the wallet credit call fails

**Severity:** Medium (player-facing balance can diverge from what the app claims was paid; same failure-swallowing shape as other filed wallet-credit bugs, but scoped to a small self-service action rather than admin-driven finance)
**Found:** 2026-07-28, backend-services documentation pass
**Files:** `services/core-api-service/src/plugins/users.ts:122-164` (`POST /users/daily-bonus/claim`)

## What's wrong

The claim handler runs entirely inside one Postgres transaction — locks the streak row (`FOR UPDATE`), computes the new streak/day number, upserts `user_login_streaks`, inserts a `bonuses` row, and commits — and only *after* that commit does it attempt to actually pay the player:

```ts
await client.query('COMMIT')
const walletUrl = process.env.WALLET_SERVICE_URL || 'http://localhost:3003'
await fetch(`${walletUrl}/internal/wallet/credit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' },
  body: JSON.stringify({ user_id: user.sub, amount: bonusAmount, type: 'bonus', wallet_type: 'bonus', idempotency_key: `daily_login:${user.sub}:${todayDate}`, description: `Daily login bonus — Day ${dayNumber}` }),
}).catch(err => console.error('[daily-bonus] wallet credit failed:', err))
return reply.send({ success: true, bonus_amount: bonusAmount, ... })
```

The `fetch` is neither awaited-and-checked nor allowed to fail the request — `.catch()` only logs to `console.error` (server-side stdout, not surfaced anywhere an operator would see in real time) and the handler unconditionally returns `{ success: true, bonus_amount, ... }` regardless of whether `wallet-service` actually accepted the credit. `fetch()` also doesn't reject on a non-2xx response at all, so even a 4xx/5xx from `wallet-service` (bad idempotency key format, service-side validation error, etc.) is silently discarded — `res.ok` is never checked.

## Impact

A player taps "Claim" on the daily bonus, the app shows the claimed amount and updates the streak counter (both driven by this response body), the `user_login_streaks`/`bonuses` rows are durably committed — but if `wallet-service` is down, slow past its own timeout, or rejects the request, the player's bonus-wallet balance never actually increases. Because `last_claimed_date` is already updated, the player cannot re-claim that day to self-correct (the status route reports `can_claim: false` for the rest of the day), and there is no reconciliation job that cross-checks `bonuses` rows against actual `wallet_transactions` credits to catch the mismatch. This is the same failure shape as the top-3 leaderboard reward (`docs/Bugs/leaderboard-top3-reward-never-paid.md`) and, previously, the admin-driven withdrawal/deposit state machine (fixed 2026-07-28) — but here it affects a routine, high-frequency player self-service action rather than an admin workflow, so the blast radius (frequency × affected users) is larger even though the per-incident amount is small.

## Fix

Check the wallet-credit call's result before returning success: if it fails (network error or non-2xx), either roll the claim into a `retry`/pending state the player can re-trigger, or move the wallet credit inside the same transaction path used elsewhere (call wallet-service first, only commit the streak/bonus rows after confirming the credit succeeded) — mirroring the fix already proposed for the withdrawal/deposit handlers. At minimum, log failures somewhere an operator will actually see them (the existing `admin_audit_log`-style tables, or an alert) instead of only `console.error`.
