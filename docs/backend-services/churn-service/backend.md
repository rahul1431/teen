# Churn Service — Backend

All routes and cron logic live in `services/churn-service/src/index.ts` and `services/churn-service/src/churn-scorer.ts`. No auth middleware of any kind is applied to any route in this service — every `/api/churn/*` endpoint is reachable by anyone who can reach port 3013 directly (mitigated in practice only by the VPS not exposing 3013 publicly; `admin-service` is the intended, RBAC-gated front door — see `docs/backend-services/churn-service/admin.md`).

## Cron job

`index.ts:23-38`. Schedule is derived, not fixed: it reads `cron_interval_minutes` from the `churn_config` table (default `60`) and builds a cron expression `0 */${Math.max(1, Math.floor(cfg.cron_interval_minutes / 60))} * * *`. With the default config this evaluates to `0 */1 * * *` — every hour, on the hour. Because the divisor floors to whole hours, any `cron_interval_minutes` value under 120 (e.g. `90`) collapses to the same hourly cadence as `60`; sub-hour intervals (e.g. `30`) are not representable — the config field name promises minute granularity but the actual schedule only moves in whole-hour steps.

The config is read **once at startup** to build the cron expression (`index.ts:25-34`) — if an admin later changes `cron_interval_minutes` via `PATCH /api/churn/config`, the running cron job does not pick up the new cadence; only a process restart re-derives the expression, since `cron.schedule` is called once and never re-registered.

In addition to the scheduled run, `runScoringCycle()` is invoked once immediately on process startup (`index.ts:136`, non-blocking, errors logged not thrown).

## `ChurnScorer.runScoringCycle()` — what one cycle does (`churn-scorer.ts:72-110`)

1. Loads current `ChurnConfig` via `getConfig()`.
2. Queries eligible users:
```sql
SELECT u.id, u.created_at, MAX(wt.created_at) AS last_deposit_at,
       COUNT(wt.id)::int AS total_deposits,
       COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '14 days' THEN 1 END)::int AS deposits_last_14,
       COUNT(CASE WHEN wt.created_at > NOW() - INTERVAL '28 days'
                   AND wt.created_at <= NOW() - INTERVAL '14 days' THEN 1 END)::int AS deposits_prior_14
FROM users u
JOIN wallet_transactions wt ON wt.user_id = u.id AND wt.type = 'deposit'
WHERE u.status = 'active' AND u.is_bot = false
  AND u.created_at < NOW() - INTERVAL '<grace_period_days> days'
GROUP BY u.id, u.created_at
HAVING COUNT(wt.id) > 0
```
Note this `JOIN` (not `LEFT JOIN`) plus `HAVING COUNT(wt.id) > 0` means users with **zero** deposits ever are never scored at all — they never enter `user_churn_scores`, regardless of how long they've been registered. Churn scoring only covers players who deposited at least once. `wt.type = 'deposit'` is not further filtered by `status = 'completed'` here (contrast with `churn-ml-service`'s equivalent query, `main.py:43`, which does filter on `wt.status = 'completed'`) — pending/failed deposit rows can count toward `total_deposits`/recency in this service's heuristic path even though they wouldn't in the ML feature set.
3. For each eligible user, calls `scoreAndActOnUser()` (below), catching and logging per-user errors so one bad row doesn't abort the whole cycle.

## Scoring a single user (`churn-scorer.ts:112-199`)

- Computes `daysSinceDeposit` from `last_deposit_at`.
- **Primary path — ML delegation**: `POST http://127.0.0.1:3020/predict` with `{ user_id: user.id }`, 2000ms timeout (`churn-scorer.ts:123`). This is `churn-ml-service`'s `/predict` route (see `docs/backend-services/churn-service/overview.md` for why this URL is hardcoded rather than env-driven). On success (`mlResponse.data.churn_risk` is a number), `totalScore = Math.round(churn_risk)` and `riskLevel = mlResponse.data.risk_level` are taken verbatim from the ML response.
- **Fallback path — heuristic** (only runs if the ML call throws or returns a non-numeric `churn_risk`, e.g. `churn-ml-service` down, timed out, or returned its 404 "user not found" case):
  - Inactivity score (0–70): 0 below `low_threshold_days`; linearly interpolated 30→60 between `low_threshold_days` and `medium_threshold_days`; linearly interpolated 60→70 between `medium_threshold_days` and `high_threshold_days`; flat 70 at/above `high_threshold_days`.
  - Frequency-drop score (0–30): if deposits in the last 14 days are lower than the prior 14-day window, `dropRate * 30` where `dropRate = (deposits_prior_14 - deposits_last_14) / deposits_prior_14`. Zero if `deposits_prior_14` is 0 (no baseline to compare against).
  - `totalScore = min(round(inactivity + frequency), 100)`; `riskLevel` thresholds: `>=80` high, `>=60` medium, `>=30` low, else `none`.
- Upserts `user_churn_scores` (`user_id, score, risk_level, days_since_deposit, last_deposit_at, updated_at`) keyed on `user_id` (`ON CONFLICT (user_id) DO UPDATE`).
- **Auto re-engagement**: skipped entirely for `none`/`low`. For `medium`/`high`, first atomically acquires a Redis cooldown lock: `SET churn:action_sent:<userId> 1 EX <action_cooldown_days*86400> NX` (`churn-scorer.ts:189`). If the key already exists (`NX` fails), the user is skipped — cooldown still active from a prior action. If acquired, calls `reEngageUser(userId, sendBonus, sendNotification, cfg)` with `sendBonus=true` only for `high`; `medium` gets notification-only. The cooldown key is set **before** the re-engagement side effects run and is not rolled back if those side effects fail — so a failed bonus/notification (e.g. a transient `wallet-service`/`core-api-service` outage) still burns the full `action_cooldown_days` (default 7) cooldown window for that user. Not addressed by the 2026-07-29 auth/schema fix below — a separate, deliberate scope decision, since it's a design tradeoff (short retry-backoff vs. the current full cooldown) rather than a straightforward bug.

## `reEngageUser()` (`churn-scorer.ts:203-276`)

Called both internally (from the cycle, with `cfg` pre-loaded — skips the cooldown check since the caller already holds the NX lock) and externally (from `POST /api/churn/re-engage/:userId`, `cfg` omitted — re-checks `churn:action_sent:<userId>` in Redis and throws `'Action cooldown active'` if set, then sets the cooldown key itself after running).

1. Verifies the user exists in `user_churn_scores` (`SELECT id FROM user_churn_scores WHERE user_id = $1`) — throws `'User not in churn risk list'` if not, meaning re-engagement can only target users who have already been through at least one scoring cycle.
2. If `sendBonus`: `POST {WALLET_SERVICE_URL}/internal/wallet/credit` with body `{ user_id, amount: cfg.high_bonus_amount, type: 'bonus', idempotency_key: 'churn_reengagement_<userId>_<UTC date>', description: 'Re-engagement bonus' }` and an `x-internal-key` header (fixed 2026-07-29 — previously sent `userId`/`reference` with no auth header at all, matching neither `wallet-service`'s required header nor its zod body schema, so this call always 403'd). The idempotency key is day-bucketed rather than timestamped so a retry within the same call is deduped against `wallet-service`'s `ON CONFLICT (idempotency_key) DO NOTHING`, while the next legitimate re-engagement cycle — which can't happen for `action_cooldown_days` (default 7) — still gets a fresh key. On success, sets `user_churn_scores.action_taken = 'bonus_credited'`.
3. If `sendNotification`: `POST {NOTIFICATION_SERVICE_URL}/internal/notifications/send` with body `{ user_id, title: 'We miss you! 🎮', body: <bonus-aware copy>, type: 'reengagement' }` and the same `x-internal-key` header (fixed 2026-07-29 — previously sent `userId` instead of the `user_id` this endpoint actually destructures, on top of the same missing header, so even bypassing auth would have inserted the notification row with a null `user_id`). On success, sets `action_taken` to `'notification'` or `'bonus+notification'` depending on whether the bonus step succeeded first.
4. Both steps are wrapped in independent `try`/`catch` — a failure in one does not block the other, and failures are only logged, never surfaced to the HTTP caller (`POST /api/churn/re-engage/:userId` always returns `200 { success: true }` regardless of whether the bonus/notification actually landed).

## HTTP routes (`index.ts`)

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/health` | inline | `{ success: true, data: { status: 'ok', service: 'churn-service', timestamp } }` |
| GET | `/api/churn/users` | inline, queries `user_churn_scores` joined to `users` | Query params: `risk_level` (`low`/`medium`/`high` only — validated against a whitelist; anything else is silently ignored and the filter is dropped), `limit` (default 50, clamped to 200 via `Math.min`), `offset` (default 0). `limit`/`offset` are string-interpolated directly into the SQL (`LIMIT ${limit} OFFSET ${offset}`, `index.ts:71`) rather than parameterized — safe here only because both are passed through `parseInt` first, but it's a different pattern from the parameterized `risk_level` filter on the same query. Returns `{ users: [...], count }`, each row: `id, username, phone, score, risk_level, days_since_deposit, last_deposit_at, action_taken, action_taken_at, updated_at`. |
| GET | `/api/churn/stats` | `scorer.getStats()` | Runs a single aggregate query over `user_churn_scores`: `low_count`, `medium_count`, `high_count` (each `COUNT(*) FILTER (WHERE risk_level = ...)`), and `actions_today` (`COUNT(*) FILTER (WHERE action_taken IS NOT NULL AND action_taken_at > NOW() - INTERVAL '1 day')`) — a single combined counter, not split by bonus vs. notification. See `docs/backend-services/churn-service/admin.md` for the shape mismatch this creates against the admin-panel UI. |
| POST | `/api/churn/re-engage/:userId` | `scorer.reEngageUser(userId, send_bonus, send_notification)` | Body `{ send_bonus?: boolean, send_notification?: boolean }` (`send_notification` defaults to `true`, `send_bonus` defaults to `false`). No role check at this layer — RBAC is enforced one hop up in `admin-service` (`support` role required, see admin.md). |
| GET | `/api/churn/config` | `scorer.getConfig()` | Reads all rows from `churn_config`, returns typed defaults for any missing key (see below). |
| PATCH | `/api/churn/config` | `scorer.updateConfig(body)` | Body is `Record<string, string>` — any key/value pairs are upserted into `churn_config` via `INSERT ... ON CONFLICT (key) DO UPDATE`. Keys in a fixed numeric whitelist (`low_threshold_days`, `medium_threshold_days`, `high_threshold_days`, `high_bonus_amount`, `action_cooldown_days`, `grace_period_days`, `cron_interval_minutes`) are validated with `parseInt` and rejected (`throw`) if non-numeric; **any other key name is accepted and persisted with no validation at all** — `updateConfig` will happily insert arbitrary rows into `churn_config` for typos or unrecognized keys, which then sit unused since `getConfig()` only reads the seven known keys. `updated_by` (present in the `churn_config` schema, `infra/db/migrations/015_churn.sql:24`) is never set — no admin-user attribution is recorded for config changes. |

## Config shape (`ChurnConfig`, `churn-scorer.ts:11-19`)

Backed by `churn_config` (key/value rows, `infra/db/migrations/015_churn.sql:21-36`), seeded with: `low_threshold_days=3`, `medium_threshold_days=7`, `high_threshold_days=14`, `high_bonus_amount=50`, `action_cooldown_days=7`, `grace_period_days=3`, `cron_interval_minutes=60`. `getConfig()` parses every value with `parseFloat` and falls back to these same defaults for any missing key, so a partially-seeded table never breaks the service.

## Database tables

- **Reads**: `users` (id, created_at, status, is_bot), `wallet_transactions` (user_id, type, created_at, filtered to `type = 'deposit'`), `churn_config`.
- **Writes**: `user_churn_scores` (upsert per scoring cycle; `action_taken`/`action_taken_at` updated by `reEngageUser`), `churn_config` (via `PATCH /api/churn/config`).
- Does **not** write to `wallet_transactions` or `notifications` directly — those are owned by `wallet-service` and `core-api-service` respectively, reached only via the internal HTTP calls described above.

## Downstream call summary

| Call | Target | Auth sent | Purpose |
|---|---|---|---|
| `POST /predict` | `churn-ml-service` (hardcoded `http://127.0.0.1:3020`) | none (endpoint is unauthenticated anyway) | Primary churn-risk prediction |
| `POST /internal/wallet/credit` | `wallet-service` (`WALLET_SERVICE_URL`) | `x-internal-key` (fixed 2026-07-29) | Re-engagement bonus credit |
| `POST /internal/notifications/send` | `core-api-service` (`NOTIFICATION_SERVICE_URL`) | `x-internal-key` (fixed 2026-07-29) | Re-engagement push/in-app notification |
