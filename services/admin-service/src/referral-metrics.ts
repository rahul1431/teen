// Pure helpers for the agent-facing referral dashboard
// (GET /api/admin/agent-portal/referrals). Kept separate from the route
// handler so they're unit-testable without a database — see
// pnl-dashboard-routes.ts's computeRoiPct/bySign for the same pattern.

export function conversionRate(signups: number, clicks: number): number {
  if (clicks === 0) return 0
  return signups / clicks
}

interface ClickRow { date: string; clicks: number }
interface SignupRow { date: string; signups: number }
interface MergedRow { date: string; clicks: number; signups: number; conversion_rate: number }

export function mergeReferralRows(clickRows: ClickRow[], signupRows: SignupRow[]): MergedRow[] {
  const byDate = new Map<string, { clicks: number; signups: number }>()

  for (const row of clickRows) {
    byDate.set(row.date, { clicks: row.clicks, signups: byDate.get(row.date)?.signups ?? 0 })
  }
  for (const row of signupRows) {
    byDate.set(row.date, { clicks: byDate.get(row.date)?.clicks ?? 0, signups: row.signups })
  }

  return Array.from(byDate.entries())
    .map(([date, { clicks, signups }]) => ({
      date,
      clicks,
      signups,
      conversion_rate: conversionRate(signups, clicks),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
