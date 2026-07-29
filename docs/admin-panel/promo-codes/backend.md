# Promo Codes — Backend

In `services/admin-service/src/index.ts` (~lines 2325-2387), all mutations `requireRole('finance')`, list is any authenticated admin.

- **`GET /promo-codes`** — all rows, newest first.
- **`POST /promo-codes`** — full Zod validation (code min 3/max 50 chars, auto-uppercased, discount type enum, positive discount value, non-negative min deposit, integer usage limits, per-user default 1, active default true).
- **`PUT /promo-codes/:id`** — **no Zod validation** (`req.body as any`, still true). All 10 fields are now `COALESCE`'d against the existing row (fixed 2026-07-28) — previously `description`/`max_discount`/`usage_limit`/`expires_at` were set unconditionally, so the Active toggle (which only sends `is_active`) silently wiped a promo's cap/limit/expiry every time it was flipped.
- **`DELETE /promo-codes/:id`** — hard delete.

Where redemption actually happens (presumably `core-api-service`'s deposit flow, checking `min_deposit`/`usage_limit`/`per_user_limit`/`expires_at`/`is_active`) is outside admin-service — check `services/core-api-service/src/helpers/` or the deposit plugin if tracing end-to-end behavior.
