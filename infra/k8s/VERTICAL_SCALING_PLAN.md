# Vertical Scaling Plan - Teen Platform Infrastructure

## Overview
This document outlines the vertical scaling strategy for services that benefit from increased CPU and memory resources to handle higher load and larger batch processing tasks.

---

## Service: Bot Learning Service

### Current Configuration (PM2/VPS)
- Memory: 150M (max_memory_restart)
- Node memory: 120MB (NODE_OPTIONS)
- Instances: 1

### Target Configuration (Kubernetes)
- Memory Request: 1024Mi (1GB) → **Increased to 2048Mi (2GB)**
- Memory Limit: 2048Mi (2GB) → **Increased to 3072Mi (3GB)**
- CPU Request: 500m → **Kept at 500m (not bottleneck)**
- CPU Limit: 1000m → **Increased to 1500m (1.5 cores)**

### Rationale
- **2x memory increase** allows larger batch processing of player data
- Nightly bot profile rebuilds require in-memory aggregation of 10K+ player records
- Larger batches reduce Kafka processing iterations and database queries
- Current 150M limit causes frequent garbage collection pauses during peak ingestion

### Expected Benefits
- Reduce nightly batch processing time from 45min → 20min
- Support 5K+ concurrent players in memory without swapping
- Eliminate OOM kills during high-variance days

### Kubernetes Deployment
```yaml
resources:
  requests:
    cpu: 500m
    memory: 2Gi
  limits:
    cpu: 1500m
    memory: 3Gi
```

---

## Service: Model Server

### Current Configuration (PM2/VPS)
- Memory: 150M (implied, not explicitly set)
- CPU: Not configured
- Instances: 1

### Target Configuration (Kubernetes)
- Memory Request: 512Mi → **Kept at 512Mi**
- Memory Limit: 1024Mi → **Kept at 1024Mi**
- CPU Request: 500m → **Increased to 1000m (1 core)**
- CPU Limit: 2000m → **Kept at 2000m**

### Rationale
- Model inference is CPU-intensive (matrix operations, predictions)
- Current 500m CPU is insufficient for sub-100ms latency
- 1 core (1000m) minimum needed for churn/fraud models
- Memory is secondary concern (models loaded once at startup)

### Expected Benefits
- Reduce inference latency from 150-200ms → 50-80ms
- Handle 500+ concurrent inference requests/sec
- Support multiple models in-memory (churn, fraud, personalization)

### Kubernetes Deployment
```yaml
resources:
  requests:
    cpu: 1000m
    memory: 512Mi
  limits:
    cpu: 2000m
    memory: 1024Mi
```

---

## Database: PostgreSQL Scaling Plan

### Current Configuration (Docker Compose)
- max_connections: 150
- shared_buffers: 512MB
- effective_cache_size: 1536MB
- Max query throughput: ~5K queries/sec

### Target Configuration (10K queries/sec)
- max_connections: 250 (support 10 concurrent app servers × 25 conn pool)
- shared_buffers: 1024MB (2x increase for larger working set)
- effective_cache_size: 3072MB (increase hit ratio)
- work_mem: 12MB → 16MB (more memory per query operation)

### Required Indices (from Task 30)
```sql
-- Leaderboard queries (top N players by score)
CREATE INDEX idx_leaderboards_game_season_score 
ON leaderboards(game_id, season_id, score DESC);

-- Player session lookups
CREATE INDEX idx_player_sessions_player_active 
ON player_sessions(player_id, is_active) 
INCLUDE (room_id, started_at);

-- Fraud detection (recent transactions)
CREATE INDEX idx_transactions_player_timestamp 
ON transactions(player_id, created_at DESC) 
WHERE status = 'completed';

-- Bot profile queries (by skill level)
CREATE INDEX idx_bot_profiles_game_skill 
ON bot_profiles(game_id, skill_level) 
INCLUDE (aggression, play_style);

-- Churn prediction (inactive players)
CREATE INDEX idx_players_last_seen_churned 
ON players(last_seen_at DESC) 
WHERE is_churned = false 
AND last_seen_at > now() - interval '90 days';
```

### Scaling Steps
1. **Add indices** (non-blocking, created concurrently)
2. **Increase shared_buffers** (requires restart, schedule at low-traffic window)
3. **Increase effective_cache_size** (no restart needed, just tuning)
4. **Tune connection pooling** (app-side: reduce pool size, add connection multiplexing)
5. **Enable logical replication** (for read replicas to handle reads at 10K QPS)

### Expected Throughput
- Single PostgreSQL: 10K queries/sec (with proper tuning)
- With read replica: 15K queries/sec (write-heavy workloads to primary, reads distributed)

---

## Capacity Mapping: Concurrent Players → Resources

### Formula
```
Replicas(n) = CEIL(n / 1500)
Memory(n) = Replicas(n) * 2GB
CPU(n) = Replicas(n) * 1000m
```

Where n = target concurrent players

### Examples

| Players | Game Gateway Replicas | CPU (cores) | Memory (GB) | DB Queries/sec | Bot Batches/night |
|---------|----------------------|------------|-----------|----------------|------------------|
| 500     | 1                    | 0.5        | 2         | 500            | 2                |
| 1500    | 1                    | 0.5        | 2         | 1500           | 4                |
| 3000    | 2                    | 1.0        | 4         | 3000           | 8                |
| 5000    | 4                    | 2.0        | 8         | 5000           | 12               |
| 10000   | 7                    | 3.5        | 14        | 10000          | 20               |

---

## Scaling Timeline

### Phase 1: Testing & Validation (Week 1)
- Deploy HPA to staging cluster
- Run load tests with k6 (5K concurrent)
- Verify scaling behavior under synthetic load
- Validate database performance with indices

### Phase 2: Gradual Rollout to Production (Week 2-3)
- Enable HPA with min=2, max=5 (conservative)
- Monitor real user load patterns
- Collect baseline metrics (latency, error rate)
- Validate Pod Disruption Budget doesn't cause downtime

### Phase 3: Full Scaling (Week 4)
- Increase max replicas to 10
- Deploy vertical scaling to bot-learning, model-server
- Enable read replicas for PostgreSQL
- Document runbooks for oncall teams

---

## Monitoring & Alerts

### Key Metrics to Monitor
- HPA current/desired replicas
- Average CPU utilization (target: 60-70%)
- Average memory utilization (target: 60-70%)
- Pod scale-up/scale-down events
- Database query latency p50/p95/p99
- WebSocket connection errors (detect pod crashes)

### Alerting Rules
```
- Alert if HPA at maxReplicas for >10min (need higher limit or optimization)
- Alert if CPU utilization >90% for >5min (sustained high load)
- Alert if memory utilization >85% for >5min (risk of OOM)
- Alert if pod scale-up failed (node capacity issues)
- Alert if database connections at 80% of limit
```

---

## Trade-offs & Considerations

### Over-provisioning vs. Under-provisioning
- **Conservative:** minReplicas=2, maxReplicas=5 → guaranteed uptime but higher cost
- **Aggressive:** minReplicas=1, maxReplicas=10 → lower cost but risk single-point-of-failure

Recommendation: **Conservative for production** (minReplicas=2 is our choice)

### Cold Start & Warm-up
- Game gateway pods take ~5-10 seconds to start
- HPA stabilization window = 0s for scale-up (respond immediately)
- Consider keeping 2-3 replicas warm even at low load

### Resource Quotas
- Reserve 20% overhead for system pods, logging, monitoring
- Total allocatable = 80% of node capacity
- For 4GB node: allocate 3.2GB max to app containers

### Database Replication Strategy
- Read replicas consume 50% of primary resources
- Replication lag: <1 second (for eventual consistency in ML features)
- Failover: automated via primary key election or load balancer

---

## Rollback Plan

If scaling causes issues:

1. **Immediate:** Set HPA to minReplicas=1, maxReplicas=2
2. **Investigate:** Check pod logs, database slow queries, network saturation
3. **Fix:** Apply patch to resource limits or database tuning
4. **Re-enable:** Gradually increase maxReplicas, monitor closely
5. **Communicate:** Post-mortem + runbook update

---

## References
- Kubernetes HPA docs: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/
- PostgreSQL tuning guide: https://wiki.postgresql.org/wiki/Performance_Optimization
- Load testing results: See capacity-planning.test.ts
