# Deposit — Frontend (Mobile)

`_DepositSheet` in `mobile/lib/features/wallet/wallet_page.dart`.

1. Fetches `GET /api/wallet/deposit/methods` and renders each as a `ChoiceChip`.
2. On selecting a UPI method: shows either the admin-uploaded QR image, or, if none was uploaded, a client-generated `QrImageView` built from a `upi://pay?pa=<upi_id>&am=<amount>` URI (`wallet_page.dart:440-443`). This is deliberately rendered as a scannable QR image rather than fired as a `upi://` deep link — an in-source comment explains that UPI apps' fraud heuristics tend to block intent-link collect requests to a VPA with no prior payer history, so a plain QR scan sidesteps that check. "Download QR Code" saves either image to the device gallery via the `gal` package.
3. A promo code field calls `POST /api/wallet/promo/validate` live (debounced against the amount field) to preview the bonus before submitting — this preview number is not trusted server-side; `POST /wallet/deposit/submit` re-computes it independently (see `deposit/backend.md`).
4. Final submit is multipart: `amount`, `payment_method_id`, `reference_number` (UTR), a required screenshot, optional `promo_code`. On success, shows a message that differs depending on whether a promo bonus was recorded ("₹X bonus will be added on approval" vs. a plain "submitted for review" message) — both taken verbatim from the API response, not computed client-side.

No visible submit-guard (disable-while-in-flight) was found on this sheet in the reviewed code — contrast with `_WithdrawSheet`, which explicitly sets `_submitting` to disable its button during the request (`wallet_page.dart:939`, `docs/app/wallet-client/mobile.md`). A fast double-tap on deposit submit is still the most plausible real-world trigger for two racing requests, but the server-side promo double-bonus race that could result from it is now closed (fixed 2026-07-29, see `deposit/backend.md`) — a client-side submit-guard would still be a good UX addition, just no longer a money-integrity gap.

Razorpay: `AppConfig.razorpayKeyId` (`mobile/lib/core/constants/app_config.dart:11-13`, a `String.fromEnvironment('RAZORPAY_KEY_ID')`) exists but is never read anywhere in `mobile/lib` outside its own declaration — no screen calls `create-order` or `deposit/verify`. See `docs/payments/razorpay-integration/frontend.md`.
