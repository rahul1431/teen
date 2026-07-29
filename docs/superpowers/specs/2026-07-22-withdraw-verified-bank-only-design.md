# Withdrawal: lock payout to verified bank details

Date: 2026-07-22

## Problem

The app's Withdraw sheet (`mobile/lib/features/wallet/wallet_page.dart`, `_WithdrawSheet`)
currently lets the user type a UPI ID and/or bank account + IFSC by hand for every
withdrawal request, and the backend (`POST /wallet/withdraw/request` in
`services/wallet-service/src/index.ts`) accepts those as free-text fields
(`bank_account`, `upi_id`) and stores whatever the client sent. This is separate
from the bank account the user already saves and gets verified under Profile →
Bank Details (`GET/PUT /api/users/me/bank`, `bank_details` table).

Net effect: a user (or a tampered client) can send a withdrawal to any account,
verified or not, regardless of what admin has approved.

## Scope

Single bank account per user — the existing `bank_details` model (one row per
`user_id`, enforced by `ON CONFLICT (user_id)`) is unchanged. No new tables or
migrations. This is a UI + API enforcement change only.

Out of scope: multiple bank accounts per user, admin verification workflow,
KYC gating (stays as-is), deposit flow.

## Design

### 1. Mobile — `_WithdrawSheet`

On sheet open, fetch `GET /api/users/me/bank` and render one of three states:

- **No bank details saved** (`bank == null`): show a card — "Add your bank
  details to withdraw" — with a button that pushes `BankDetailsPage`. Amount
  field and submit button are disabled.
- **Saved but not verified** (`bank.verified == false`): show a card — "Your
  bank details are pending verification" (same tone as the existing pending
  badge on `BankDetailsPage`). Amount field and submit button are disabled.
- **Verified** (`bank.verified == true`): show a read-only info card with
  holder name, bank name, masked account number (e.g. `••••1234`, last 4
  digits visible), and IFSC. This is the payout destination — there is nothing
  to pick since only one account exists. Amount field and submit are enabled.

Remove the `_upiCtrl` and `_bankCtrl` text controllers and their `TextField`s
entirely. The request body sent to `/api/wallet/withdraw/request` becomes just
`{ amount }` — no payout fields from the client.

The existing KYC-required dialog/flow and the 10 AM–9 PM withdrawal window gate
are unchanged and layer on top of the above states (KYC dialog still fires from
the 403 error path; the window gate still disables submit outside hours).

### 2. Backend — `POST /wallet/withdraw/request`

- Drop `bank_account` and `upi_id` from the Zod request schema — only `amount`
  is accepted.
- Look up the `bank_details` row for `req.user.sub`. If none exists or
  `verified != true`, return `400` with an error message the mobile client can
  show directly, e.g. `"Add and verify your bank details before withdrawing"`.
- Snapshot the verified row's `holder_name`, `bank_name`, `account_number`,
  `ifsc_code`, `upi_id` into the withdrawal order's stored payout JSON (the
  same field admin already reads for existing withdrawal requests), replacing
  the previous client-supplied `{ bank_account, upi_id }` shape.

### Error handling

- Missing/unverified bank on withdraw attempt: 400 from backend (defense in
  depth — mobile already disables submit in this state, but the API must not
  trust the client).
- Existing error handling for amount validation (min ₹100), KYC gate (403), and
  the withdrawal time window is untouched.

## Testing

- Manual: no bank saved → sheet shows add-bank CTA, submit disabled.
- Manual: bank saved, unverified → sheet shows pending card, submit disabled.
- Manual: bank saved, verified → sheet shows masked account info, submit
  works, request body contains only `amount`.
- Manual: direct API call to `/api/wallet/withdraw/request` with a fabricated
  `bank_account`/`upi_id` in the body confirms the fields are ignored and the
  server-side verified account is used instead.
- Manual: direct API call with no verified bank on file returns 400 with the
  expected error message.
