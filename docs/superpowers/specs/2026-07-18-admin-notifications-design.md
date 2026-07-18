# Admin Panel Notification System — Design

Date: 2026-07-18

## Problem

Admins currently have no way to know about new deposits, withdrawals, user
registrations, support tickets, KYC submissions, or unusually large payouts
without manually refreshing the relevant page. They need a real-time bell
notification with sound, backed by a persisted history.

## Architecture

### Why Postgres triggers, not app-code hooks

The events that should trigger a notification are written by different
backend services that all share one Postgres database (`teen_db`):

| Event | Written by |
|---|---|
| Deposit / withdrawal request | wallet-service (`payment_orders`) |
| New user registration | core-api-service (`users`) |
| Support ticket created | core-api-service and bot-learning-service (`support_tickets`) |
| KYC document submitted | core-api-service (`kyc_documents`) |
| Large win | game engines / wallet-service (`wallet_transactions`) |

Rather than adding notification-emitting code to five different services,
this design uses **Postgres `AFTER INSERT` triggers** on the five source
tables. Each trigger function inserts a row into a new `admin_notifications`
table and calls `pg_notify('admin_events', id)`. No source service needs any
code change — this lives entirely in a DB migration.

### admin-service: LISTEN + WebSocket fan-out

- admin-service opens one dedicated long-lived `pg` client that runs
  `LISTEN admin_events` for the life of the process.
- On each notification, it `SELECT`s the new `admin_notifications` row,
  checks `target_role` against each connected admin's role (from their JWT,
  reusing the existing `requireRole` role data), and pushes matching events
  over a new authenticated WebSocket endpoint: `/ws/admin/notifications`
  (JWT passed as a query param or first message, same trust model as the
  REST admin routes).
- If the LISTEN connection drops, admin-service reconnects and re-issues
  `LISTEN` — the durable `admin_notifications` table means no permanent data
  loss even if a gap occurs; the admin panel backfills via the REST history
  endpoint on reconnect.

### REST endpoints (durable side)

- `GET /api/admin/notifications?since=&limit=` — paginated history + unread
  count, filtered by the caller's role.
- `PATCH /api/admin/notifications/:id/read`
- `PATCH /api/admin/notifications/read-all`

### Database schema

```sql
CREATE TABLE admin_notifications (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,              -- 'deposit' | 'withdrawal' | 'new_user' | 'ticket' | 'kyc' | 'large_win'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',  -- 'info' | 'warning'
  target_role TEXT NOT NULL,       -- 'finance' | 'support' | 'superadmin'
  ref_table TEXT,
  ref_id TEXT,
  read_by JSONB NOT NULL DEFAULT '[]',  -- array of admin_user ids who've read it
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_notifications_role_created ON admin_notifications (target_role, created_at DESC);
```

`read_by` is an array (not a boolean) because a single notification is
visible to every admin with the matching role — each admin dismisses it
independently.

### Trigger conditions and role targeting

Role targeting mirrors the existing `requireRole()` gates already used for
the equivalent action in admin-service (verified against
`services/admin-service/src/index.ts`):

| Event | Source table / condition | `target_role` | Rationale |
|---|---|---|---|
| New deposit | `payment_orders`, `type='deposit'` insert | `finance` | deposit endpoints are `requireRole('finance')` |
| New withdrawal | `payment_orders`, `type='withdrawal'` insert | `finance` | withdrawal endpoints are `requireRole('finance')` |
| New user | `users` insert | `support` | user status/KYC endpoints are `requireRole('support')` |
| New ticket | `support_tickets` insert | `support` | ticket endpoints are `requireRole('support')` |
| KYC submitted | `kyc_documents`, `status='under_review'` insert | `support` | KYC approval endpoint (`PATCH /users/:id/kyc`) is `requireRole('support')`, **not** finance |
| Large win | `wallet_transactions`, `type='win' AND amount >= 5000` insert | `finance` | matches ledger/finance ownership of payout data |

`superadmin` sees every notification (checked as `target_role = admin's
role OR admin's role = 'superadmin'`), consistent with superadmin already
being a superset role everywhere else in admin-service.

## Frontend (admin-panel)

- **Bell icon**: added to `Layout.tsx` header next to the existing
  `Avatar`/`Dropdown`, with an unread-count `Badge`.
- **`useAdminNotifications` hook** (new, `src/hooks/useAdminNotifications.ts`):
  connects the WebSocket on login, appends incoming events to a small
  Zustand store, plays a short chime once per new event via `new
  Audio(...)`, and reconnects with backoff on drop. On (re)connect, calls
  `GET /api/admin/notifications` to backfill anything missed.
- **Mute toggle**: next to the bell, persisted in `localStorage`
  (`admin_notifications_muted`).
- **Dropdown**: shows the most recent ~10 notifications; clicking one calls
  the mark-read endpoint and deep-links to the relevant page (e.g. a deposit
  notification → Finance → Deposits tab).
- **History page**: new `NotificationsHistory.tsx` (or a new tab on the
  existing `Notifications.tsx`, which today is only an outbound
  push-to-users form) listing full history with type/date filters and a
  "mark all read" action.

## Error handling

- If the WebSocket is unavailable (e.g. reverse proxy doesn't forward
  `Upgrade`, per the known `nginx-ws-upgrade-pitfall` from this project's
  history), the hook falls back to polling
  `GET /api/admin/notifications?since=` every 15s so the feature degrades
  gracefully instead of going silent.
- Trigger functions wrap their `admin_notifications` insert + `pg_notify` in
  the same transaction as the original row insert, so a notification is
  never recorded for a write that itself rolled back.

## Testing

- Migration applies cleanly and triggers fire on manual `INSERT`s during
  local testing (deposit, withdrawal, user, ticket, KYC, large win).
- admin-service LISTEN reconnect logic verified by killing/restoring the DB
  connection and confirming no notifications are permanently lost (durable
  table backfill).
- Frontend: bell badge count, sound-on-arrival, mute persistence across
  reload, mark-read/mark-all-read, role-based filtering (a `support`-only
  admin never sees deposit/withdrawal/large-win alerts and vice versa for
  `finance`).

## Out of scope (explicitly deferred)

- Per-admin per-type mute/subscription preferences (only a single global
  mute toggle for now).
- Email/SMS/push notification fan-out beyond the in-panel bell.
- Configurable large-win threshold via admin UI (₹5,000 is hardcoded in the
  trigger for now; changing it later just means editing the trigger
  function).
