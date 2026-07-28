# Deposit — Backend

Player-facing routes in `services/wallet-service/src/index.ts`; admin approval routes in `services/admin-service/src/index.ts`.

## `GET /wallet/deposit/methods` (`index.ts:253-261`)

Player, JWT auth. Returns active `payment_methods` rows (`is_active = true`), ordered by `sort_order`. No amount context passed in — the client fetches all active methods and applies their individual `min_amount`/`max_amount` at submit time.

## `POST /wallet/promo/validate` (`index.ts:263-309`)

Player, JWT auth. `{ code, amount }`. Looks up `promo_codes` (active, not expired, under global `usage_limit`), checks the amount against `min_deposit`, checks the caller's own usage count against `per_user_limit` via `promo_code_usages`. Computes `discount_amount`/`bonus_amount` (percent-of-amount or fixed, capped by `max_discount`, rounded to 2dp). **Read-only** — does not insert into `promo_code_usages` or touch `used_count`. Pure preview.

## `POST /wallet/deposit/submit` (`index.ts:313-408`) — the live deposit path

Player, JWT auth, multipart body. Streams the proof file to `UPLOAD_DIR` (`/opt/teen/uploads/deposits` by default, served by nginx at `/uploads/`), validating extension against `.jpg/.jpeg/.png/.webp/.pdf` — 8MB limit enforced at the Fastify `multipart` plugin level (`index.ts:91`).

Validation order:
1. `amount >= 1` and `referenceNumber` (UTR) non-empty — else 400.
2. If `payment_method_id` given: re-check the method exists, is active, and `amount` is within its `min_amount`/`max_amount` — else 400. (If no method ID is given, this check is skipped entirely — the field is optional in the multipart body.)
3. If `promo_code` given: full independent server-side re-validation and re-computation of the bonus (never trusts a client-supplied number) — see `docs/Bugs/deposit-promo-used-count-race-allows-double-bonus.md` for the concurrency gap in the usage bookkeeping that follows.

Inserts `payment_orders` (`gateway='manual'`, `type='deposit'`, `status='created'`, `reference_number`, `screenshot_url`, `payment_method_id`, `metadata: { submitted_at, promo_code, promo_bonus }`). **Does not touch the wallet at all** — the balance only changes once an admin approves it. Promo usage bookkeeping (insert into `promo_code_usages`, increment `promo_codes.used_count`) happens here, at submit time, wrapped in its own try/catch marked non-fatal — a failure here doesn't fail the deposit submission, it just silently skips recording the promo usage.

## `PATCH /api/admin/finance/deposits/:id` (`admin-service/src/index.ts:788-856`) — the credit path

Admin, `finance` role. Two actions:

- **`mark_paid_and_credit`**: guards against double-approval of the *same* order (`if (status === 'paid') return 400`), then calls `POST /wallet/deposit/manual` with `request_id: id` (the order's own id — deterministic, so a retried admin-panel request after a network blip is idempotent rather than double-crediting) and checks the response *before* updating `payment_orders` to `'paid'`, aborting with a 502 if the credit call failed. Then, if `metadata.promo_bonus > 0`, a second `POST /internal/wallet/credit` for the bonus wallet, keyed `promo_bonus:<orderId>` (also idempotent per order — but see the Bugs entry on how a promo race can produce two separate orders each carrying their own bonus).
- **`mark_failed`**: `UPDATE payment_orders SET status='failed'`, no wallet call — safe, since nothing was ever credited.

Both actions write `admin_audit_log` and fire a push notification (`NOTIFICATION_URL/internal/notifications/send`, fire-and-forget `.catch(() => null)`) regardless of whether the preceding wallet call actually succeeded.

## Razorpay path

See `docs/payments/razorpay-integration/backend.md` — `POST /wallet/deposit/create-order` and `POST /wallet/deposit/verify` live in the same file but are unreferenced by any client.
