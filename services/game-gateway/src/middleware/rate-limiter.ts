import Redis from 'ioredis'
import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Rate limiter using Redis for distributed systems
 * Tracks rate limit hits per IP in Redis and enforces limits
 */
export class RateLimiter {
  constructor(private redis: Redis) {}

  /**
   * Check if a request exceeds the rate limit
   * @param key - Unique key for the limit bucket (e.g., IP:endpoint)
   * @param maxRequests - Maximum requests allowed
   * @param windowMs - Time window in milliseconds
   * @returns true if request is allowed, false if rate limited
   */
  private async check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now()
    const windowStart = now - windowMs

    // Use Redis sorted set to track requests
    // Score is the timestamp, value is unique request identifier
    const multi = this.redis.pipeline()
    multi.zremrangebyscore(key, '-inf', windowStart)
    multi.zcard(key)
    multi.expire(key, Math.ceil(windowMs / 1000) + 1)
    multi.ttl(key)

    const results = await multi.exec()
    const count = (results?.[1]?.[1] as number) || 0
    const ttl = (results?.[3]?.[1] as number) || 0
    const resetTime = ttl > 0 ? now + ttl * 1000 : now + windowMs

    const allowed = count < maxRequests
    const remaining = Math.max(0, maxRequests - count - 1)

    // Record this request if allowed
    if (allowed) {
      await this.redis.zadd(key, now, `${now}-${Math.random()}`)
    }

    return { allowed, remaining, resetTime }
  }

  /**
   * Middleware factory for HTTP endpoints
   * Limit: 500 requests per minute per IP
   */
  async httpLimiter(req: FastifyRequest, reply: FastifyReply) {
    const ip = this.getClientIP(req)
    const key = `rate-limit:http:${ip}`
    const { allowed, remaining, resetTime } = await this.check(key, 500, 60 * 1000)

    reply.header('X-RateLimit-Limit', '500')
    reply.header('X-RateLimit-Remaining', remaining.toString())
    reply.header('X-RateLimit-Reset', resetTime.toString())

    if (!allowed) {
      reply.header('Retry-After', Math.ceil((resetTime - Date.now()) / 1000).toString())
      return reply.code(429).send({
        error: 'Too Many Requests',
        message: 'API rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
      })
    }
  }

  /**
   * Middleware factory for login endpoints
   * Limit: 10 attempts per 5 minutes per IP
   */
  async loginLimiter(req: FastifyRequest, reply: FastifyReply) {
    const ip = this.getClientIP(req)
    const key = `rate-limit:login:${ip}`
    const { allowed, remaining, resetTime } = await this.check(key, 10, 5 * 60 * 1000)

    reply.header('X-RateLimit-Limit', '10')
    reply.header('X-RateLimit-Remaining', remaining.toString())
    reply.header('X-RateLimit-Reset', resetTime.toString())

    if (!allowed) {
      reply.header('Retry-After', Math.ceil((resetTime - Date.now()) / 1000).toString())
      return reply.code(429).send({
        error: 'Too Many Login Attempts',
        message: 'Too many login attempts. Please try again later.',
        retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
      })
    }
  }

  /**
   * WebSocket rate limiter
   * Limit: 100 connections per minute per IP
   * Returns true if allowed, false if rate limited
   */
  async wsLimiter(ip: string): Promise<{ allowed: boolean; resetTime: number }> {
    const key = `rate-limit:ws:${ip}`
    const { allowed, resetTime } = await this.check(key, 100, 60 * 1000)
    return { allowed, resetTime }
  }

  /**
   * Extract client IP from request
   * Considers X-Forwarded-For and X-Real-IP headers for proxy scenarios
   */
  private getClientIP(req: FastifyRequest): string {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded
      return ips.split(',')[0].trim()
    }

    const realIP = req.headers['x-real-ip']
    if (realIP) {
      const ip = Array.isArray(realIP) ? realIP[0] : realIP
      return ip.trim()
    }

    return req.socket.remoteAddress || 'unknown'
  }
}

/**
 * Factory to create a rate limiter instance
 */
export function createRateLimiter(redis: Redis): RateLimiter {
  return new RateLimiter(redis)
}
