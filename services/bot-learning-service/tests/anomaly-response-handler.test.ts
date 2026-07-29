import { AnomalyResponseHandler, AnomalyRecord } from '../src/anomaly-response-handler'
import pino from 'pino'

// Mock helper functions
const createMockPool = () => {
  return {
    connect: jest.fn(),
    query: jest.fn(),
  } as unknown as any
}

const createMockClient = () => {
  return {
    query: jest.fn(),
    release: jest.fn(),
  }
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

describe('AnomalyResponseHandler', () => {
  let pool: any
  let logger: any
  let handler: AnomalyResponseHandler
  let mockClient: any

  beforeEach(() => {
    pool = createMockPool()
    logger = createMockLogger()
    mockClient = createMockClient()
    pool.connect.mockResolvedValue(mockClient)

    handler = new AnomalyResponseHandler(pool, logger, 'https://hooks.slack.com/test')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('processAnomalies', () => {
    it('should pause players with confidence > 0.7', async () => {
      const mockAnomalies: AnomalyRecord[] = [
        {
          id: 'anom-1',
          player_id: 'player-1',
          anomaly_type: 'win_rate_spike',
          confidence: 0.85,
          anomaly_score: 0.8,
          feature_zscore: 3.2,
          status: 'new',
          created_at: new Date(),
        },
      ]

      // Mock all query calls
      let callCount = 0
      mockClient.query.mockImplementation(async (query: string) => {
        callCount++
        if (query.includes('BEGIN')) {
          return {}
        } else if (query.includes('SELECT') && query.includes('player_anomalies')) {
          return { rows: mockAnomalies }
        } else if (query.includes('UPDATE users')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO support_tickets')) {
          return { rows: [{ id: 'ticket-1' }] }
        } else if (query.includes('UPDATE player_anomalies')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO anomaly_response_log')) {
          return { rowCount: 1 }
        } else if (query.includes('COMMIT')) {
          return {}
        } else if (query.includes('ROLLBACK')) {
          return {}
        }
        return { rows: [], rowCount: 0 }
      })

      global.fetch = jest.fn().mockResolvedValue({ ok: true })

      const stats = await handler.processAnomalies()

      expect(stats.total_anomalies_processed).toBe(1)
      expect(stats.players_paused).toBe(1)
      expect(stats.support_tickets_created).toBe(1)
      expect(stats.slack_alerts_sent).toBe(1)
      expect(stats.errors).toBe(0)
    })

    it('should create high-priority support tickets', async () => {
      const mockAnomalies: AnomalyRecord[] = [
        {
          id: 'anom-1',
          player_id: 'player-1',
          anomaly_type: 'bet_aggression',
          confidence: 0.75,
          anomaly_score: 0.7,
          feature_zscore: 2.8,
          status: 'new',
          created_at: new Date(),
        },
      ]

      // Mock all query calls
      mockClient.query.mockImplementation(async (query: string) => {
        if (query.includes('BEGIN')) {
          return {}
        } else if (query.includes('SELECT') && query.includes('player_anomalies')) {
          return { rows: mockAnomalies }
        } else if (query.includes('UPDATE users')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO support_tickets')) {
          return { rows: [{ id: 'ticket-1' }] }
        } else if (query.includes('UPDATE player_anomalies')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO anomaly_response_log')) {
          return { rowCount: 1 }
        } else if (query.includes('COMMIT')) {
          return {}
        }
        return { rows: [], rowCount: 0 }
      })

      global.fetch = jest.fn().mockResolvedValue({ ok: true })

      const stats = await handler.processAnomalies()

      // Check that support ticket creation was attempted
      const ticketCall = mockClient.query.mock.calls.find((call: any[]) => {
        return call[0] && call[0].includes('INSERT INTO support_tickets')
      })

      expect(ticketCall).toBeDefined()
      // Check that the priority parameter (5th position, index 4) is 'high'
      if (ticketCall && ticketCall[1]) {
        const params = ticketCall[1]
        expect(params[params.length - 1]).toBe('high') // last param is priority
      }
    })

    it('should send Slack alerts with correct format', async () => {
      const mockAnomalies: AnomalyRecord[] = [
        {
          id: 'anom-1',
          player_id: 'player-1',
          anomaly_type: 'churn_risk',
          confidence: 0.9,
          anomaly_score: 0.85,
          feature_zscore: 4.1,
          status: 'new',
          created_at: new Date(),
        },
      ]

      // Mock all query calls
      mockClient.query.mockImplementation(async (query: string) => {
        if (query.includes('BEGIN')) {
          return {}
        } else if (query.includes('SELECT') && query.includes('player_anomalies')) {
          return { rows: mockAnomalies }
        } else if (query.includes('UPDATE users')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO support_tickets')) {
          return { rows: [{ id: 'ticket-1' }] }
        } else if (query.includes('UPDATE player_anomalies')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO anomaly_response_log')) {
          return { rowCount: 1 }
        } else if (query.includes('COMMIT')) {
          return {}
        }
        return { rows: [], rowCount: 0 }
      })

      global.fetch = jest.fn().mockResolvedValue({ ok: true })

      const stats = await handler.processAnomalies()

      expect(global.fetch).toHaveBeenCalled()
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
      expect(fetchCall[0]).toBe('https://hooks.slack.com/test')

      const messageBody = JSON.parse(fetchCall[1].body)
      expect(messageBody.channel).toBe('#game-fraud-alerts')
      expect(messageBody.text).toContain('ANOMALY')
      expect(messageBody.attachments[0].fields.length).toBeGreaterThan(0)
    })

    it('should handle admin overrides', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      const result = await handler.handleAdminOverride(
        'player-1',
        'anom-1',
        'admin-1',
        'False positive'
      )

      expect(result).toBe(true)

      // Check that player status was updated to 'active'
      const updateUserCall = mockClient.query.mock.calls.find((call: any[]) => {
        return call[0] && call[0].includes('UPDATE users')
      })
      expect(updateUserCall).toBeDefined()
      expect(updateUserCall[1][0]).toBe('active')

      // Check that anomaly status was updated to 'overridden'
      const updateAnomalyCall = mockClient.query.mock.calls.find((call: any[]) => {
        return call[0] && call[0].includes('overridden')
      })
      expect(updateAnomalyCall).toBeDefined()
    })

    it('should avoid duplicate pauses', async () => {
      mockClient.query = jest.fn()
      pool.query = jest.fn().mockResolvedValue({ rows: [{ count: '1' }] })

      const hasPause = await handler.hasPendingPause('player-1')

      expect(hasPause).toBe(true)
    })
  })

  describe('generateDailyReport', () => {
    it('should generate daily report with paused players and ticket backlog', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // paused count
        .mockResolvedValueOnce({ rows: [{ count: '12' }] }) // ticket count
        .mockResolvedValueOnce({
          rows: [
            { anomaly_type: 'win_rate_spike', count: '3' },
            { anomaly_type: 'bet_aggression', count: '2' },
          ],
        }) // anomaly types

      pool.connect.mockResolvedValue(mockClient)

      const report = await handler.generateDailyReport()

      expect(report.players_paused).toBe('5')
      expect(report.support_tickets_backlog).toBe('12')
      expect(report.anomalies_by_type).toBeDefined()
      expect(report.anomalies_by_type.win_rate_spike).toBe('3')
    })
  })

  describe('dismissAnomaly', () => {
    it('should dismiss anomaly with admin reason', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })
      pool.connect.mockResolvedValue(mockClient)

      const result = await handler.dismissAnomaly('anom-1', 'admin-1', 'False positive investigation')

      expect(result).toBe(true)

      const dismissCall = mockClient.query.mock.calls[0]
      expect(dismissCall[0]).toContain('dismissed')
      expect(dismissCall[1][2]).toBe('False positive investigation')
    })
  })

  describe('error handling', () => {
    it('should handle errors gracefully during processing', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('DB connection failed'))
      mockClient.query.mockResolvedValueOnce({}) // ROLLBACK

      const stats = await handler.processAnomalies()

      expect(stats.errors).toBeGreaterThan(0)
    })

    it('should handle Slack webhook failure gracefully', async () => {
      const mockAnomalies: AnomalyRecord[] = [
        {
          id: 'anom-1',
          player_id: 'player-1',
          anomaly_type: 'game_frequency',
          confidence: 0.8,
          anomaly_score: 0.75,
          feature_zscore: 3.5,
          status: 'new',
          created_at: new Date(),
        },
      ]

      // Mock all query calls
      mockClient.query.mockImplementation(async (query: string) => {
        if (query.includes('BEGIN')) {
          return {}
        } else if (query.includes('SELECT') && query.includes('player_anomalies')) {
          return { rows: mockAnomalies }
        } else if (query.includes('UPDATE users')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO support_tickets')) {
          return { rows: [{ id: 'ticket-1' }] }
        } else if (query.includes('UPDATE player_anomalies')) {
          return { rowCount: 1 }
        } else if (query.includes('INSERT INTO anomaly_response_log')) {
          return { rowCount: 1 }
        } else if (query.includes('COMMIT')) {
          return {}
        }
        return { rows: [], rowCount: 0 }
      })

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 })

      const stats = await handler.processAnomalies()

      // Should still mark as processed even if Slack fails
      expect(stats.total_anomalies_processed).toBe(1)
      // But slack alerts should not be incremented
      expect(stats.slack_alerts_sent).toBe(0)
    })
  })
})
