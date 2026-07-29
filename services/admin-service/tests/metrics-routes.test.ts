import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { Pool } from 'pg'
import { registerMetricsRoutes } from '../src/metrics-routes'

describe('Metrics Routes', () => {
  let app: FastifyInstance
  let db: any
  let token: string

  beforeAll(async () => {
    // Mock database
    db = {
      query: vi.fn(),
    }

    app = Fastify({ logger: false })
    await app.register(jwt, { secret: 'test-secret' })

    // Simple auth middleware for testing
    const authenticate = async (req: any, reply: any) => {
      try {
        await req.jwtVerify()
      } catch {
        reply.code(401).send({ error: 'Unauthorized' })
      }
    }

    // Register metrics routes
    await registerMetricsRoutes(app, db, authenticate)

    // Generate test token
    token = app.jwt.sign({ sub: 'admin-1', username: 'admin', role: 'superadmin' })
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /api/admin/metrics', () => {
    it('should return 24h/7d/30d trends for all game_type/difficulty combos', async () => {
      const mockMetrics = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T10:00:00Z'),
          avg_win_rate: 0.48,
          drift_from_target: -0.02,
        },
        {
          game_type: 'teen_patti',
          difficulty: 'hard',
          hour: new Date('2026-07-11T11:00:00Z'),
          avg_win_rate: 0.52,
          drift_from_target: 0.03,
        },
      ]

      db.query.mockResolvedValueOnce({ rows: mockMetrics })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('trends')
      expect(Array.isArray(body.trends)).toBe(true)
    })

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return empty trends if no data', async () => {
      db.query.mockResolvedValueOnce({ rows: [] })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.trends).toEqual([])
    })
  })

  describe('GET /api/admin/metrics/:game_type/:difficulty', () => {
    it('should return profile-specific metrics with trends', async () => {
      const mockData = {
        profile: {
          game_type: 'teen_patti',
          difficulty: 'easy',
          win_rate_target: 0.50,
          sample_size: 150,
        },
        metrics_24h: [
          { hour: new Date('2026-07-11T10:00:00Z'), avg_win_rate: 0.48, game_count: 25 },
          { hour: new Date('2026-07-11T11:00:00Z'), avg_win_rate: 0.49, game_count: 22 },
        ],
        metrics_7d: [
          { day: new Date('2026-07-11T00:00:00Z'), avg_win_rate: 0.495, game_count: 500 },
        ],
        metrics_30d: [
          { day: new Date('2026-07-11T00:00:00Z'), avg_win_rate: 0.50, game_count: 2000 },
        ],
      }

      db.query
        .mockResolvedValueOnce({ rows: [mockData.profile] })
        .mockResolvedValueOnce({ rows: mockData.metrics_24h })
        .mockResolvedValueOnce({ rows: mockData.metrics_7d })
        .mockResolvedValueOnce({ rows: mockData.metrics_30d })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics/teen_patti/easy',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('profile')
      expect(body).toHaveProperty('metrics_24h')
      expect(body).toHaveProperty('metrics_7d')
      expect(body).toHaveProperty('metrics_30d')
      expect(body.profile.game_type).toBe('teen_patti')
      expect(body.profile.difficulty).toBe('easy')
    })

    it('should return 404 if profile not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics/unknown_game/hard',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('error')
    })

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics/teen_patti/easy',
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe('GET /api/admin/drift-alerts', () => {
    it('should return active drift alerts', async () => {
      const mockAlerts = [
        {
          game_type: 'teen_patti',
          difficulty: 'hard',
          latest_hour: new Date('2026-07-11T10:00:00Z'),
          latest_drift: '0.045',
          consecutive_hours: 3,
          alert_count: 3,
          severity: 'MEDIUM',
        },
        {
          game_type: 'ludo',
          difficulty: 'medium',
          latest_hour: new Date('2026-07-11T09:00:00Z'),
          latest_drift: '-0.055',
          consecutive_hours: 4,
          alert_count: 4,
          severity: 'HIGH',
        },
      ]

      db.query.mockResolvedValueOnce({ rows: mockAlerts })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/drift-alerts',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(Array.isArray(body.alerts)).toBe(true)
      expect(body.alerts.length).toBe(2)
      expect(body.alerts[0].severity).toBe('MEDIUM')
      expect(Math.abs(body.alerts[0].drift_from_target) > 0.03).toBe(true)
    })

    it('should return empty list if no alerts', async () => {
      db.query.mockResolvedValueOnce({ rows: [] })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/drift-alerts',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.alerts).toEqual([])
    })

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/drift-alerts',
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe('GET /api/admin/a-b-experiments', () => {
    it('should return active A/B experiments with metrics', async () => {
      const mockExperiments = [
        {
          id: 'exp-1',
          name: 'Bot Aggression Test',
          game_type: 'teen_patti',
          difficulty: 'medium',
          status: 'active',
          variant_a: { name: 'Control', sample_size: 5000, avg_win_rate: 0.50 },
          variant_b: { name: 'High Aggression', sample_size: 5100, avg_win_rate: 0.52 },
          confidence: 0.95,
          winner: null,
          created_at: new Date('2026-07-01T00:00:00Z'),
        },
        {
          id: 'exp-2',
          name: 'Easy Tier Difficulty Test',
          game_type: 'ludo',
          difficulty: 'easy',
          status: 'completed',
          variant_a: { name: 'Control', sample_size: 4000, avg_win_rate: 0.48 },
          variant_b: { name: 'Adjusted', sample_size: 4100, avg_win_rate: 0.49 },
          confidence: 0.88,
          winner: 'variant_b',
          created_at: new Date('2026-06-01T00:00:00Z'),
        },
      ]

      db.query.mockResolvedValueOnce({ rows: mockExperiments })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/a-b-experiments',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(Array.isArray(body.experiments)).toBe(true)
      expect(body.experiments.length).toBe(2)
      expect(body.experiments[0].status).toBe('active')
      expect(body.experiments[1].status).toBe('completed')
    })

    it('should return empty list if no experiments', async () => {
      db.query.mockResolvedValueOnce({ rows: [] })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/a-b-experiments',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.experiments).toEqual([])
    })

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/a-b-experiments',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should support filtering by status', async () => {
      const mockActiveExperiments = [
        {
          id: 'exp-1',
          name: 'Bot Aggression Test',
          status: 'active',
          game_type: 'teen_patti',
          difficulty: 'medium',
        },
      ]

      db.query.mockResolvedValueOnce({ rows: mockActiveExperiments })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/a-b-experiments?status=active',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.experiments.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Response format validation', () => {
    it('should return consistent time-series data format', async () => {
      const mockData = [
        {
          game_type: 'teen_patti',
          difficulty: 'easy',
          hour: new Date('2026-07-11T10:00:00Z'),
          avg_win_rate: 0.48,
          drift_from_target: -0.02,
          game_count: 25,
        },
      ]

      db.query.mockResolvedValueOnce({ rows: mockData })

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.trends[0]).toHaveProperty('hour')
      expect(body.trends[0]).toHaveProperty('avg_win_rate')
      expect(body.trends[0]).toHaveProperty('drift_from_target')
      expect(body.trends[0]).toHaveProperty('game_count')
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'))

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(500)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('error')
    })

    it('should return 400 for invalid query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/metrics/teen_patti',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBeGreaterThanOrEqual(400)
    })
  })
})
