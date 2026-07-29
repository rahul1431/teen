# Finance — Backend

All in `services/admin-service/src/index.ts`. Every route requires `finance` role except the two `authenticate`-only reads noted below.

| Route | Role | Notes |
|---|---|---|
| `GET /finance/stats` | any | Platform fee (rake) collected today/30d from `game_rooms`, plus paid deposit/withdrawal totals today. |
| `GET /finance/withdrawals?status=` | any | `payment_orders WHERE type='withdrawal'`, joined to username, max 100. |
| `PATCH /finance/withdrawals/:id` | `finance` | 6-way state machine (`created`/`paid`/`refunded`, any→any). Each transition calls a different wallet-service internal endpoint (consume/unlock/credit/debit/lock) to actually move money — **none of these calls are checked for success before the DB is updated and the user notified, see Bugs.** Also updates the matching `wallet_transactions` row status and writes `admin_audit_log`. |
| `GET /finance/deposits` | `finance` | Filterable by status/gateway, paginated. |
| `PATCH /finance/deposits/:id` | `finance` | `mark_paid_and_credit` (also credits a recorded promo-code bonus into the bonus wallet if one was pending) or `mark_failed`. **Same unchecked wallet-call issue, worse ordering — DB is marked `paid` before the credit call even fires, see Bugs.** |
| `GET`/`PATCH` `/bank-details` | any / `finance` | User-submitted bank accounts; verify flips eligibility for withdrawals elsewhere in the app. |
| `POST /uploads/qr` | `finance` | Multipart upload for a payment method's QR image; validates extension (`.jpg/.jpeg/.png/.webp`), writes to `QR_UPLOAD_DIR` with a random filename. |
| `GET`/`POST`/`PATCH`/`DELETE` `/payment-methods` | `finance` (delete: `superadmin`) | Straightforward CRUD over `payment_methods`; delete is the one action bumped to superadmin. |
| `GET /finance/ledger` | `finance` | Raw `wallet_transactions` filtered by type/wallet/user/date range, paginated 50/page. |
| `GET /finance/reconciliation?days=` | any | Daily `payment_orders` totals by type+status, GGR (rake) trend, and totals by gateway — capped at 90 days. Shared with the Dashboard's GGR chart. |
| `GET /finance/tips` | any | Aggregates `wallet_transactions WHERE type='tip_dealer'` — today/week/all-time totals plus last 100. |

The money-movement reliability issue affecting withdrawals and deposits (a wallet-service call failure could previously be silently ignored) was fixed 2026-07-28.
