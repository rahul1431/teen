# Risk Service

Real-time fraud detection and risk scoring for MyOnlineJoker platform.

## Overview

The Risk Service analyzes game events in real-time to detect fraudulent patterns and potential collusion. It implements four detection rules:

1. **Co-location Detection** - Flags multiple accounts on the same device
2. **Win-Rate Anomalies** - Detects unusually high win rates
3. **Velocity Checks** - Identifies rapid fund movements (potential money laundering)
4. **Referral Chain Flagging** - Detects networks of flagged players

## Architecture

```
Monitoring Service (Redis Streams: events:all)
        ↓
Risk Service (Event Consumer)
        ↓
    Fraud Detector
   (4 detection rules)
        ↓
PostgreSQL (fraud_events table) + Redis (fraud:alerts channel)
        ↓
Admin Panel / Alert System
```

## Getting Started

### Install Dependencies

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `FRAUD_*_THRESHOLD` - Detection rule thresholds

### Database Schema

Ensure the following tables exist:

```sql
-- fraud_events table
CREATE TABLE fraud_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  game_type VARCHAR(50),
  rule_triggered VARCHAR(100),
  fraud_score NUMERIC(3,2) NOT NULL,
  confidence NUMERIC(3,2) NOT NULL,
  evidence TEXT,
  action VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fraud_events_user_id ON fraud_events(user_id);
CREATE INDEX idx_fraud_events_created_at ON fraud_events(created_at DESC);
CREATE INDEX idx_fraud_events_action ON fraud_events(action);
CREATE INDEX idx_fraud_events_fraud_score ON fraud_events(fraud_score DESC);
```

### Running the Service

Development:
```bash
npm run dev
```

Production:
```bash
npm run build
npm start
```

Watching for changes:
```bash
npm run watch
```

## API Endpoints

### GET /health
Service health check.

**Response:**
```json
{
  "status": "ok",
  "service": "risk-service",
  "timestamp": "2026-06-28T12:00:00Z"
}
```

### GET /api/risk/alerts
Get recent fraud alerts.

**Query Parameters:**
- `limit` (default: 50, max: 500) - Number of alerts to return
- `action` - Filter by action: 'allow', 'slow_lane', 'block'

**Response:**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "id": "uuid",
        "user_id": "user_123",
        "game_type": "teen_patti",
        "rule_triggered": "co_location",
        "fraud_score": 0.85,
        "confidence": 0.85,
        "evidence": "Multiple accounts on same device.",
        "action": "block",
        "created_at": "2026-06-28T12:00:00Z"
      }
    ],
    "count": 10,
    "timestamp": "2026-06-28T12:00:00Z"
  }
}
```

### GET /api/risk/user/:userId/history
Get fraud history for a specific user.

**Query Parameters:**
- `limit` (default: 50, max: 500) - Number of records to return

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user_123",
    "events": [
      { /* fraud event object */ }
    ],
    "count": 5
  }
}
```

### GET /api/risk/stats
Get fraud detection statistics.

**Query Parameters:**
- `hours` (default: 24, max: 168) - Time window for statistics

**Response:**
```json
{
  "success": true,
  "data": {
    "timeWindow": "24 hours",
    "stats": {
      "totalAlerts": 42,
      "blocks": 8,
      "slowLanes": 15,
      "avgScore": 0.65,
      "maxScore": 0.95,
      "uniqueUsers": 35,
      "rulesTriggered": 4
    },
    "timestamp": "2026-06-28T12:00:00Z"
  }
}
```

### POST /api/risk/user/:userId/flag
Manually flag or unflag a user.

**Request Body:**
```json
{
  "isFlagged": true,
  "reason": "Manual review - suspected collusion"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user_123",
    "flagged": true,
    "message": "User flagged successfully"
  }
}
```

## Detection Rules

### Rule 1: Co-location Detection
Flags users when 3+ accounts are found on the same device fingerprint.

**Configuration:**
- `FRAUD_CO_LOCATION_THRESHOLD=3` - Minimum accounts on same device

**Scoring:**
- Score = min(accountCount / 10, 1)
- Weight: 30% of total fraud score

**Example:**
```
5 accounts on same device → score = 0.5
10+ accounts → score = 1.0 (capped)
```

### Rule 2: Win-Rate Anomaly
Flags players with unusually high win rates in recent games.

**Configuration:**
- `FRAUD_WIN_RATE_THRESHOLD=95` - Win rate percentage threshold

**Scoring:**
- Score = (winRate - threshold) / 5 (normalized)
- Weight: 35% of total fraud score
- Requires minimum 10 games in 7-day window

**Example:**
```
98% win rate (threshold: 95%) → score = (98-95)/5 = 0.6
100% win rate → score = 1.0 (capped)
```

### Rule 3: Velocity Check
Flags rapid fund movements that may indicate money laundering.

**Configuration:**
- `FRAUD_VELOCITY_HOURS=1` - Time window for checking
- Threshold: ₹10,000 hardcoded

**Scoring:**
- Score = min((totalAmount - 10000) / 50000, 1)
- Weight: 20% of total fraud score

**Example:**
```
₹15,000 in 1 hour → score = 5000/50000 = 0.1
₹60,000+ in 1 hour → score = 1.0 (capped)
```

### Rule 4: Referral Chain
Flags players connected to other flagged players.

**Configuration:**
- `FRAUD_REFERRAL_DEPTH=2` - How many levels up to check

**Scoring:**
- Score = 1 - (depth * 0.2)
- Weight: 15% of total fraud score

**Example:**
```
Directly referred by flagged user → depth=0, score = 1.0
One hop away → depth=1, score = 0.8
Two hops away → depth=2, score = 0.6
```

## Action Thresholds

Based on combined fraud score:

- **score < 0.4** → Action: `allow` (normal processing)
- **0.4 ≤ score < 0.6** → Action: `slow_lane` (rate limit, require 2FA)
- **0.6 ≤ score < 0.85** → Action: `slow_lane` (increase scrutiny)
- **score ≥ 0.85** → Action: `block` (prevent game participation)

## Real-Time Monitoring

The service subscribes to:

1. **Redis Streams**: `events:all` from monitoring-service
   - Processes game events as they occur
   - Real-time fraud detection

2. **Redis Pub/Sub**: `ml:config:change` channel
   - Updates fraud detection config without restarting
   - Allows admins to adjust thresholds dynamically

3. **Publishes to**: `fraud:alerts` channel
   - Sends fraud events to admin alert system
   - Real-time notifications to admins

## Performance Optimization

### Database Queries
- All queries use prepared statements (parameterized)
- Indices on frequently queried columns (user_id, created_at, fraud_score)
- Connection pooling with configurable pool size

### Redis Streams
- Reads in batches of 10 events
- Non-blocking streams with 1-second timeout
- Automatic retry with exponential backoff on failure

### Event Processing
- Async event analysis (non-blocking)
- Fraud detector methods use connection pooling
- Redis operations use pipelining where possible

## Integration with Admin Panel

### Admin Service Endpoints

The admin service should expose these endpoints:

```typescript
// Get fraud alerts for admin dashboard
GET /api/admin/fraud-alerts?limit=50&action=block

// Get fraud statistics
GET /api/admin/fraud-stats?hours=24

// Get user fraud history
GET /api/admin/user/:userId/fraud-history

// Manually flag/unflag user
POST /api/admin/user/:userId/fraud-flag
```

These endpoints will query the Risk Service or directly access the fraud_events table.

## Troubleshooting

### Service Not Starting
- Check Redis connection: `redis-cli ping`
- Check PostgreSQL connection: `psql $DATABASE_URL`
- Check logs: `npm run dev` for detailed output

### No Alerts Being Generated
- Verify monitoring-service is publishing to `events:all` stream
- Check Redis Streams: `redis-cli XINFO STREAM events:all`
- Verify fraud detection is enabled: `FRAUD_DETECTION_ENABLED=true`

### High False Positive Rate
- Adjust thresholds in `.env`:
  - Increase `FRAUD_WIN_RATE_THRESHOLD` to 98%
  - Increase `FRAUD_CO_LOCATION_THRESHOLD` to 5
  - Increase `FRAUD_VELOCITY_HOURS` to 2

### Performance Issues
- Increase Redis connection pool
- Add more indices to fraud_events table
- Consider archiving old fraud_events (>30 days)

## Development

### Running Tests
```bash
npm test
```

### Building for Production
```bash
npm run build
docker build -t risk-service .
```

### Docker Compose (Local Development)
```yaml
services:
  risk-service:
    build: ./services/risk-service
    ports:
      - "3006:3006"
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/teen_app
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - postgres
      - redis
```

## Future Enhancements

- [ ] ML-based fraud scoring (logistic regression)
- [ ] Behavioral pattern analysis
- [ ] Graph-based collusion detection (GNN)
- [ ] Real-time alerts to admins via WebSocket
- [ ] Fraud appeal system for false positives
- [ ] Integration with payment gateway fraud detection
