# Live Commission Preview (Agent Portal)

Date: 2026-07-22

## Problem

Agent commission is only computed by a nightly batch job (`AgentSettlementJob`,
`services/admin-service/src/agent-settlement-job.ts`) that settles the
*previous* IST day between 00:00–00:30 IST. An agent whose referred player
plays today sees nothing in their Commission History or wallet balance until
after midnight — there's no way to see today's activity or its resulting
commission before then.

## Scope

- Show agents a **live, read-only estimate** of today's commission (direct +
  override + total), computed on-demand using the exact same settlement
  formula the nightly job uses — not a separate approximation.
- Show a **per-player breakdown for today**: each referred player's net
  house win/loss so far today.
- Nothing is written to `agent_commission_ledger` or `agent_wallets` by this
  feature — it is a pure read. The nightly job remains the only thing that
  actually pays out, unchanged.
- Out of scope: resolving which specific game (Teen Patti/Ludo/Aviator/
  Matka/Lottery/Cricket) each transaction came from — confirmed with the
  user that this needs cross-engine joins disproportionate to a preview
  feature; per-player rows show net win/loss only, not a per-game type
  column.
- Out of scope: a fabricated "this player's exact commission contribution."
  The real settlement formula (`calculateDailySettlement` in
  `services/admin-service/src/agent-settlement.ts`) computes direct
  commission from the *pool total* of an agent's players (with a
  floor-at-zero applied to the pool, not per player), so a naive per-player
  `rate * player_net_win` split would not sum to the true aggregate when
  players offset each other. The UI shows the real aggregate commission
  separately from the per-player raw win/loss numbers, never inventing a
  per-player commission split.

## Design

### 1. Backend — `GET /api/admin/agent-portal/commission/live`

New route in `agent-portal-routes.ts`, behind the existing `authenticateAgent`
guard.

**Step 1 — reuse the exact settlement formula for "today so far":**

```typescript
const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
```

Run the identical query shape used by `AgentSettlementJob.runSettlementForDate`
(same `status = 'completed'` filter — for the same doubling-prevention reason
documented there — and the same `AT TIME ZONE 'Asia/Kolkata'` day-boundary
logic), but for **all agents** (needed because `calculateDailySettlement`
computes override commission by walking the whole hierarchy, not just one
agent), scoped to `todayIst` instead of a fixed past date. Feed the result
into the existing pure `calculateDailySettlement(agents, playerLosses)` and
pick out the calling agent's own entry from the returned array.

**Step 2 — per-player rows for this agent only:**

```sql
SELECT u.username,
       COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
FROM wallet_transactions wt
JOIN users u ON u.id = wt.user_id
WHERE u.agent_id = $1
  AND wt.type IN ('game_debit', 'game_credit')
  AND wt.status = 'completed'
  AND wt.created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')
  AND wt.created_at <  ((CURRENT_DATE + 1) AT TIME ZONE 'Asia/Kolkata')
GROUP BY u.username
ORDER BY net_house_win DESC
```

**Response:**

```json
{
  "today": { "direct_commission": 4.34, "override_commission": 0, "total_commission": 4.34 },
  "players": [{ "username": "tessst", "net_house_win": 434.27 }]
}
```

If the agent has no entry in the computed settlement results (no activity
today), `today` is `{ direct_commission: 0, override_commission: 0,
total_commission: 0 }` and `players` is `[]` — not a 404, since "no activity
yet today" is a normal, expected state, not an error.

### 2. Agent Portal UI — `AgentPortal.tsx`

A new section inside the existing **Commission History** tab, above the
historical table: a small "Today (live estimate)" block with 3 `Statistic`s
(Direct / Override / Total, ₹-prefixed) and a compact table of today's
per-player net win/loss. Loaded via the same `Promise.all` in `load()` as
everything else in this page — no polling, manual refresh only (matches
the rest of this portal, which has no polling anywhere today).

## Testing

- **Automated:** none of this task's logic is new pure logic — it reuses the
  already-tested `calculateDailySettlement`. No new vitest file needed.
- **Manual:** hit the new endpoint as the `test1` test agent used to verify
  this feature request, confirm the returned `total_commission` matches the
  hand-computed expected value from today's real test transactions, and
  confirm it does NOT write anything to `agent_commission_ledger` or
  `agent_wallets` (diff those tables before/after the call).
- `npx tsc --noEmit` for `admin-service` and `admin-panel`.
