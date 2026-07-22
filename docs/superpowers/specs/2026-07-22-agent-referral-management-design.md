# Agent Referral Management

Date: 2026-07-22

## Problem

The Agent Portal (`admin-panel/src/pages/AgentPortal.tsx`) shows an agent's raw
referral code (`agents.referral_code`) as a plain stat, but nothing about how
that code performs: no visibility into how many people clicked their referral
link, how many of those signed up, or the conversion rate. Signups are
already attributed (`users.agent_id`, set at registration in
`services/core-api-service/src/plugins/auth.ts`), but link clicks aren't
recorded anywhere — the referral landing page
(`infra/web/join/index.html`) is a static, unauthenticated page with no
tracking call at all.

## Scope

- Clicks + signups + conversion rate, broken down by day (last 90 days,
  matching the existing Commission History tab's window) plus running totals.
- A full shareable link (not just the bare code) with a copy button.
- Every page load of the referral link counts as a click — no dedup by
  IP/device, no PII stored.
- Out of scope: deposit/active-player funnel beyond signup, per-click device
  detail, changes to the user-to-user (non-agent) referral flow.

## Design

### 1. Data model — new migration

```sql
-- infra/db/migrations/0NN_referral_clicks.sql
CREATE TABLE referral_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code VARCHAR(20) NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_clicks_ref_code ON referral_clicks(ref_code);
```

No IP, user agent, or other visitor data is stored — a click is just "this
ref code was hit at this time." This table records clicks for both agent
codes and regular user referral codes indiscriminately (the join page can't
distinguish them without a lookup), but the agent-facing query below only
ever reads rows matching that agent's own `referral_code`, so there's no
cross-contamination in what an agent sees.

### 2. Click tracking endpoint — `core-api-service`

New plugin `services/core-api-service/src/plugins/referral.ts`, registered
in `index.ts` alongside the other plugins (no auth — same "tolerates
unauthenticated caller" pattern as the existing `/events` endpoint in
`analytics.ts`):

```
POST /referral/click
Body: { ref_code: string }   (1-20 chars, matches agents.referral_code's VARCHAR(20))
-> 200 { success: true }
```

Inserts one row into `referral_clicks`. No validation against
`agents`/`users` tables — logging is intentionally blind and cheap. Relies on
the service's existing global rate limit (`@fastify/rate-limit`, 200
req/min/IP in `index.ts`) for abuse protection; no additional limiting.

### 3. Referral landing page — `infra/web/join/index.html`

The existing inline `<script>` already reads `ref` from the query string. Add
a fire-and-forget beacon when `ref` is non-empty:

```js
if (ref) {
  fetch('/api/referral/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref_code: ref }),
    keepalive: true,
  }).catch(() => {}); // never let tracking failure block the download buttons
}
```

### 4. nginx — new location block

`infra/web/join/index.html`'s fetch needs a route to reach
`core-api-service` (port 3001). This repo proxies each API namespace through
its own explicit `location` block (no catch-all `/api/`), so add, matching
the existing `/api/analytics/` block's shape:

```nginx
location /api/referral/ {
    limit_except POST { deny all; }
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 5. Agent-facing API — `agent-portal-routes.ts`

New route, behind the existing `authenticateAgent` guard:

```
GET /api/admin/agent-portal/referrals
-> 200 {
     rows: [{ date: 'YYYY-MM-DD', clicks: number, signups: number, conversion_rate: number }],
     totals: { clicks: number, signups: number, conversion_rate: number },
   }
```

Implementation: two queries (clicks grouped by day for this agent's
`referral_code`, signups grouped by day for this agent's `id` via
`users.agent_id`), merged by date. The merge itself is a pure function —
`mergeReferralRows(clicksRows, signupsRows)` — exported from a new
`services/admin-service/src/referral-metrics.ts` module (mirroring the
existing `pnl-dashboard-routes.ts` pattern of `computeRoiPct`/`bySign` as
standalone, unit-testable helpers rather than inline route logic), along
with `conversionRate(signups, clicks)` (`0` when `clicks` is `0`, to avoid
divide-by-zero). The route handler itself just runs the two queries and
calls these helpers. Window: last 90 days, matching the existing
`/agent-portal/ledger` endpoint.

### 6. Agent Portal UI — `AgentPortal.tsx`

- The existing "Your Referral Code" stat card becomes a card showing the
  full link (`${window.location.origin}/join?ref=${me.agent.referral_code}`)
  with a copy-to-clipboard button (same one-tap copy pattern already used
  elsewhere in the admin panel, e.g. Finance.tsx's UTR field).
- New "Referrals" tab (alongside the existing Players / Sub-Agents /
  Commission History tabs): 3 summary `Statistic` cards (Total Clicks, Total
  Signups, Conversion Rate) followed by a `Table` with one row per day
  (date, clicks, signups, conversion %), styled like the existing Commission
  History table.

## Deployment note (do not skip)

`infra/web/join/index.html` is served on the VPS from `/opt/teen/infra/web/join/`
(a plain static directory, per `hestia-proxy.conf`'s `/join` location block),
which is **outside** the git-tracked `/opt/teen-prod` checkout that normal
deploys `git pull` into. Deploying this feature requires, in addition to the
usual backend rebuild/restart and nginx reload:

```bash
cp /opt/teen-prod/infra/web/join/index.html /opt/teen/infra/web/join/index.html
```

Skipping this step means the click-tracking beacon never reaches production
even though every other piece of the feature is live — the same class of
config/deploy-path drift that has bitten this project before (see the
`/downloads` nginx-shadow incident).

## Testing

- **Automated (admin-service has vitest, unlike wallet-service):** unit
  tests in `services/admin-service/tests/referral-metrics.test.ts` for
  `mergeReferralRows` and `conversionRate` — the merge logic (dates present
  in only one source list, zero-click days, rounding) is exactly the kind of
  pure logic this repo's existing tests (`agent-hierarchy.test.ts`,
  `pnl-dashboard.test.ts`) cover directly, without a DB.
- **Manual (no DB fixture harness in this repo, so these stay manual):** hit
  `/join?ref=<code>` in a browser, confirm a row appears in
  `referral_clicks` with that code; register a new user with an agent's
  referral code, confirm `/api/admin/agent-portal/referrals` reflects it in
  the correct day's row.
- `npx tsc --noEmit` for `core-api-service`, `admin-service`, and
  `admin-panel`.
- Admin-panel new tab/copy button: visual confirmation on the deployed app,
  per established practice (live/visual checks happen there, not via browser
  automation here).
