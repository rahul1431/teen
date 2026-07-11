# Rate Limiting Implementation

This document describes the rate limiting configuration for the Game Gateway service.

## Overview

Rate limiting is implemented to protect critical endpoints from abuse, DDoS attacks, and brute force attacks. The implementation uses Redis as a distributed backend to ensure rate limiting works across multiple gateway instances.

## Configuration

### Limits

1. **HTTP API Endpoints** (`/api/*`)
   - Limit: 500 requests per minute per IP
   - Purpose: Prevent general API abuse
   - Applies to: All HTTP routes except `/health`

2. **WebSocket Connections** (`/ws`)
   - Limit: 100 connections per minute per IP
   - Purpose: Prevent connection floods/DDoS
   - Applies to: WebSocket upgrade requests

### Implementation Details

The rate limiter uses Redis sorted sets to track request timestamps per IP. When a request arrives:

1. Extract client IP (from X-Forwarded-For header for proxied requests, or socket address)
2. Create a Redis key in the format: `rate-limit:{type}:{ip}`
3. Use a sorted set where score = timestamp, value = unique request ID
4. Remove expired entries (older than the window)
5. Check if current count exceeds limit
6. Record the request if allowed

### Redis Keys

All rate limit data is stored with keys prefixed by `rate-limit:`:

- `rate-limit:http:192.168.1.1` - HTTP requests from this IP
- `rate-limit:ws:203.0.113.45` - WebSocket connections from this IP
- `rate-limit:login:198.51.100.2` - Admin login attempts from this IP

Keys automatically expire after the time window + 1 second.

## Headers

When rate limiting is applied, the following headers are returned:

```
X-RateLimit-Limit: 500           # Maximum requests in window
X-RateLimit-Remaining: 495       # Requests remaining in current window
X-RateLimit-Reset: 1234567890000 # Timestamp when window resets (milliseconds)
Retry-After: 35                   # Seconds to wait before retrying (on 429 only)
```

## Response Status Codes

### Normal Operation
- `200-399` - Request processed successfully

### Rate Limited
- `429 Too Many Requests` - Rate limit exceeded

#### Response Body:
```json
{
  "error": "Too Many Requests",
  "message": "API rate limit exceeded. Please try again later.",
  "retryAfter": 35
}
```

## Client Behavior

When receiving a `429 Too Many Requests`:

1. Check the `Retry-After` header for the number of seconds to wait
2. Wait before retrying the request
3. Implement exponential backoff for resilience
4. Consider circuit breaker patterns for critical flows

Example (JavaScript):
```javascript
async function makeRequest() {
  const response = await fetch('/api/endpoint');
  
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After')) * 1000;
    console.log(`Rate limited. Retrying after ${retryAfter}ms`);
    await new Promise(resolve => setTimeout(resolve, retryAfter));
    return makeRequest(); // Retry
  }
  
  return response;
}
```

## Distributed Systems

Rate limiting works across multiple gateway instances through Redis:

- All instances use the same Redis instance
- Rate limit counters are shared and consistent
- IP tracking is global, not per-instance
- Automatic cleanup of expired keys via Redis TTL

## Monitoring

Monitor rate limiting activity by checking Redis keys:

```bash
# View all rate limit keys
redis-cli keys "rate-limit:*"

# Check limit count for an IP
redis-cli zcard rate-limit:http:192.168.1.1

# View request timestamps for an IP
redis-cli zrange rate-limit:http:192.168.1.1 0 -1 withscores
```

## Proxy Setup

If running behind a reverse proxy (nginx, CloudFlare, etc.), ensure:

1. Proxy forwards `X-Forwarded-For` header
2. Proxy does not strip `X-Real-IP` header
3. Set trusted proxy in production (optional additional header validation)

### Nginx Example:
```nginx
location /ws {
  proxy_pass http://gateway:3004;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Real-IP $remote_addr;
  
  # WebSocket upgrade
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

## Testing

Rate limiting can be tested with the included test suites:

```bash
# Run rate limiting unit tests
npm run test rate-limit.test.ts

# Run integration tests
npm run test rate-limit-integration.test.ts
```

### Manual Testing

```bash
# Test HTTP rate limiting (500/min)
for i in {1..10}; do curl -H "X-Forwarded-For: 192.168.1.100" http://localhost:3004/health; done

# Test WebSocket rate limiting with ab
ab -n 150 -c 10 ws://localhost:3004/ws

# Monitor rate limit keys
watch -n 1 'redis-cli keys "rate-limit:*" | wc -l'
```

## Performance Impact

- **Memory**: O(1) per IP per time window (typical: <100 bytes/entry)
- **CPU**: Minimal (Redis sorted set operations are O(log n))
- **Network**: One Redis call per request (pipelined operations)
- **Latency**: <5ms additional latency per request

## Security Considerations

1. **Distributed attacks**: Attacks from multiple IPs will be rate limited per IP
2. **Spoofing**: Ensure X-Forwarded-For is only trusted from known proxies
3. **False positives**: Legitimate users behind shared IPs may be rate limited together
4. **Reset time**: Time windows are strict; requests from near-end of window may be denied

## Configuration Change

To adjust rate limits, modify the values in `src/middleware/rate-limiter.ts`:

```typescript
// HTTP endpoints: change 500 to desired limit
const { allowed } = await this.check(key, 500, 60 * 1000)

// WebSocket: change 100 to desired limit
const { allowed } = await this.check(key, 100, 60 * 1000)

// Login: change 10 to desired limit, 5*60*1000 for window
const { allowed } = await this.check(key, 10, 5 * 60 * 1000)
```

Then rebuild and redeploy:
```bash
npm run build
npm restart # or pm2 restart
```

## Troubleshooting

### Legitimate users getting rate limited
- Check if they're behind a shared IP (proxy, VPN, corporate network)
- Increase limits if needed
- Consider implementing allowlist for known services

### Rate limit not working
- Verify Redis connection: `redis-cli ping` should return PONG
- Check Redis keys: `redis-cli keys "rate-limit:*"`
- Verify proxy forwards X-Forwarded-For header

### Excessive Redis memory usage
- Check for bugs in key expiration
- Monitor key count: `redis-cli info keyspace`
- Reduce time windows if needed

## Future Enhancements

1. **Adaptive rate limiting**: Adjust limits based on server load
2. **User-based limiting**: Rate limit by user ID instead of IP
3. **Gradual backoff**: Increase penalty time for repeated violations
4. **Allowlist**: Whitelist known good IPs (trusted services)
5. **Circuit breaker**: Temporary blocks for aggressive clients
