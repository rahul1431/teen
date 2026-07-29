# Marketing Channel Directory (Agent + Admin)

Date: 2026-07-22

## Problem

Agents run their own promotional Telegram groups / WhatsApp groups to funnel
players toward their referral link, but there's nowhere to register those
channels — admin has no oversight of which agent runs which channel. This is
the first of several planned "marketing tools" pieces (see the fuller
decomposition discussed with the user — poster/banner tools and
Telegram/WhatsApp broadcast messaging are separate, later projects; broadcast
messaging is additionally blocked on the user setting up a Telegram bot token
and WhatsApp Business API access).

## Scope

- Agents can register any number of channels (Telegram, WhatsApp, or
  "other") with a label and URL.
- New submissions start `pending`; an admin reviews and approves or rejects
  each one (with an optional reason on rejection) — mirrors the existing
  `bank_details` verification pattern (`services/core-api-service/src/plugins/users.ts`
  GET/PUT `/users/me/bank`, admin verify in the same file).
- Visibility is internal-only: approved channels are visible to admin and to
  the agent who submitted them, never to players or the public. No public
  directory page.
- Out of scope (explicitly deferred): admin's own "official" company channel
  links, a public-facing directory, poster/banner design tools, and any real
  Telegram/WhatsApp message-sending integration — this feature is a registry,
  not a messaging tool.

## Design

### 1. Data model — new migration

```sql
CREATE TABLE agent_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('telegram', 'whatsapp', 'other')),
  label VARCHAR(100) NOT NULL,
  url VARCHAR(300) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES admin_users(id)
);

CREATE INDEX idx_agent_channels_agent_id ON agent_channels(agent_id);
CREATE INDEX idx_agent_channels_status ON agent_channels(status);
```

No uniqueness constraint on `(agent_id, platform)` — an agent can register
multiple channels on the same platform (per the user's explicit choice).

### 2. Agent-facing API — `agent-portal-routes.ts`

Behind the existing `authenticateAgent` guard, using the same
`(req.user as any).sub` idiom as every other route in this file:

```
GET    /api/admin/agent-portal/channels        -> 200 [{ id, platform, label, url, status, rejection_reason, created_at }, ...]
POST   /api/admin/agent-portal/channels        body { platform, label, url } -> 201 { id, ...same shape, status: 'pending' }
DELETE /api/admin/agent-portal/channels/:id     -> 200 { success: true }  (only if the row's agent_id matches the caller)
```

Basic per-platform URL sanity check on POST (rejects with 400, not silently
accepted, so an agent finds out immediately rather than waiting for an
admin to reject a malformed link days later):
- `platform: 'telegram'` → URL must contain `t.me/` or `telegram.me/`
- `platform: 'whatsapp'` → URL must contain `wa.me/` or `chat.whatsapp.com/`
- `platform: 'other'` → any `http(s)://` URL

DELETE only removes the caller's own row (scoped by `agent_id = $1` in the
`WHERE`, not just the row id) — an agent must never be able to delete
another agent's channel by guessing an id.

### 3. Admin-facing API — new routes in `agent-routes.ts`

Behind `{ onRequest: [authenticate, requireRole('finance')] }` — matching
the role used to gate other financial/oversight admin routes in this
codebase (e.g. bank-details verification and withdrawal approval both use
`finance`-tier or above):

```
GET   /api/admin/agent-channels?status=pending   -> 200 [{ id, agent_id, agent_display_name, platform, label, url, status, rejection_reason, created_at }, ...]
PATCH /api/admin/agent-channels/:id              body { status: 'approved' | 'rejected', rejection_reason?: string } -> 200 { success: true }
```

`GET` joins `agents` for `display_name` (admin needs to know *whose* channel
it's reviewing, not just an opaque `agent_id`). `status` query param is
optional — omitted means all statuses. `PATCH` requires `rejection_reason`
when `status: 'rejected'` (mirrors the existing withdrawal-rejection flow's
"reason required" validation in `admin-panel/src/pages/Finance.tsx`).

### 4. Agent Portal UI — new "Channels" tab in `AgentPortal.tsx`

- A small form (platform `Select`, label `Input`, URL `Input`) to add a
  channel.
- A list/table of the agent's own channels with a status `Tag` (orange
  "Pending", green "Approved", red "Rejected" — same color convention as
  the existing status badges elsewhere in this file and in
  `BankDetailsPage.dart`'s pending/verified badge), showing
  `rejection_reason` under a rejected row.
- Delete button per row.

### 5. Admin Panel UI — new tab in `Marketing.tsx`

"Agent Channels" tab: a table of all submissions (agent name, platform,
label, URL, status, submitted date) with a status filter, and
approve/reject actions per pending row — reject opens a small modal asking
for a reason (required), approve is a single click. Same interaction shape
as the existing Finance.tsx withdrawal approve/reject modal.

## Testing

- **Automated:** admin-service has vitest — the per-platform URL validation
  is exactly the kind of pure logic this repo's existing tests
  (`agent-hierarchy.test.ts`, `referral-metrics.test.ts`) cover directly, so
  it should be extracted into a small testable function rather than inlined
  in the route handler.
- **Manual:** submit a channel as an agent, confirm it shows `pending` in
  both the Agent Portal and the Admin Panel; approve it, confirm the agent
  sees `approved`; reject one with a reason, confirm the agent sees the
  reason; confirm one agent cannot delete another agent's channel via a
  direct API call with a foreign channel id.
- `npx tsc --noEmit` for `admin-service` and `admin-panel`.
