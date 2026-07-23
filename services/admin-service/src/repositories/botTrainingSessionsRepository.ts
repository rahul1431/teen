import { Database } from '../db'

export interface BotLearningSession {
  gameId: string
  winnerBotId: bigint
  actualWinnerId: bigint
  botIds: bigint[]
  rpId: bigint
  strategyUsed: string
  targetWinRate: number
  coordinationSuccess: boolean
  createdAt: string
}

export interface SessionsQuery {
  page?: number
  limit?: number
  startDate?: string
  endDate?: string
  botId?: bigint
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

    if (query.startDate) {
      whereClause += ' AND created_at >= ?'
      params.push(query.startDate)
    }
    if (query.endDate) {
      whereClause += ' AND created_at <= ?'
      params.push(query.endDate)
    }
    if (query.botId !== undefined) {
      whereClause += ' AND JSON_CONTAINS(bot_ids, ?)'
      params.push(JSON.stringify(query.botId))
    }
    if (query.success !== undefined) {
      whereClause += ' AND coordination_success = ?'
      params.push(query.success ? 1 : 0)
    }

    const countResult = await this.db.query(
      `SELECT COUNT(*) as total FROM bot_learning_sessions WHERE ${whereClause}`,
      params
    )
    const total = countResult[0]?.total || 0

    const rows = await this.db.query(
      `SELECT * FROM bot_learning_sessions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )

    const sessions = rows.map((row: any) => ({
      gameId: row.game_id,
      winnerBotId: row.winner_bot_id,
      actualWinnerId: row.actual_winner_id,
      botIds: JSON.parse(row.bot_ids),
      rpId: row.rp_id,
      strategyUsed: row.strategy_used,
      targetWinRate: row.target_win_rate,
      coordinationSuccess: row.coordination_success,
      createdAt: row.created_at,
    }))

    return { total, sessions }
  }
}
