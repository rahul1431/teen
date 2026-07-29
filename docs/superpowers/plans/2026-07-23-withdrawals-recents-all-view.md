# Withdrawals: Recents Card + "All" Status View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "All" status option to the Withdrawals status filter and an always-visible "Recent Withdrawals" card (last 15, any status) above it, in Admin Panel → Finance → Withdrawals.

**Architecture:** Extract two small pure helpers (`buildWithdrawalsFilter`, `resolveWithdrawalsLimit`) into a new backend module so they're independently unit-testable per this codebase's existing convention (see `services/admin-service/src/pnl-dashboard-routes.ts` / `tests/pnl-dashboard.test.ts`), then wire them into the existing inline `GET /api/admin/finance/withdrawals` route in `index.ts`. On the frontend, extend the existing `Withdrawals()` component in `Finance.tsx` with the new dropdown option and a new card, following the `DealerTips()` "Recent Tips" card pattern already in the same file.

**Tech Stack:** Fastify + pg (`services/admin-service`), React + antd + vitest/testing-library (`admin-panel`).

## Global Constraints

- Backend query must stay `ORDER BY po.created_at DESC` and continue joining `users` for `username` — no schema changes.
- `status=all` must produce a query with **no** `po.status = ...` clause (not a clause matching all four statuses individually — the codebase may add new statuses later).
- `limit` must be clamped to a safe range (1–500) so a malformed/huge value can't turn into an unbounded query; default stays 100 (unchanged from current behavior) when omitted.
- Recents card timestamps use full `toLocaleString()` format, matching the main table — not relative time.
- Recents card has no pagination, no row actions (read-only), fixed to 15 rows.
- No changes to the PATCH approve/reject/revert endpoint or modal.

---

### Task 1: Backend — extract and test pure withdrawals-query helpers

**Files:**
- Create: `services/admin-service/src/withdrawals-query.ts`
- Test: `services/admin-service/tests/withdrawals-query.test.ts`

**Interfaces:**
- Produces: `buildWithdrawalsFilter(status: string | undefined): { clause: string; params: any[] }` — `clause` is either `''` (when `status` is `'all'`) or `'AND po.status = $1'` (any other value, including the default), `params` is `[]` or `[status || 'created']` respectively.
- Produces: `resolveWithdrawalsLimit(raw: unknown): number` — parses `raw` to an integer, clamps to `[1, 500]`, defaults to `100` when `raw` is missing/non-numeric.

- [ ] **Step 1: Write the failing tests**

```typescript
// services/admin-service/tests/withdrawals-query.test.ts
import { describe, it, expect } from 'vitest'
import { buildWithdrawalsFilter, resolveWithdrawalsLimit } from '../src/withdrawals-query'

describe('buildWithdrawalsFilter', () => {
  it('returns no status clause when status is "all"', () => {
    expect(buildWithdrawalsFilter('all')).toEqual({ clause: '', params: [] })
  })

  it('filters by the given status', () => {
    expect(buildWithdrawalsFilter('paid')).toEqual({ clause: 'AND po.status = $1', params: ['paid'] })
  })

  it('defaults to "created" when status is missing', () => {
    expect(buildWithdrawalsFilter(undefined)).toEqual({ clause: 'AND po.status = $1', params: ['created'] })
  })
})

describe('resolveWithdrawalsLimit', () => {
  it('defaults to 100 when raw is missing', () => {
    expect(resolveWithdrawalsLimit(undefined)).toBe(100)
  })

  it('parses a numeric string', () => {
    expect(resolveWithdrawalsLimit('15')).toBe(15)
  })

  it('clamps values above 500 down to 500', () => {
    expect(resolveWithdrawalsLimit('99999')).toBe(500)
  })

  it('clamps values below 1 up to 1', () => {
    expect(resolveWithdrawalsLimit('0')).toBe(1)
    expect(resolveWithdrawalsLimit('-5')).toBe(1)
  })

  it('defaults to 100 when raw is not a number', () => {
    expect(resolveWithdrawalsLimit('not-a-number')).toBe(100)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/admin-service && npx vitest run tests/withdrawals-query.test.ts`
Expected: FAIL with "Cannot find module '../src/withdrawals-query'"

- [ ] **Step 3: Write the minimal implementation**

```typescript
// services/admin-service/src/withdrawals-query.ts
export function buildWithdrawalsFilter(status: string | undefined): { clause: string; params: any[] } {
  if (status === 'all') return { clause: '', params: [] }
  return { clause: 'AND po.status = $1', params: [status || 'created'] }
}

export function resolveWithdrawalsLimit(raw: unknown): number {
  const n = parseInt(String(raw), 10)
  if (!Number.isFinite(n)) return 100
  return Math.min(500, Math.max(1, n))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/admin-service && npx vitest run tests/withdrawals-query.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/withdrawals-query.ts services/admin-service/tests/withdrawals-query.test.ts
git commit -m "feat(admin-service): add pure helpers for withdrawals status/limit filtering"
```

---

### Task 2: Backend — wire helpers into the withdrawals route

**Files:**
- Modify: `services/admin-service/src/index.ts:686-696`

**Interfaces:**
- Consumes: `buildWithdrawalsFilter`, `resolveWithdrawalsLimit` from Task 1 (`services/admin-service/src/withdrawals-query.ts`).

- [ ] **Step 1: Add the import**

Near the top of `services/admin-service/src/index.ts`, alongside the other local imports, add:

```typescript
import { buildWithdrawalsFilter, resolveWithdrawalsLimit } from './withdrawals-query'
```

- [ ] **Step 2: Replace the route body**

Replace the existing route (currently `index.ts:686-696`):

```typescript
  // GET /api/admin/finance/withdrawals
  app.get('/api/admin/finance/withdrawals', { onRequest: [authenticate] }, async (req, reply) => {
    const { status } = req.query as any
    const res = await db.query(`
      SELECT po.*, u.username FROM payment_orders po
      JOIN users u ON u.id = po.user_id
      WHERE po.type = 'withdrawal' AND po.status = $1
      ORDER BY po.created_at DESC LIMIT 100
    `, [status || 'created'])
    return reply.send(res.rows)
  })
```

with:

```typescript
  // GET /api/admin/finance/withdrawals
  // status='all' returns every status (used by the "All" filter and the Recents card);
  // any other value (or omitted) filters to that single status, defaulting to 'created'.
  app.get('/api/admin/finance/withdrawals', { onRequest: [authenticate] }, async (req, reply) => {
    const { status, limit } = req.query as any
    const { clause, params } = buildWithdrawalsFilter(status)
    const boundedLimit = resolveWithdrawalsLimit(limit)
    const res = await db.query(`
      SELECT po.*, u.username FROM payment_orders po
      JOIN users u ON u.id = po.user_id
      WHERE po.type = 'withdrawal' ${clause}
      ORDER BY po.created_at DESC LIMIT ${boundedLimit}
    `, params)
    return reply.send(res.rows)
  })
```

Note: `boundedLimit` is interpolated directly (not parameterized) because it's already an integer clamped by `resolveWithdrawalsLimit` — never raw user input — matching the existing `LIMIT 100` literal style in this file.

- [ ] **Step 3: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run the full admin-service test suite**

Run: `cd services/admin-service && npx vitest run`
Expected: all tests pass, including `withdrawals-query.test.ts` from Task 1

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): support status=all and limit on GET /finance/withdrawals"
```

---

### Task 3: Frontend — "All" filter option + Recent Withdrawals card

**Files:**
- Modify: `admin-panel/src/pages/Finance.tsx:99-213` (the `Withdrawals()` function)
- Test: `admin-panel/tests/Withdrawals.test.tsx`

**Interfaces:**
- Consumes: `adminApi.get('/finance/withdrawals', { params: { status, limit? } })` (existing client, now backed by Task 2's route).
- Consumes: `withdrawalDestination(metadata: any): string` — existing helper already defined above `Withdrawals()` in the same file (`Finance.tsx:89-96`), unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// admin-panel/tests/Withdrawals.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import Finance from '../src/pages/Finance'
import { adminApi } from '../src/api/client'

vi.mock('../src/api/client', () => ({
  adminApi: { get: vi.fn(), patch: vi.fn() },
}))

describe('Withdrawals tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(adminApi.get as any).mockImplementation((url: string) => {
      if (url === '/finance/stats') return Promise.resolve({ data: {} })
      if (url === '/finance/withdrawals') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    })
  })

  it('fetches a 15-row all-status page for the Recents card on mount', async () => {
    render(<Finance />)
    await waitFor(() => {
      expect(adminApi.get).toHaveBeenCalledWith('/finance/withdrawals', { params: { status: 'all', limit: 15 } })
    })
  })

  it('offers an "All" option in the status filter', async () => {
    render(<Finance />)
    await waitFor(() => expect(screen.getByText('Recent Withdrawals')).toBeInTheDocument())
    expect(screen.getAllByText('All').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-panel && npx vitest run tests/Withdrawals.test.tsx`
Expected: FAIL — no call with `{ status: 'all', limit: 15 }` yet, and no "Recent Withdrawals" text found

- [ ] **Step 3: Implement — add the "All" option to the status Select**

In `admin-panel/src/pages/Finance.tsx`, inside `Withdrawals()`, find the status `<Select>` (around line 141-145):

```tsx
        <Select value={status} onChange={setStatus} style={{ width: 160 }}>
          <Select.Option value="created">Pending</Select.Option>
          <Select.Option value="paid">Approved</Select.Option>
          <Select.Option value="refunded">Rejected</Select.Option>
        </Select>
```

Replace with:

```tsx
        <Select value={status} onChange={setStatus} style={{ width: 160 }}>
          <Select.Option value="created">Pending</Select.Option>
          <Select.Option value="paid">Approved</Select.Option>
          <Select.Option value="refunded">Rejected</Select.Option>
          <Select.Option value="all">All</Select.Option>
        </Select>
```

(No other change needed here — `load()` already passes `status` straight through as a query param, and the backend now understands `status=all`.)

- [ ] **Step 4: Implement — add the Recent Withdrawals card**

Still in `Withdrawals()`, add state and a loader for the recents list, and fetch it once on mount. Insert after the existing state declarations (after the `reason` state, before `load`):

```tsx
  const [recent, setRecent] = useState<any[]>([])
  const [recentLoading, setRecentLoading] = useState(false)

  const loadRecent = async () => {
    setRecentLoading(true)
    try {
      const res = await adminApi.get('/finance/withdrawals', { params: { status: 'all', limit: 15 } })
      setRecent(res.data)
    } finally { setRecentLoading(false) }
  }
  useEffect(() => { loadRecent() }, [])
```

Then, in the returned JSX, insert the card immediately before the existing `<Space style={{ marginBottom: 16 }}>` filter row:

```tsx
      <Card
        size="small"
        title="Recent Withdrawals"
        extra={<Button size="small" onClick={loadRecent} loading={recentLoading}>Refresh</Button>}
        style={{ marginBottom: 16 }}
      >
        <Table
          dataSource={recent}
          rowKey="id"
          size="small"
          loading={recentLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: 'User', dataIndex: 'username' },
            { title: 'Amount (₹)', dataIndex: 'amount', align: 'right' as const, render: (v: any) => parseFloat(v).toFixed(2) },
            { title: 'Status', dataIndex: 'status', render: (s: string) => (
              <Tag color={{ created: 'orange', paid: 'green', failed: 'red', refunded: 'purple' }[s] || 'default'}>{s}</Tag>
            )},
            { title: 'Requested', dataIndex: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
          ]}
          locale={{ emptyText: 'No withdrawals yet' }}
        />
      </Card>
```

`Card` is already imported at the top of `Finance.tsx` (line 3-5 import block), so no import changes are needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd admin-panel && npx vitest run tests/Withdrawals.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Type-check the frontend**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Run the full admin-panel test suite**

Run: `cd admin-panel && npx vitest run`
Expected: all tests pass, no regressions in other Finance/Dashboard tests

- [ ] **Step 8: Commit**

```bash
git add admin-panel/src/pages/Finance.tsx admin-panel/tests/Withdrawals.test.tsx
git commit -m "feat(admin-panel): add Recent Withdrawals card and All status filter"
```

---

## Manual Verification (after all tasks)

Per user's standing preference, this is verified via `tsc`/`vitest` only, not a live Chrome check — the user reviews visually on the VPS themselves. Confirm before considering the feature done:

- [ ] `cd services/admin-service && npx tsc --noEmit && npx vitest run` — all green
- [ ] `cd admin-panel && npx tsc --noEmit && npx vitest run` — all green
