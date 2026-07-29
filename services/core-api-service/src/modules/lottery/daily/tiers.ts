import { pool } from '../../../db/pool'
import { v4 as uuidv4 } from 'uuid'

export interface PrizeTier {
  match_type: 'last_1' | 'last_2' | 'last_3' | 'exact'
  outcome_type: 'cash' | 'coupon'
  multiplier?: number
  coupon_code?: string
}

export interface Tier {
  id: string
  amount: number
  draw_time: string // HH:MM:SS
  default_prize_tiers: PrizeTier[]
  status: 'active' | 'paused' | 'archived'
  created_at: string
}

export async function createTier(req: {
  amount: number
  draw_time: string
  default_prize_tiers: PrizeTier[]
  status?: string
}): Promise<Tier> {
  const id = uuidv4()
  const status = req.status || 'active'

  const query = `
    INSERT INTO lottery_daily_tiers (id, amount, draw_time, default_prize_tiers, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `

  const result = await pool.query(query, [
    id,
    req.amount,
    req.draw_time,
    JSON.stringify(req.default_prize_tiers),
    status,
  ])

  return formatTier(result.rows[0])
}

export async function getTiers(filters?: { status?: string }): Promise<Tier[]> {
  let query = 'SELECT * FROM lottery_daily_tiers'
  const params: any[] = []

  if (filters?.status) {
    query += ' WHERE status = $1'
    params.push(filters.status)
  }

  query += ' ORDER BY created_at DESC'

  const result = await pool.query(query, params)
  return result.rows.map(formatTier)
}

export async function getTier(id: string): Promise<Tier> {
  const result = await pool.query('SELECT * FROM lottery_daily_tiers WHERE id = $1', [id])

  if (!result.rows[0]) {
    throw new Error(`Tier ${id} not found`)
  }

  return formatTier(result.rows[0])
}

export async function updateTier(
  id: string,
  req: { draw_time?: string; default_prize_tiers?: PrizeTier[]; status?: string }
): Promise<Tier> {
  const updates: string[] = []
  const params: any[] = [id]
  let paramIndex = 2

  if (req.draw_time !== undefined) {
    updates.push(`draw_time = $${paramIndex++}`)
    params.push(req.draw_time)
  }

  if (req.default_prize_tiers !== undefined) {
    updates.push(`default_prize_tiers = $${paramIndex++}`)
    params.push(JSON.stringify(req.default_prize_tiers))
  }

  if (req.status !== undefined) {
    updates.push(`status = $${paramIndex++}`)
    params.push(req.status)
  }

  if (updates.length === 0) {
    return getTier(id)
  }

  const query = `
    UPDATE lottery_daily_tiers
    SET ${updates.join(', ')}
    WHERE id = $1
    RETURNING *
  `

  const result = await pool.query(query, params)

  if (!result.rows[0]) {
    throw new Error(`Tier ${id} not found`)
  }

  return formatTier(result.rows[0])
}

export async function archiveTier(id: string): Promise<void> {
  await updateTier(id, { status: 'archived' })
}

function formatTier(row: any): Tier {
  return {
    id: row.id,
    amount: row.amount,
    draw_time: row.draw_time,
    default_prize_tiers: row.default_prize_tiers,
    status: row.status,
    created_at: row.created_at,
  }
}
