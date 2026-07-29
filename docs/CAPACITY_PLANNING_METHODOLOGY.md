# Capacity Planning Methodology - Teen Platform

## Overview

This document describes the capacity planning model used to forecast infrastructure resources needed to support a target number of concurrent players. The model is deterministic and data-driven, enabling predictable scaling decisions.

## Table of Contents

1. [Core Assumptions](#core-assumptions)
2. [Scaling Formulas](#scaling-formulas)
3. [Service-by-Service Breakdown](#service-by-service-breakdown)
4. [Database Scaling](#database-scaling)
5. [Cost Estimation](#cost-estimation)
6. [Load Testing Strategy](#load-testing-strategy)
7. [Deployment Checklist](#deployment-checklist)
8. [Monitoring & Feedback](#monitoring--feedback)

---

## Core Assumptions

### Players-to-Replicas Mapping

**Formula:**
```
Game Gateway Replicas = CEIL(Concurrent Players / 1500)
```

**Rationale:**
- Based on profiling: 1 game-gateway pod handles ~1500 concurrent WebSocket connections
- Each pod: 250m CPU, 2GB memory
- Headroom: 70% target CPU utilization (leave 30% for traffic spikes)

**Examples:**
| Players | Replicas | Note |
|---------|----------|------|
| 500 | 1 | Single pod, underutilized |
| 1500 | 1 | Single pod at optimal capacity |
| 1501 | 2 | Trigger scale-up |
| 3000 | 2 | Dual pods, good distribution |
| 5000 | 4 | 4-pod cluster |
| 10000 | 7 | Enterprise cluster |

### Query Rate per Player

**Formula:**
```
Queries Per Second (QPS) = Concurrent Players × QPS per Player
```

**Default:** 1 query/sec per concurrent player

**Rationale:**
- WebSocket connection creates session in DB (1 query on connect)
- Game state updates: ~0.1 queries/sec per active hand
- Leaderboard & profile reads: ~0.05 queries/sec
- **Total: ~0.5-1.5 queries/sec per player**

**Breakdown (Teen Patti example):**
- Hand start: 3 queries (player session, room state, hand setup)
- Hand action (fold/check/call/raise): 2 queries (hand update, action log)
- Hand end: 2 queries (settlement, leaderboard update)
- Duration: ~60 seconds (1 hand/min average)
- **Average: (3 + 2 + 2) / 60 = 0.12 queries/hand**
- **With 5-10 hands active simultaneously: 0.6-1.2 queries/sec**

### Network Bandwidth per Player

**Formula:**
```
Total Bandwidth (Mbps) = Concurrent Players × Bandwidth per Player
```

**Default:** 1 Mbps per concurrent player

**Rationale:**
- WebSocket message size: ~100-500 bytes
- Message frequency: ~10-100/sec per connection
- Average: ~50-100 Kbps per player
- **Conservative estimate: 1 Mbps (to account for spikes)**

**Examples:**
- 5000 players: 5 Gbps bandwidth
- 10000 players: 10 Gbps bandwidth

### Connection Pool Size

**Formula:**
```
DB Connection Pool = (Concurrent Players / 1500) × 25
```

**Default:** 25 connections per game-gateway pod

**Rationale:**
- Fastify connection pool: ~25 concurrent queries
- With 1500 players/pod: 1 connection pool per pod
- Scale linearly with pod count

---

## Scaling Formulas

### Horizontal Scaling (Game Gateway)

```
MinReplicas = 2                                    # HA: always 2+
MaxReplicas = 10                                   # Cost control
DesiredReplicas = CEIL(Players / 1500)
TargetUtilization = 70%                           # HPA metric
ScaleUpThreshold = 70% CPU (immediate)
ScaleDownThreshold = 30% CPU (after 5 minutes)
```

### Vertical Scaling

**Game Gateway per Replica:**
- CPU: 250m (request) → 1000m (limit)
- Memory: 2GB (request) → 2GB (limit)

**Bot Learning (background batch):**
- CPU: 500m (request) → 1500m (limit)
- Memory: **2GB** (increased from 1GB for larger batches)
- Rationale: Nightly bot-profile rebuild processes 10K+ player records
- Expected improvement: 45min → 20min processing time

**Model Server (ML inference):**
- CPU: **1000m** (increased from 500m for <100ms latency)
- Memory: 512Mi (request) → 1024Mi (limit)
- Rationale: Churn/fraud model inference is CPU-bound
- Expected improvement: 150-200ms → 50-80ms latency

### Database Scaling

**Single PostgreSQL Instance:**
```
max_connections = 250 + (Replicas × 25)
shared_buffers = 512MB → 2GB (based on QPS)
effective_cache_size = 1536MB → 6GB (based on QPS)
```

**Multi-Region Read Replica:**
- Recommended for QPS > 5000
- Replication lag: < 1 second
- Read-only: suitable for leaderboards, player profiles

---

## Service-by-Service Breakdown

### 1. Game Gateway (WebSocket Server)

**Scaling Formula:**
```
Replicas = CEIL(Players / 1500)
```

**Resource per Replica:**
- CPU: 1000m (1 core)
- Memory: 2GB

**Capacity Example (5000 players):**
- Replicas: 4
- Total CPU: 4 cores
- Total Memory: 8GB
- Max connections: 4 × 1500 = 6000

**Bottleneck:** CPU (WebSocket connection handling, JSON serialization)

**Optimization:**
- Connection pooling for database
- Redis caching for frequently-accessed data
- Message compression (optional)

### 2. Bot Learning Service (Background Batch)

**Scaling Formula:**
```
Replicas = 1 (background job, not scale-dependent)
```

**Resource:**
- CPU: 500m
- Memory: **2GB** (scaled up for batch processing)
- Frequency: Nightly (20:00-21:00 UTC)
- Duration: 20-45 minutes

**Capacity Example (5000 players):**
- Processes: ~5000 player records
- Loads in memory: 50KB per player profile
- Total memory needed: 5000 × 50KB = 250MB (within 2GB limit)

**Improvement:**
- Old: 150MB limit → frequent GC pauses
- New: 2GB limit → batch processing completes in 20min

### 3. Model Server (ML Inference)

**Scaling Formula:**
```
Replicas = 1 (QPS < 3000), 2 (QPS ≥ 3000)
```

**Resource per Replica:**
- CPU: **1000m** (scaled up for inference speed)
- Memory: 512MB
- Models loaded: churn, fraud, personalization

**Capacity Example (5000 players):**
- Request rate: ~50 inference requests/sec
- Latency target: <100ms (p99)
- With 1 replica at 1000m CPU: 50-70 inference ops/sec (achievable)
- With 2 replicas at 1000m CPU: 100-140 inference ops/sec (headroom)

**Improvement:**
- Old: 500m CPU → 150-200ms latency
- New: 1000m CPU → 50-80ms latency

### 4. Database (PostgreSQL)

**Scaling Strategy:**

**Phase 1: Single Instance (up to 5000 players)**
- max_connections: 250
- shared_buffers: 1GB
- effective_cache_size: 3GB

**Phase 2: Read Replicas (5000-10000 players)**
- Primary: 250 connections (writes + local reads)
- Replica 1: 250 connections (read-heavy queries)
- Replica 2: 250 connections (read-heavy queries)
- Replication lag: < 1 second

**Phase 3: Sharding (>10000 players)**
- Shard by game_type or player_id
- Each shard: independent primary + replicas
- Load balancer routes queries to correct shard

---

## Database Scaling

### Required Indices (from Task 30)

These indices are critical for query performance at scale:

```sql
-- 1. Leaderboard queries (top N players by score)
CREATE INDEX idx_leaderboards_game_season_score 
ON leaderboards(game_id, season_id, score DESC);

-- 2. Player session lookups
CREATE INDEX idx_player_sessions_player_active 
ON player_sessions(player_id, is_active) 
INCLUDE (room_id, started_at);

-- 3. Fraud detection (recent transactions)
CREATE INDEX idx_transactions_player_timestamp 
ON transactions(player_id, created_at DESC) 
WHERE status = 'completed';

-- 4. Bot profile queries (by skill level)
CREATE INDEX idx_bot_profiles_game_skill 
ON bot_profiles(game_id, skill_level) 
INCLUDE (aggression, play_style);

-- 5. Churn prediction (inactive players)
CREATE INDEX idx_players_last_seen_churned 
ON players(last_seen_at DESC) 
WHERE is_churned = false 
AND last_seen_at > now() - interval '90 days';
```

### Query Performance Targets

| Metric | Target | Current | Gap |
|--------|--------|---------|-----|
| Leaderboard (top 100) | <50ms | 200ms | Add index |
| Player session lookup | <20ms | 150ms | Add index |
| Fraud check (recent tx) | <30ms | 300ms | Add index |
| Bot difficulty lookup | <10ms | 80ms | Add index |
| Churn query (bulk) | <5s | 45s | Add index + cache |

---

## Cost Estimation

### AWS Pricing Model

**Compute (m7g.large instances: 2 cores, 8GB RAM)**
- Per core/month: $0.0536
- Per GB/month: $0.0107

**Database (RDS db.t4g.medium: 2 cores, 4GB RAM)**
- Per instance/month: $0.195
- Per read replica/month: $0.195

### Cost Examples

#### Scenario 1: 1000 Concurrent Players
- Game Gateway: 1 replica (0.5 cores, 2GB)
  - Compute: 0.5 × $0.0536 + 2 × $0.0107 = $37/month
- Database: 1 primary
  - Database: $195/month
- **Total: ~$230/month**

#### Scenario 2: 5000 Concurrent Players
- Game Gateway: 4 replicas (2 cores, 8GB)
  - Compute: 2 × $0.0536 + 8 × $0.0107 = $193/month
- Bot Learning: 1 replica (0.5 cores, 2GB)
  - Compute: 0.5 × $0.0536 + 2 × $0.0107 = $37/month
- Model Server: 1 replica (1 core, 0.5GB)
  - Compute: 1 × $0.0536 + 0.5 × $0.0107 = $59/month
- Database: 1 primary + 1 replica
  - Database: $195 × 2 = $390/month
- **Total: ~$680/month**

#### Scenario 3: 10000 Concurrent Players
- Game Gateway: 7 replicas (3.5 cores, 14GB)
  - Compute: 3.5 × $0.0536 + 14 × $0.0107 = $338/month
- Bot Learning: 1 replica (0.5 cores, 2GB)
  - Compute: $37/month
- Model Server: 2 replicas (2 cores, 1GB)
  - Compute: 2 × $0.0536 + 1 × $0.0107 = $118/month
- Database: 1 primary + 2 replicas
  - Database: $195 × 3 = $585/month
- **Total: ~$1080/month**

---

## Load Testing Strategy

### Test Phases

**Phase 1: Ramp-up (0-5 minutes)**
- Linearly increase from 0 → 5000 concurrent players
- Observe how HPA responds to gradual load increase
- Monitor connection acceptance rate
- Measure: Pod scale-up events, latency trend

**Phase 2: Steady-state (5-15 minutes)**
- Maintain 5000 concurrent players
- Simulate realistic game play (joins, hands, leaves)
- Measure: Throughput, latency distribution, error rate
- Expected: Stable resource utilization (60-70% CPU, 50-60% memory)

**Phase 3: Ramp-down (15-20 minutes)**
- Linearly decrease from 5000 → 0 players
- Observe how HPA scales down gracefully
- Measure: Pod scale-down events, session cleanup latency
- Expected: Clean shutdown without errors

### Success Criteria

| Metric | Threshold | Note |
|--------|-----------|------|
| p50 latency | < 50ms | Typical WebSocket round-trip |
| p95 latency | < 200ms | 95th percentile acceptable |
| p99 latency | < 500ms | **SLO: hard limit** |
| Error rate | < 1% | Connection/message errors |
| Memory usage | < 70% | Pod resource limit |
| CPU usage | 60-70% | Target for HPA |

### k6 Metrics Collection

**Counters:**
- `ws_connect_errors`: Failed WebSocket connections
- `ws_messages_sent`: Total messages sent
- `game_sessions_joined`: Players joined games
- `game_sessions_left`: Players left games

**Trends:**
- `ws_connection_time`: Time to establish connection
- `ws_message_latency_ms`: Round-trip latency
- `game_session_duration_sec`: Session length
- `http_req_duration`: API request latency

**Rates:**
- `game_error_rate`: Fraction of failed operations
- `http_req_errors`: Fraction of failed HTTP requests

---

## Deployment Checklist

### Pre-Deployment

- [ ] Review capacity forecast for target load
- [ ] Validate Kubernetes manifests (syntax, resource limits)
- [ ] Deploy to staging cluster first
- [ ] Run load tests in staging
- [ ] Verify all indices created on database
- [ ] Document current resource utilization (baseline)

### Deployment Day

1. **Scale Database**
   ```bash
   # Add indices (non-blocking)
   psql -d teen_db < add-indices.sql
   
   # Increase shared_buffers (requires restart, schedule at low traffic)
   # Update docker-compose.yml max_connections setting
   ```

2. **Deploy HPA to Production**
   ```bash
   kubectl apply -f infra/k8s/game-gateway-hpa.yaml
   ```

3. **Monitor First 24 Hours**
   - Watch HPA scaling events: `kubectl get hpa -w`
   - Monitor latency: `kubectl logs -f -l app=game-gateway | grep latency`
   - Check error rate: Dashboard or metrics endpoint
   - Verify no pod crashes: `kubectl get pods -w`

4. **Verify Scaling Behavior**
   - Should see ~0-1 scale-up/scale-down events during normal operation
   - Peak hours (18:00-23:00 UTC): expect 2-3 scale-up events
   - No unexpected pod evictions or restarts

### Rollback Procedure

If issues arise:

```bash
# 1. Scale manually to known-good state
kubectl scale deployment game-gateway --replicas=2

# 2. Disable HPA
kubectl delete hpa game-gateway-hpa

# 3. Investigate logs
kubectl logs -f -l app=game-gateway --tail=1000

# 4. Fix root cause (update image, config, etc.)

# 5. Re-apply HPA after verification
kubectl apply -f infra/k8s/game-gateway-hpa.yaml
```

---

## Monitoring & Feedback

### Key Metrics to Track

**HPA Metrics:**
- Current replicas vs. desired replicas
- CPU utilization trend
- Scale-up/scale-down frequency
- Time to reach steady state

**Application Metrics:**
- WebSocket connection success rate
- Message latency (p50/p95/p99)
- Active connections per pod
- Errors per second

**Infrastructure Metrics:**
- CPU utilization per pod
- Memory utilization per pod
- Network I/O per pod
- Pod restart count

**Database Metrics:**
- Active connections
- Query latency (p50/p95/p99)
- Slow query count
- Replication lag (if using replicas)

### Feedback Loop

1. **Weekly Review**
   - Analyze HPA scaling events
   - Check if assumptions (1500 players/pod) still hold
   - Review cost trends

2. **Monthly Tune**
   - Adjust target CPU utilization based on latency data
   - Re-run load tests with real traffic patterns
   - Update forecasting model if needed

3. **Quarterly Forecast**
   - Re-forecast capacity for next quarter
   - Plan hardware upgrades or cloud expansion
   - Review cost trajectory

---

## Appendix: Formulas Reference

### Quick Lookup

| Input | Formula | Output |
|-------|---------|--------|
| Target concurrent players | CEIL(n / 1500) | Game gateway replicas |
| Concurrent players | n × 1 | Estimated QPS |
| Concurrent players | n × 1 | Estimated Mbps |
| Replicas | r × 250m | Total CPU (millicores) |
| Replicas | r × 2 | Total memory (GB) |
| Target QPS | See table | Recommended DB config |

### Resource Allocation Cheat Sheet

```
For 1K concurrent players:
- Replicas: 1
- CPU: 0.25 cores
- Memory: 2GB
- QPS: ~1000
- Cost: ~$200/month

For 5K concurrent players:
- Replicas: 4
- CPU: 1 core
- Memory: 8GB
- QPS: ~5000
- Cost: ~$700/month

For 10K concurrent players:
- Replicas: 7
- CPU: 1.75 cores
- Memory: 14GB
- QPS: ~10000
- Cost: ~$1100/month
```

---

## References

- Kubernetes HPA: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/
- PostgreSQL Tuning: https://wiki.postgresql.org/wiki/Performance_Optimization
- k6 Load Testing: https://k6.io/docs/
- AWS Pricing: https://aws.amazon.com/ec2/pricing/on-demand/
