# Stress Test: 5,000 Concurrent Players

This document describes how to run the 5K concurrent player stress test for the game gateway.

## Overview

The stress test simulates:
- **5,000 concurrent WebSocket/HTTP connections**
- **Realistic game actions** (bet, fold, check, raise, call)
- **Network latency measurement** (P95, P99 percentiles)
- **Failure recovery** and error tracking
- **Sustained load** for 2 minutes
- **Real-time metrics** reporting

## Prerequisites

### 1. Running Services

Ensure these services are running:

```bash
# Terminal 1: PostgreSQL
docker run -d --name teen_postgres -e POSTGRES_PASSWORD=teen_secret_2024 -p 5432:5432 postgres:16-alpine

# Terminal 2: Redis
docker run -d --name teen_redis -e REDIS_PASSWORD=teen_redis_2024 -p 6379:6379 redis:7-alpine

# Terminal 3: Zookeeper + Kafka (optional, for event streaming)
docker-compose up -d zookeeper kafka-broker-1 kafka-broker-2 kafka-broker-3

# Terminal 4: Gateway instances (3 x load balancing)
cd services/game-gateway
npm run dev  # Starts on port 3004
PORT=3005 npm run dev  # Starts on port 3005
PORT=3006 npm run dev  # Starts on port 3006

# Terminal 5: Nginx load balancer (optional)
sudo nginx -c $(pwd)/infra/nginx/load-balancer.conf
```

### 2. Environment Setup

```bash
# In services/game-gateway/.env
DATABASE_URL=postgresql://teen:teen_secret_2024@localhost:5432/teen_db
REDIS_URL=redis://:teen_redis_2024@localhost:6379
JWT_SECRET=cluster_jwt_secret_min_32_characters_long
```

## Running the Stress Test

### Quick Start

```bash
cd services/game-gateway

# Install dependencies
npm install

# Run the stress test
npm run test:stress-5k
```

### Full Example with Docker Compose

```bash
# Start all required services
docker-compose -f docker-compose.load-balancer.yml up -d

# Wait for services to be healthy
sleep 10

# Run the stress test
cd services/game-gateway
npm run test:stress-5k

# Clean up
docker-compose -f docker-compose.load-balancer.yml down
```

## Expected Results

### Success Baseline

A healthy deployment should achieve:

| Metric | Target | Notes |
|--------|--------|-------|
| **Connection Success Rate** | ≥95% | 4,750+ successful connections |
| **Sustained Throughput** | ≥1,000 msgs/sec | Across all 5K players |
| **Average Latency** | <100ms | Per message round-trip |
| **P95 Latency** | <200ms | 95th percentile |
| **P99 Latency** | <500ms | 99th percentile |
| **Error Rate** | <1% | Total errors / total messages |

### Example Output

```
════════════════════════════════════════════════════════════════════════════════
🚀 Starting Stress Test: 5000 Concurrent Players
⏱️  Test Duration: 120 seconds
════════════════════════════════════════════════════════════════════════════════

📊 Phase 1: Connection Ramp-up (5000 players)
  Batch 1/10: 500/500 connected
  Batch 2/10: 500/500 connected
  Batch 3/10: 500/500 connected
  Batch 4/10: 500/500 connected
  Batch 5/10: 500/500 connected
  Batch 6/10: 500/500 connected
  Batch 7/10: 500/500 connected
  Batch 8/10: 500/500 connected
  Batch 9/10: 500/500 connected
  Batch 10/10: 500/500 connected

⚙️  Phase 2: Sustained Load (120s)
  [10.2s] Connected: 5000/5000 | Errors: 0
  [20.1s] Connected: 5000/5000 | Errors: 2
  [30.3s] Connected: 5000/5000 | Errors: 5
  [40.2s] Connected: 5000/5000 | Errors: 12
  [50.1s] Connected: 5000/5000 | Errors: 18
  [60.2s] Connected: 5000/5000 | Errors: 24
  [70.1s] Connected: 5000/5000 | Errors: 31
  [80.3s] Connected: 5000/5000 | Errors: 38
  [90.2s] Connected: 5000/5000 | Errors: 45
  [100.1s] Connected: 5000/5000 | Errors: 52
  [110.2s] Connected: 5000/5000 | Errors: 58
  [120.1s] Connected: 5000/5000 | Errors: 62

⏹️  Phase 3: Cooldown (waiting for connections to close)

════════════════════════════════════════════════════════════════════════════════
📈 STRESS TEST RESULTS
════════════════════════════════════════════════════════════════════════════════

✅ Connection Metrics:
   Total Players Attempted: 5000
   Successfully Connected: 4975 (99.5%)
   Connection Failures: 25

📊 Throughput Metrics:
   Total Messages Sent: 150,000
   Total Messages Received: 149,500
   Messages/Second: 1,245.83

⏱️  Latency Metrics (ms):
   Average: 42.35ms
   P95: 156.32ms
   P99: 412.18ms

⚠️  Error Metrics:
   Total Errors: 62
   Error Rate: 0.04%

⏱️  Test Duration: 120.5 seconds
════════════════════════════════════════════════════════════════════════════════
```

## Performance Tuning

### If Connection Rate is Too Low

**Issue**: Fewer than 95% connections succeeded

**Solutions**:
1. Increase system file descriptor limits:
   ```bash
   ulimit -n 10000  # Raise from typical 1024
   ```

2. Tune kernel parameters:
   ```bash
   sudo sysctl -w net.core.somaxconn=4096
   sudo sysctl -w net.ipv4.tcp_max_syn_backlog=4096
   ```

3. Check gateway logs for errors:
   ```bash
   tail -f services/game-gateway/logs/*.log
   ```

### If Latency is High

**Issue**: Average latency > 100ms

**Solutions**:
1. Check CPU usage (should be < 80%):
   ```bash
   top
   ```

2. Check memory usage (should be < 4GB for 5K players):
   ```bash
   free -h
   ```

3. Check Redis performance:
   ```bash
   redis-cli --latency
   ```

4. Increase gateway instance count (currently 3):
   ```bash
   PORT=3007 npm run dev  # Add 4th instance
   PORT=3008 npm run dev  # Add 5th instance
   ```

### If Error Rate is High

**Issue**: Error rate > 1%

**Solutions**:
1. Check database connection pool:
   ```bash
   # In services/game-gateway/src/db.ts
   const pool = new Pool({
     max: 50,  // Increase from default
   })
   ```

2. Check Redis connection pool:
   ```bash
   # In services/game-gateway/src/redis.ts
   const redis = new Redis({
     maxRetriesPerRequest: null,  // Unlimited retries
     enableReadyCheck: false,
   })
   ```

3. Check for process crashes:
   ```bash
   pm2 logs
   ```

## Monitoring During Test

### Open Multiple Terminals

**Terminal 1: Watch Gateway Logs**
```bash
cd services/game-gateway
npm run dev  # Logs appear in console
```

**Terminal 2: Monitor System Resources**
```bash
watch -n 1 'ps aux | grep node | grep -v grep'
```

**Terminal 3: Monitor Database Connections**
```bash
psql -U teen -d teen_db -c "SELECT count(*) FROM pg_stat_activity;"
```

**Terminal 4: Monitor Redis Memory**
```bash
redis-cli -a teen_redis_2024 INFO memory
```

**Terminal 5: Run the Stress Test**
```bash
cd services/game-gateway
npm run test:stress-5k
```

## Interpreting Results

### Connection Phase Insights

- **0-30s**: Ramp-up phase - connection rate should be ~2,000 players/sec
- **30-120s**: Sustained phase - all 5K should be connected and stable

### Throughput Insights

- **150,000+ messages** in 2 minutes = healthy
- **If < 100,000 messages**: Check for:
  - Network issues (packet loss)
  - Gateway crashes
  - Redis memory pressure

### Latency Insights

- **Average < 50ms**: Excellent
- **P95 < 200ms**: Good
- **P99 < 500ms**: Acceptable
- **If P99 > 1s**: System is congested

### Error Rate Insights

- **< 0.1%**: Excellent (good error handling)
- **0.1-1%**: Good
- **> 1%**: Investigate root cause:
  - Connection timeouts?
  - Message processing failures?
  - Database errors?

## Scale Testing Beyond 5K

To test with more players:

```bash
# Modify CONFIG in stress-test-5k.ts
const CONFIG = {
  CONCURRENT_PLAYERS: 10000,  // Change this
  // ... rest of config
}

# Run again
npm run test:stress-5k
```

**Prerequisites for 10K+**:
- At least 6 gateway instances (load them across VPS)
- 16GB+ RAM
- Dedicated Redis instance (512MB+)
- 10 Gbps network (cloud recommended)

## CI/CD Integration

Add to GitHub Actions:

```yaml
name: Stress Test

on:
  schedule:
    - cron: '0 2 * * *'  # Run daily at 2 AM
  workflow_dispatch:

jobs:
  stress-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: teen_secret_2024
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: cd services/game-gateway && npm install && npm run test:stress-5k
      - name: Report Results
        if: always()
        run: echo "Stress test completed"
```

## Related Documentation

- [Load Balancing Guide](LOAD_BALANCING.md)
- [Game Gateway README](README.md)
- [Capacity Planning](../../docs/CAPACITY_PLANNING_METHODOLOGY.md)
- [Performance Tuning](../../docs/PERFORMANCE_TUNING.md)
