export interface CampaignsFilter {
  clause: string
  params: any[]
}

/** Builds the WHERE clause + params for filtering notification_campaigns by
 *  type and/or a created_at date range. Params are numbered starting at
 *  $1 so callers can safely append LIMIT/OFFSET placeholders after. */
export function buildCampaignsFilter(type?: string, startDate?: string, endDate?: string): CampaignsFilter {
  const conditions: string[] = []
  const params: any[] = []
  let idx = 1

  if (type) {
    conditions.push(`type = $${idx}`)
    params.push(type)
    idx++
  }
  if (startDate) {
    conditions.push(`created_at >= $${idx}`)
    params.push(startDate)
    idx++
  }
  if (endDate) {
    conditions.push(`created_at <= $${idx}`)
    params.push(endDate)
    idx++
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/** Clamps a raw page-size query param to [1, 100], defaulting to 20. */
export function resolveCampaignsLimit(raw?: string): number {
  const n = parseInt(raw ?? '', 10)
  if (isNaN(n)) return 20
  return Math.max(1, Math.min(n, 100))
}

/** Read rate as a 0-1 fraction; 0 when there were no recipients (avoids
 *  divide-by-zero showing as NaN in the UI). */
export function computeReadRate(readCount: number, totalRecipients: number): number {
  if (totalRecipients <= 0) return 0
  return readCount / totalRecipients
}
