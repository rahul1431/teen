# Withdrawals: Recents card + "All" status view

## Problem

Admin Panel → Finance → Withdrawals only shows one status at a time (Pending /
Approved / Rejected) via a dropdown. There's no way to see everything at a
glance, and no quick view of the most recent withdrawal activity without
switching the filter repeatedly.

## Design

### Backend — `services/admin-service/src/index.ts`

`GET /api/admin/finance/withdrawals` (line ~687):

- Accept `status=all` as a sentinel meaning "no status filter" — drop the
  `AND po.status = $1` clause and return withdrawal orders of every status,
  still `ORDER BY po.created_at DESC`.
- Accept an optional `limit` query param (integer, default 100, used as-is
  in the existing `LIMIT` clause) so the frontend can request a short page
  (15) for the Recents card without a second endpoint.

No other behavior changes; the PATCH approve/reject/revert endpoint is
untouched.

### Frontend — `admin-panel/src/pages/Finance.tsx`, `Withdrawals()`

1. **Status filter dropdown**: add an `"All"` option (`value="all"`) alongside
   Pending/Approved/Rejected. Selecting it calls the API with `status=all`
   and renders every status in the same table — the existing `Status` column
   (colored Tag) already differentiates rows, so no table changes needed
   beyond the new filter option.

2. **Recent Withdrawals card**: a new `<Card title="Recent Withdrawals">`
   rendered above the existing filter `<Space>` + table, always visible
   regardless of the selected status filter.
   - Fetches independently via `adminApi.get('/finance/withdrawals', { params: { status: 'all', limit: 15 } })` on mount, with its own small "Refresh" button (mirrors the pattern already used in `DealerTips`'s "Recent Tips" card).
   - Dense/small `<Table>`, columns: User, Amount (₹), Status (Tag), Requested
     (full timestamp via `new Date(v).toLocaleString()` — same format as the
     main table, not relative time).
   - No pagination controls (fixed to the 15 most recent); no row actions —
     this is a read-only glance view. Approve/reject still happens in the
     main table below.

### Out of scope

- No changes to the approve/reject/revert modal or PATCH logic.
- No new backend table/column — reuses `payment_orders`.
- Recents card is not auto-refreshing/polling; manual refresh only, matching
  existing Finance tab conventions.
