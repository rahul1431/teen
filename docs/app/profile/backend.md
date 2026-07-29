# Profile — Backend

All in `services/core-api-service/src/plugins/users.ts` (auth required on every route below):

- **`GET /users/me`** — profile + wallet balances + `total_games`/`total_winnings` aggregates (subqueries over `game_participants`).
- **`PUT /users/me`** — partial update of `username`/`avatar_url`/`fcm_token`; builds its `SET` clause dynamically from only the fields present (no COALESCE-vs-null footgun here since it only ever appends fields that were actually provided, unlike the admin-panel PATCH bugs).
- **`POST /users/me/avatar`** — multipart upload, validates extension (`jpg`/`jpeg`/`png`/`webp`), writes to `AVATAR_UPLOAD_DIR`, updates `avatar_url` to a public `APP_URL/uploads/avatars/...` link (avatars are public, unlike KYC images which are proxied — see `docs/admin-panel/kyc/`).
- **`GET`/`PUT /users/me/bank`** — upsert via `ON CONFLICT (user_id) DO UPDATE`; the `PUT` unconditionally sets `verified = false` on every save (by design — any change requires re-verification), and returns "Pending admin verification."
- **`POST /users/kyc/submit`** — multipart, requires all three files (`aadhaar_front`, `aadhaar_back`, `selfie`) in the same request or rejects with 400; upserts one `kyc_documents` row per user (`ON CONFLICT (user_id)`) and resets `status = 'under_review'` + clears any prior `rejection_reason`; also mirrors status onto `users.kyc_status`.
- **`GET /users/kyc/status`** — joins `users.kyc_status` with the `kyc_documents` row (doc type, status, rejection reason, submitted/reviewed timestamps, and the three document URLs).

This file used to also define `GET /admin/bank-details` and `PATCH /admin/bank-details/:userId/verify` with **no `onRequest` auth hook at all** — byte-for-byte duplicates of the properly-gated (`authenticate` + `requireRole('finance')`) equivalents in `services/admin-service/src/index.ts`, unreferenced by any frontend. Removed 2026-07-29 rather than patched, since admin-service already owns this feature.
