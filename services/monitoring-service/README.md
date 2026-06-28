# Monitoring Service

Real-time event monitoring and streaming for MyOnlineJoker platform.

## Purpose

Capture all game events (matchmaking, room joins, actions, results) from the game gateway in real-time, stream them to Redis Streams for fast consumption, and persist to PostgreSQL for analytics and anomaly detection.

## Data Flow

```
Game Gateway (WebSocket)
        ↓
Monitoring Service (Port 3005)
        ↓
    ┌───┴────┐
    ↓        ↓
Redis    PostgreSQL
Streams  (Persistent
(Live)   Logs)
    ↓
Admin Panel (Real-time charts)
Analytics Service (Aggregation)
Fraud Detection (Anomaly alerts)
```

## Features

### 1. WebSocket Event Listener
- Receives game events from game-gateway
- Validates and normalizes events
- Handles binary and JSON payloads

### 2. Redis Streams Publishing
- Stream key: `events:{game_type}` (e.g., `events:teen_patti`)
- Also publishes to `events:all` for global consumers
- Fast, durable event queue
- Messages auto-expire after 2 days

### 3. PostgreSQL Persistence
- Table: `game_events` (1.5M+ rows expected at scale)
- Indexed by game_type, user_id, room_id, created_at
- Materialized view for minute-level aggregates
- Retention policy: Keep 30 days (configurable)

### 4. HTTP Endpoints

#### GET /health
Check service and dependencies health.

```bash
curl http://localhost:3005/health
```

Response:
```json
{
  "success": true,
  "data": {
    "redis": "connected",
    "postgres": "connected",
    "timestamp": "2026-06-28T12:34:56.789Z"
  }
}
```

#### GET /metrics/status
Real-time service metrics.

```bash
curl http://localhost:3005/metrics/status
```

Response:
```json
{
  "success": true,
  "data": {
    "uptime": 3600.5,
    "connectedWebSocketClients": 2,
    "eventCounts": {
      "joinMatchmaking": 150,
      "roomJoined": 120,
      "gameAction": 5432,
      "gameResult": 45,
      ...
    },
    "timestamp": "2026-06-28T12:34:56.789Z"
  }
}
```

#### GET /metrics/events?game_type=teen_patti&interval=hour
Aggregated metrics for a specific game/time window.

```bash
curl "http://localhost:3005/metrics/events?game_type=teen_patti&interval=hour"
```

Response:
```json
{
  "success": true,
  "data": {
    "interval": "hour",
    "gameType": "teen_patti",
    "timestamp": "2026-06-28T12:34:56.789Z",
    "events": [
      {
        "game_type": "teen_patti",
        "event_type": "gameAction",
        "count": 1232,
        "avg_amount": 150.50,
        "max_amount": 5000,
        "unique_players": 234,
        "active_rooms": 56
      }
    ],
    "summary": {
      "totalEvents": 1500,
      "totalPlayers": 234,
      "activeRooms": 56,
      "averageStake": 150.50
    }
  }
}
```

#### GET /events/stream?game_type=all (Server-Sent Events)
Live event stream via SSE.

```bash
curl http://localhost:3005/events/stream?game_type=teen_patti
```

Streaming response (NDJSON):
```
data: {"event_type":"joinMatchmaking","game_type":"teen_patti","user_id":"uuid","stake":100,"timestamp":"2026-06-28T12:34:56.789Z"}
data: {"event_type":"roomJoined","game_type":"teen_patti","room_id":"uuid",...}
```

#### GET /events/recent?game_type=all&limit=100
Recent events from Redis Streams.

```bash
curl "http://localhost:3005/events/recent?game_type=teen_patti&limit=50"
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "stream_id": "1719578096789-0",
      "event_type": "joinMatchmaking",
      "game_type": "teen_patti",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "amount": "100"
    }
  ]
}
```

## WebSocket Protocol

### Connection
```
ws://localhost:3005/ws?token=jwt_access_token
```

### Incoming Events (from game-gateway)

```javascript
{
  "type": "join_matchmaking",
  "data": {
    "user_id": "uuid",
    "game_type": "teen_patti",
    "stake": 100,
    "timestamp": "2026-06-28T12:34:56.789Z"
  }
}
```

### Event Types
- `join_matchmaking`: User enters matchmaking queue
- `leave_matchmaking`: User leaves queue
- `room_joined`: User joins game room
- `game_action`: User action during game (bet, fold, raise, etc.)
- `game_result`: Game ends, winner determined
- `room_chat`: Chat message in room

## Event Schema

```typescript
interface NormalizedEvent {
  event_type: string;        // 'joinMatchmaking', 'gameAction', etc.
  game_type?: string;         // 'teen_patti', 'ludo', 'aviator'
  room_id?: string;           // UUID of game room
  user_id?: string;           // UUID of player
  player_count?: number;      // Players in room
  amount?: number;            // ₹ amount (stakes, bets)
  action?: string;            // Action name ('fold', 'raise', 'bet', etc.)
  timestamp: string;          // ISO 8601 timestamp
  raw_data?: any;             // Original event object
}
```

## Setup

### 1. Install Dependencies
```bash
cd services/monitoring-service
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your Redis/PostgreSQL URLs
```

### 3. Run Database Migration
```bash
psql -h localhost -U teen teen_db < ../../infra/db/migrations/012_game_events_monitoring.sql
```

### 4. Start Service
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Integration with Game Gateway

Update `/services/game-gateway/src/index.ts` to send events to monitoring service:

```typescript
// On each game event
const event = {
  type: 'join_matchmaking',
  data: {
    user_id: userId,
    game_type: 'teen_patti',
    stake: 100,
    timestamp: new Date().toISOString(),
  },
};

// Send to monitoring service via HTTP POST or WebSocket
await fetch('http://localhost:3005/events', {
  method: 'POST',
  body: JSON.stringify(event),
});
```

## Redis Streams Consumer Example

```typescript
import Redis from 'ioredis';

const redis = new Redis('redis://localhost:6379');

async function consumeEvents() {
  let lastId = '0'; // Start from beginning

  while (true) {
    const events = await redis.xread('BLOCK', 0, 'STREAMS', 'events:teen_patti', lastId);
    
    if (events) {
      events.forEach(([stream, messages]) => {
        messages.forEach(([id, data]) => {
          const event = JSON.parse(data[1]); // data is [key1, val1, key2, val2, ...]
          console.log('Event:', event);
          lastId = id;
        });
      });
    }
  }
}

consumeEvents();
```

## PostgreSQL Queries

### Events in last hour
```sql
SELECT event_type, COUNT(*) as count
FROM game_events
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY event_type
ORDER BY count DESC;
```

### Average stake by game type
```sql
SELECT game_type, AVG(amount) as avg_stake, COUNT(*) as games
FROM game_events
WHERE event_type = 'roomJoined'
  AND created_at > NOW() - INTERVAL '1 day'
GROUP BY game_type;
```

### Anomalies: Players with >50 actions/hour
```sql
SELECT user_id, COUNT(*) as action_count
FROM game_events
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND event_type = 'gameAction'
GROUP BY user_id
HAVING COUNT(*) > 50
ORDER BY action_count DESC;
```

## Performance Considerations

### Indexing
- Game events indexed on: game_type, user_id, room_id, created_at
- Queries filter by created_at for fast scans
- Materialized view refreshed every 5 minutes

### Retention
- Keep 30 days of detailed events in PostgreSQL
- Archive older events to S3/cold storage (future)
- Redis Streams auto-expire after 2 days

### Scaling
- Redis Streams can handle 1M+ events/day
- PostgreSQL needs partitioning by date if >100M rows
- Use read replicas for analytics queries

## Monitoring & Debugging

### Check event flow
```bash
curl http://localhost:3005/metrics/status

# Should show increasing eventCounts
```

### Tail events in real-time
```bash
curl http://localhost:3005/events/stream?game_type=all | jq
```

### Check Redis Streams
```bash
redis-cli XLEN events:teen_patti
redis-cli XRANGE events:teen_patti - + COUNT 10
```

### Check database
```bash
psql -h localhost -U teen teen_db
SELECT COUNT(*) FROM game_events;
SELECT DATE(created_at), COUNT(*) FROM game_events GROUP BY DATE(created_at);
```

## Next Steps

1. **Fraud Detection Service** (Week 1-2): Rules-based anomaly detection
2. **Analytics Service** (Week 4-6): Aggregation and dashboards
3. **ML Service** (Week 7+): Churn prediction, RTP optimization

---

**Status**: Phase 1 Implementation  
**Last Updated**: 2026-06-28
