import { pool } from '../../../db/pool'
import { v4 as uuidv4 } from 'uuid'
import { getTier, PrizeTier } from './tiers'

export interface Draw {
  id: string
  tier_id: string
  draw_date: string // YYYY-MM-DD
  draw_time: string // ISO timestamp
  status: 'open' | 'calling' | 'settled' | 'cancelled'
  winning_number: string | null
  prize_tiers: PrizeTier[]
  created_at: string
  tickets_count?: number
  bot_tickets_count?: number
}

export async function createDraw(req: {
  tier_id: string
  draw_date: Date
  prize_tiers?: PrizeTier[]
}): Promise<Draw> {
  const id = uuidv4()
  const tier = await getTier(req.tier_id)

  // Compute draw_time from draw_date + tier.draw_time
  const dateStr = req.draw_date.toISOString().split('T')[0] // YYYY-MM-DD
  const timeStr = tier.draw_time // HH:MM:SS
  const drawTimestamp = new Date(`${dateStr}T${timeStr}Z`)

  // Use provided prize_tiers or copy from tier defaults
  const prizeTiers = req.prize_tiers || tier.default_prize_tiers

  const botConfigRes = await pool.query('SELECT default_max_tickets FROM lottery_bot_config LIMIT 1')
  const maxTickets = botConfigRes.rows[0]?.default_max_tickets ?? 200

  const query = `
    INSERT INTO lottery_daily_draws (id, tier_id, draw_date, draw_time, status, prize_tiers, max_tickets)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `

  const result = await pool.query(query, [
    id,
    req.tier_id,
    dateStr,
    drawTimestamp.toISOString(),
    'open',
    JSON.stringify(prizeTiers),
    maxTickets,
  ])

  return formatDraw(result.rows[0])
}

export async function getDraw(id: string): Promise<Draw> {
  const result = await pool.query('SELECT * FROM lottery_daily_draws WHERE id = $1', [id])

  if (!result.rows[0]) {
    throw new Error(`Draw ${id} not found`)
  }

  return formatDraw(result.rows[0])
}

export async function getDrawsByTierAndDate(tier_id: string, draw_date: Date): Promise<Draw> {
  const dateStr = draw_date.toISOString().split('T')[0]

  const result = await pool.query(
    'SELECT * FROM lottery_daily_draws WHERE tier_id = $1 AND draw_date = $2',
    [tier_id, dateStr]
  )

  if (!result.rows[0]) {
    throw new Error(`Draw not found for tier ${tier_id} on ${dateStr}`)
  }

  return formatDraw(result.rows[0])
}

export async function getDrawsByStatus(status: string): Promise<Draw[]> {
  const result = await pool.query(
    'SELECT * FROM lottery_daily_draws WHERE status = $1 ORDER BY draw_time ASC',
    [status]
  )

  return result.rows.map(formatDraw)
}

export async function getDrawsDueForSettlement(): Promise<Draw[]> {
  const now = new Date().toISOString()

  const result = await pool.query(
    `SELECT * FROM lottery_daily_draws
     WHERE status IN ('open', 'calling')
     AND draw_time <= $1
     ORDER BY draw_time ASC`,
    [now]
  )

  return result.rows.map(formatDraw)
}

export async function getDrawsForToday(): Promise<Draw[]> {
  const today = new Date().toISOString().split('T')[0]

  const result = await pool.query(
    `SELECT d.*, COUNT(t.id)::int AS tickets_count,
            COUNT(t.id) FILTER (WHERE u.is_bot = true)::int AS bot_tickets_count
     FROM lottery_daily_draws d
     LEFT JOIN lottery_daily_tickets t ON t.draw_id = d.id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE d.draw_date = $1
     GROUP BY d.id
     ORDER BY d.draw_time ASC`,
    [today]
  )

  return result.rows.map(formatDraw)
}

export async function updateDrawStatus(id: string, status: string): Promise<Draw> {
  const result = await pool.query(
    'UPDATE lottery_daily_draws SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  )

  if (!result.rows[0]) {
    throw new Error(`Draw ${id} not found`)
  }

  return formatDraw(result.rows[0])
}

export async function updateDrawWinningNumber(
  id: string,
  winning_number: string
): Promise<Draw> {
  if (!/^\d{4}$/.test(winning_number)) {
    throw new Error('Winning number must be exactly 4 digits')
  }

  const result = await pool.query(
    'UPDATE lottery_daily_draws SET winning_number = $1 WHERE id = $2 RETURNING *',
    [winning_number, id]
  )

  if (!result.rows[0]) {
    throw new Error(`Draw ${id} not found`)
  }

  return formatDraw(result.rows[0])
}

export async function cancelDraw(id: string): Promise<void> {
  await updateDrawStatus(id, 'cancelled')
}

function formatDraw(row: any): Draw {
  return {
    id: row.id,
    tier_id: row.tier_id,
    draw_date: row.draw_date,
    draw_time: row.draw_time,
    status: row.status,
    winning_number: row.winning_number,
    prize_tiers: row.prize_tiers,
    created_at: row.created_at,
    ...(row.tickets_count !== undefined && { tickets_count: row.tickets_count }),
    ...(row.bot_tickets_count !== undefined && { bot_tickets_count: row.bot_tickets_count }),
  }
}
