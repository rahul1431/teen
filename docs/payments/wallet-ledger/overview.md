# Wallet Ledger — Overview

The ledger is the money-of-record for the whole platform: every deposit, withdrawal, bet, win, bonus, referral reward, and admin adjustment ultimately becomes a row in `wallet_transactions` and a balance mutation on `wallets`. It lives entirely in `wallet-service` (`services/wallet-service/src/wallet.service.ts`, class `WalletService`) — kept as its own isolated PM2 process per root `CLAUDE.md` because it's the financial critical path. Every other service (`core-api-service`, `game-gateway`, `admin-service`) talks to it over HTTP with an `x-internal-key` header, never touching `wallets`/`wallet_transactions` directly — with two documented exceptions, see "Direct-write paths" below.

## The three balances

`wallets` (one row per user, `infra/db/migrations/001_initial.sql:69-79`):

- **`real_balance`** — withdrawable money: deposits, game winnings, manual admin credits.
- **`bonus_balance`** — non-withdrawable money: referral rewards, promo-code bonuses, daily bonuses. Play-only.
- **`locked_balance`** — real money temporarily held: funds locked for an in-progress bet/game, or a withdrawal request pending admin approval. Not spendable by the user in either state.

All three carry a `CHECK (>= 0)` constraint at the DB level — a second line of defense if application logic ever computes a negative balance. `total_deposited`/`total_withdrawn`/`total_won` are running totals maintained alongside `real_balance` for reporting (Finance/Reconciliation, player stats).

## The ledger primitives

Five operations in `WalletService`, all built on the same pattern — `SELECT ... FOR UPDATE` row lock, compute new balance, `INSERT INTO wallet_transactions ... ON CONFLICT (idempotency_key) DO NOTHING`, only mutate `wallets` if the insert actually landed a row:

| Operation | Effect | Used by |
|---|---|---|
| `credit` | `+amount` to `real_balance` or `bonus_balance` | deposits, game wins, manual credits, referral/promo bonuses |
| `debit` | `-amount` from `real_balance` or `bonus_balance` (throws `Insufficient balance`) | bet stakes (Matka/Lottery/Cricket), manual debits |
| `lockForGame` | `real_balance → locked_balance` | Teen Patti/Ludo/Aviator entry fees at game start / per bet |
| `unlockFunds` | `locked_balance → real_balance` (refund) | game cancellation, idle-room reaping, withdrawal rejection |
| `consumeLockedFunds` | `locked_balance` shrinks, money spent | game settlement (loser stakes), withdrawal approval |

`wallet_transactions.idempotency_key` is `UNIQUE NOT NULL` at the DB level (`infra/db/migrations/024_wallet_idempotency_unique.sql`), so the `ON CONFLICT DO NOTHING` pattern is a real guarantee, not just application-level discipline — a retried call with the same key is guaranteed to be a no-op rather than a race.

## What to read next

- `backend.md` — line-level detail of every ledger method and the routes that call them.
- `frontend.md` — the mobile Wallet page/transaction history that read this data.
- `admin.md` — the Finance page's Ledger and Reconciliation tabs, the only UI over raw `wallet_transactions`.

## Known issues

See `docs/Bugs/dealer-tip-idempotency-key-is-not-actually-idempotent.md` and `docs/Bugs/referral-reward-claims-real-balance-but-credits-bonus.md` for ledger-adjacent bugs. (A failed per-player `consumeLockedFunds` during settlement used to be able to strand money in `locked_balance` forever with no recovery path — fixed 2026-07-28 via an automatic reconcile sweep, see `docs/backend-services/game-gateway/backend.md`.) `docs/Bugs/users-page-debit-wallet-missing-request-id.md` covers a caller-side failure mode (no global Zod error handler here, so a malformed request to any of these routes throws a bare 500).
