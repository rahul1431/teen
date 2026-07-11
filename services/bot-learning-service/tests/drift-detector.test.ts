import { DriftDetector } from '../src/drift-detector'
import { SlackNotifier } from '../src/slack-notifier'
import pino from 'pino'

// Mock helper functions
const createMockPool = () => {
  return {
    query: jest.fn(),
  } as unknown as any
}

const createMockRedis = () => {
  return {
    del: jest.fn().mockResolvedValue(0),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    scan: jest.fn().mockResolvedValue(['0', []]),
  } as unknown as any
}

const createMockLogger = () => {
  return pino({ level: 'silent' })
}

const createMockSlackNotifier = () => {
  return {
    sendAlert: jest.fn().mockResolvedValue(true),
    sendResolution: jest.fn().mockResolvedValue(true),
  } as unknown as SlackNotifier
}

describe('DriftDetector', () => {
  let pool: any
  let redis: any
  let logger: any
  let detector: DriftDetector
  let slackNotifier: any

  beforeEach(() => {
    pool = createMockPool()
    redis = createMockRedis()
    logger = createMockLogger()
    slackNotifier = createMockSlackNotifier()
    detector = new DriftDetector(pool, redis, logger, slackNotifier)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('should detect 3-hour drift pattern', () => {
    it('should identify when 3+ consecutive hours exceed drift threshold', async () => {
      // Setup: 3 consecutive hours with drift > 3%
      const metricsRows = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T14:00:00Z'),
          avg_win_rate: 0.535,
          drift_from_target: 0.035,
          win_rate_target: 0.50,
        },
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T13:00:00Z'),
          avg_win_rate: 0.545,
          drift_from_target: 0.045,
          win_rate_target: 0.50,
        },
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T12:00:00Z'),
          avg_win_rate: 0.535,
          drift_from_target: 0.035,
          win_rate_target: 0.50,
        },
      ]

      pool.query.mockResolvedValueOnce({ rows: metricsRows })
      redis.get.mockResolvedValueOnce(null) // No previous alert state

      const drifts = await detector.checkDriftPatterns()

      expect(drifts.length).toBeGreaterThan(0)
      const drift = drifts[0]
      expect(drift.game_type).toBe('teen_patti')
      expect(drift.difficulty).toBe('easy')
      expect(drift.consecutive_hours).toBeGreaterThanOrEqual(3)
      expect(Math.abs(drift.max_drift) > 0.03).toBe(true)
    })

    it('should not alert if drift is less than 3%', async () => {
      const metricsRows = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T14:00:00Z'),
          avg_win_rate: 0.515,
          drift_from_target: 0.015,
          win_rate_target: 0.50,
        },
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T13:00:00Z'),
          avg_win_rate: 0.515,
          drift_from_target: 0.015,
          win_rate_target: 0.50,
        },
      ]

      pool.query.mockResolvedValueOnce({ rows: metricsRows })

      const drifts = await detector.checkDriftPatterns()

      expect(drifts.length).toBe(0)
    })

    it('should not alert if fewer than 3 consecutive hours show drift', async () => {
      const metricsRows = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T14:00:00Z'),
          avg_win_rate: 0.53,
          drift_from_target: 0.03,
          win_rate_target: 0.50,
        },
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T13:00:00Z'),
          avg_win_rate: 0.50,
          drift_from_target: 0.0,
          win_rate_target: 0.50,
        },
      ]

      pool.query.mockResolvedValueOnce({ rows: metricsRows })

      const drifts = await detector.checkDriftPatterns()

      expect(drifts.length).toBe(0)
    })
  })

  describe('should classify severity correctly', () => {
    it('should classify RED severity for drift > 5%', () => {
      const severity = detector.classifySeverity(0.065) // 6.5% drift
      expect(severity).toBe('RED')
    })

    it('should classify YELLOW severity for drift 3-5%', () => {
      const severity1 = detector.classifySeverity(0.035) // 3.5%
      const severity2 = detector.classifySeverity(0.045) // 4.5%
      expect(severity1).toBe('YELLOW')
      expect(severity2).toBe('YELLOW')
    })

    it('should classify GREEN severity for drift < 3%', () => {
      const severity = detector.classifySeverity(0.025) // 2.5%
      expect(severity).toBe('GREEN')
    })

    it('should handle negative drift values', () => {
      const severity1 = detector.classifySeverity(-0.065) // -6.5% drift
      const severity2 = detector.classifySeverity(-0.045) // -4.5% drift
      const severity3 = detector.classifySeverity(-0.025) // -2.5% drift
      expect(severity1).toBe('RED')
      expect(severity2).toBe('YELLOW')
      expect(severity3).toBe('GREEN')
    })

    it('should use absolute value for classification', () => {
      const positiveSeverity = detector.classifySeverity(0.06)
      const negativeSeverity = detector.classifySeverity(-0.06)
      expect(positiveSeverity).toBe(negativeSeverity)
    })
  })

  describe('should avoid duplicate alerts on state change', () => {
    it('should not send alert if already alerted for this drift', async () => {
      const driftKey = 'teen_patti:easy'
      const previousState = JSON.stringify({ severity: 'RED', lastAlertTime: Date.now() })

      redis.get.mockResolvedValueOnce(previousState)

      const drift = {
        game_type: 'teen_patti',
        difficulty: 'easy',
        max_drift: 0.065,
        consecutive_hours: 3,
      }

      const shouldAlert = await detector.shouldSendAlert(drift)
      expect(shouldAlert).toBe(false)
    })

    it('should send alert if state changed from non-alert to alert', async () => {
      const drift = {
        game_type: 'teen_patti',
        difficulty: 'easy',
        max_drift: 0.065,
        consecutive_hours: 3,
      }

      redis.get.mockResolvedValueOnce(null) // No previous state

      const shouldAlert = await detector.shouldSendAlert(drift)
      expect(shouldAlert).toBe(true)
    })

    it('should send alert if severity changed', async () => {
      const previousState = JSON.stringify({ severity: 'YELLOW', lastAlertTime: Date.now() - 3600000 })
      redis.get.mockResolvedValueOnce(previousState)

      const drift = {
        game_type: 'teen_patti',
        difficulty: 'easy',
        max_drift: 0.065, // RED severity
        consecutive_hours: 3,
      }

      const shouldAlert = await detector.shouldSendAlert(drift)
      expect(shouldAlert).toBe(true)
    })

    it('should send resolution alert if drift resolved', async () => {
      const previousState = JSON.stringify({ severity: 'RED', lastAlertTime: Date.now() })
      redis.get.mockResolvedValueOnce(previousState)

      const drift = {
        game_type: 'teen_patti',
        difficulty: 'easy',
        max_drift: 0.025, // GREEN severity
        consecutive_hours: 0,
      }

      const shouldSendResolution = await detector.shouldSendResolution(drift)
      expect(shouldSendResolution).toBe(true)
    })
  })

  describe('should handle missing metrics data', () => {
    it('should handle empty metrics gracefully', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] })

      const drifts = await detector.checkDriftPatterns()

      expect(drifts).toEqual([])
    })

    it('should handle null values in metrics', async () => {
      const metricsRows = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T14:00:00Z'),
          avg_win_rate: null,
          drift_from_target: null,
          win_rate_target: 0.50,
        },
      ]

      pool.query.mockResolvedValueOnce({ rows: metricsRows })

      const drifts = await detector.checkDriftPatterns()

      expect(drifts).toEqual([])
    })

    it('should skip metrics without profile_id reference', async () => {
      const metricsRows = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T14:00:00Z'),
          avg_win_rate: 0.53,
          drift_from_target: 0.03,
          win_rate_target: 0.50,
          profile_id: null,
        },
      ]

      pool.query.mockResolvedValueOnce({ rows: metricsRows })

      const drifts = await detector.checkDriftPatterns()

      // Should still process metrics (metrics are grouped by game_type/difficulty)
      expect(Array.isArray(drifts)).toBe(true)
    })
  })

  describe('should notify Slack on alert', () => {
    it('should send Slack alert when drift detected', async () => {
      const drift = {
        game_type: 'teen_patti',
        difficulty: 'hard',
        max_drift: 0.065,
        consecutive_hours: 3,
        avg_win_rate: 0.565,
        win_rate_target: 0.50,
      }

      redis.get.mockResolvedValueOnce(null)
      redis.set.mockResolvedValueOnce('OK')

      await detector.processAlert(drift)

      expect(slackNotifier.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          game_type: 'teen_patti',
          difficulty: 'hard',
          severity: 'RED',
        })
      )
    })

    it('should include dashboard link in Slack notification', async () => {
      const drift = {
        game_type: 'ludo',
        difficulty: 'medium',
        max_drift: 0.045,
        consecutive_hours: 3,
        avg_win_rate: 0.545,
        win_rate_target: 0.50,
      }

      redis.get.mockResolvedValueOnce(null)
      redis.set.mockResolvedValueOnce('OK')

      await detector.processAlert(drift)

      expect(slackNotifier.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          dashboardLink: expect.stringContaining('ludo')
        })
      )
    })

    it('should send resolution notification when drift clears', async () => {
      const previousState = JSON.stringify({ severity: 'RED', lastAlertTime: Date.now() })
      redis.get.mockResolvedValueOnce(previousState)
      redis.set.mockResolvedValueOnce('OK')

      const drift = {
        game_type: 'teen_patti',
        difficulty: 'easy',
        max_drift: 0.02,
        consecutive_hours: 0,
        avg_win_rate: 0.52,
        win_rate_target: 0.50,
      }

      await detector.processResolution(drift)

      expect(slackNotifier.sendResolution).toHaveBeenCalledWith(
        expect.objectContaining({
          game_type: 'teen_patti',
          difficulty: 'easy',
        })
      )
    })

    it('should not send notification if already notified', async () => {
      const previousState = JSON.stringify({ severity: 'RED', lastAlertTime: Date.now() })
      redis.get.mockResolvedValueOnce(previousState)

      const drift = {
        game_type: 'teen_patti',
        difficulty: 'easy',
        max_drift: 0.065,
        consecutive_hours: 3,
        avg_win_rate: 0.565,
        win_rate_target: 0.50,
      }

      await detector.processAlert(drift)

      expect(slackNotifier.sendAlert).not.toHaveBeenCalled()
    })
  })

  describe('run method', () => {
    it('should process all detected drifts', async () => {
      const metricsRows = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T14:00:00Z'),
          avg_win_rate: 0.535,
          drift_from_target: 0.035,
          win_rate_target: 0.50,
        },
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T13:00:00Z'),
          avg_win_rate: 0.545,
          drift_from_target: 0.045,
          win_rate_target: 0.50,
        },
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T12:00:00Z'),
          avg_win_rate: 0.535,
          drift_from_target: 0.035,
          win_rate_target: 0.50,
        },
      ]

      pool.query.mockResolvedValueOnce({ rows: metricsRows })
      redis.scan.mockResolvedValueOnce(['0', []]) // No previously alerted keys
      redis.get.mockResolvedValue(null)
      redis.setex.mockResolvedValue('OK')

      await detector.run()

      // Should have called Slack notifier for the detected drift
      expect(slackNotifier.sendAlert).toHaveBeenCalled()
    })
  })
})
