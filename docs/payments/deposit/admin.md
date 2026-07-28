# Deposit — Admin

Finance page, **Deposits** tab (`admin-panel/src/pages/Finance.tsx`, `finance`-role gated backend-side, no client-side hiding).

- Lists `payment_orders WHERE type='deposit'`, filterable by `status` and `gateway` (`razorpay` vs. `manual` — in practice this filter will only ever show `manual` rows populated, since the Razorpay path has no live traffic, see `docs/payments/razorpay-integration/`), paginated (`GET /api/admin/finance/deposits`).
- Each row action opens a confirmation modal: approve requires nothing beyond confirming (the UTR was already captured by the player at submit time and is shown for the admin to visually check against the screenshot), reject requires a reason. Underlying call is `PATCH /api/admin/finance/deposits/:id` with `action: mark_paid_and_credit | mark_failed`.
- The screenshot/proof (`screenshot_url`) is presumably rendered inline for the admin to visually verify against the claimed UTR and amount — this is the entire fraud-prevention mechanism for manual deposits; there is no automated matching against a bank statement or gateway record.

**Payment Methods** tab (same page) is where the destinations shown in the deposit sheet come from — see `docs/payments/wallet-ledger/admin.md`'s sibling coverage in `docs/admin-panel/finance/admin.md` for the full CRUD detail (`GET`/`POST`/`PATCH`/`DELETE /api/admin/payment-methods`, delete bumped to `superadmin`). `POST /api/admin/uploads/qr` handles the QR image upload for `method_type='qr'`.

## Known issues

- Both the deposit-approval and withdrawal-state-machine unchecked-wallet-call issues are fixed: deposit approval calls wallet-service and checks the response *before* marking `payment_orders` `'paid'` (aborts with a clear error otherwise), and the withdrawal state machine's 6 wallet calls (fixed 2026-07-28) now all check `res.ok` and abort the status transition on failure.
- `docs/Bugs/deposit-promo-used-count-race-allows-double-bonus.md` — an admin approving two racing deposit orders from the same user (each looking like an independent, legitimately-proofed deposit) can pay out a promo bonus twice.
