import { AuditLogger } from '../src/audit-logger'
import { Pool } from 'pg'
import pino from 'pino'

// Mock helper functions
const createMockPool = () => {
  return {
    query: jest.fn(),
  } as unknown as any
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

describe('AuditLogger', () => {
  let pool: any
  let logger: any
  let auditLogger: AuditLogger

  beforeEach(() => {
    pool = createMockPool()
    logger = createMockLogger()
    auditLogger = new AuditLogger(pool, logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('logProfileChange', () => {
    it('should log a profile change with all fields', async () => {
      pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'audit-1' }] })

      const changes = {
        win_rate_target: { old: 50.0, new: 52.5 },
        fold_probability: { old: 0.3, new: 0.32 },
      }

      await auditLogger.logProfileChange('teen_patti', 'medium', changes, 'admin-user-123', 'Manual override')

      expect(pool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = pool.query.mock.calls[0]

      // Verify SQL contains INSERT and all columns
      expect(sql.toUpperCase()).toContain('INSERT INTO')
      expect(sql.toUpperCase()).toContain('BOT_PROFILE_AUDIT_LOG')
      expect(sql.toUpperCase()).toContain('GAME_TYPE')
      expect(sql.toUpperCase()).toContain('DIFFICULTY')
      expect(sql.toUpperCase()).toContain('ADMIN_USER_ID')
      expect(sql.toUpperCase()).toContain('CHANGES')
      expect(sql.toUpperCase()).toContain('REASON')

      // Verify parameters
      expect(params[0]).toBe('teen_patti')
      expect(params[1]).toBe('medium')
      expect(params[2]).toBe('admin-user-123')
      expect(JSON.parse(params[3])).toEqual(changes)
      expect(params[4]).toBe('Manual override')
    })

    it('should log a profile change with null admin_user_id', async () => {
      pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'audit-2' }] })

      const changes = { sample_size: { old: 100, new: 150 } }

      await auditLogger.logProfileChange('ludo', 'easy', changes, null, 'Automatic rebuild')

      expect(pool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = pool.query.mock.calls[0]

      expect(params[0]).toBe('ludo')
      expect(params[1]).toBe('easy')
      expect(params[2]).toBe(null)
      expect(JSON.parse(params[3])).toEqual(changes)
      expect(params[4]).toBe('Automatic rebuild')
    })

    it('should handle empty changes object', async () => {
      pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'audit-3' }] })

      const changes = {}

      await auditLogger.logProfileChange('aviator', 'hard', changes, 'admin-456', 'Test reason')

      expect(pool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = pool.query.mock.calls[0]

      expect(JSON.parse(params[3])).toEqual({})
    })

    it('should log complex nested changes', async () => {
      pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'audit-4' }] })

      const changes = {
        multiple_fields: {
          win_rate_target: { old: 45.0, new: 48.0 },
          fold_probability: { old: 0.4, new: 0.38 },
          call_probability: { old: 0.4, new: 0.42 },
          raise_probability: { old: 0.2, new: 0.2 },
          avg_stake_preference: { old: 10, new: 15 },
        },
      }

      await auditLogger.logProfileChange('teen_patti', 'easy', changes, 'admin-user-789', 'Bulk update')

      expect(pool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = pool.query.mock.calls[0]

      expect(JSON.parse(params[3])).toEqual(changes)
    })

    it('should throw an error if database query fails', async () => {
      pool.query.mockRejectedValue(new Error('Database connection lost'))

      const changes = { win_rate_target: { old: 50.0, new: 51.0 } }

      await expect(
        auditLogger.logProfileChange('teen_patti', 'medium', changes, 'admin-user-123', 'Test')
      ).rejects.toThrow('Database connection lost')

      expect(pool.query).toHaveBeenCalledTimes(1)
    })

    it('should handle all game types', async () => {
      pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'audit-5' }] })

      const gameTypes = ['teen_patti', 'ludo', 'aviator']
      const changes = { sample_size: { old: 50, new: 75 } }

      for (const gameType of gameTypes) {
        jest.clearAllMocks()
        pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: `audit-${gameType}` }] })

        await auditLogger.logProfileChange(gameType, 'medium', changes, 'admin-user-123', 'Test')

        const [sql, params] = pool.query.mock.calls[0]
        expect(params[0]).toBe(gameType)
      }
    })

    it('should handle all difficulty levels', async () => {
      pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'audit-6' }] })

      const difficulties = ['easy', 'medium', 'hard']
      const changes = { fold_probability: { old: 0.3, new: 0.32 } }

      for (const difficulty of difficulties) {
        jest.clearAllMocks()
        pool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: `audit-${difficulty}` }] })

        await auditLogger.logProfileChange('teen_patti', difficulty, changes, 'admin-user-123', 'Test')

        const [sql, params] = pool.query.mock.calls[0]
        expect(params[1]).toBe(difficulty)
      }
    })
  })

  describe('getAuditLog', () => {
    it('should retrieve audit logs for a specific game type and difficulty', async () => {
      const mockAuditRows = [
        {
          id: 'audit-1',
          game_type: 'teen_patti',
          difficulty: 'medium',
          admin_user_id: 'admin-123',
          changes: { win_rate_target: { old: 50, new: 52 } },
          reason: 'Manual override',
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          id: 'audit-2',
          game_type: 'teen_patti',
          difficulty: 'medium',
          admin_user_id: null,
          changes: { sample_size: { old: 100, new: 150 } },
          reason: 'Automatic rebuild',
          timestamp: '2024-01-02T00:00:00Z',
        },
      ]

      pool.query.mockResolvedValue({ rowCount: 2, rows: mockAuditRows })

      const logs = await auditLogger.getAuditLog('teen_patti', 'medium', 10)

      expect(pool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = pool.query.mock.calls[0]

      expect(sql.toUpperCase()).toContain('SELECT')
      expect(sql.toUpperCase()).toContain('BOT_PROFILE_AUDIT_LOG')
      expect(params[0]).toBe('teen_patti')
      expect(params[1]).toBe('medium')
      expect(params[2]).toBe(10)

      expect(logs).toEqual(mockAuditRows)
      expect(logs.length).toBe(2)
    })

    it('should handle empty audit logs', async () => {
      pool.query.mockResolvedValue({ rowCount: 0, rows: [] })

      const logs = await auditLogger.getAuditLog('aviator', 'hard', 10)

      expect(logs).toEqual([])
    })
  })

  describe('getRecentChanges', () => {
    it('should retrieve recent changes across all profiles', async () => {
      const mockAuditRows = [
        {
          id: 'audit-1',
          game_type: 'teen_patti',
          difficulty: 'medium',
          admin_user_id: 'admin-123',
          changes: { win_rate_target: { old: 50, new: 52 } },
          reason: 'Manual override',
          timestamp: '2024-01-02T00:00:00Z',
        },
        {
          id: 'audit-2',
          game_type: 'ludo',
          difficulty: 'easy',
          admin_user_id: null,
          changes: { sample_size: { old: 100, new: 150 } },
          reason: 'Automatic rebuild',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ]

      pool.query.mockResolvedValue({ rowCount: 2, rows: mockAuditRows })

      const logs = await auditLogger.getRecentChanges(20)

      expect(pool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = pool.query.mock.calls[0]

      expect(sql.toUpperCase()).toContain('SELECT')
      expect(sql.toUpperCase()).toContain('BOT_PROFILE_AUDIT_LOG')
      expect(sql.toUpperCase()).toContain('ORDER BY')
      expect(params[0]).toBe(20)

      expect(logs).toEqual(mockAuditRows)
      expect(logs.length).toBe(2)
    })

    it('should respect the limit parameter', async () => {
      pool.query.mockResolvedValue({ rowCount: 0, rows: [] })

      await auditLogger.getRecentChanges(5)

      const [sql, params] = pool.query.mock.calls[0]
      expect(params[0]).toBe(5)
    })
  })
})
