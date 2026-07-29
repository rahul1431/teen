# Withdrawal — Frontend (Mobile)

`_WithdrawSheet` in `mobile/lib/features/wallet/wallet_page.dart:833-961`, plus `mobile/lib/features/profile/bank_details_page.dart`.

## Withdraw sheet

- Loads the player's bank details on open (`GET /api/users/me/bank`) to show a masked account or prompt the player to add one / wait for verification.
- Client-side gates before allowing submit: amount `>= ₹100`; `_bankVerified` (`_bank!['verified'] == true`); a **10 AM–9 PM device-local-time window** (`_withdrawOpen`, explicitly commented in-source as "UI-only gate" — `docs/Bugs/withdrawal-hours-restriction-is-client-side-only.md`).
- `_submit()` only ever sends `{ 'amount': amount }` (`wallet_page.dart:941-943`) — it doesn't need to send the bank account or UPI ID it just displayed: the backend derives the payout destination itself from the caller's verified `bank_details` row server-side (`withdrawal/backend.md`), so the client showing the same account is a redundant-but-correct UX confirmation, not the actual source of truth.
- On a 403 whose error message contains `"kyc"` (case-insensitive), shows a dedicated "KYC Required" dialog with a shortcut into `KycPage`, instead of a generic error snackbar — a deliberately better UX for the most common rejection reason.
- `_submitting` flag disables the submit button for the duration of the request — the one client-side double-submit guard on this flow (contrast with the deposit sheet, see `deposit/frontend.md`).

## Bank Details page (`bank_details_page.dart`)

`GET`/`PUT /api/users/me/bank`. Shows a "Verified" / "Pending verification" badge. Saving **always resets local state to `_verified = false`** immediately after a successful save (`bank_details_page.dart:76-79`) — matching the backend, which resets `bank_details.verified` to `false` on any edit (`core-api-service/src/plugins/users.ts:255`) so a changed account always requires re-verification before the next withdrawal can be requested from the UI. Validates account number (`^\d{6,20}$`) and IFSC (`^[A-Za-z]{4}0[A-Za-z0-9]{6}$`) format client-side before submitting; the backend's own validation was not independently re-verified in this pass.
