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

  it('should use separate limits for different IPs', async () => {
    const ip1 = '192.168.1.3'
    const ip2 = '192.168.1.4'
    const maxRequests = 3

    // Fill limit for IP1
    for (let i = 0; i < maxRequests; i++) {
      await (rateLimiter as any).check(`rate-limit:test:${ip1}`, maxRequests, 60 * 1000)
    }

    // IP1 should be limited
    const result1 = await (rateLimiter as any).check(`rate-limit:test:${ip1}`, maxRequests, 60 * 1000)
    expect(result1.allowed).toBe(false)

    // IP2 should still have quota
    const result2 = await (rateLimiter as any).check(`rate-limit:test:${ip2}`, maxRequests, 60 * 1000)
    expect(result2.allowed).toBe(true)
  })
})

describe('RateLimiter - Login Endpoints (10 attempts/5min)', () => {
  it('should allow 10 login attempts within window', async () => {
    const ip = '192.168.1.5'

    for (let i = 0; i < 10; i++) {
      const result = await (rateLimiter as any).check(`rate-limit:login:${ip}`, 10, 5 * 60 * 1000)
      expect(result.allowed).toBe(true)
    }
  })

  it('should reject 11th login attempt', async () => {
    const ip = '192.168.1.6'

    for (let i = 0; i < 10; i++) {
      await (rateLimiter as any).check(`rate-limit:login:${ip}`, 10, 5 * 60 * 1000)
    }

    const result = await (rateLimiter as any).check(`rate-limit:login:${ip}`, 10, 5 * 60 * 1000)
    expect(result.allowed).toBe(false)
  })

  it('should track login attempts per IP separately', async () => {
    const ip1 = '192.168.1.7'
    const ip2 = '192.168.1.8'

    // Make attempts from IP1
    for (let i = 0; i < 10; i++) {
      await (rateLimiter as any).check(`rate-limit:login:${ip1}`, 10, 5 * 60 * 1000)
    }

    // IP1 should be limited
    const result1 = await (rateLimiter as any).check(`rate-limit:login:${ip1}`, 10, 5 * 60 * 1000)
    expect(result1.allowed).toBe(false)

    // IP2 should still be able to attempt login
    const result2 = await (rateLimiter as any).check(`rate-limit:login:${ip2}`, 10, 5 * 60 * 1000)
    expect(result2.allowed).toBe(true)
  })

  it('should provide correct reset time for login limit', async () => {
    const ip = '192.168.1.9'
    const windowMs = 5 * 60 * 1000 // 5 minutes
    const before = Date.now()

    const result = await (rateLimiter as any).check(`rate-limit:login:${ip}`, 10, windowMs)
    const after = Date.now()

    // Reset time should be approximately now + windowMs
    expect(result.resetTime).toBeGreaterThanOrEqual(before + windowMs)
    expect(result.resetTime).toBeLessThanOrEqual(after + windowMs + 1000) // Allow 1 second tolerance
  })
})
