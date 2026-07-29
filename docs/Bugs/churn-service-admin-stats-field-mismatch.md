# Churn Intelligence stats bar always shows zero — field names don't match between backend and admin panel

**Severity:** Medium (cosmetic/informational only — no data corruption or money impact, but the entire stats bar is non-functional)
**Found:** 2026-07-28, backend-services documentation pass
**Files:** `services/churn-service/src/churn-scorer.ts:278-289`, `admin-panel/src/components/AI/ChurnTab.tsx:18-27`, `admin-panel/src/components/AI/ChurnTab.tsx:156-175`

## What's wrong
`ChurnScorer.getStats()` (`churn-scorer.ts:278-289`) queries and returns:
```ts
{ low_count, medium_count, high_count, actions_today }
```
(one row from a single aggregate query with `COUNT(*) FILTER (WHERE risk_level = 'low'/'medium'/'high')` and a combined `actions_today` counter that doesn't distinguish bonuses from notifications).

The admin panel's `ChurnStats` TypeScript interface (`ChurnTab.tsx:18-27`) expects a completely different shape:
```ts
{ total_at_risk: number, by_level: { low: number, medium: number, high: number }, bonuses_sent_today: number, notifications_sent_today: number }
```
The stats bar (`ChurnTab.tsx:156-175`) reads `stats?.total_at_risk`, `stats?.by_level?.low/medium/high`, `stats?.bonuses_sent_today`, and `stats?.notifications_sent_today` — none of these keys exist on the actual response, so every one of them evaluates to `undefined` and falls through the `?? 0` default. The six stat tiles (Total At-Risk, Low/Medium/High Risk, Bonuses Sent Today, Notifications Sent Today) render `0` regardless of the real numbers in `user_churn_scores`.

This is a pure naming/shape mismatch, not a missing feature — the backend computes real per-level counts, they're just returned under different key names and without the nesting or bonus/notification split the frontend expects.

## Impact
Admins viewing the Churn Intelligence tab (`AIControlCenter.tsx` → `ChurnTab.tsx`) see a permanently-zeroed stats bar and have no way to gauge at-risk population size or daily re-engagement volume from that summary view — they'd have to infer it from the at-risk user table underneath, which does load correctly (it hits a different, correctly-shaped endpoint, `GET /api/churn/users`). Low severity since the underlying data isn't lost and the rest of the tab (user table, config form, re-engage buttons) works independently.

## Fix
Pick one side as canonical and update the other to match. Simplest fix is changing `ChurnScorer.getStats()` to return the shape the frontend already expects:
```ts
async getStats(): Promise<object> {
  const res = await this.pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE risk_level = 'low')    AS low,
      COUNT(*) FILTER (WHERE risk_level = 'medium') AS medium,
      COUNT(*) FILTER (WHERE risk_level = 'high')   AS high,
      COUNT(*) FILTER (WHERE action_taken IN ('bonus_credited','bonus+notification')
                         AND action_taken_at > NOW() - INTERVAL '1 day') AS bonuses_today,
      COUNT(*) FILTER (WHERE action_taken IN ('notification','bonus+notification')
                         AND action_taken_at > NOW() - INTERVAL '1 day') AS notifications_today
    FROM user_churn_scores
  `)
  const row = res.rows[0]
  return {
    total_at_risk: Number(row.low) + Number(row.medium) + Number(row.high),
    by_level: { low: Number(row.low), medium: Number(row.medium), high: Number(row.high) },
    bonuses_sent_today: Number(row.bonuses_today),
    notifications_sent_today: Number(row.notifications_today),
  }
}
```
This also fixes the `actions_today` blending of bonus and notification counts into one number, which the UI wants split apart anyway. `reEngageUser`'s auth-header/schema bug is now fixed (2026-07-29), so `action_taken` values will actually start populating going forward, making these counts meaningful.
