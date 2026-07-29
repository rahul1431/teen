# admin-service — Backend

## RBAC / permission model

Defined entirely in `index.ts` lines 34-69, shared by every route in the service (including the four satellite files, which receive `authenticate`/`requireRole` as function parameters rather than importing them).

```ts
const ROLES = ['readonly', 'support', 'finance', 'superadmin'] as const
const ROLE_INDEX: Record<Role, number> = { readonly: 0, support: 1, finance: 2, superadmin: 3 }
function hasRole(actual, required) { return ROLE_INDEX[actual] >= ROLE_INDEX[required] }
```

Roles are a strict linear hierarchy (index comparison, not a permission-bitmask/ACL system) — `finance` implicitly has everything `support` and `readonly` have, `superadmin` has everything. There is no per-permission granularity (e.g. no way to grant "wallet credit but not KYC review" without also granting the whole `finance`/`support` tier); the full role-by-role capability breakdown lives in `docs/admin-panel/admin-users/overview.md`, not repeated here.

Two Fastify decorators, built once in `start()` and reused everywhere:
- **`authenticate`** (`onRequest: [authenticate]`) — `await req.jwtVerify()`, catches and 401s on failure. Verifies the JWT signature and expiry only.
- **`requireRole(role)`** (a factory: `onRequest: [authenticate, requireRole('finance')]`) — reads `req.user.role` (decoded straight from the JWT payload) and calls `hasRole`. 403s with `Forbidden — requires ${role} role` on failure.

**Critical property: neither ever re-queries `admin_users`.** The JWT is signed once at login (`app.jwt.sign({ sub, username, role }, { expiresIn: '8h' })`, `POST /auth/login`) and its `role` claim is trusted for the JWT's full 8-hour lifetime. A role change or `is_active = false` via `PATCH /admin-users/:id` has no effect on an already-issued token — see `docs/Bugs/admin-deactivation-does-not-revoke-active-sessions.md` for the incident-response implication. This is a property of `authenticate`/`requireRole` themselves, so it applies uniformly across all ~165 routes, not just admin-user management.

**Coverage is consistent almost everywhere** — every mutating route across `index.ts`'s ~135 routes pairs `authenticate` with an appropriate `requireRole(...)` (`support` for status/notes/KYC/tickets/CMS, `finance` for wallet/payment/betting-settlement writes, `superadmin` for admin-user/role/game-config/payment-method-delete/bot-create/APK-upload). The two documented exceptions are both in the satellite files:
- **`ml-routes.ts`** — `registerMLRoutes` isn't even passed a `requireRole` parameter (only `authenticate`), so `POST /ml/config` (rewrites fraud-detection/churn-prediction/bot-settings/RTP-optimizer thresholds platform-wide) and `POST /ml/query` are reachable by a `readonly` admin.
- **`monitor-routes.ts`** — deliberately read-only by design (per its own top-of-file comment) except `POST /monitor/alerts/:id/ack`, which is also only `authenticate`.

Both are tracked in `docs/Bugs/ai-control-center-missing-role-gates.md`; full per-route detail in `docs/admin-panel/ai-control-center/backend.md`. A couple of smaller, lower-stakes gaps exist too but weren't judged worth a separate bug filing: the `game_emojis` CRUD (`POST`/`PATCH`/`DELETE /api/admin/emojis`, `index.ts` ~2089-2122) is `authenticate`-only with no role tier, and `GET /api/admin/bank-details` (index.ts ~2535) returns every user's unmasked account number/IFSC/UPI to any authenticated role even though the corresponding `PATCH .../verify` requires `finance` — both are consistent with this service's general pattern of gating reads loosely and writes tightly, but the emoji routes are the one place a *write* isn't role-gated at all outside the two ML/monitor cases above.

## Audit log

**Schema** (`admin_audit_log`, `infra/db/migrations/001_initial.sql`): `id UUID`, `admin_id UUID REFERENCES admin_users(id)`, `action VARCHAR(100)`, `target_type VARCHAR(50)`, `target_id UUID`, `details JSONB`, `ip_address INET`, `created_at TIMESTAMPTZ`.

**Write pattern**: there is no shared helper — all 18 insert call sites in `index.ts` are hand-written `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES (...)` statements immediately following the mutation they log (2FA enable/disable, admin create/update/password-reset, user status/credit/debit/password-reset/KYC/notes, withdrawal/deposit status changes, payment-method create/update/delete, risk-flag, ticket updates). `action` is a free-text string per call site (e.g. `'credit_wallet'`, `'kyc_${status}'`, `'withdrawal_${newStatus}'`) — there's no enum or constant list, so consistency depends on each call site being written correctly by hand. `details` is whatever JSON each call site chooses to pass (often the raw parsed request body).

**What's captured**: which admin (`admin_id`, joined to `admin_users.username` for display), what action, what it targeted, and a JSON blob of specifics — sufficient for the Security page's audit trail (`docs/admin-panel/security/`) to reconstruct "who did what to what."

**What's not**: `ip_address` is a real column, selected by `GET /security/audit-logs` (`index.ts` ~1819) and rendered as a dedicated column in `Security.tsx`, but **no insert call site ever populates it** — see `docs/Bugs/audit-log-ip-address-never-recorded.md`. It has been empty since the column was added and will stay empty until a fix lands.

**Also not fully consistent**: the KYC review flow has two near-duplicate endpoints that update the exact same rows but only one of them writes to `admin_audit_log` (and only one sends the approve/reject push notification) — see `docs/Bugs/kyc-review-endpoint-skips-audit-log-and-notification.md`, filed during this pass. `DELETE /banners/:id` is another mutation that writes no audit row at all (per `docs/admin-panel/banners/backend.md`).

**Read surfaces**: `GET /api/admin/security/audit-logs?limit=&offset=` (`superadmin`-only, global, paginated, `index.ts` ~1815) and `GET /api/admin/users/:id/audit` (any authenticated admin, scoped to `target_type='user' AND target_id=:id`, `index.ts` ~478) — the latter is what backs the "Audit" tab on a player's detail view in `Users.tsx`, distinct from the global Security page.

## KYC image proxy

`GET /api/admin/kyc/:userId/file/:type` (`index.ts` ~2429-2453, `type` ∈ `front`/`back`/`selfie` mapped via `KYC_FILE_KEYS` to on-disk filename prefixes `aadhaar_front`/`aadhaar_back`/`selfie`). Exists because Nginx denies public access to `/uploads/kyc/` — this is the only path through which the admin panel can render a submitted Aadhaar/selfie image (see `docs/admin-panel/kyc/frontend.md`'s `KycImg` component, which fetches this route with a bearer token and renders the response as a blob URL).

Mechanism: `userId` is resolved to `KYC_UPLOAD_DIR/<userId>/` and path-traversal-checked (`path.resolve(...).startsWith(path.resolve(KYC_UPLOAD_DIR) + path.sep)`), the directory is listed with `fs.readdirSync` and the first file matching `${key}.*` is streamed back with a `Content-Type` looked up from a small extension→MIME table (`.png`/`.webp`/`.jpg`/`.jpeg`). No signed URLs, no expiry, no per-request logging of who viewed which document.

Access control used to be `{ onRequest: [authenticate] }` with no `requireRole`, unlike the review action on the same document set (`PUT /kyc/:userId/review`, `support`-gated) — meaning any authenticated admin, including `readonly`, could view any user's raw government-ID photos and selfie by iterating user IDs. Fixed 2026-07-29: now `requireRole('support')`, matching the review action.

## ML / churn / bot-learning / monitor route groups

All four are registered from `start()` before `index.ts` defines its own routes (lines 71-81):
```ts
await registerMLRoutes(app, redis, db, authenticate)
await registerChurnRoutes(app, authenticate, requireRole)
await registerBotLearningRoutes(app, authenticate, requireRole)
await registerMonitorRoutes(app, authenticate, requireRole)
```
Three of the four are near-identical thin proxies; one is genuinely local. Per-endpoint tables, RBAC-per-route breakdowns, and frontend consumption are already fully documented under `docs/admin-panel/ai-control-center/` (ML + churn + bot-learning), `docs/admin-panel/app-monitor/`, and `docs/admin-panel/player-tracking/` — this section covers the mechanism, not repeated per-route.

- **`ml-routes.ts`** — the one route group with real local state. `GET`/`POST /api/admin/ml/config` reads/writes a single JSON blob (`DEFAULT_CONFIG`: `fraudDetection`, `churnPrediction`, `botSettings`, `rtpOptimizer` sub-objects) — Redis-first read (`ml:config` key, 24h TTL via `EX 86400` on write) falling back to Postgres (`admin_config` table, upserted `ON CONFLICT (key) DO UPDATE`), and a write publishes to the `ml:config:change` Redis channel for any subscriber. `GET /ml/metrics` is a dashboard aggregation endpoint — real counts from `users`/`game_participants`/`user_churn_scores`/`game_rooms`/`fraud_events` mixed with **hardcoded** model-status/job entries (`models: [...]`, `jobs: [...]` are static arrays, not driven by any actual training pipeline — see `docs/Bugs/ai-workflow-dashboard-hardcoded-model-jobs.md`). `POST /ml/query` ("AI Prompt Console") is keyword substring matching against 6 hardcoded topic groups (`user`/`revenue`/`deposit`/`game`/`fraud`/`churn`), not a real LLM or NL query engine — each match runs one fixed SQL query and formats a canned sentence.
- **`churn-routes.ts`** — pure `axios` proxy to `churn-service` (`CHURN_SERVICE_URL`, default `http://localhost:3013`); no local table, no request-body validation before forwarding. `GET /churn/users`, `GET /churn/stats`, `GET`/`PATCH /churn/config`, `POST /churn/re-engage/:userId`.
- **`bot-learning-routes.ts`** — pure `axios` proxy to `bot-learning-service` (`BOT_LEARNING_SERVICE_URL`, default `:3014`). `GET /bots/profile(s)`, `GET`/`PATCH /bots/config`, `PATCH /bots/profiles/:gameType/:difficulty`, `POST /bots/rebuild` (sends an explicit `{}` body — a bare `axios.post` with no body defaults to `x-www-form-urlencoded`, which Fastify's body parser on the receiving end rejects with 415, per the in-source comment).
- **`monitor-routes.ts`** — pure `axios` proxy to `app-monitor-service` (`APP_MONITOR_SERVICE_URL`, default `:3015`), 15 routes. Explicitly documented in its own header comment as read-only-by-design and therefore only `authenticate`-gated, **except** `live-players`/`player/:userId`/`geo-distribution`/`engagement`, which are `superadmin`-gated because they carry per-player IP/geo/device PII (see `docs/admin-panel/player-tracking/backend.md`), and except the `alerts/:id/ack` write, which — despite the file's stated read-only design intent — has no role gate at all (part of `docs/Bugs/ai-control-center-missing-role-gates.md`).

None of the three proxy files validate or transform the request/response bodies passing through them (no Zod schemas on `req.body` before forwarding) — errors from the downstream service are relayed as-is (`err.response?.status ?? 500`, `err.response?.data`), so a downstream service's error shape leaks through to the admin panel unchanged.
