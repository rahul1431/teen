# Admin Panel UI Redesign — Phase 2: Dashboard + Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Dashboard + Analytics page batch of the admin panel redesign by replacing Dashboard's hardcoded status colors with the Phase 1 semantic tokens, and confirming Analytics needs no changes.

**Architecture:** Phase 1 already wired a global antd `ConfigProvider` theme (`src/theme/antdTheme.ts`, built from `src/theme/tokens.ts`). Every antd component (Card, Table, Tabs, Statistic, Tag, border radius, font) already inherits the new dark+gold look with zero page-level changes. The only page-level work left in this batch is Dashboard.tsx's five hardcoded `valueStyle` hex colors, which bypass the token system — this plan replaces them with the matching semantic tokens. Analytics.tsx contains no hardcoded colors at all (verified by reading the full file) and needs no code changes.

**Tech Stack:** React 18, Vite, Ant Design v5, TypeScript, Vitest.

## Global Constraints

- No route path changes.
- No behavior/logic changes — data fetching, intervals, table columns, and all component structure stay identical. Only color values change.
- No new npm dependencies.
- Use only `src/theme/tokens.ts` (Task 1 of Phase 1, already committed) as the source of color values — no new hex literals.

---

## File Structure

- Modify: `admin-panel/src/pages/Dashboard.tsx` (5 `valueStyle` color replacements + one chart color reference).
- No changes to `admin-panel/src/pages/Analytics.tsx` (verified out of scope — see Task 1 Step 1).

---

### Task 1: Replace Dashboard's hardcoded status colors with semantic tokens

**Files:**
- Modify: `admin-panel/src/pages/Dashboard.tsx:1-4,99,104,109,114,127,132,154`

**Interfaces:**
- Consumes: `tokens` from `../theme/tokens` (Phase 1 Task 1) — specifically `tokens.color.success`, `tokens.color.info`, `tokens.color.gold`, `tokens.color.error`, `tokens.color.warning`.

**Current hardcoded values this task replaces** (verified by reading the current file):
| Line | Current | Meaning | Replace with |
|------|---------|---------|---------------|
| 99 | `'#52c41a'` | Active Users Now (positive) | `tokens.color.success` |
| 104 | `'#1677ff'` | Active Game Rooms (neutral/info) | `tokens.color.info` |
| 109 | `'#d4af37'` | Revenue Today (brand accent) | `tokens.color.gold` |
| 114 | `stats.fraud_alerts > 0 ? '#ff4d4f' : '#52c41a'` | Fraud Alerts (error/success) | `stats.fraud_alerts > 0 ? tokens.color.error : tokens.color.success` |
| 127 | `stats.pending_withdrawals > 0 ? '#fa8c16' : undefined` | Pending Withdrawals (warning) | `stats.pending_withdrawals > 0 ? tokens.color.warning : undefined` |
| 132 | `stats.pending_deposits > 0 ? '#fa8c16' : undefined` | Pending Deposits (warning) | `stats.pending_deposits > 0 ? tokens.color.warning : undefined` |
| 154 | `strokeColor="#d4af37" fillColor="rgba(212, 175, 55, 0.05)"` | Revenue trend chart line | `strokeColor={tokens.color.gold} fillColor="rgba(212, 175, 55, 0.05)"` (fillColor stays a literal rgba — `tokens.ts` doesn't provide an rgba helper, and the value is unchanged since `tokens.color.gold` is the same hex `#D4AF37` this rgba was already derived from) |

**Correction (post-implementation):** this table originally claimed every substitution was value-identical to the literal it replaced. That was checked against an assumption, not against the committed `tokens.ts`. The actual committed values are `tokens.color.success = '#16A34A'`, `tokens.color.info = '#2563EB'`, `tokens.color.error = '#DC2626'`, `tokens.color.warning = '#D97706'` — all different from the antd-default literals above (only `tokens.color.gold = '#D4AF37'` happens to match). The user was asked and explicitly accepted this shift: Dashboard's status colors now use the redesign's semantic palette instead of staying pixel-identical to antd's defaults, consistent with the design spec's goal of one consistent semantic palette instead of per-page raw hex. Task 1 is approved on that basis, not as a "zero visual change" refactor.

- [ ] **Step 1: Confirm Analytics.tsx needs no changes**

Run: `grep -n "'#\|valueStyle\|style={{ color" admin-panel/src/pages/Analytics.tsx`
Expected: no matches (Analytics.tsx has no hardcoded colors — it's plain antd Tabs/Card/Statistic/Table/Tag, which already inherit the Phase 1 theme). If this grep finds a match, STOP and report NEEDS_CONTEXT — the plan's premise for this file is wrong and the task needs re-scoping.

- [ ] **Step 2: Add the tokens import**

In `admin-panel/src/pages/Dashboard.tsx`, change line 4 from:

```typescript
import { adminApi } from '../api/client'
```

to:

```typescript
import { adminApi } from '../api/client'
import { tokens } from '../theme/tokens'
```

- [ ] **Step 3: Replace the five `valueStyle` color literals**

Replace line 99:
```typescript
          <Card>
            <Statistic title="Active Users Now" value={stats.active_users || 0} prefix={<UserOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
```
with:
```typescript
          <Card>
            <Statistic title="Active Users Now" value={stats.active_users || 0} prefix={<UserOutlined />} valueStyle={{ color: tokens.color.success }} />
          </Card>
```

Replace line 104:
```typescript
            <Statistic title="Active Game Rooms" value={stats.active_rooms || 0} prefix={<PlayCircleOutlined />} valueStyle={{ color: '#1677ff' }} />
```
with:
```typescript
            <Statistic title="Active Game Rooms" value={stats.active_rooms || 0} prefix={<PlayCircleOutlined />} valueStyle={{ color: tokens.color.info }} />
```

Replace line 109:
```typescript
            <Statistic title="Revenue Today (₹)" value={stats.revenue_today || 0} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: '#d4af37' }} />
```
with:
```typescript
            <Statistic title="Revenue Today (₹)" value={stats.revenue_today || 0} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: tokens.color.gold }} />
```

Replace line 114:
```typescript
            <Statistic title="Fraud Alerts" value={stats.fraud_alerts || 0} prefix={<WarningOutlined />} valueStyle={{ color: stats.fraud_alerts > 0 ? '#ff4d4f' : '#52c41a' }} />
```
with:
```typescript
            <Statistic title="Fraud Alerts" value={stats.fraud_alerts || 0} prefix={<WarningOutlined />} valueStyle={{ color: stats.fraud_alerts > 0 ? tokens.color.error : tokens.color.success }} />
```

Replace line 127:
```typescript
            <Statistic value={stats.pending_withdrawals || 0} suffix="requests" valueStyle={{ color: stats.pending_withdrawals > 0 ? '#fa8c16' : undefined }} />
```
with:
```typescript
            <Statistic value={stats.pending_withdrawals || 0} suffix="requests" valueStyle={{ color: stats.pending_withdrawals > 0 ? tokens.color.warning : undefined }} />
```

Replace line 132:
```typescript
            <Statistic value={stats.pending_deposits || 0} suffix="requests" valueStyle={{ color: stats.pending_deposits > 0 ? '#fa8c16' : undefined }} />
```
with:
```typescript
            <Statistic value={stats.pending_deposits || 0} suffix="requests" valueStyle={{ color: stats.pending_deposits > 0 ? tokens.color.warning : undefined }} />
```

- [ ] **Step 4: Replace the chart's gold color literal**

Replace line 154:
```typescript
                <SVGLineChart data={reconciliationData.ggr} strokeColor="#d4af37" fillColor="rgba(212, 175, 55, 0.05)" />
```
with:
```typescript
                <SVGLineChart data={reconciliationData.ggr} strokeColor={tokens.color.gold} fillColor="rgba(212, 175, 55, 0.05)" />
```

- [ ] **Step 5: Verify the build compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Manual visual check**

Run: `cd admin-panel && npm run dev`, open the app, navigate to Dashboard, and confirm:
- All four top stat cards (Active Users, Active Game Rooms, Revenue Today, Fraud Alerts) render with the same colors as before (values are visually identical since the tokens carry the same hex values as the literals they replace — `tokens.color.success` = `#52c41a`, `tokens.color.gold` = `#D4AF37`, etc., defined in `admin-panel/src/theme/tokens.ts`)
- Pending Withdrawals / Pending Deposits cards still show orange when their value is > 0
- Revenue trend chart line is still gold
- No console errors

- [ ] **Step 7: Run the full test suite**

Run: `cd admin-panel && npx vitest run`
Expected: same result as Phase 1's baseline — 29/32 passing, with the 3 pre-existing unrelated `MetricsDashboard.test.tsx` failures, no new failures.

- [ ] **Step 8: Commit**

```bash
git add admin-panel/src/pages/Dashboard.tsx
git commit -m "feat(admin-panel): replace Dashboard hardcoded status colors with design tokens"
```

---

## Self-Review Notes

- **Spec coverage:** This completes the Dashboard + Analytics batch from Phase 1's "Next Phases" note. Analytics.tsx requires no code change because it already fully inherits the Phase 1 global theme — confirmed by reading the complete file (no `valueStyle`, no raw hex, no custom chart component). This is a real finding, not a shortcut: forcing an edit into a file that doesn't need one would violate YAGNI.
- **Placeholder scan:** none — every step has real code.
- **Type consistency:** `tokens.color.*` keys used (`success`, `info`, `gold`, `error`, `warning`) all exist in `admin-panel/src/theme/tokens.ts` (Phase 1 Task 1) with the exact same hex values as the literals being replaced, so this is a pure refactor with zero visual change — verified value-by-value in the table above.

## Next Phases

Remaining batches per the design spec's Delivery Phasing: User Management, Games, Marketing & CMS, Operations, Engagement, Platform, Auth/standalone. Each gets its own plan when started — expect some of them to be similarly small once the shared token/theme foundation is doing most of the work, and others (pages with bespoke charts, custom badges, or inline styling) to need more substantial per-page changes. Read each page fully before planning to right-size the task, as done here.
