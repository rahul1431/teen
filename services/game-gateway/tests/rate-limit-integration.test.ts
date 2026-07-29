import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { FastifyRequest, FastifyReply } from 'fastify'
import Redis from 'ioredis'
import { createRateLimiter } from '../src/middleware/rate-limiter'

let redis: Redis
let rateLimiter: any

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
})

afterAll(async () => {
  await redis.disconnect()
})

beforeEach(async () => {
  const keys = await redis.keys('rate-limit:*')
  if (keys.length > 0) {
    await redis.del(...keys)
  }
  rateLimiter = createRateLimiter(redis)
})

describe('Rate Limiter - HTTP Middleware Integration', () => {
  it('should add correct rate limit headers to response', async () => {
    const mockReq = {
      socket: { remoteAddress: '192.168.1.1' },
      headers: {},
      url: '/api/test',
    } as unknown as FastifyRequest

    const mockReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply

    // Make a request
    await rateLimiter.httpLimiter(mockReq, mockReply)

    // Should have set rate limit headers
    expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Limit', '500')
    expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String))
    expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String))
  })

  it('should return 429 when rate limit exceeded', async () => {
    const mockReq = {
      socket: { remoteAddress: '192.168.1.2' },
      headers: {},
      url: '/api/test',
    } as unknown as FastifyRequest

    const mockReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply

    // Exhaust the limit (use smaller limit for test)
    for (let i = 0; i < 5; i++) {
      await (rateLimiter as any).check('rate-limit:http:192.168.1.2', 5, 60 * 1000)
    }

    // Next request should be rate limited
    await rateLimiter.httpLimiter(mockReq, mockReply)

    expect(mockReply.code).toHaveBeenCalledWith(429)
    expect(mockReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Too Many Requests',
        message: expect.any(String),
        retryAfter: expect.any(Number),
      })
    )
  })

  it('should set Retry-After header on rate limit', async () => {
    const mockReq = {
      socket: { remoteAddress: '192.168.1.3' },
      headers: {},
      url: '/api/test',
    } as unknown as FastifyRequest

    const mockReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply

    // Exhaust limit
    for (let i = 0; i < 3; i++) {
      await (rateLimiter as any).check('rate-limit:http:192.168.1.3', 3, 60 * 1000)
    }

    await rateLimiter.httpLimiter(mockReq, mockReply)

    // Should have Retry-After header
    const callWithRetryAfter = mockReply.header.mock.calls.find(
      (call: any[]) => call[0] === 'Retry-After'
    )
    expect(callWithRetryAfter).toBeDefined()
    expect(callWithRetryAfter[1]).toBeDefined()
  })

  it('should respect X-Forwarded-For header for proxy scenarios', async () => {
    const mockReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1' },
      url: '/api/test',
    } as unknown as FastifyRequest

    const mockReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply

    // First request from client IP 203.0.113.1
    await rateLimiter.httpLimiter(mockReq, mockReply)
    expect(mockReply.code).not.toHaveBeenCalledWith(429)

    // Exhaust limit for that IP
    for (let i = 0; i < 499; i++) {
      await (rateLimiter as any).check('rate-limit:http:203.0.113.1', 500, 60 * 1000)
    }

    // Next request from same IP should be rate limited
    await rateLimiter.httpLimiter(mockReq, mockReply)
    expect(mockReply.code).toHaveBeenCalledWith(429)
  })
})

describe('Rate Limiter - WebSocket Integration', () => {
  it('should allow WS connection within limit', async () => {
    const ip = '192.168.1.10'
    const { allowed, resetTime } = await rateLimiter.wsLimiter(ip)

    expect(allowed).toBe(true)
    expect(resetTime).toBeGreaterThan(Date.now())
  })

  it('should reject WS connection when limit exceeded', async () => {
    const ip = '192.168.1.11'

    // Exhaust limit
    for (let i = 0; i < 100; i++) {
      await rateLimiter.wsLimiter(ip)
    }

    // Next connection should be rejected
    const result = await rateLimiter.wsLimiter(ip)
    expect(result.allowed).toBe(false)
  })
})

describe('Rate Limiter - Login Middleware Integration', () => {
  it('should allow login attempts within limit', async () => {
    const mockReq = {
      socket: { remoteAddress: '192.168.1.12' },
      headers: {},
      url: '/api/admin/auth/login',
    } as unknown as FastifyRequest

    const mockReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply

    await rateLimiter.loginLimiter(mockReq, mockReply)

    // Should not be rate limited
    expect(mockReply.code).not.toHaveBeenCalledWith(429)
  })

  it('should reject login after 10 attempts', async () => {
    const mockReq = {
      socket: { remoteAddress: '192.168.1.13' },
      headers: {},
      url: '/api/admin/auth/login',
    } as unknown as FastifyRequest

    const mockReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply

    // Make 10 login attempts
    for (let i = 0; i < 10; i++) {
      await (rateLimiter as any).check('rate-limit:login:192.168.1.13', 10, 5 * 60 * 1000)
    }

    // 11th attempt should be rejected
    await rateLimiter.loginLimiter(mockReq, mockReply)

    expect(mockReply.code).toHaveBeenCalledWith(429)
    expect(mockReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Too Many Login Attempts',
      })
    )
  })
})
