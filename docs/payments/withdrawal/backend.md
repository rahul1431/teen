# Withdrawal — Backend

Request route in `services/wallet-service/src/index.ts`; admin state machine in `services/admin-service/src/index.ts`.

## `POST /wallet/withdraw/request` (`wallet-service/src/index.ts:441-499`)

Player, JWT auth. `{ amount: 100–50000 }` — no client-supplied destination fields at all; the client cannot influence where the money goes.

Gates enforced, in order: `SELECT kyc_status FROM users WHERE id = $1` must equal `'approved'` (else 403); a `fraud:flagged:<userId>` Redis check (403 if flagged, enforced 2026-07-28); and a `SELECT ... FROM bank_details WHERE user_id = $1` lookup that requires a row to exist with `verified = true` (else 400 `Add and verify your bank details before withdrawing`) — no check of time-of-day (`docs/Bugs/withdrawal-hours-restriction-is-client-side-only.md`).

Then, in one transaction:
1. `SELECT real_balance FROM wallets WHERE user_id = $1 FOR UPDATE`.
2. If `real_balance < amount`: rollback, 400 `Insufficient balance`.
3. `UPDATE wallets SET real_balance -= amount, locked_balance += amount`.
4. `INSERT INTO payment_orders (..., type='withdrawal', status='created', metadata)` — `metadata` is a **server-side snapshot** of the verified `bank_details` row (`holder_name`, `bank_name`, `account_number`, `ifsc_code`, `upi_id`), not client input.
5. `INSERT INTO wallet_transactions (..., status='pending', idempotency_key: 'withdraw:<orderId>')` — logs the lock itself as a ledger row, separate from the `WalletService.lockForGame` path (this route builds its own transaction inline rather than calling a shared `WalletService` method for the lock).

No idempotency protection against a double-submit from the client: two rapid requests each acquire the `FOR UPDATE` lock in turn (they serialize, they don't race incorrectly against each other), but if the balance is sufficient for both, two independent withdrawal orders and two independent locks are created — the mobile client's `_submitting` flag (`wallet_page.dart:939`) is the only thing preventing this in practice.

## `PATCH /api/admin/finance/withdrawals/:id` (`admin-service/src/index.ts:616-764`)

Admin, `finance` role. `{ status: 'created'|'paid'|'refunded', reference?, reason? }`. A 6-way state machine over the 3 statuses (any→any except no-op same-status, which returns success immediately). Each transition calls a different wallet-service internal endpoint to actually move money:

| From → To | Wallet call | Effect |
|---|---|---|
| `created → paid` | `POST /internal/wallet/consume` | Locked funds consumed (spent/paid out) |
| `created → refunded` | `POST /internal/wallet/unlock` | Locked funds returned to `real_balance` |
| `paid → refunded` | `POST /internal/wallet/credit` (`manual_credit`) | Funds already consumed — re-credit `real_balance` directly |
| `refunded → paid` | `POST /wallet/debit/manual` | Funds already refunded — re-debit `real_balance` directly |
| `paid → created` | credit then `POST /internal/wallet/lock` | Restore to `real_balance`, then re-lock |
| `refunded → created` | `POST /internal/wallet/lock` | Funds already in `real_balance` — just re-lock |

**Fixed 2026-07-28**: every one of these 6 calls now goes through a shared `callWallet()` helper that checks `res.ok` and returns an error string on failure (network-level rejection or an explicit 4xx/5xx, e.g. insufficient balance for a debit). If any call fails, the handler returns a 502 immediately and skips the `payment_orders.status` update, the `wallet_transactions` status update, the audit log entry, and the user notification — previously all of those fired unconditionally even when the underlying money movement had silently failed. For the two-call `paid → created` transition (credit then lock), the second call only runs if the first succeeded, and both use per-order deterministic idempotency keys so a retried PATCH after a partial failure is safe.

Each idempotency key used for the re-credit/re-debit paths is deterministic per order id (`withdrawal_refund_paid_<id>`, `withdrawal_debit_refunded_<id>`, `withdrawal_restore_paid_<id>`) — so *retrying the same transition* is safe even though checking the *first* call's success is not currently done.

`meta.utr`/`meta.refund_reason` are set/cleared depending on the target status, stored back into `payment_orders.metadata` — this is the only place a payout reference is recorded; it is a freeform string typed by the admin, not a structured link to any actual bank transfer record.
