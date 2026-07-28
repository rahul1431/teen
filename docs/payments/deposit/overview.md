# Deposit — Overview

Two deposit paths exist in the code, but only one is live: **manual deposit** (UPI/bank/QR, admin-reviewed) is what the shipped mobile app actually uses; **Razorpay online checkout** is a fully-implemented but entirely unused code path — see `docs/payments/razorpay-integration/overview.md`. Both funnel into the same `payment_orders` table (`type='deposit'`) and the same `WalletService.credit` primitive.

## Manual deposit (the live path)

1. Player opens the deposit sheet, which loads admin-configured payment destinations (`GET /wallet/deposit/methods` — UPI ID, bank account, or QR image, each with its own min/max limits).
2. Player pays externally, in their own UPI app or bank, to the chosen destination.
3. Player submits proof: amount, chosen method, a UTR/reference number, a screenshot, and optionally a promo code (`POST /wallet/deposit/submit`, multipart). This creates a `payment_orders` row with `status='created'` — **no wallet balance changes yet.**
4. An admin reviews the proof on the Finance → Deposits tab and either approves it (`mark_paid_and_credit` — credits `real_balance` plus any promo bonus into `bonus_balance`) or marks it failed.

There is no automatic verification of the UTR/screenshot — approval is entirely a human decision based on what the admin sees in the panel.

## Razorpay deposit (dead code)

`POST /wallet/deposit/create-order` + `POST /wallet/deposit/verify` implement a complete, correctly-signed Razorpay checkout flow (order creation, HMAC signature verification, atomic credit) — but no mobile client code calls either route. See `docs/payments/razorpay-integration/` for the full detail on why, and what that implies for the "webhook failed, etc." comment already present in `admin-service`'s reconciliation code (`services/admin-service/src/index.ts:787`), which anticipates a failure mode this integration doesn't currently have any live traffic to trigger.

## Promo codes

Both deposit paths can carry a promo code: `POST /wallet/promo/validate` gives a live preview (dry-run, no usage recorded) and `POST /wallet/deposit/submit` re-validates and re-computes the bonus server-side before storing it in the order's `metadata`, actually credited only on admin approval. See `docs/Bugs/deposit-promo-used-count-race-allows-double-bonus.md` for a race in this bookkeeping.

## Referral trigger

Every successful deposit credit (manual-approved or Razorpay-verified) calls `tryTriggerReferralReward` (`services/wallet-service/src/index.ts:19-71`), which checks for a pending referral where the depositor is the referee and, on the referee's first deposit, credits the referrer a bonus into their **bonus** wallet — idempotent per referral row, non-fatal on failure so a referral bug never blocks the deposit itself.

## Known issues

- `docs/Bugs/deposit-promo-used-count-race-allows-double-bonus.md` (new, this pass) — racing submits can double the bonus and inflate a promo's global usage count.
- Deposit approval's wallet credit call is checked before marking the order `'paid'`, and the withdrawal state machine's 6 wallet calls (fixed 2026-07-28) now all check the response and abort the status transition on failure — both previously shared the unchecked-`fetch` root cause.
- `docs/Bugs/wallet-service-deposit-withdrawal-limit-env-vars-are-dead-config.md` — the ₹10–₹100,000 Razorpay-path range is hardcoded in the Zod schema, not read from any env var despite `.env.example` suggesting otherwise.
