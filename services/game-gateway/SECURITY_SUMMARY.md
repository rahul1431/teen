# Security Implementation Summary - Rate Limiting

## Task: Add Rate Limiting to Critical Endpoints

### Status: COMPLETED ✓

This document summarizes the rate limiting implementation for the Teen Patti gaming platform.

---

## What Was Implemented

### 1. Game Gateway Service (`services/game-gateway`)

**Protected Endpoints:**
- WebSocket connections (`/ws`) - 100 connections/minute per IP
- HTTP API routes - 500 requests/minute per IP (except `/health`)

**Files Added:**
- `src/middleware/rate-limiter.ts` - Core rate limiting logic
- `tests/rate-limit.test.ts` - Unit tests
- `tests/rate-limit-integration.test.ts` - Integration tests
- `RATE_LIMITING.md` - Detailed documentation

**Changes to Existing Files:**
- `src/index.ts` - Added rate limiter initialization and middleware hooks

### 2. Admin Service (`services/admin-service`)

**Protected Endpoints:**
- Admin login (`/api/admin/auth/login`) - 10 attempts/5 minutes per IP
- HTTP API routes - 500 requests/minute per IP (except `/health`)

**Files Added:**
- `src/middleware/rate-limiter.ts` - Core rate limiting logic
- `tests/rate-limit.test.ts` - Unit tests
- `RATE_LIMITING.md` - Detailed documentation

**Changes to Existing Files:**
- `src/index.ts` - Added rate limiter initialization, middleware hooks, and login endpoint protection

---

## Implementation Details

### Technology Stack

- **Rate Limiter**: Redis-backed distributed rate limiting
- **Algorithm**: Token bucket using Redis sorted sets
- **Time Windows**: 
  - HTTP API: 1 minute (60 seconds)
  - WebSocket: 1 minute (60 seconds)
  - Login attempts: 5 minutes (300 seconds)

### How It Works

1. **Request Arrives** → Extract client IP from socket or X-Forwarded-For header
2. **Check Redis** → Query sorted set for requests in current time window
3. **Clean Old Entries** → Remove requests older than the time window
4. **Count Requests** → Check if current count exceeds limit
5. **Response**:
   - If allowed: Add request to Redis, forward to handler
   - If limited: Return `429 Too Many Requests` with Retry-After header

### Rate Limit Tiers

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| WebSocket (/ws) | 100 | 1 min | Prevent connection floods |
| HTTP API | 500 | 1 min | Prevent API abuse |
| Admin Login | 10 | 5 min | Prevent brute force attacks |

### Response Headers

```
X-RateLimit-Limit: 500           # Max requests in window
X-RateLimit-Remaining: 495       # Requests left in window
X-RateLimit-Reset: 1234567890000 # Timestamp when window resets
Retry-After: 35                   # Seconds to wait (on 429 only)
```

---

## Prerequisites

### Environment Variables

No new environment variables are required. The rate limiter uses the existing:
- `REDIS_URL` - Connection string for Redis (must be already configured)

### Dependencies

Added to both services:
```json
"@fastify/rate-limit": "^9.0.0"
```

**Installation:**
```bash
cd services/game-gateway && npm install @fastify/rate-limit
cd services/admin-service && npm install @fastify/rate-limit
```

---

## Verification & Testing

### Unit Tests

```bash
# Game Gateway tests
cd services/game-gateway
npm run test rate-limit.test.ts

# Admin Service tests
cd services/admin-service
npm run test rate-limit.test.ts
```

### Integration Tests

```bash
# Game Gateway integration tests
cd services/game-gateway
npm run test rate-limit-integration.test.ts
```

### Build Verification

```bash
# Both services compile without errors
cd services/game-gateway && npm run build
cd services/admin-service && npm run build
```

### Manual Testing

**Test HTTP Rate Limiting:**
```bash
# Make 550 requests quickly to trigger limit (500/min)
for i in {1..550}; do
  curl -H "X-Forwarded-For: 192.168.1.100" http://localhost:3003/api/test
  # Should get 429 after 500 requests
done
```

**Test Login Rate Limiting:**
```bash
# Make 11 login attempts (limit is 10/5min)
for i in {1..11}; do
  curl -X POST http://localhost:3003/api/admin/auth/login \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 192.168.1.100" \
    -d '{"username":"admin","password":"wrong"}'
  sleep 1
done
# Should get 429 on 11th attempt
```

**Test WebSocket Rate Limiting:**
```bash
# Attempt 101 connections (limit is 100/min)
# Should succeed for first 100, fail on 101st
```

---

## Configuration

### Adjusting Rate Limits

To change rate limits, edit the middleware files:

**Game Gateway** (`services/game-gateway/src/middleware/rate-limiter.ts`):
```typescript
// HTTP: change 500 to desired limit
async httpLimiter(req, reply) {
  const { allowed } = await this.check(key, 500, 60 * 1000)
  // ...
}

// WebSocket: change 100 to desired limit
async wsLimiter(ip) {
  const { allowed } = await this.check(key, 100, 60 * 1000)
  // ...
}
```

**Admin Service** (`services/admin-service/src/middleware/rate-limiter.ts`):
```typescript
// HTTP: change 500 to desired limit
async httpLimiter(req, reply) {
  const { allowed } = await this.check(key, 500, 60 * 1000)
  // ...
}

// Login: change 10 to desired limit or 5*60*1000 for time window
async loginLimiter(req, reply) {
  const { allowed } = await this.check(key, 10, 5 * 60 * 1000)
  // ...
}
```

Then rebuild and restart:
```bash
npm run build
npm restart # or pm2 restart
```

---

## Monitoring

### Check Rate Limit Activity

```bash
# View all rate limit keys in Redis
redis-cli keys "rate-limit:*"

# Count login attempts from an IP
redis-cli zcard rate-limit:login:192.168.1.1

# Count API requests from an IP
redis-cli zcard rate-limit:http:203.0.113.1

# View request details (timestamps)
redis-cli zrange rate-limit:login:192.168.1.1 0 -1 withscores
```

### Log Monitoring

Rate limit violations appear in service logs:

**Game Gateway:**
```
[ws] rate limit exceeded for IP 192.168.1.1
```

**Admin Service:**
Log all 429 responses (check application logs).

### Redis Memory Usage

Monitor Redis memory for rate limit data:
```bash
# Check total Redis memory
redis-cli info memory

# Get count of rate limit keys
redis-cli dbsize # or filter with: redis-cli keys "rate-limit:*" | wc -l
```

---

## Security Benefits

### 1. DDoS Prevention
- WebSocket connection floods limited to 100/min per IP
- HTTP floods limited to 500/min per IP
- Reduces server load and improves availability

### 2. Brute Force Protection
- Admin login limited to 10 attempts per 5 minutes
- Makes password guessing impractical
- Time delays increase attack cost

### 3. API Abuse Prevention
- General API requests limited to 500/min per IP
- Prevents resource exhaustion from bad clients
- Protects other legitimate users

### 4. Distributed Security
- Redis backend ensures limits work across multiple instances
- Fair enforcement across all gateways
- Consistent tracking even with load balancing

---

## Limitations & Considerations

### 1. Shared IP Addresses
- Users behind corporate proxies/VPNs share same IP
- Legitimate users may be rate limited together
- Solution: Increase limits or implement allowlist

### 2. Distributed Attacks
- Attack from many IPs bypasses per-IP limits
- Not a replacement for network-level DDoS protection
- Use CDN/WAF for large-scale DDoS

### 3. False Positives
- Retry logic in clients can cause legitimate 429 responses
- Ensure clients respect Retry-After header
- Monitor for unexpected spikes

### 4. Time Window Precision
- Windows are strict (no sliding window)
- Request at end of window may fail even with low usage
- By design to keep implementation simple

---

## Future Enhancements

1. **Adaptive Limits**: Adjust limits based on server load
2. **IP Blocklist**: Temporarily block IPs with many violations
3. **User-based Limits**: Rate limit by user ID instead of IP
4. **Allowlist**: Whitelist trusted IPs (internal services)
5. **Graduated Penalties**: Increase lockout time for repeated violations
6. **Per-endpoint Limits**: Different limits for different endpoints
7. **Circuit Breaker**: Fail fast for downstream services

---

## Deployment Checklist

- [x] Rate limiter middleware created for both services
- [x] Unit tests written and passing
- [x] Integration tests written and passing
- [x] Both services compile without errors
- [x] Rate limiter applied to all critical endpoints
- [x] Response headers configured correctly
- [x] 429 responses return proper error format
- [x] Retry-After header implemented
- [x] Redis keys auto-expire
- [x] Proxy header support (X-Forwarded-For) implemented
- [x] Documentation created
- [ ] Deploy to staging and test with real traffic
- [ ] Configure monitoring/alerts
- [ ] Deploy to production
- [ ] Monitor for false positives

---

## Testing Scenarios

### Scenario 1: Normal Usage
- User makes requests under limit → All requests succeed
- User sees rate limit headers
- No 429 responses

### Scenario 2: Hitting Rate Limit
- User makes 501 API requests in 60 seconds → 501st fails with 429
- Retry-After header suggests waiting 30+ seconds
- Next request after window expires → Succeeds

### Scenario 3: Brute Force Attack
- Attacker makes 10 login attempts → First 10 allowed
- 11th attempt → 429 Too Many Login Attempts
- Attacker must wait 5 minutes to retry

### Scenario 4: WebSocket Flood
- Client attempts 150 connections/minute → First 100 allowed
- Connections 101-150 → Receive close code 4029
- Message: "WebSocket connection rate limit exceeded"

---

## Support & Troubleshooting

### Issue: "Rate limit not working"
**Diagnosis:**
```bash
# Check Redis is running
redis-cli ping  # Should return PONG

# Check rate limit keys exist
redis-cli keys "rate-limit:*"

# Check Redis connectivity from service
# (Service logs should show Redis connection errors)
```

### Issue: "Legitimate users getting rate limited"
**Solution:**
1. Check if users behind shared proxy/VPN
2. Increase rate limits if needed
3. Implement IP allowlist for trusted services

### Issue: "Memory usage high"
**Diagnosis:**
```bash
# Check number of rate limit keys
redis-cli keys "rate-limit:*" | wc -l

# View largest keys
redis-cli --bigkeys

# Check key expiration is working
redis-cli ttl rate-limit:http:192.168.1.1
```

---

## References

- Redis Sorted Sets: https://redis.io/docs/data-types/sorted-sets/
- HTTP Status Codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
- Rate Limiting Best Practices: https://cloud.google.com/architecture/rate-limiting-strategies-techniques
