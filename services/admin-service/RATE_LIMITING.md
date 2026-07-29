# Rate Limiting Implementation - Admin Service

This document describes the rate limiting configuration for the Admin Service.

## Overview

Rate limiting is implemented to protect the admin panel from brute force attacks and API abuse. The implementation uses Redis as a distributed backend to ensure rate limiting works across multiple admin service instances.

## Configuration

### Limits

1. **HTTP API Endpoints** (`/api/*`)
   - Limit: 500 requests per minute per IP
   - Purpose: Prevent general API abuse
   - Applies to: All HTTP routes except `/health` and `/api/admin/auth/login`

2. **Admin Login Endpoint** (`/api/admin/auth/login`)
   - Limit: 10 attempts per 5 minutes per IP
   - Purpose: Prevent brute force attacks
   - Applies to: Login endpoint specifically

### Implementation Details

The rate limiter uses Redis sorted sets to track request timestamps per IP. When a request arrives:

1. Extract client IP (from X-Forwarded-For header for proxied requests, or socket address)
2. Create a Redis key in the format: `rate-limit:{type}:{ip}`
3. Use a sorted set where score = timestamp, value = unique request ID
4. Remove expired entries (older than the time window)
5. Check if current count exceeds limit
6. Record the request if allowed

### Redis Keys

All rate limit data is stored with keys prefixed by `rate-limit:`:

- `rate-limit:http:192.168.1.1` - HTTP API requests from this IP
- `rate-limit:login:203.0.113.45` - Admin login attempts from this IP

Keys automatically expire after the time window + 1 second.

## Login Protection

The login endpoint is specifically protected against brute force attacks:

- Limit: 10 failed login attempts per 5 minutes per IP
- Note: This counts ALL login attempts, not just failed ones (conservative approach)
- After 10 attempts, further login attempts will receive `429 Too Many Requests`
- The 5-minute window is per-IP, resets after timeout

### Brute Force Attack Scenario

Attacker tries to guess password:

```
Attempt 1: Login attempt - ALLOWED (9 remaining)
Attempt 2: Login attempt - ALLOWED (8 remaining)
...
Attempt 10: Login attempt - ALLOWED (0 remaining)
Attempt 11: Login attempt - REJECTED with 429 (5 min lockout)
```

## Headers

When rate limiting is applied, the following headers are returned:

```
X-RateLimit-Limit: 10            # Maximum attempts in 5-minute window (login) or 500 per minute (HTTP)
X-RateLimit-Remaining: 5         # Attempts/requests remaining in current window
X-RateLimit-Reset: 1234567890000 # Timestamp when window resets (milliseconds)
Retry-After: 245                  # Seconds to wait before retrying (on 429 only)
```

## Response Status Codes

### Normal Operation
- `200-399` - Request processed successfully

### Rate Limited
- `429 Too Many Requests` - Rate limit exceeded

#### Response Body for Login:
```json
{
  "error": "Too Many Login Attempts",
  "message": "Too many login attempts. Please try again later.",
  "retryAfter": 245
}
```

#### Response Body for HTTP API:
```json
{
  "error": "Too Many Requests",
  "message": "API rate limit exceeded. Please try again later.",
  "retryAfter": 45
}
```

## Client Behavior

When receiving a `429 Too Many Requests`:

1. Check the `Retry-After` header for the number of seconds to wait
2. Wait before retrying the request
3. For login: Display message to admin and lock form temporarily
4. Implement exponential backoff for API requests

### Login Example (React):

```typescript
const [loginAttempts, setLoginAttempts] = useState(0)
const [lockoutTime, setLockoutTime] = useState(0)

async function handleLogin(username: string, password: string) {
  try {
    const response = await fetch('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60')
      setLockoutTime(retryAfter)
      
      // Lock form for retryAfter seconds
      setTimeout(() => setLockoutTime(0), retryAfter * 1000)
      
      return toast.error(`Too many login attempts. Try again in ${retryAfter} seconds`)
    }

    // Handle successful login or invalid credentials
    const data = await response.json()
    if (response.ok) {
      localStorage.setItem('token', data.token)
      navigate('/dashboard')
    }
  } catch (error) {
    toast.error('Login failed')
  }
}

// In the login form:
<button disabled={lockoutTime > 0}>
  {lockoutTime > 0 ? `Try again in ${lockoutTime}s` : 'Login'}
</button>
```

## Distributed Systems

Rate limiting works across multiple admin service instances through Redis:

- All instances use the same Redis instance
- Rate limit counters are shared and consistent
- IP tracking is global, not per-instance
- Automatic cleanup of expired keys via Redis TTL

## Monitoring

Monitor rate limiting activity by checking Redis keys:

```bash
# View all rate limit keys
redis-cli keys "rate-limit:*"

# Check login attempts from an IP
redis-cli zcard rate-limit:login:192.168.1.1

# Check API request count from an IP
redis-cli zcard rate-limit:http:192.168.1.1

# View request timestamps
redis-cli zrange rate-limit:login:192.168.1.1 0 -1 withscores

# Remove rate limit for specific IP (if needed)
redis-cli del rate-limit:login:192.168.1.1
```

## Proxy Setup

If running behind a reverse proxy (nginx, CloudFlare, etc.), ensure:

1. Proxy forwards `X-Forwarded-For` header
2. Proxy does not strip `X-Real-IP` header
3. The rightmost IP in X-Forwarded-For is used (client IP)

### Nginx Example:
```nginx
location /api/admin {
  proxy_pass http://admin-service:3003;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Real-IP $remote_addr;
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
# Test login rate limiting (10 attempts per 5 min)
for i in {1..15}; do
  curl -X POST http://localhost:3003/api/admin/auth/login \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 192.168.1.100" \
    -d '{"username":"test","password":"test"}' \
    -w "\n%{http_code}\n"
  sleep 1
done

# Monitor rate limit keys in real-time
watch -n 1 'redis-cli keys "rate-limit:login:*" | xargs redis-cli mget'
```

## Performance Impact

- **Memory**: O(1) per IP per time window (typical: <100 bytes/entry)
- **CPU**: Minimal (Redis sorted set operations are O(log n))
- **Network**: One Redis call per request (pipelined operations)
- **Latency**: <5ms additional latency per request

## Security Considerations

1. **Distributed attacks**: Attacks from multiple IPs will be rate limited per IP, but may still succeed across many IPs
2. **Spoofing**: Ensure X-Forwarded-For is only trusted from known proxies
3. **False positives**: Legitimate admins behind shared IPs may be rate limited
4. **Time synchronization**: Ensure server clocks are synced for accurate window tracking

## Configuration Change

To adjust rate limits, modify the values in `src/middleware/rate-limiter.ts`:

```typescript
// HTTP endpoints: change 500 to desired limit (per minute)
async httpLimiter(req: FastifyRequest, reply: FastifyReply) {
  const { allowed } = await this.check(key, 500, 60 * 1000)
  // ...
}

// Login attempts: change 10 to desired limit (per 5 minutes)
async loginLimiter(req: FastifyRequest, reply: FastifyReply) {
  const { allowed } = await this.check(key, 10, 5 * 60 * 1000)
  // ...
}
```

Then rebuild and redeploy:
```bash
npm run build
npm restart # or pm2 restart
```

## Troubleshooting

### Legitimate admins getting rate limited
- Check X-Forwarded-For header to identify the IP
- If behind corporate proxy/VPN, may need allowlist
- Increase login limit temporarily if needed

### Rate limit not working
- Verify Redis connection: `redis-cli ping` should return PONG
- Check Redis keys: `redis-cli keys "rate-limit:*"`
- Verify proxy forwards headers correctly
- Check admin-service logs for errors

### Excessive Redis memory usage
- Check for bugs in key expiration
- Monitor key count: `redis-cli info keyspace`
- View oldest keys: `redis-cli zrange rate-limit:login:* 0 10`

### Testing login lockout behavior
1. Make 10 failed login attempts from the same IP
2. Attempt 11 should return `429 Too Many Requests`
3. Wait 5 minutes for window to reset
4. Next attempt should succeed (if credentials are valid)

## Integration with 2FA

The rate limiter is applied BEFORE 2FA verification. This means:

- Incorrect passwords are rate limited after 10 attempts
- Incorrect 2FA codes are NOT separately rate limited
- A brute force attack on 2FA codes will need to guess within 10 password attempts

Future enhancement: Add separate rate limiting for 2FA codes.

## Alerts and Notifications

Consider adding alerts when rate limiting is triggered:

1. Monitor Redis for spike in `rate-limit:login:*` keys
2. Log suspicious patterns (same IP, multiple failed attempts)
3. Alert admin on repeated rate limiting violations
4. Consider temporary IP block for aggressive attackers

## Future Enhancements

1. **Adaptive rate limiting**: Adjust limits based on attack patterns
2. **IP blocklist**: Temporary block for IPs with many violations
3. **2FA-specific limiting**: Separate rate limit for 2FA attempts
4. **Allowlist**: Whitelist trusted IPs (internal services)
5. **Per-user limiting**: Track by username instead of IP
6. **Graduated penalties**: Increase lockout time for repeated violations
