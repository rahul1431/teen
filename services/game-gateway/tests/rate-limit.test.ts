import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Redis from 'ioredis'
import { RateLimiter, createRateLimiter } from '../src/middleware/rate-limiter'

let redis: Redis
let rateLimiter: RateLimiter

beforeAll(async () => {
  // Connect to Redis (adjust URL for test environment)
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
})

afterAll(async () => {
  await redis.disconnect()
})

beforeEach(async () => {
  // Clear all rate limit keys before each test
  const keys = await redis.keys('rate-limit:*')
  if (keys.length > 0) {
    await redis.del(...keys)
  }
  rateLimiter = createRateLimiter(redis)
})

describe('RateLimiter - HTTP Endpoints (500 req/min)', () => {
  it('should allow requests within the limit', async () => {
    const ip = '192.168.1.1'

    // Make 10 requests - all should be allowed
    for (let i = 0; i < 10; i++) {
      const result = await (rateLimiter as any).check(`rate-limit:http:${ip}`, 500, 60 * 1000)
      expect(result.allowed).toBe(true)
    }
  })

  it('should reject requests exceeding the limit', async () => {
    const ip = '192.168.1.2'
    const maxRequests = 10 // Use smaller limit for testing

    // Fill up the limit
    for (let i = 0; i < maxRequests; i++) {
      await (rateLimiter as any).check(`rate-limit:test:${ip}`, maxRequests, 60 * 1000)
    }

    // Next request should be rejected
    const result = await (rateLimiter as any).check(`rate-limit:test:${ip}`, maxRequests, 60 * 1000)
    expect(result.allowed).toBe(false)
  })

  it('should track remaining requests correctly', async () => {
    const ip = '192.168.1.3'
    const maxRequests = 5

    const results = []
    for (let i = 0; i < maxRequests + 1; i++) {
      const result = await (rateLimiter as any).check(`rate-limit:test2:${ip}`, maxRequests, 60 * 1000)
      results.push(result)
    }

    // First request should have 4 remaining
    expect(results[0].remaining).toBe(4)
    // After maxRequests, should not be allowed
    expect(results[maxRequests].allowed).toBe(false)
  })

  it('should use separate limits for different IPs', async () => {
    const ip1 = '192.168.1.4'
    const ip2 = '192.168.1.5'
    const maxRequests = 3

    // Fill limit for IP1
    for (let i = 0; i < maxRequests; i++) {
      await (rateLimiter as any).check(`rate-limit:test3:${ip1}`, maxRequests, 60 * 1000)
    }

    // IP1 should be limited
    const result1 = await (rateLimiter as any).check(`rate-limit:test3:${ip1}`, maxRequests, 60 * 1000)
    expect(result1.allowed).toBe(false)

    // IP2 should still have quota
    const result2 = await (rateLimiter as any).check(`rate-limit:test3:${ip2}`, maxRequests, 60 * 1000)
    expect(result2.allowed).toBe(true)
  })

  it('should provide correct reset time', async () => {
    const ip = '192.168.1.6'
    const windowMs = 5 * 1000 // 5 seconds
    const before = Date.now()

    const result = await (rateLimiter as any).check(`rate-limit:test4:${ip}`, 5, windowMs)
    const after = Date.now()

    // Reset time should be approximately now + windowMs
    expect(result.resetTime).toBeGreaterThanOrEqual(before + windowMs)
    expect(result.resetTime).toBeLessThanOrEqual(after + windowMs + 1000) // Allow 1 second tolerance
  })
})

describe('RateLimiter - Login Endpoints (10 attempts/5min)', () => {
  it('should allow 10 login attempts within window', async () => {
    const ip = '192.168.1.7'

    for (let i = 0; i < 10; i++) {
      const result = await (rateLimiter as any).check(`rate-limit:login:${ip}`, 10, 5 * 60 * 1000)
      expect(result.allowed).toBe(true)
    }
  })

  it('should reject 11th login attempt', async () => {
    const ip = '192.168.1.8'

    for (let i = 0; i < 10; i++) {
      await (rateLimiter as any).check(`rate-limit:login:${ip}`, 10, 5 * 60 * 1000)
    }

    const result = await (rateLimiter as any).check(`rate-limit:login:${ip}`, 10, 5 * 60 * 1000)
    expect(result.allowed).toBe(false)
  })
})

describe('RateLimiter - WebSocket (100 connections/min)', () => {
  it('should allow 100 WS connections within limit', async () => {
    const ip = '192.168.1.9'

    for (let i = 0; i < 100; i++) {
      const result = await (rateLimiter as any).check(`rate-limit:ws:${ip}`, 100, 60 * 1000)
      expect(result.allowed).toBe(true)
    }
  })

  it('should reject 101st WS connection', async () => {
    const ip = '192.168.1.10'

    for (let i = 0; i < 100; i++) {
      await (rateLimiter as any).check(`rate-limit:ws:${ip}`, 100, 60 * 1000)
    }

    const result = await (rateLimiter as any).check(`rate-limit:ws:${ip}`, 100, 60 * 1000)
    expect(result.allowed).toBe(false)
  })
})
