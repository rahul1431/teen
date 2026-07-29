# Churn Service — Admin-panel touchpoints

## UI surface

Churn data is surfaced in exactly one place: the **"Churn Intelligence" tab** of the AI Control Center, rendered by `admin-panel/src/components/AI/ChurnTab.tsx` (238 lines), embedded inside `AIControlCenter.tsx`. There is no standalone routed page for churn — full frontend detail (stats bar, at-risk user table, threshold-config form, per-user re-engage buttons) is already documented in `docs/admin-panel/ml-churn-bot-learning/frontend.md`; this file focuses on the API contract and RBAC between the admin panel and this service, not the component internals.

## Bridge: `admin-service/src/churn-routes.ts`

`services/admin-service/src/churn-routes.ts` is a pure proxy — every route builds an `axios` call to `churn-service` (`CHURN_URL = process.env.CHURN_SERVICE_URL || 'http://localhost:3013'`) and forwards the response or error straight back to the admin-panel caller (`err.response?.status ?? 500`, `err.response?.data ?? { success: false, error: 'Churn service unavailable' }`). It holds no churn state of its own — no Postgres queries, no caching. Mounted via `registerChurnRoutes(app, authenticate, requireRole)` at `services/admin-service/src/index.ts:75`.

| Admin-panel call (`adminApi`, base `/api/admin`) | admin-service route | RBAC | Proxies to |
|---|---|---|---|
| `GET /churn/users` | `GET /api/admin/churn/users` | `authenticate` only — any logged-in admin role | `GET {CHURN_URL}/api/churn/users` (query params forwarded verbatim) |
| `GET /churn/stats` | `GET /api/admin/churn/stats` | `authenticate` only | `GET {CHURN_URL}/api/churn/stats` |
| `POST /churn/re-engage/:userId` | `POST /api/admin/churn/re-engage/:userId` | `authenticate` + `requireRole('support')` | `POST {CHURN_URL}/api/churn/re-engage/:userId` (body forwarded) |
| `GET /churn/config` | `GET /api/admin/churn/config` | `authenticate` only | `GET {CHURN_URL}/api/churn/config` |
| `PATCH /churn/config` | `PATCH /api/admin/churn/config` | `authenticate` + `requireRole('superadmin')` | `PATCH {CHURN_URL}/api/churn/config` (body forwarded) |

This matches `docs/admin-panel/ml-churn-bot-learning/admin.md`: re-engage requires `support`, config writes require `superadmin`; the two GET routes (users list, stats) and config *read* have no role gate beyond being logged in — any admin role (including the lowest-privilege ones) can view the full at-risk user list with usernames/phone numbers and current risk scores. There is no client-side role hiding on the re-engage buttons or the config form either — a non-`support`/`non-superadmin` admin sees the controls and only discovers the gate when the underlying `POST`/`PATCH` call 403s.

`churn-service` itself performs **no authentication or authorization on any of its own routes** (see `docs/backend-services/churn-service/backend.md`) — all RBAC enforcement for admin access happens at this proxy layer in `admin-service`, not in `churn-service`. Anything that can reach `churn-service`'s port 3013 directly (e.g. another process on the same VPS) bypasses this RBAC entirely.

## Known contract mismatch: stats shape

The admin-panel's `ChurnStats` interface (`ChurnTab.tsx:18-27`) expects:
```ts
{ total_at_risk: number, by_level: { low: number, medium: number, high: number }, bonuses_sent_today: number, notifications_sent_today: number }
```
but `churn-service`'s `GET /api/churn/stats` (backed by `ChurnScorer.getStats()`, `churn-scorer.ts:278-289`) actually returns:
```ts
{ low_count, medium_count, high_count, actions_today }
```
None of the field names match, and there's no `by_level` nesting or bonus/notification split on the backend at all. See `docs/Bugs/churn-service-admin-stats-field-mismatch.md` — every tile in the ChurnTab stats bar (Total At-Risk, Low/Medium/High Risk, Bonuses Sent Today, Notifications Sent Today) always renders `0` because every field access resolves to `undefined` and falls through the `?? 0` default.

## Config write semantics

`PATCH /api/admin/churn/config` forwards `admin-panel`'s body straight through. `ChurnTab.saveConfig()` (`ChurnTab.tsx:83-92`) stringifies every field (`String(v)`) before sending, matching `churn-service`'s `updateConfig()` expectation of `Record<string, string>` values (`churn-scorer.ts:52`) — this part of the contract is correct and intentional (per `docs/admin-panel/ml-churn-bot-learning/frontend.md`'s note that the config store expects strings even for conceptually-numeric fields).

## Re-engagement from the admin panel

Clicking "Notify" or "Bonus + Notify" in `ChurnTab.tsx:94-103` calls `POST /api/admin/churn/re-engage/:userId` with `{ send_bonus, send_notification: true }`. Both buttons report success (`message.success(...)`) unconditionally on a `200` response — which `churn-service` always returns for this route regardless of whether the downstream wallet-credit/notification calls actually succeeded (see `docs/backend-services/churn-service/backend.md`). Before 2026-07-29 those downstream calls always failed (missing auth header, plus a body-schema mismatch) — an admin clicking "Bonus + Notify" saw a success toast even though nothing landed. Both calls are fixed now, so a `200` here reflects reality again, but the route's own error-swallowing (any future downstream failure still reports success) is unchanged.
