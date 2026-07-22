import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { registerPnlDashboardRoutes, isValidPnlGameType, computeRoiPct, bySign } from '../src/pnl-dashboard-routes'

describe('pnl-dashboard pure helpers', () => {
  it('isValidPnlGameType accepts only teen_patti and ludo', () => {
    expect(isValidPnlGameType('teen_patti')).toBe(true)
    expect(isValidPnlGameType('ludo')).toBe(true)
    expect(isValidPnlGameType('aviator')).toBe(false)
    expect(isValidPnlGameType('matka')).toBe(false)
  })

  it('computeRoiPct is 0 when total_invested is 0 (no divide-by-zero)', () => {
    expect(computeRoiPct(500, 0)).toBe(0)
    expect(computeRoiPct(-500, 0)).toBe(0)
  })

  it('computeRoiPct computes the real percentage otherwise', () => {
    expect(computeRoiPct(250, 1000)).toBe(25)
    expect(computeRoiPct(-100, 1000)).toBe(-10)
  })

  it('bySign picks the matching is_bot slice, not mixed together', () => {
    const rows = [
      { is_bot: false, total_wagered: 1000, total_paid_out: 900, net_pnl: -100 },
      { is_bot: true, total_wagered: 500, total_paid_out: 600, net_pnl: 100 },
    ]
    expect(bySign(rows, false)).toEqual({ is_bot: false, total_wagered: 1000, total_paid_out: 900, net_pnl: -100 })
    expect(bySign(rows, true)).toEqual({ is_bot: true, total_wagered: 500, total_paid_out: 600, net_pnl: 100 })
  })

  it('bySign returns an empty breakdown when that side has no rows at all', () => {
    const rows = [{ is_bot: false, total_wagered: 1000, total_paid_out: 900, net_pnl: -100 }]
    expect(bySign(rows, true)).toEqual({ total_wagered: 0, total_paid_out: 0, net_pnl: 0 })
  })
})

describe('GET /api/admin/games/:gameType/pnl-dashboard', () => {
  let app: FastifyInstance
  let db: any
  let token: string

  beforeAll(async () => {
    db = { query: vi.fn() }

    app = Fastify({ logger: false })
    await app.register(jwt, { secret: 'test-secret' })

    const authenticate = async (req: any, reply: any) => {
      try {
        await req.jwtVerify()
      } catch {
        reply.code(401).send({ error: 'Unauthorized' })
      }
    }
    const requireRole = (role: string) => async (req: any, reply: any) => {
      if ((req.user as any)?.role !== role) reply.code(403).send({ error: `Forbidden — requires ${role} role` })
    }

    await registerPnlDashboardRoutes(app, db, authenticate, requireRole)

    token = app.jwt.sign({ sub: 'admin-1', username: 'admin', role: 'finance' })
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects a gameType other than teen_patti or ludo with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/games/aviator/pnl-dashboard',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects a non-finance role with 403', async () => {
    const nonFinanceToken = app.jwt.sign({ sub: 'admin-2', username: 'support', role: 'support' })
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/games/ludo/pnl-dashboard',
      headers: { authorization: `Bearer ${nonFinanceToken}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('returns the full combined shape for a valid gameType', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total_paid_out: 900, total_wagered: 1000 }] }) // summary
      .mockResolvedValueOnce({ rows: [ // breakdown
        { is_bot: false, total_wagered: 700, total_paid_out: 650, net_pnl: -50 },
        { is_bot: true, total_wagered: 300, total_paid_out: 250, net_pnl: -50 },
      ] })
      .mockResolvedValueOnce({ rows: [{ date: '2026-07-20', wagered: 1000, paid_out: 900 }] }) // trend
      .mockResolvedValueOnce({ rows: [{ total_invested: 20000 }] }) // invested
      .mockResolvedValueOnce({ rows: [{ current_balance: 19500 }] }) // balance
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', username: 'Player1', is_bot: false, net_pnl: 300, games_played: 10 }] }) // leaderboard
      .mockResolvedValueOnce({ rows: [{ room_id: 'r1', started_at: '2026-07-20T10:00:00Z', pot_amount: 100, platform_fee_collected: 5, players: 2 }] }) // history
      .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // history count

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/games/ludo/pnl-dashboard',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.summary).toEqual({ total_wagered: 1000, total_paid_out: 900, net_rake: 100 })
    expect(body.breakdown.real.net_pnl).toBe(-50)
    expect(body.breakdown.bot.net_pnl).toBe(-50)
    expect(body.bot_roi).toEqual({ total_invested: 20000, current_balance: 19500, net_realized_pnl: -50, roi_pct: -0.25 })
    expect(body.leaderboard).toHaveLength(1)
    expect(body.history.total).toBe(1)
  })
})
