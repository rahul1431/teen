# Withdrawal — Admin

Finance page, **Withdrawals** tab (`admin-panel/src/pages/Finance.tsx`) and **Bank Details** tab — two separate tabs with no data linkage between them.

## Withdrawals tab

- `GET /api/admin/finance/withdrawals?status=` — lists `payment_orders WHERE type='withdrawal' AND status=$1` (default `created`), joined to username, max 100 rows, any authenticated admin can read (`{ onRequest: [authenticate] }` — no `requireRole`, though the mutating `PATCH` correctly requires `finance`).
- Status changed via a `<Select>` inline in the table row, opening a confirmation modal requiring a UTR reference (approve) or a reason (reject) — both enforced client-side before the request fires.
- The table's "UPI / Bank" column and the confirmation modal's "Destination" field both render `metadata.upi_id || metadata.bank_account || '-'` (`Finance.tsx:138,177`) — since the shipped mobile app never sends either field (see `withdrawal/frontend.md`), **this will show `-` for every real withdrawal request**, giving the approving admin no system-surfaced destination at all. In practice an admin must separately open the Bank Details tab and search for the same user to find where to actually send money — a manual, unlinked, error-prone step. See `docs/Bugs/withdrawal-destination-account-never-recorded-or-verified-server-side.md`.

## Bank Details tab

- `GET /api/admin/bank-details` — lists every user's bank account (holder name, bank name, account number, IFSC, UPI ID) joined with username/phone/email. Correctly `requireRole('finance')`-gated (fixed 2026-07-28 — previously required only `authenticate`, letting any admin role read unmasked bank details).
- `PATCH /api/admin/bank-details/:userId/verify` — correctly `finance`-role gated; flips `bank_details.verified`.
- Account numbers are masked in the table display (`v.replace(/\d(?=\d{4})/g, '*')`) — client-side only, the full number is present in the raw API response.

## Known issues

- `docs/Bugs/withdrawal-destination-account-never-recorded-or-verified-server-side.md` (new, this pass) — no system link between a withdrawal order and the verified bank account it should be paid to.
- Status transitions here used to be able to silently diverge from actual wallet state on a wallet-service failure — fixed 2026-07-28.
- `docs/Bugs/duplicate-unauthenticated-bank-details-routes.md` — a dead-but-reachable-if-misrouted duplicate of the bank-details routes with zero auth, sitting in `core-api-service`.
