# Notifications: History, Views & Analytics

Date: 2026-07-26

## Summary

There are two separate notification systems in this codebase, and both get history/analytics improvements:

1. **User-facing push notifications** (admin sends messages/promos to players) — currently a fire-and-forget send form with zero persistence of what was sent or how it performed. Gets a full history + analytics build-out.
2. **Admin-bell internal alerts** (payment issues, KYC docs, support tickets, etc.) — already has a working history page, just isn't linked in the sidebar. Gets a sidebar link plus a new volume-by-type trend chart.

## Part 1 — Push Notification History & Analytics

### Current state (for context)

- Admin panel: `admin-panel/src/pages/Notifications.tsx` — pure send form (All Users / Specific User by UUID, type, title, body). No history, no past-send list, no analytics.
- Admin-service proxy routes: `POST /api/admin/notifications/broadcast` and `POST /api/admin/notifications/send` (both `services/admin-service/src/index.ts`) forward to core-api-service.
- Core-api-service: `services/core-api-service/src/plugins/notifications.ts` — `/internal/notifications/send` inserts one `notifications` row + FCM push; `/internal/notifications/broadcast` bulk-inserts one row per active non-bot user (batches of 1000) + FCM in batches of 500 via `sendEach`. The `{ success, sent, total }` delivery count is returned to the browser and then lost — never persisted.
- `notifications` table (`infra/db/migrations/002_notifications.sql`): `id, user_id, type, title, body, data, read, sent_at, read_at, created_at`. Per-user `read`/`read_at` already exist and are reliably maintained by the mobile app's inbox (`mobile/lib/features/notifications/notifications_page.dart`) — this is real, existing "view" data that's just never surfaced to admins.
- **Important scoping detail**: `/internal/notifications/send` is also called directly by *other* admin-service flows as a side effect of KYC approval, deposit confirmation, and withdrawal confirmation (`services/admin-service/src/index.ts` around lines 538, 859, 965) — these are system-triggered, not something an admin consciously "sent" from the Notifications page. They must NOT show up in the send history/analytics being built here, or the history table fills with unrelated noise.

### Data model (new migration)

**`notification_campaigns`** — one row per admin-initiated send from the Notifications page:
- `id UUID PK`
- `title TEXT`, `body TEXT`, `type VARCHAR(20)`
- `target_type VARCHAR(20)` — `all` | `specific_user`
- `target_user_id UUID` nullable — set only for `specific_user` sends
- `sent_by UUID` — admin user id (from the authenticated request)
- `total_recipients INT` — 1 for specific_user, actual active-user count for broadcast
- `delivered_count INT` nullable — backfilled from Firebase's `sendEach` response once the send completes; null briefly during a broadcast in flight, then always set
- `created_at TIMESTAMPTZ`

**`notifications`** table gets one new nullable column: `campaign_id UUID` (FK to `notification_campaigns.id`, nullable — existing rows and all system-triggered sends stay `null`).

### Request flow

1. Admin submits the Send form → `POST /api/admin/notifications/send` or `/broadcast` (admin-service).
2. Admin-service inserts the `notification_campaigns` row first (using its own DB pool — same Postgres instance core-api-service uses), generating `campaign_id`.
3. Admin-service forwards the request to core-api-service's `/internal/notifications/send` or `/broadcast`, **including `campaign_id` in the body**.
4. Core-api-service tags each inserted `notifications` row with `campaign_id` **only when provided** in the request — system-triggered calls (KYC/deposit/withdrawal) never pass one, so they stay untagged exactly as today. Core-api-service's response already includes `{ sent, total }`.
5. Admin-service updates the campaign row's `delivered_count` from that response, then returns to the browser as today.
6. Broadcast is fire-and-forget from the browser's perspective (the toast just confirms it was queued/sent) — `delivered_count` may lag slightly behind `total_recipients` finishing all FCM batches, but is filled in synchronously before the admin-service response returns, matching how `sent`/`total` already work today.

### API surface (new, admin-service)

- `GET /api/admin/notifications/campaigns` — paginated (default 20/page), filterable by `type` and date range (`startDate`/`endDate`). Each row: `title, type, target_type, target_user_id, sent_by (username), total_recipients, delivered_count, created_at`, plus a live-computed `read_count` and `read_rate` via `SELECT COUNT(*) FROM notifications WHERE campaign_id = $1 AND read = true`.
- `GET /api/admin/notifications/analytics?days=30` — two datasets for the Analytics tab:
  - Daily trend: `date, campaigns_sent, avg_read_rate` (grouped by `date_trunc('day', created_at)` on `notification_campaigns`, joined to per-campaign read rate)
  - Type breakdown: `type, campaigns_sent, avg_read_rate` grouped by `type`

### Admin panel

`Notifications.tsx` becomes a tabbed page (same `Tabs` pattern as `Missions.tsx`):
1. **Send** — existing form, unchanged.
2. **History** — table: Title, Type, Target, Sent By, Sent At, Recipients, Delivered, Read Rate. Filters: type dropdown, date range picker. No per-recipient drill-down (aggregate only, per confirmed scope).
3. **Analytics** — a line/area trend chart (sends + read-rate over time, same `recharts` pattern as `admin-panel/src/components/BotTrainingTrendChart.tsx`) plus a bar chart comparing read rate by notification type.

## Part 2 — Admin-Bell Alerts: Sidebar Link + Volume Trend

### Current state

`admin-panel/src/pages/NotificationsHistory.tsx` already exists — full history table with type filter, date-range filter, mark-all-read. It's only reachable via the bell dropdown's "View All" link; **not listed in `admin-panel/src/pages/layout/menuConfig.ts`**, so there's no direct sidebar navigation to it.

### Changes

1. **Sidebar link**: add an entry to `menuConfig.ts` pointing at the existing `/admin/notifications-history` route. No backend change needed — the page and its data already work.
2. **Volume-by-type trend chart**: new `GET /api/admin/notifications/bell-trend?days=30` route (admin-service) querying `admin_notifications` grouped by `date_trunc('day', created_at)` and `type`, returning daily counts per type. Rendered as a stacked bar or multi-line chart (same `recharts` pattern as Part 1's analytics) added to the top of `NotificationsHistory.tsx`, above the existing filterable table.

## Testing

- Backend: unit tests for the campaign-creation + `campaign_id` tagging logic (admin-service), and for the two new aggregate query routes (campaigns list, analytics, bell-trend) — verify filters, pagination, and that read-rate math is correct against seeded rows.
- Verify system-triggered sends (KYC/deposit/withdrawal) still work unchanged and never create a campaign row or get a `campaign_id`.
- Frontend: no new automated tests expected beyond the project's existing `tsc`/lint gate (matches the pattern used for `Missions.tsx` and `BotTrainingConfigPanel.tsx` in this codebase — these admin pages aren't currently covered by component tests).

## Out of scope

- Per-recipient drill-down (who specifically read a given campaign) — explicitly deferred; aggregate counts only.
- Scheduling future sends, or editing/canceling an in-flight broadcast.
- Push delivery *receipts* beyond Firebase's own `sendEach` success/failure count (no client-side "notification received" ping).
- Any change to how "specific user" targeting works today (still paste-a-UUID) — not requested.
