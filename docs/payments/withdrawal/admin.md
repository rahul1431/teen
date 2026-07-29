# Withdrawal — Admin

Finance page, **Withdrawals** tab (`admin-panel/src/pages/Finance.tsx`) and **Bank Details** tab — two separate tabs with no data linkage between them.

## Withdrawals tab

- `GET /api/admin/finance/withdrawals?status=` — lists `payment_orders WHERE type='withdrawal' AND status=$1` (default `created`), joined to username, max 100 rows, any authenticated admin can read (`{ onRequest: [authenticate] }` — no `requireRole`, though the mutating `PATCH` correctly requires `finance`).
- Status changed via a `<Select>` inline in the table row, opening a confirmation modal requiring a UTR reference (approve) or a reason (reject) — both enforced client-side before the request fires.
- The table's "UPI / Bank" column and the confirmation modal's "Destination" field render `metadata.account_number ? "<holder> · <bank> · <account> · <ifsc>" : (metadata.upi_id || metadata.bank_account || '-')` (`Finance.tsx`) — `/wallet/withdraw/request` now snapshots the caller's verified `bank_details` row into that metadata server-side at request time (found already fixed on this branch, not client-supplied), so the approving admin sees a real destination instead of `-` for every withdrawal.

## Bank Details tab

- `GET /api/admin/bank-details` — lists every user's bank account (holder name, bank name, account number, IFSC, UPI ID) joined with username/phone/email. Correctly `requireRole('finance')`-gated (fixed 2026-07-28 — previously required only `authenticate`, letting any admin role read unmasked bank details).
- `PATCH /api/admin/bank-details/:userId/verify` — correctly `finance`-role gated; flips `bank_details.verified`.
- Account numbers are masked in the table display (`v.replace(/\d(?=\d{4})/g, '*')`) — client-side only, the full number is present in the raw API response.

## Known issues

- Status transitions here used to be able to silently diverge from actual wallet state on a wallet-service failure — fixed 2026-07-28.
- The dead-but-reachable-if-misrouted duplicate of the bank-details routes with zero auth, previously sitting in `core-api-service`, was removed 2026-07-29 (admin-service's own gated routes are the only copy now).
