export type MissionCategory = 'weekly' | 'monthly' | 'one_time'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function toIstShifted(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS)
}

function fromIstShifted(d: Date): Date {
  return new Date(d.getTime() - IST_OFFSET_MS)
}

function isoWeekKey(istShiftedMonday: Date): string {
  // istShiftedMonday is already the Monday 00:00 of the IST week, expressed
  // in the shifted (fake-UTC) frame. Standard ISO-8601 week number algorithm.
  const d = new Date(Date.UTC(istShiftedMonday.getUTCFullYear(), istShiftedMonday.getUTCMonth(), istShiftedMonday.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/**
 * Computes the current mission period for a given category, aligned to IST
 * day boundaries (weekly resets Monday 00:00 IST, monthly resets the 1st
 * 00:00 IST). Returned start/end are real UTC instants suitable for a SQL
 * `created_at >= start AND created_at < end` range query.
 */
export function getCurrentPeriod(category: MissionCategory, now: Date): { key: string; start: Date; end: Date } {
  if (category === 'one_time') {
    return { key: 'lifetime', start: new Date(0), end: new Date(now.getTime() + 1) }
  }

  const ist = toIstShifted(now)

  if (category === 'monthly') {
    const startIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1))
    const endIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1))
    const key = `${startIst.getUTCFullYear()}-${String(startIst.getUTCMonth() + 1).padStart(2, '0')}`
    return { key, start: fromIstShifted(startIst), end: fromIstShifted(endIst) }
  }

  // weekly
  const isoDay = (ist.getUTCDay() + 6) % 7 // Monday=0 .. Sunday=6
  const startIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - isoDay))
  const endIst = new Date(startIst.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { key: isoWeekKey(startIst), start: fromIstShifted(startIst), end: fromIstShifted(endIst) }
}

/**
 * The one formula every mission metric type shares: how many more times can
 * this user claim the reward this period, given their raw activity metric?
 */
export function computeCompletionsAvailable(
  metricValue: number,
  targetValue: number,
  maxCompletionsPerPeriod: number | null,
  alreadyClaimed: number,
): number {
  const eligible = Math.floor(metricValue / targetValue)
  const capped = maxCompletionsPerPeriod === null ? eligible : Math.min(eligible, maxCompletionsPerPeriod)
  return Math.max(0, capped - alreadyClaimed)
}
