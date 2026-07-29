# Admin Panel Notification Bell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a real-time bell notification (with sound) for new deposits, withdrawals, user registrations, support tickets, KYC submissions, and large wins, backed by a persisted, role-scoped history.

**Architecture:** Postgres `AFTER INSERT` triggers on five source tables insert into a new `admin_notifications` table and call `pg_notify`. admin-service holds one long-lived `LISTEN` connection and fans matching events out over a new authenticated `/ws/admin/notifications` WebSocket endpoint (via `@fastify/websocket`). admin-panel adds a bell icon + Web Audio chime + history page, backed by REST endpoints for backfill/read-state.

**Tech Stack:** PostgreSQL triggers/LISTEN-NOTIFY, Fastify + `@fastify/websocket`, native browser `WebSocket`, Web Audio API (`AudioContext`, no binary asset), Zustand, Ant Design.

## Global Constraints

- Role targeting must use the existing **hierarchical** role check (`services/admin-service/src/index.ts:58-65`: `ROLES = ['readonly','employee','support','finance','superadmin']`, `hasRole(actual, required)` returns true when `ROLE_INDEX[actual] >= ROLE_INDEX[required]`). A notification with `target_role='finance'` must be visible to `finance` AND `superadmin` admins, not just exact-role matches.
- Large-win threshold is hardcoded at ₹5,000 (`amount >= 5000`) per the approved spec — no admin UI to configure it.
- No source service (`wallet-service`, `core-api-service`, `bot-learning-service`, game engines) gets any code changes — the trigger lives entirely in the migration file.
- Migrations are plain numbered `.sql` files in `infra/db/migrations/`, applied via `infra/db/migrate.sh` (idempotent, tracks applied files in `schema_migrations`). Next unused number is `081`.
- admin-panel API calls go through `adminApi` (`admin-panel/src/api/client.ts`), base URL `/api/admin` in production (same-origin, see `admin-panel/.env.production`). The JWT is read from `localStorage.getItem('admin_token')`.
- Follow the nginx WS proxy pattern already used for `/ws/aviator` and `/ws/bingo` in `infra/nginx/game.myonlinejoker.com.conf` — a new WS location must include `proxy_set_header Upgrade $http_upgrade;` and `proxy_pass_header Upgrade;` or, per this project's known pitfall, sockets silently fail to upgrade.

---

## File Structure

| File | Responsibility |
|---|---|
| `infra/db/migrations/081_admin_notifications.sql` | New `admin_notifications` table, 5 trigger functions + triggers on the source tables |
| `services/admin-service/src/notifications-routes.ts` | New file: REST endpoints (`GET /api/admin/notifications`, `PATCH .../read`, `PATCH .../read-all`) + the WS route + the `LISTEN` client lifecycle |
| `services/admin-service/src/index.ts` | Register `@fastify/websocket`, call `registerNotificationRoutes(app, db, authenticate)` (same pattern as `registerTaskRoutes` etc. at line 136) |
| `services/admin-service/package.json` | Add `@fastify/websocket` dependency |
| `infra/nginx/game.myonlinejoker.com.conf` | New `/ws/admin` location block proxying to `admin_backend` with Upgrade headers |
| `admin-panel/src/store/notifications.ts` | New Zustand store: notification list, unread count, mute flag, WS connection state |
| `admin-panel/src/hooks/useAdminNotifications.ts` | New hook: opens the WebSocket, wires reconnect/backoff + polling fallback, plays the chime, backfills via REST on connect |
| `admin-panel/src/lib/notificationSound.ts` | New file: Web Audio chime generator (no binary asset) |
| `admin-panel/src/components/NotificationBell.tsx` | New component: bell icon + badge + dropdown, mounted in `Layout.tsx` header |
| `admin-panel/src/pages/NotificationsHistory.tsx` | New page: full history table with filters + mark-all-read |
| `admin-panel/src/pages/Layout.tsx` | Mount `<NotificationBell />` in the header (around line 153) |
| `admin-panel/src/App.tsx` (or wherever routes are registered) | Add route for `/admin/notifications-history` |

---

## Task 1: Database migration — `admin_notifications` table + triggers

**Files:**
- Create: `infra/db/migrations/081_admin_notifications.sql`

**Interfaces:**
- Produces: table `admin_notifications(id BIGSERIAL, type TEXT, title TEXT, body TEXT, severity TEXT, target_role TEXT, ref_table TEXT, ref_id TEXT, read_by JSONB, created_at TIMESTAMPTZ)`, channel name `'admin_events'` (NOTIFY payload = the new row's `id` as text).

- [ ] **Step 1: Confirm the exact source-table column names the triggers will reference**

Run these against the dev DB to lock in column names before writing trigger bodies (do not skip — a wrong column name fails silently at DEPLOY time, not write time, since triggers are attached at migration-apply time but only execute later):

```bash
docker exec teen_postgres psql -U teen -d teen_db -c "\d payment_orders" -c "\d users" -c "\d support_tickets" -c "\d kyc_documents" -c "\d wallet_transactions"
```

Expected: `payment_orders` has `id, user_id, type, amount, status`; `users` has `id, username, phone`; `support_tickets` has `id, user_id, subject`; `kyc_documents` has `id, user_id, doc_type, status`; `wallet_transactions` has `id, user_id, type, amount`. If any column is named differently, adjust the trigger bodies in Step 2 accordingly.

- [ ] **Step 2: Write the migration file**

```sql
-- Admin notification bell: table + AFTER INSERT triggers on the source tables
-- that generate admin-facing events (deposits, withdrawals, new users,
-- support tickets, KYC submissions, large wins). Triggers live entirely in
-- this migration so no source service (wallet-service, core-api-service,
-- bot-learning-service, game engines) needs any code change.

CREATE TABLE admin_notifications (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  target_role TEXT NOT NULL,
  ref_table TEXT,
  ref_id TEXT,
  read_by JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_notifications_role_created ON admin_notifications (target_role, created_at DESC);

-- Deposit requests
CREATE OR REPLACE FUNCTION trg_notify_new_deposit() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.type = 'deposit' THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('deposit', 'New Deposit Request', 'A deposit of ₹' || NEW.amount || ' is awaiting review.', 'info', 'finance', 'payment_orders', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_orders_deposit
  AFTER INSERT ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_deposit();

CREATE OR REPLACE FUNCTION trg_notify_new_withdrawal() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.type = 'withdrawal' THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('withdrawal', 'New Withdrawal Request', 'A withdrawal of ₹' || NEW.amount || ' is awaiting review.', 'info', 'finance', 'payment_orders', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_orders_withdrawal
  AFTER INSERT ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_withdrawal();

CREATE OR REPLACE FUNCTION trg_notify_new_user() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
  VALUES ('new_user', 'New User Registered', COALESCE(NEW.username, NEW.phone, 'A new user') || ' just signed up.', 'info', 'support', 'users', NEW.id::text)
  RETURNING id INTO notif_id;
  PERFORM pg_notify('admin_events', notif_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_new
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_user();

CREATE OR REPLACE FUNCTION trg_notify_new_ticket() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
  VALUES ('ticket', 'New Support Ticket', COALESCE(NEW.subject, 'A new ticket'), 'info', 'support', 'support_tickets', NEW.id::text)
  RETURNING id INTO notif_id;
  PERFORM pg_notify('admin_events', notif_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_support_tickets_new
  AFTER INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_ticket();

CREATE OR REPLACE FUNCTION trg_notify_new_kyc() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.status = 'under_review' THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('kyc', 'KYC Document Submitted', 'A ' || NEW.doc_type || ' document is awaiting review.', 'info', 'support', 'kyc_documents', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kyc_documents_new
  AFTER INSERT ON kyc_documents
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_kyc();

CREATE OR REPLACE FUNCTION trg_notify_large_win() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.type = 'win' AND NEW.amount >= 5000 THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('large_win', 'Large Win Detected', 'A payout of ₹' || NEW.amount || ' was just credited.', 'warning', 'finance', 'wallet_transactions', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_transactions_large_win
  AFTER INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_notify_large_win();
```

Write the full migration (table + index + all five function/trigger pairs above) to `infra/db/migrations/081_admin_notifications.sql`.

- [ ] **Step 3: Apply the migration locally and verify triggers fire**

```bash
docker exec -i teen_postgres psql -U teen -d teen_db < infra/db/migrations/081_admin_notifications.sql
```

Then manually verify a trigger fires (using a real `user_id` from your dev DB, substitute accordingly):

```bash
docker exec teen_postgres psql -U teen -d teen_db -c \
  "INSERT INTO support_tickets (user_id, subject, category, status, priority) VALUES ((SELECT id FROM users LIMIT 1), 'test ticket', 'general', 'open', 'normal');"
docker exec teen_postgres psql -U teen -d teen_db -c \
  "SELECT type, title, target_role FROM admin_notifications ORDER BY id DESC LIMIT 1;"
```

Expected: one row with `type='ticket'`, `title='New Support Ticket'`, `target_role='support'`.

- [ ] **Step 4: Commit**

```bash
git add infra/db/migrations/081_admin_notifications.sql
git commit -m "feat: add admin_notifications table + triggers for deposits/withdrawals/users/tickets/KYC/large-wins"
```

---

## Task 2: admin-service — REST endpoints for notification history

**Files:**
- Create: `services/admin-service/src/notifications-routes.ts`
- Modify: `services/admin-service/src/index.ts` (register the new routes)

**Interfaces:**
- Consumes: `db: Pool` (from `services/admin-service/src/index.ts:68`), `authenticate` (from `services/admin-service/src/index.ts:90`), the existing `hasRole`/`ROLE_INDEX` concept — reimplemented locally in this file since it's not exported from `index.ts` (see Step 1).
- Produces: `export function registerNotificationRoutes(app: FastifyInstance, db: Pool, authenticate: any): void` — called from `index.ts`. Also produces the shared `hasRoleAtLeast(actual: string, required: string): boolean` helper used again in Task 3.

- [ ] **Step 1: Write the route file with role-hierarchy helper**

```typescript
// services/admin-service/src/notifications-routes.ts
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'

const ROLE_INDEX: Record<string, number> = { readonly: 0, employee: 1, support: 2, finance: 3, superadmin: 4 }

export function hasRoleAtLeast(actual: string | undefined, required: string): boolean {
  if (!actual || !(actual in ROLE_INDEX) || !(required in ROLE_INDEX)) return false
  return ROLE_INDEX[actual] >= ROLE_INDEX[required]
}

export function registerNotificationRoutes(app: FastifyInstance, db: Pool, authenticate: any) {
  // GET /api/admin/notifications?since=<iso>&limit=<n> — role-scoped history + unread count
  app.get('/api/admin/notifications', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const q = req.query as { since?: string; limit?: string }
    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200)

    // Every role the caller's role satisfies (e.g. superadmin satisfies target_role in ['readonly','employee','support','finance','superadmin'])
    const satisfiedRoles = Object.keys(ROLE_INDEX).filter(r => hasRoleAtLeast(role, r))

    const params: any[] = [satisfiedRoles, limit]
    let sql = `SELECT id, type, title, body, severity, target_role, ref_table, ref_id, read_by, created_at
               FROM admin_notifications WHERE target_role = ANY($1)`
    if (q.since) {
      params.push(q.since)
      sql += ` AND created_at > $3`
    }
    sql += ` ORDER BY created_at DESC LIMIT $2`

    const rows = await db.query(sql, params)
    const unreadCount = await db.query(
      `SELECT COUNT(*)::int AS c FROM admin_notifications WHERE target_role = ANY($1) AND NOT (read_by @> $2::jsonb)`,
      [satisfiedRoles, JSON.stringify([me.id])]
    )
    return reply.send({ notifications: rows.rows, unread_count: unreadCount.rows[0].c })
  })

  // PATCH /api/admin/notifications/:id/read — mark one notification read by this admin
  app.patch('/api/admin/notifications/:id/read', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const { id } = req.params as { id: string }
    await db.query(
      `UPDATE admin_notifications SET read_by = read_by || $2::jsonb WHERE id = $1 AND NOT (read_by @> $2::jsonb)`,
      [id, JSON.stringify([me.id])]
    )
    return reply.send({ success: true })
  })

  // PATCH /api/admin/notifications/read-all — mark every notification visible to this admin as read
  app.patch('/api/admin/notifications/read-all', { onRequest: [authenticate] }, async (req: any, reply) => {
    const me = req.user as any
    const role = me?.role as string
    const satisfiedRoles = Object.keys(ROLE_INDEX).filter(r => hasRoleAtLeast(role, r))
    await db.query(
      `UPDATE admin_notifications SET read_by = read_by || $2::jsonb
       WHERE target_role = ANY($1) AND NOT (read_by @> $2::jsonb)`,
      [satisfiedRoles, JSON.stringify([me.id])]
    )
    return reply.send({ success: true })
  })
}
```

- [ ] **Step 2: Register the routes in `index.ts`**

In `services/admin-service/src/index.ts`, add the import near the other route-registration imports (after line 37, `import { registerTaskRoutes } from './task-routes'`):

```typescript
import { registerNotificationRoutes } from './notifications-routes'
```

Then after line 136 (`await registerTaskRoutes(app, db, authenticate, requireRole)`), add:

```typescript

  // Register Notification routes
  registerNotificationRoutes(app, db, authenticate)
```

- [ ] **Step 3: Verify with a manual request**

```bash
cd services/admin-service && npm run dev
```

In another terminal, log in via the existing `/api/admin/auth/login` endpoint to get a token, then:

```bash
curl -s http://localhost:3008/api/admin/notifications -H "Authorization: Bearer <token>" | head -c 500
```

Expected: JSON with `notifications` (array, possibly containing the test ticket from Task 1 Step 3 if that admin's role is `support` or higher) and `unread_count`.

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/notifications-routes.ts services/admin-service/src/index.ts
git commit -m "feat: add role-scoped admin notification history REST endpoints"
```

---

## Task 3: admin-service — WebSocket push via LISTEN/NOTIFY

**Files:**
- Modify: `services/admin-service/src/notifications-routes.ts` (add the WS route + LISTEN client)
- Modify: `services/admin-service/src/index.ts` (register `@fastify/websocket`)
- Modify: `services/admin-service/package.json` (add dependency)

**Interfaces:**
- Consumes: `hasRoleAtLeast` from Task 2 (same file), `db: Pool`, a raw `pg.Client` for the dedicated LISTEN connection (`new Client({ connectionString: process.env.DATABASE_URL })`, distinct from the pooled `db: Pool` since `LISTEN` must stay on one held connection).
- Produces: WS route `/ws/admin/notifications` that authenticates via a `token` query param and streams `{ id, type, title, body, severity, target_role, ref_table, ref_id, created_at }` JSON messages to clients whose role satisfies the notification's `target_role`.

- [ ] **Step 1: Add the WebSocket plugin dependency**

```bash
cd services/admin-service && npm install @fastify/websocket@^10.0.1
```

- [ ] **Step 2: Register the plugin in `index.ts`**

In `services/admin-service/src/index.ts`, add the import after line 6 (`import multipart from '@fastify/multipart'`):

```typescript
import websocket from '@fastify/websocket'
```

Then after line 78 (`await app.register(multipart, ...)`), add:

```typescript
  await app.register(websocket)
```

- [ ] **Step 3: Add the LISTEN client + WS route to `notifications-routes.ts`**

Append to `services/admin-service/src/notifications-routes.ts` (extend the existing `registerNotificationRoutes` function body — do not create a second exported function):

```typescript
import { Client } from 'pg'
import jwt from 'jsonwebtoken'
```

Add these imports at the top of the file alongside the existing ones. Then inside `registerNotificationRoutes`, after the three REST routes, add:

```typescript
  // WebSocket push: one client per browser tab, filtered by role
  const wsClients = new Set<{ socket: any; role: string }>()

  app.get('/ws/admin/notifications', { websocket: true }, (socket: any, req: any) => {
    const token = (req.query as any)?.token
    let role: string | undefined
    try {
      const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET!) as any
      role = payload.role
    } catch {
      socket.close(4001, 'Unauthorized')
      return
    }
    const entry = { socket, role: role! }
    wsClients.add(entry)
    socket.on('close', () => wsClients.delete(entry))
  })

  // Dedicated LISTEN connection — separate from the pooled `db` since LISTEN
  // must stay bound to one held connection for the process lifetime.
  async function startListener() {
    const listenClient = new Client({ connectionString: process.env.DATABASE_URL })
    listenClient.on('error', (err) => {
      app.log.error(err, 'admin_events LISTEN connection error, reconnecting in 5s')
      setTimeout(startListener, 5000)
    })
    await listenClient.connect()
    await listenClient.query('LISTEN admin_events')
    listenClient.on('notification', async (msg) => {
      const notifId = msg.payload
      if (!notifId) return
      const row = await db.query(
        `SELECT id, type, title, body, severity, target_role, ref_table, ref_id, created_at
         FROM admin_notifications WHERE id = $1`,
        [notifId]
      )
      if (row.rows.length === 0) return
      const notif = row.rows[0]
      for (const client of wsClients) {
        if (hasRoleAtLeast(client.role, notif.target_role) && client.socket.readyState === 1) {
          client.socket.send(JSON.stringify(notif))
        }
      }
    })
    app.log.info('Listening for admin_events notifications')
  }
  startListener().catch(err => app.log.error(err, 'Failed to start admin_events listener'))
```

- [ ] **Step 4: Add `jsonwebtoken` dependency** (needed to verify the token on the raw WS route, since `@fastify/jwt`'s `req.jwtVerify()` only works on HTTP request lifecycle, not the WS upgrade path used here)

```bash
cd services/admin-service && npm install jsonwebtoken@^9.0.2 && npm install -D @types/jsonwebtoken@^9.0.7
```

- [ ] **Step 5: Verify locally with a WS test client**

```bash
cd services/admin-service && npm run dev
```

In another terminal (Node one-liner, substitute a real token from a logged-in admin):

```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3008/ws/admin/notifications?token=<token>');
ws.on('open', () => console.log('connected'));
ws.on('message', (m) => console.log('received:', m.toString()));
ws.on('close', (c) => console.log('closed', c));
"
```

Then in a third terminal, insert a test row that fires a trigger:

```bash
docker exec teen_postgres psql -U teen -d teen_db -c \
  "INSERT INTO support_tickets (user_id, subject, category, status, priority) VALUES ((SELECT id FROM users LIMIT 1), 'ws test', 'general', 'open', 'normal');"
```

Expected: the WS test client prints `received: {"id":...,"type":"ticket",...}` within ~1 second (assuming the connected admin's role is `support` or higher).

- [ ] **Step 6: Commit**

```bash
git add services/admin-service/src/notifications-routes.ts services/admin-service/src/index.ts services/admin-service/package.json services/admin-service/package-lock.json
git commit -m "feat: push admin notifications over WebSocket via Postgres LISTEN/NOTIFY"
```

---

## Task 4: nginx — proxy `/ws/admin` to admin-service

**Files:**
- Modify: `infra/nginx/game.myonlinejoker.com.conf`

**Interfaces:**
- Consumes: `admin_backend` upstream (already defined, used by the existing `/api/admin/` location at line 122).
- Produces: `/ws/admin` location block reachable at `wss://game.myonlinejoker.com/ws/admin/notifications`.

- [ ] **Step 1: Add the location block**

In `infra/nginx/game.myonlinejoker.com.conf`, insert a new block immediately before the generic `# ── WebSocket: Game Gateway ──` block (before line 107), matching the exact pattern used for `/ws/aviator` and `/ws/bingo`:

```nginx
    # ── WebSocket: Admin Notifications (longer prefix wins) ──
    location /ws/admin {
        proxy_pass http://admin_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass_header Upgrade;
        proxy_pass_header Connection;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

```

- [ ] **Step 2: Commit**

```bash
git add infra/nginx/game.myonlinejoker.com.conf
git commit -m "feat: proxy /ws/admin to admin-service for the notification bell"
```

(Deployment of this nginx change to the VPS happens in Task 8, alongside the service deploy — nginx config changes require a reload on the live box, not just a local commit.)

---

## Task 5: admin-panel — Web Audio chime (no binary asset)

**Files:**
- Create: `admin-panel/src/lib/notificationSound.ts`
- Test: `admin-panel/src/lib/notificationSound.test.ts`

**Interfaces:**
- Produces: `export function playChime(): void` — plays a short two-tone beep using the Web Audio API. No file asset, so nothing to source/commit/deploy as a binary.

- [ ] **Step 1: Write the failing test**

```typescript
// admin-panel/src/lib/notificationSound.test.ts
import { describe, it, expect, vi } from 'vitest'
import { playChime } from './notificationSound'

describe('playChime', () => {
  it('creates an AudioContext and starts an oscillator without throwing', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const connect = vi.fn()
    const oscillator = { connect, start, stop, frequency: { setValueAtTime: vi.fn() }, type: 'sine' }
    const gainNode = { connect, gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
    const audioContextMock = vi.fn().mockImplementation(() => ({
      createOscillator: () => oscillator,
      createGain: () => gainNode,
      destination: {},
      currentTime: 0,
    }))
    // @ts-expect-error test stub
    global.AudioContext = audioContextMock

    expect(() => playChime()).not.toThrow()
    expect(start).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-panel && npx vitest run src/lib/notificationSound.test.ts`
Expected: FAIL with "Failed to resolve import" or "playChime is not a function" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// admin-panel/src/lib/notificationSound.ts
// Generates a short two-tone chime with the Web Audio API instead of
// shipping a binary audio asset.
export function playChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtx()
    const now = ctx.currentTime

    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + startOffset)
      gain.gain.setValueAtTime(0.15, now + startOffset)
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + startOffset)
      osc.stop(now + startOffset + duration)
    }

    playTone(880, 0, 0.12)
    playTone(1174.66, 0.13, 0.15)
  } catch {
    // Audio unsupported/blocked (e.g. autoplay policy before first user gesture) — silently skip.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin-panel && npx vitest run src/lib/notificationSound.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/lib/notificationSound.ts admin-panel/src/lib/notificationSound.test.ts
git commit -m "feat: add Web Audio chime for admin notification bell"
```

---

## Task 6: admin-panel — notification store + WebSocket hook

**Files:**
- Create: `admin-panel/src/store/notifications.ts`
- Create: `admin-panel/src/hooks/useAdminNotifications.ts`
- Test: `admin-panel/src/store/notifications.test.ts`

**Interfaces:**
- Consumes: `playChime` from Task 5 (`admin-panel/src/lib/notificationSound.ts`), `adminApi` from `admin-panel/src/api/client.ts`, `useAuthStore` from `admin-panel/src/store/auth.ts` (`token`, `admin.id`).
- Produces: `useNotificationStore` (Zustand) with shape `{ items: AdminNotification[], unreadCount: number, muted: boolean, addNotification(n), setInitial(items, unreadCount), markRead(id), markAllRead(), toggleMute() }`, where `AdminNotification = { id: number; type: string; title: string; body: string; severity: string; target_role: string; ref_table: string | null; ref_id: string | null; created_at: string; read: boolean }`. Also produces `useAdminNotifications(): void` hook (side-effect only, call once near the app root).

- [ ] **Step 1: Write the failing store test**

```typescript
// admin-panel/src/store/notifications.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useNotificationStore } from './notifications'

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ items: [], unreadCount: 0, muted: false })
    localStorage.clear()
  })

  it('addNotification prepends and increments unreadCount', () => {
    const n = { id: 1, type: 'ticket', title: 'T', body: 'B', severity: 'info', target_role: 'support', ref_table: null, ref_id: null, created_at: '2026-07-18T00:00:00Z', read: false }
    useNotificationStore.getState().addNotification(n)
    const state = useNotificationStore.getState()
    expect(state.items[0].id).toBe(1)
    expect(state.unreadCount).toBe(1)
  })

  it('markRead sets read=true and decrements unreadCount, once', () => {
    const n = { id: 2, type: 'ticket', title: 'T', body: 'B', severity: 'info', target_role: 'support', ref_table: null, ref_id: null, created_at: '2026-07-18T00:00:00Z', read: false }
    useNotificationStore.getState().addNotification(n)
    useNotificationStore.getState().markRead(2)
    useNotificationStore.getState().markRead(2) // idempotent — shouldn't double-decrement
    const state = useNotificationStore.getState()
    expect(state.items[0].read).toBe(true)
    expect(state.unreadCount).toBe(0)
  })

  it('toggleMute flips and persists to localStorage', () => {
    useNotificationStore.getState().toggleMute()
    expect(useNotificationStore.getState().muted).toBe(true)
    expect(localStorage.getItem('admin_notifications_muted')).toBe('true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-panel && npx vitest run src/store/notifications.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the store**

```typescript
// admin-panel/src/store/notifications.ts
import { create } from 'zustand'

export interface AdminNotification {
  id: number
  type: string
  title: string
  body: string
  severity: string
  target_role: string
  ref_table: string | null
  ref_id: string | null
  created_at: string
  read: boolean
}

interface NotificationState {
  items: AdminNotification[]
  unreadCount: number
  muted: boolean
  addNotification: (n: AdminNotification) => void
  setInitial: (items: AdminNotification[], unreadCount: number) => void
  markRead: (id: number) => void
  markAllRead: () => void
  toggleMute: () => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  muted: localStorage.getItem('admin_notifications_muted') === 'true',

  addNotification: (n) => set((state) => ({
    items: [n, ...state.items].slice(0, 100),
    unreadCount: state.unreadCount + (n.read ? 0 : 1),
  })),

  setInitial: (items, unreadCount) => set({ items, unreadCount }),

  markRead: (id) => set((state) => {
    const target = state.items.find(i => i.id === id)
    if (!target || target.read) return state
    return {
      items: state.items.map(i => i.id === id ? { ...i, read: true } : i),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }
  }),

  markAllRead: () => set((state) => ({
    items: state.items.map(i => ({ ...i, read: true })),
    unreadCount: 0,
  })),

  toggleMute: () => {
    const next = !get().muted
    localStorage.setItem('admin_notifications_muted', String(next))
    set({ muted: next })
  },
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin-panel && npx vitest run src/store/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Write the WebSocket hook (no unit test — integration-level, verified manually in Task 7)**

```typescript
// admin-panel/src/hooks/useAdminNotifications.ts
import { useEffect, useRef } from 'react'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useNotificationStore, type AdminNotification } from '../store/notifications'
import { playChime } from '../lib/notificationSound'

function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/admin/notifications?token=${encodeURIComponent(token)}`
}

export function useAdminNotifications() {
  const token = useAuthStore((s) => s.token)
  const addNotification = useNotificationStore((s) => s.addNotification)
  const setInitial = useNotificationStore((s) => s.setInitial)
  const muted = useNotificationStore((s) => s.muted)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let reconnectDelay = 1000

    // Backfill history + unread count on (re)connect
    async function backfill() {
      try {
        const res = await adminApi.get('/notifications', { params: { limit: 50 } })
        if (cancelled) return
        const items: AdminNotification[] = res.data.notifications.map((n: any) => ({ ...n, read: false }))
        setInitial(items, res.data.unread_count)
      } catch {
        // history fetch failed — WS/poll will still deliver new events live
      }
    }
    backfill()

    function connect() {
      const ws = new WebSocket(wsUrl(token!))
      wsRef.current = ws
      ws.onopen = () => {
        reconnectDelay = 1000
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      }
      ws.onmessage = (evt) => {
        const notif = JSON.parse(evt.data)
        addNotification({ ...notif, read: false })
        if (!mutedRef.current) playChime()
      }
      ws.onclose = () => {
        if (cancelled) return
        // Fall back to polling while disconnected (covers the known
        // nginx-Upgrade-header pitfall for this project, and any transient drop).
        if (!pollRef.current) {
          pollRef.current = setInterval(backfill, 15000)
        }
        setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      }
      ws.onerror = () => ws.close()
    }
    connect()

    return () => {
      cancelled = true
      wsRef.current?.close()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [token, addNotification, setInitial])
}
```

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/store/notifications.ts admin-panel/src/store/notifications.test.ts admin-panel/src/hooks/useAdminNotifications.ts
git commit -m "feat: add admin notification store + WebSocket hook with polling fallback"
```

---

## Task 7: admin-panel — bell UI + history page

**Files:**
- Create: `admin-panel/src/components/NotificationBell.tsx`
- Create: `admin-panel/src/pages/NotificationsHistory.tsx`
- Modify: `admin-panel/src/pages/Layout.tsx`
- Modify: routing file that lists `/admin/*` routes (locate via Step 1)

**Interfaces:**
- Consumes: `useNotificationStore`, `useAdminNotifications` (Task 6), `adminApi` (mark-read calls), Ant Design `Badge`, `Dropdown`, `List`, `Switch`, `Button`.
- Produces: `<NotificationBell />` component mounted in the header; `/admin/notifications-history` route.

- [ ] **Step 1: Find the route registration file**

```bash
cd admin-panel && grep -rn "notifications" src/App.tsx src/main.tsx src/routes* 2>/dev/null
```

Locate the `<Route path="/admin/notifications" ...>` entry (from the existing `Notifications.tsx` outbound-push page) to model the new route on.

- [ ] **Step 2: Write `NotificationBell.tsx`**

```tsx
// admin-panel/src/components/NotificationBell.tsx
import { Badge, Dropdown, Button, List, Switch, Typography, Empty } from 'antd'
import { BellOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../api/client'
import { useNotificationStore } from '../store/notifications'
import { useAdminNotifications } from '../hooks/useAdminNotifications'

const { Text } = Typography

export default function NotificationBell() {
  useAdminNotifications()
  const navigate = useNavigate()
  const { items, unreadCount, muted, markRead, toggleMute } = useNotificationStore()

  const onItemClick = async (id: number, refTable: string | null) => {
    markRead(id)
    try { await adminApi.patch(`/notifications/${id}/read`) } catch { /* best-effort */ }
    const dest: Record<string, string> = {
      payment_orders: '/admin/finance',
      users: '/admin/users',
      support_tickets: '/admin/support',
      kyc_documents: '/admin/kyc',
      wallet_transactions: '/admin/finance',
    }
    if (refTable && dest[refTable]) navigate(dest[refTable])
  }

  const dropdownContent = (
    <div style={{ width: 340, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
        <Text strong>Notifications</Text>
        <Switch size="small" checked={!muted} onChange={toggleMute} checkedChildren="🔔" unCheckedChildren="🔕" />
      </div>
      <List
        style={{ maxHeight: 360, overflowY: 'auto' }}
        dataSource={items.slice(0, 10)}
        locale={{ emptyText: <Empty description="No notifications yet" style={{ padding: 24 }} /> }}
        renderItem={(item) => (
          <List.Item
            style={{ padding: '10px 16px', cursor: 'pointer', background: item.read ? '#fff' : '#f6ffed' }}
            onClick={() => onItemClick(item.id, item.ref_table)}
          >
            <div>
              <Text strong={!item.read}>{item.title}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>{item.body}</Text>
            </div>
          </List.Item>
        )}
      />
      <div style={{ padding: 8, textAlign: 'center', borderTop: '1px solid #f0f0f0' }}>
        <Button type="link" size="small" onClick={() => navigate('/admin/notifications-history')}>View All</Button>
      </div>
    </div>
  )

  return (
    <Dropdown popupRender={() => dropdownContent} trigger={['click']} placement="bottomRight">
      <Badge count={unreadCount} size="small">
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
      </Badge>
    </Dropdown>
  )
}
```

- [ ] **Step 3: Mount it in `Layout.tsx`**

In `admin-panel/src/pages/Layout.tsx`, add the import after line 13 (`import { useAuthStore } from '../store/auth'`):

```typescript
import NotificationBell from '../components/NotificationBell'
```

Then in the header's right-hand `<div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>` block (line 153-164), add `<NotificationBell />` as the first child, immediately before the existing `<Dropdown>`:

```tsx
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <NotificationBell />
            <Dropdown menu={{ items: [
```

- [ ] **Step 4: Write `NotificationsHistory.tsx`**

```tsx
// admin-panel/src/pages/NotificationsHistory.tsx
import { useEffect, useState } from 'react'
import { Card, Table, Tag, Button, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { adminApi } from '../api/client'
import { useNotificationStore, type AdminNotification } from '../store/notifications'

const { Title } = Typography

export default function NotificationsHistory() {
  const { items, setInitial, markAllRead } = useNotificationStore()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchHistory()
  }, [])

  async function fetchHistory() {
    setLoading(true)
    try {
      const res = await adminApi.get('/notifications', { params: { limit: 200 } })
      const data: AdminNotification[] = res.data.notifications.map((n: any) => ({ ...n, read: false }))
      setInitial(data, res.data.unread_count)
    } catch {
      message.error('Failed to load notification history')
    } finally {
      setLoading(false)
    }
  }

  async function onMarkAllRead() {
    try {
      await adminApi.patch('/notifications/read-all')
      markAllRead()
      message.success('All marked as read')
    } catch {
      message.error('Failed to mark all as read')
    }
  }

  const columns: ColumnsType<AdminNotification> = [
    { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
    { title: 'Title', dataIndex: 'title' },
    { title: 'Details', dataIndex: 'body' },
    { title: 'Severity', dataIndex: 'severity', render: (v) => <Tag color={v === 'warning' ? 'orange' : 'blue'}>{v}</Tag> },
    { title: 'Date', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('en-IN') },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3}>Notification History</Title>
        <Button onClick={onMarkAllRead}>Mark All Read</Button>
      </div>
      <Card>
        <Table dataSource={items} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Add the route**

In the route file found in Step 1, add (following the exact pattern of the neighboring `/admin/notifications` route):

```tsx
<Route path="notifications-history" element={<NotificationsHistory />} />
```

And add the import at the top of that file:

```typescript
import NotificationsHistory from './pages/NotificationsHistory' // adjust relative path to match the file's existing imports
```

- [ ] **Step 6: Manual verification**

```bash
cd admin-panel && npm run dev
```

Open the admin panel in a browser, log in, confirm: the bell icon appears in the header, clicking it opens the dropdown (empty state or backfilled history), navigating to `/admin/notifications-history` shows the full table, and the mute `Switch` persists across a page reload.

- [ ] **Step 7: Commit**

```bash
git add admin-panel/src/components/NotificationBell.tsx admin-panel/src/pages/NotificationsHistory.tsx admin-panel/src/pages/Layout.tsx
git commit -m "feat: add notification bell UI and history page to admin panel"
```

(Include the route-file modification from Step 5 in this same commit — `git add` its actual path once located.)

---

## Task 8: End-to-end verification + VPS deploy

**Files:** none (deploy + verification only)

**Interfaces:** N/A — this task exercises the full stack built in Tasks 1-7.

- [ ] **Step 1: End-to-end local test**

With `admin-service` and `admin-panel` both running locally (`npm run dev` in each) and the DB migration from Task 1 applied, open the admin panel in two browser tabs logged in as a `finance`-or-higher admin. In a third terminal, insert a test deposit row:

```bash
docker exec teen_postgres psql -U teen -d teen_db -c \
  "INSERT INTO payment_orders (user_id, gateway, amount, type, status) VALUES ((SELECT id FROM users LIMIT 1), 'manual', 2500, 'deposit', 'created');"
```

Expected: both browser tabs show the bell badge increment, play the chime, and the dropdown shows "New Deposit Request" within ~1 second.

- [ ] **Step 2: Verify role scoping**

Log in as a `support`-role admin (no `finance`) in a separate tab. Repeat Step 1's insert. Expected: the `support` tab's bell does NOT update (deposits are `finance`-only), but inserting a test support ticket (per Task 1 Step 3) DOES notify it.

- [ ] **Step 3: Verify the polling fallback**

Temporarily comment out the `/ws/admin` nginx location (or block port access) if testing against a deployed environment, or simulate by closing the WS connection via browser devtools. Confirm the bell dropdown still updates within ~15s via the poll fallback in `useAdminNotifications.ts`.

- [ ] **Step 4: Build and deploy admin-service**

Follow this project's established deploy pattern:

```bash
cd services/admin-service && npm run build
```

Then `scp dist/` to the VPS admin-service directory, `pm2 restart teen-admin-svc`, and confirm clean startup with `pm2 logs teen-admin-svc --lines 30 --nostream` (look for "Listening for admin_events notifications" with no errors).

- [ ] **Step 5: Apply the migration on the VPS**

```bash
bash /opt/teen/infra/db/migrate.sh
```

Expected output includes `081_admin_notifications.sql` under "Applying pending migrations" with no errors.

- [ ] **Step 6: Deploy the nginx config change**

Copy the updated `infra/nginx/game.myonlinejoker.com.conf` to the VPS's active nginx config location, run `nginx -t` to validate syntax, then `nginx -s reload`. Confirm no errors from `nginx -t` before reloading (a syntax error here would take down the entire domain, not just this feature).

- [ ] **Step 7: Build and deploy admin-panel**

```bash
cd admin-panel && npm run build
```

Then back up the live docroot (timestamped), `scp -r dist/*` to it, and verify the deployed `index.html`'s bundle hash matches the fresh local build.

- [ ] **Step 8: Live verification**

Log into `https://game.myonlinejoker.com/admin/` as a real admin, confirm the bell renders in the header with no console errors, and (if safe to do so on production data) trigger one real low-risk event — e.g. open a real support ticket through the mobile app — to confirm the full pipeline fires live.
