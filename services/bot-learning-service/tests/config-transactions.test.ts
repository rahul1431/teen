import { ProfileBuilder, AuditLogger } from '../src/profile-builder'
import { Pool } from 'pg'
import Redis from 'ioredis'
import pino from 'pino'

// Mock implementations
const createMockPool = () => {
  const queryMock = jest.fn()
  const pool = {
    query: queryMock,
  } as any
  return { pool: pool as Pool, queryMock }
}

const createMockRedis = () => {
  return {
    del: jest.fn().mockResolvedValue(0),
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    publish: jest.fn().mockResolvedValue(0),
  } as any as Redis
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

const createMockAuditLogger = () => {
  return {
    logProfileChange: jest.fn().mockResolvedValue(undefined),
  } as any as AuditLogger
}

describe('Config Transactions', () => {
  describe('updateConfig', () => {
    it('should rollback all changes if one fails', async () => {
      // Setup
      const { pool, queryMock } = createMockPool()
      const redis = createMockRedis()
      const logger = createMockLogger()
      const auditLogger = createMockAuditLogger()

      // Mock sequence: BEGIN succeeds, first update succeeds, second update fails, ROLLBACK succeeds
      const querySequence = [
        { rowCount: 0 }, // BEGIN
        { rowCount: 1 }, // First config update (rebuild_hour)
        { error: new Error('Database connection lost') }, // Second config update (stream_lookback_days) - FAILS
        { rowCount: 0 }, // ROLLBACK
      ]
      let queryIndex = 0
      queryMock.mockImplementation(async (sql: string, params?: any[]) => {
        const result = querySequence[queryIndex]
        queryIndex++
        if ((result as any).error) throw (result as any).error
        return result
      })

      const builder = new (ProfileBuilder as any)(pool, redis, logger, undefined, auditLogger)

      // Test
      const updates = {
        rebuild_hour: '3',
        stream_lookback_days: '8',
      }

      await expect(builder.updateConfig(updates)).rejects.toThrow('Database connection lost')

      // Verify all queries were called in order
      expect(queryMock).toHaveBeenCalledTimes(4)

      // Verify BEGIN was called
      const firstCall = queryMock.mock.calls[0][0]
      expect(firstCall.toUpperCase()).toContain('BEGIN')

      // Verify ROLLBACK was called after error
      const lastCall = queryMock.mock.calls[3][0]
      expect(lastCall.toUpperCase()).toContain('ROLLBACK')

      // Verify auditLogger was NOT called (because transaction rolled back)
      expect(auditLogger.logProfileChange).not.toHaveBeenCalled()
    })

    it('should commit all changes atomically on success', async () => {
      // Setup
      const { pool, queryMock } = createMockPool()
      const redis = createMockRedis()
      const logger = createMockLogger()
      const auditLogger = createMockAuditLogger()

      // Mock sequence: BEGIN, 2 config updates, COMMIT all succeed
      const querySequence = [
        { rowCount: 0 }, // BEGIN
        { rowCount: 1 }, // First config update (rebuild_hour)
        { rowCount: 1 }, // Second config update (stream_lookback_days)
        { rowCount: 0 }, // COMMIT
      ]
      let queryIndex = 0
      queryMock.mockImplementation(async (sql: string, params?: any[]) => {
        const result = querySequence[queryIndex]
        queryIndex++
        if ((result as any).error) throw (result as any).error
        return result
      })

      const builder = new (ProfileBuilder as any)(pool, redis, logger, undefined, auditLogger)

      // Test
      const updates = {
        rebuild_hour: '3',
        stream_lookback_days: '8',
      }

      await expect(builder.updateConfig(updates)).resolves.toBeUndefined()

      // Verify all queries were called in correct order
      expect(queryMock).toHaveBeenCalledTimes(4)

      // Verify BEGIN was called
      const firstCall = queryMock.mock.calls[0][0]
      expect(firstCall.toUpperCase()).toContain('BEGIN')

      // Verify config updates were called with correct params
      const secondCall = queryMock.mock.calls[1]
      expect(secondCall[0].toUpperCase()).toContain('INSERT')
      expect(secondCall[1]).toEqual(['rebuild_hour', '3'])

      const thirdCall = queryMock.mock.calls[2]
      expect(thirdCall[0].toUpperCase()).toContain('INSERT')
      expect(thirdCall[1]).toEqual(['stream_lookback_days', '8'])

      // Verify COMMIT was called
      const lastCall = queryMock.mock.calls[3][0]
      expect(lastCall.toUpperCase()).toContain('COMMIT')

      // Verify auditLogger was called with the updates
      expect(auditLogger.logProfileChange).toHaveBeenCalledWith('config_updated', updates)
    })

    it('should validate numeric keys before transaction', async () => {
      // Setup
      const { pool, queryMock } = createMockPool()
      const redis = createMockRedis()
      const logger = createMockLogger()
      const auditLogger = createMockAuditLogger()

      const builder = new (ProfileBuilder as any)(pool, redis, logger, undefined, auditLogger)

      // Test invalid numeric value
      const updates = {
        rebuild_hour: 'not-a-number',
      }

      await expect(builder.updateConfig(updates)).rejects.toThrow(
        'Invalid numeric value for config key \'rebuild_hour\': not-a-number'
      )

      // Verify queryMock was never called (validation happens before BEGIN)
      expect(queryMock).not.toHaveBeenCalled()
    })

    it('should handle empty updates gracefully', async () => {
      // Setup
      const { pool, queryMock } = createMockPool()
      const redis = createMockRedis()
      const logger = createMockLogger()
      const auditLogger = createMockAuditLogger()

      const builder = new (ProfileBuilder as any)(pool, redis, logger, undefined, auditLogger)

      // Test
      const updates = {}

      await expect(builder.updateConfig(updates)).resolves.toBeUndefined()

      // Verify no database calls were made
      expect(queryMock).not.toHaveBeenCalled()
    })
  })
})
