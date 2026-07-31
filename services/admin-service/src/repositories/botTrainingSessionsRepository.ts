import { Database } from '../db'

export interface BotLearningSession {
  gameId: string
  gameType: string
  winnerBotId: string
  actualWinnerId: string
  botIds: string[]
  rpId: string
  strategyUsed: string
  targetWinRate: number
  coordinationSuccess: boolean
  createdAt: string
}

export interface SessionsQuery {
  gameType: string
  page?: number
  limit?: number
  startDate?: string
  endDate?: string
  botId?: string
  success?: boolean
}

export class BotTrainingSessionsRepository {
  constructor(private db: Database) {}

  async getSessions(query: SessionsQuery): Promise<{ total: number; sessions: BotLearningSession[] }> {
    const page = query.page || 1
    const limit = Math.min(query.limit || 20, 100) // Cap at 100
    const offset = (page - 1) * limit

    let whereClause = '1=1'
    const params: any[] = []

    params.push(query.gameType)
    whereClause += ` AND game_type = $${params.length}`

    if (query.startDate) {
      params.push(query.startDate)
      whereClause += ` AND created_at >= $${params.length}`
    }
    if (query.endDate) {
      params.push(query.endDate)
      whereClause += ` AND created_at <= $${params.length}`
    }
    if (query.botId !== undefined) {
      params.push(JSON.stringify([query.botId]))
      whereClause += ` AND bot_ids @> $${params.length}::jsonb`
    }
    if (query.success !== undefined) {
      params.push(query.success ? 1 : 0)
      whereClause += ` AND coordination_success = $${params.length}`
    }

    const countResult = await this.db.query(
      `SELECT COUNT(*) as total FROM bot_learning_sessions WHERE ${whereClause}`,
      params
    )
    const total = countResult.rows[0]?.total || 0

    params.push(limit)
    params.push(offset)
    const rows = await this.db.query(
      `SELECT * FROM bot_learning_sessions WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const sessions = rows.rows.map((row: any) => ({
      gameId: row.game_id,
      gameType: row.game_type,
      winnerBotId: row.winner_bot_id,
      actualWinnerId: row.actual_winner_id,
      botIds: row.bot_ids,
      rpId: row.rp_id,
      strategyUsed: row.strategy_used,
      targetWinRate: row.target_win_rate,
      coordinationSuccess: row.coordination_success,
      createdAt: row.created_at,
    }))

    return { total, sessions }
  }
}
