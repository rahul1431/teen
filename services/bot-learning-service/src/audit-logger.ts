import { Pool } from 'pg'
import { Logger } from 'pino'

export interface AuditLogEntry {
  id: string
  game_type: string
  difficulty: string
  admin_user_id: string | null
  changes: Record<string, any>
  reason: string
  timestamp: string
}

/**
 * AuditLogger: Records all bot profile changes to database audit log
 * - Tracks who made the change, when, and what changed
 * - Supports both manual overrides (via admin) and automatic rebuilds
 */
export class AuditLogger {
  constructor(
    private pool: Pool,
    private logger: Logger
  ) {}

  /**
   * Log a bot profile change
   * @param gameType Game type (teen_patti, ludo, aviator)
   * @param difficulty Difficulty level (easy, medium, hard)
   * @param changes Object describing what changed (e.g., { field: { old, new } })
   * @param adminUserId ID of admin who made the change (null for automatic rebuilds)
   * @param reason Description of why the change was made
   */
  async logProfileChange(
    gameType: string,
    difficulty: string,
    changes: Record<string, any>,
    adminUserId: string | null,
    reason: string
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO bot_profile_audit_log
         (game_type, difficulty, admin_user_id, changes, reason, timestamp)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [gameType, difficulty, adminUserId, JSON.stringify(changes), reason]
      )
      this.logger.debug(
        { gameType, difficulty, adminUserId, reason },
        'Profile change audit logged'
      )
    } catch (error) {
      this.logger.error(
        { error, gameType, difficulty, reason },
        'Failed to log profile change audit'
      )
      throw error
    }
  }

  /**
   * Retrieve audit logs for a specific profile
   * @param gameType Game type
   * @param difficulty Difficulty level
   * @param limit Maximum number of entries to return
   */
  async getAuditLog(
    gameType: string,
    difficulty: string,
    limit: number
  ): Promise<AuditLogEntry[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, game_type, difficulty, admin_user_id, changes, reason, timestamp
         FROM bot_profile_audit_log
         WHERE game_type = $1 AND difficulty = $2
         ORDER BY timestamp DESC
         LIMIT $3`,
        [gameType, difficulty, limit]
      )
      return result.rows.map(row => ({
        ...row,
        changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes,
      }))
    } catch (error) {
      this.logger.error(
        { error, gameType, difficulty, limit },
        'Failed to retrieve audit log'
      )
      throw error
    }
  }

  /**
   * Retrieve recent changes across all profiles
   * @param limit Maximum number of entries to return
   */
  async getRecentChanges(limit: number): Promise<AuditLogEntry[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, game_type, difficulty, admin_user_id, changes, reason, timestamp
         FROM bot_profile_audit_log
         ORDER BY timestamp DESC
         LIMIT $1`,
        [limit]
      )
      return result.rows.map(row => ({
        ...row,
        changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes,
      }))
    } catch (error) {
      this.logger.error(
        { error, limit },
        'Failed to retrieve recent changes'
      )
      throw error
    }
  }
}
