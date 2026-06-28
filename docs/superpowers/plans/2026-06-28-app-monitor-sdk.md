# App Monitor SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a zero-crash monitoring SDK into the Flutter app and build a backend ingestion service that captures API calls, screen views, WebSocket events, and errors — surfaced as a 5th tab in the AI Control Center.

**Architecture:** Flutter MonitorService queues events locally and flushes every 10 seconds to a new `app-monitor-service` (Fastify, port 3015). The backend upserts sessions, bulk-inserts events into Postgres, updates Redis counters, and exposes query endpoints proxied through admin-service. The admin panel renders data in `AppMonitorTab` as a 5th tab in `AIControlCenter.tsx`.

**Tech Stack:** Flutter 3 / Dart 3 (mobile), Node.js 20 / TypeScript 5 / Fastify 4 / pg 8 / ioredis 5 / pino 8 (backend), React + Ant Design (admin panel). All packages already installed — no new dependencies in any layer.

## Global Constraints

- Flutter: all monitor code in `mobile/lib/core/monitor/` — never modify game logic files for monitoring purposes
- Flutter: `MonitorService` must never throw — every method wrapped in try/catch, failures are silent
- Flutter: never log request/response bodies or query string parameters (PII risk)
- Backend: TypeScript strict mode, `import 'dotenv/config'` at top, same Fastify 4 pattern as `churn-service`
- Backend: all endpoints return `{ success: true, data: {...} }` or `{ success: false, error: string }`
- Ingest endpoint: no JWT auth, rate-limited by `device_id` (max 1 batch per 8s per device via Redis SET NX)
- Max 100 events per batch — reject larger payloads with 400
- SQL interval interpolation: always wrap config day values with `parseInt(String(val), 10)` before interpolating
- Admin panel: `adminApi` from `../../api/client`, 30s auto-refresh, follows `ChurnTab.tsx` patterns
- Migration file: `infra/db/migrations/017_app_monitor.sql`, wrapped in `BEGIN; ... COMMIT;`
- No test framework present — verify backend via `curl`, Flutter via `flutter run` + backend log inspection

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `infra/db/migrations/017_app_monitor.sql` | Create | `app_sessions` + `app_events` tables with indices |
| `services/app-monitor-service/package.json` | Create | Service scaffold |
| `services/app-monitor-service/tsconfig.json` | Create | TypeScript config (identical to churn-service) |
| `services/app-monitor-service/.env.example` | Create | PORT, DATABASE_URL, REDIS_URL |
| `services/app-monitor-service/src/monitor-ingestor.ts` | Create | Core class: ingest, rate-limit, Redis counters, all query methods |
| `services/app-monitor-service/src/index.ts` | Create | Fastify server + all 7 endpoints |
| `services/admin-service/src/monitor-routes.ts` | Create | Proxy routes `/api/admin/monitor/*` |
| `services/admin-service/src/index.ts` | Modify | Import + register `registerMonitorRoutes` |
| `services/admin-service/.env.example` | Modify | Add `APP_MONITOR_SERVICE_URL` |
| `mobile/lib/core/monitor/monitor_service.dart` | Create | Singleton: session, queue, 10s flush timer, WS hooks |
| `mobile/lib/core/monitor/monitor_interceptor.dart` | Create | Dio interceptor: API timing + errors |
| `mobile/lib/core/monitor/monitor_navigator_observer.dart` | Create | GoRouter observer: screen views + duration |
| `mobile/lib/core/monitor/socket_monitor_wrapper.dart` | Create | Hooks SocketService ValueNotifiers |
| `mobile/lib/core/network/api_client.dart` | Modify | Add `MonitorInterceptor` after existing interceptor |
| `mobile/lib/app.dart` | Modify | Add `MonitorNavigatorObserver()` to GoRouter observers |
| `mobile/lib/main.dart` | Modify | `MonitorService.init()`, error hooks, SocketMonitorWrapper init |
| `admin-panel/src/components/AI/AppMonitorTab.tsx` | Create | 5th tab: stats, errors, API health, funnel, sessions |
| `admin-panel/src/pages/AIControlCenter.tsx` | Modify | Add 5th tab importing `AppMonitorTab` |
| `ecosystem.config.js` | Modify | Add `teen-app-monitor` entry (port 3015) |

---

## Task 1: DB Migration — app_sessions + app_events

**Files:**
- Create: `infra/db/migrations/017_app_monitor.sql`

**Interfaces:**
- Produces: `app_sessions(id VARCHAR(36) PK, user_id, device_id, app_version, platform, os_version, started_at, ended_at, last_seen_at)`, `app_events(id UUID PK, session_id FK, user_id, event_type CHECK, screen, endpoint, method, status_code, duration_ms, error_message, ws_status, properties JSONB, created_at)`

- [ ] **Step 1: Create the migration file**

```sql
-- infra/db/migrations/017_app_monitor.sql
-- App Monitor SDK — sessions and event tables

BEGIN;

CREATE TABLE IF NOT EXISTS app_sessions (
  id            VARCHAR(36) PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id     VARCHAR(100),
  app_version   VARCHAR(20),
  platform      VARCHAR(10) CHECK (platform IN ('android', 'ios')),
  os_version    VARCHAR(20),
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    VARCHAR(36) REFERENCES app_sessions(id) ON DELETE CASCADE,
  user_id       UUID,
  event_type    VARCHAR(30) NOT NULL
                CHECK (event_type IN ('screen_view','api_call','ws_event','error','lifecycle')),
  screen        VARCHAR(100),
  endpoint      VARCHAR(200),
  method        VARCHAR(10),
  status_code   INT,
  duration_ms   INT,
  error_message TEXT,
  ws_status     VARCHAR(30),
  properties    JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_session   ON app_events(session_id);
CREATE INDEX IF NOT EXISTS idx_app_events_type_time ON app_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_error     ON app_events(created_at)
  WHERE event_type = 'error';
CREATE INDEX IF NOT EXISTS idx_app_events_api       ON app_events(endpoint, created_at)
  WHERE event_type = 'api_call';
CREATE INDEX IF NOT EXISTS idx_app_sessions_user    ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_active  ON app_sessions(last_seen_at);

COMMIT;
```

- [ ] **Step 2: Verify file reads cleanly**

```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('infra/db/migrations/017_app_monitor.sql','utf8'); console.log('Lines:', sql.split('\n').length, '— OK')"
```

Expected: `Lines: 44 — OK` (approximately)

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/017_app_monitor.sql
git commit -m "chore: add DB migration for app_sessions and app_events tables (App Monitor)"
```

---

## Task 2: app-monitor-service Scaffold

**Files:**
- Create: `services/app-monitor-service/package.json`
- Create: `services/app-monitor-service/tsconfig.json`
- Create: `services/app-monitor-service/.env.example`

**Interfaces:**
- Produces: installable service directory at `services/app-monitor-service/` with `node_modules`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "app-monitor-service",
  "version": "1.0.0",
  "description": "Flutter app event ingestion and query service for MyOnlineJoker",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "watch": "tsc --watch"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "ioredis": "^5.4.1",
    "pg": "^8.12.0",
    "pino": "^8.17.2"
  },
  "devDependencies": {
    "@types/node": "^20.10.6",
    "@types/pg": "^8.20.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create .env.example**

```
PORT=3015
DATABASE_URL=postgresql://teen:password@localhost:5432/teen_db
REDIS_URL=redis://localhost:6379
```

- [ ] **Step 4: Install dependencies**

```bash
cd services/app-monitor-service && npm install
```

Expected: `added NNN packages`

- [ ] **Step 5: Verify node_modules exists**

```bash
ls services/app-monitor-service/node_modules | head -5
```

Expected: `@types`, `dotenv`, `fastify`, `ioredis`, `pg` (approximately)

- [ ] **Step 6: Commit**

```bash
git add services/app-monitor-service/package.json services/app-monitor-service/tsconfig.json "services/app-monitor-service/.env.example" services/app-monitor-service/package-lock.json
git commit -m "chore: scaffold app-monitor-service package (App Monitor)"
```

---

## Task 3: MonitorIngestor Core Class

**Files:**
- Create: `services/app-monitor-service/src/monitor-ingestor.ts`

**Interfaces:**
- Consumes: `Pool` from pg, `Redis` from ioredis, `Logger` from pino
- Produces: `MonitorIngestor` class with methods:
  - `constructor(pool: Pool, redis: Redis, logger: Logger)`
  - `async ingestBatch(payload: IngestPayload): Promise<void>` — upsert session, bulk-insert events, update Redis
  - `async getStats(): Promise<MonitorStats>`
  - `async getErrors(hours: number, limit: number): Promise<ErrorGroup[]>`
  - `async getApiHealth(hours: number): Promise<ApiEndpointHealth[]>`
  - `async getWsHealth(hours: number): Promise<WsHealth>`
  - `async getSessions(limit: number, offset: number, activeOnly: boolean): Promise<SessionRow[]>`
  - `async getScreenFunnel(hours: number): Promise<ScreenFunnelRow[]>`

- [ ] **Step 1: Create src/ directory and write the file**

```typescript
// services/app-monitor-service/src/monitor-ingestor.ts
import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'

export interface AppEvent {
  event_type: 'screen_view' | 'api_call' | 'ws_event' | 'error' | 'lifecycle'
  screen?: string
  endpoint?: string
  method?: string
  status_code?: number
  duration_ms?: number
  error_message?: string
  ws_status?: string
  properties?: Record<string, unknown>
  ts?: string
}

export interface IngestPayload {
  session_id: string
  user_id?: string
  device_id: string
  app_version: string
  platform: 'android' | 'ios'
  os_version: string
  events: AppEvent[]
}

export interface MonitorStats {
  active_sessions: number
  errors_last_5min: number
  api_error_rate_pct: number
  avg_api_latency_ms: number
  ws_disconnect_last_1h: number
  sessions_today: number
}

export interface ErrorGroup {
  error_message: string
  screen: string | null
  count: number
  affected_users: number
  first_seen: string
  last_seen: string
}

export interface ApiEndpointHealth {
  endpoint: string
  method: string
  total_calls: number
  error_count: number
  error_rate_pct: number
  avg_ms: number
  p95_ms: number
}

export interface WsHealth {
  connected: number
  disconnected: number
  errors: number
  reconnects: number
}

export interface SessionRow {
  session_id: string
  user_id: string | null
  platform: string
  app_version: string
  started_at: string
  ended_at: string | null
  last_seen_at: string
  event_count: number
  status: 'active' | 'ended'
}

export interface ScreenFunnelRow {
  screen: string
  visit_count: number
  avg_duration_s: number
  unique_users: number
}

const ALLOWED_EVENT_TYPES = new Set(['screen_view', 'api_call', 'ws_event', 'error', 'lifecycle'])

export class MonitorIngestor {
  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger
  ) {}

  async ingestBatch(payload: IngestPayload): Promise<void> {
    const { session_id, user_id, device_id, app_version, platform, os_version, events } = payload

    // Rate limit: 1 batch per 8s per device
    const rateLimitKey = `monitor:ratelimit:${device_id}`
    const acquired = await this.redis.set(rateLimitKey, '1', 'EX', 8, 'NX')
    if (!acquired) {
      throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 })
    }

    // Upsert session
    await this.pool.query(
      `INSERT INTO app_sessions (id, user_id, device_id, app_version, platform, os_version, started_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         last_seen_at = NOW(),
         user_id = COALESCE(EXCLUDED.user_id, app_sessions.user_id)`,
      [session_id, user_id ?? null, device_id, app_version, platform, os_version]
    )

    // Mark session ended if lifecycle event indicates it
    const endEvent = events.find(
      e => e.event_type === 'lifecycle' &&
           (e.properties?.state === 'terminated' || e.properties?.state === 'background')
    )
    if (endEvent) {
      await this.pool.query(
        `UPDATE app_sessions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL`,
        [session_id]
      )
    }

    // Filter to valid event types only
    const validEvents = events.filter(e => ALLOWED_EVENT_TYPES.has(e.event_type))
    if (validEvents.length > 0) {
      await this._bulkInsertEvents(session_id, user_id ?? null, validEvents)
    }

    // Update Redis counters (fire-and-forget)
    this._updateRedisCounters(device_id, validEvents).catch(err =>
      this.logger.warn({ err }, 'Redis counter update failed')
    )
  }

  private async _bulkInsertEvents(
    sessionId: string,
    userId: string | null,
    events: AppEvent[]
  ): Promise<void> {
    const cols = [
      'session_id', 'user_id', 'event_type', 'screen', 'endpoint', 'method',
      'status_code', 'duration_ms', 'error_message', 'ws_status', 'properties', 'created_at'
    ]
    const params: unknown[] = []
    const rows = events.map((e, i) => {
      const base = i * cols.length
      params.push(
        sessionId,
        userId,
        e.event_type,
        e.screen ?? null,
        e.endpoint ?? null,
        e.method ?? null,
        e.status_code ?? null,
        e.duration_ms ?? null,
        e.error_message ?? null,
        e.ws_status ?? null,
        e.properties ? JSON.stringify(e.properties) : null,
        e.ts ?? new Date().toISOString()
      )
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`
    })
    await this.pool.query(
      `INSERT INTO app_events (${cols.join(', ')}) VALUES ${rows.join(', ')}`,
      params
    )
  }

  private async _updateRedisCounters(deviceId: string, events: AppEvent[]): Promise<void> {
    const pipeline = this.redis.pipeline()

    // Active session: refresh 35s TTL key for this device
    pipeline.set(`monitor:session:${deviceId}`, '1', 'EX', 35)

    // Error sliding window (5 min) using sorted set
    const errorEvents = events.filter(e => e.event_type === 'error')
    const now = Date.now()
    for (let i = 0; i < errorEvents.length; i++) {
      pipeline.zadd('monitor:errors:5min', now, `${now}-${i}-${deviceId}`)
    }
    // Prune entries older than 5 minutes
    pipeline.zremrangebyscore('monitor:errors:5min', '-inf', now - 300_000)

    await pipeline.exec()
  }

  async getStats(): Promise<MonitorStats> {
    // Active sessions: count Redis keys set by devices in last 35s
    const sessionKeys = await this.redis.keys('monitor:session:*')
    const activeSessions = sessionKeys.length

    // Errors in last 5 min from sorted set
    const errorsLast5min = await this.redis.zcount('monitor:errors:5min', '-inf', '+inf')

    // API + WS stats from DB (last 1 hour)
    const statsRes = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'api_call')                              AS total_api,
        COUNT(*) FILTER (WHERE event_type = 'api_call' AND status_code >= 400)       AS api_errors,
        AVG(duration_ms) FILTER (WHERE event_type = 'api_call')                      AS avg_latency,
        COUNT(*) FILTER (WHERE event_type = 'ws_event' AND ws_status = 'disconnected') AS ws_disconnects
      FROM app_events
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `)
    const row = statsRes.rows[0]
    const totalApi = parseInt(row.total_api) || 0
    const apiErrors = parseInt(row.api_errors) || 0

    // Sessions today (separate query — started_at filter)
    const todayRes = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM app_sessions WHERE started_at > NOW() - INTERVAL '24 hours'`
    )

    return {
      active_sessions:       activeSessions,
      errors_last_5min:      errorsLast5min,
      api_error_rate_pct:    totalApi > 0 ? Math.round((apiErrors / totalApi) * 100) : 0,
      avg_api_latency_ms:    Math.round(parseFloat(row.avg_latency) || 0),
      ws_disconnect_last_1h: parseInt(row.ws_disconnects) || 0,
      sessions_today:        parseInt(todayRes.rows[0].cnt) || 0,
    }
  }

  async getErrors(hours: number, limit: number): Promise<ErrorGroup[]> {
    const safeHours = parseInt(String(hours), 10) || 24
    const res = await this.pool.query(
      `SELECT
         SUBSTRING(error_message, 1, 200) AS error_message,
         screen,
         COUNT(*)                          AS count,
         COUNT(DISTINCT user_id)           AS affected_users,
         MIN(created_at)                   AS first_seen,
         MAX(created_at)                   AS last_seen
       FROM app_events
       WHERE event_type = 'error'
         AND created_at > NOW() - INTERVAL '${safeHours} hours'
       GROUP BY SUBSTRING(error_message, 1, 200), screen
       ORDER BY count DESC
       LIMIT $1`,
      [Math.min(limit, 200)]
    )
    return res.rows
  }

  async getApiHealth(hours: number): Promise<ApiEndpointHealth[]> {
    const safeHours = parseInt(String(hours), 10) || 1
    const res = await this.pool.query(
      `SELECT
         endpoint,
         method,
         COUNT(*)                                                         AS total_calls,
         COUNT(*) FILTER (WHERE status_code >= 400)                      AS error_count,
         ROUND(
           COUNT(*) FILTER (WHERE status_code >= 400)::numeric
           / NULLIF(COUNT(*), 0) * 100, 1
         )                                                                AS error_rate_pct,
         ROUND(AVG(duration_ms)::numeric, 0)                             AS avg_ms,
         ROUND(
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric, 0
         )                                                                AS p95_ms
       FROM app_events
       WHERE event_type = 'api_call'
         AND created_at > NOW() - INTERVAL '${safeHours} hours'
         AND endpoint IS NOT NULL
       GROUP BY endpoint, method
       ORDER BY total_calls DESC
       LIMIT 50`
    )
    return res.rows
  }

  async getWsHealth(hours: number): Promise<WsHealth> {
    const safeHours = parseInt(String(hours), 10) || 24
    const res = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ws_status = 'connected')                 AS connected,
         COUNT(*) FILTER (WHERE ws_status = 'disconnected')              AS disconnected,
         COUNT(*) FILTER (WHERE ws_status = 'error')                     AS errors,
         COUNT(*) FILTER (WHERE ws_status = 'reconnect')                 AS reconnects
       FROM app_events
       WHERE event_type = 'ws_event'
         AND created_at > NOW() - INTERVAL '${safeHours} hours'`
    )
    const r = res.rows[0]
    return {
      connected:    parseInt(r.connected)    || 0,
      disconnected: parseInt(r.disconnected) || 0,
      errors:       parseInt(r.errors)       || 0,
      reconnects:   parseInt(r.reconnects)   || 0,
    }
  }

  async getSessions(
    limit: number,
    offset: number,
    activeOnly: boolean
  ): Promise<SessionRow[]> {
    const activeFilter = activeOnly
      ? `AND s.last_seen_at > NOW() - INTERVAL '35 seconds'`
      : ''
    const res = await this.pool.query(
      `SELECT
         s.id              AS session_id,
         s.user_id,
         s.platform,
         s.app_version,
         s.started_at,
         s.ended_at,
         s.last_seen_at,
         COUNT(e.id)::int  AS event_count,
         CASE WHEN s.last_seen_at > NOW() - INTERVAL '35 seconds'
              THEN 'active' ELSE 'ended' END AS status
       FROM app_sessions s
       LEFT JOIN app_events e ON e.session_id = s.id
       WHERE 1=1 ${activeFilter}
       GROUP BY s.id
       ORDER BY s.last_seen_at DESC
       LIMIT $1 OFFSET $2`,
      [Math.min(limit, 100), offset]
    )
    return res.rows
  }

  async getScreenFunnel(hours: number): Promise<ScreenFunnelRow[]> {
    const safeHours = parseInt(String(hours), 10) || 24
    const res = await this.pool.query(
      `SELECT
         screen,
         COUNT(*)                                                     AS visit_count,
         ROUND(AVG(duration_ms)::numeric / 1000.0, 1)                AS avg_duration_s,
         COUNT(DISTINCT user_id)                                      AS unique_users
       FROM app_events
       WHERE event_type = 'screen_view'
         AND screen IS NOT NULL
         AND created_at > NOW() - INTERVAL '${safeHours} hours'
       GROUP BY screen
       ORDER BY visit_count DESC
       LIMIT 20`
    )
    return res.rows
  }
}
```

- [ ] **Step 2: Run tsc --noEmit**

```bash
cd services/app-monitor-service && npx tsc --noEmit
```

Expected: zero output (clean compile)

- [ ] **Step 3: Commit**

```bash
git add services/app-monitor-service/src/monitor-ingestor.ts
git commit -m "feat: add MonitorIngestor class with ingest, rate-limit, and all query methods (App Monitor)"
```

---

## Task 4: app-monitor-service Server & All Endpoints

**Files:**
- Create: `services/app-monitor-service/src/index.ts`

**Interfaces:**
- Consumes: `MonitorIngestor` from `./monitor-ingestor`
- Produces: Running Fastify server on port 3015 with endpoints: `POST /api/monitor/events`, `GET /health`, `GET /api/monitor/stats`, `GET /api/monitor/errors`, `GET /api/monitor/api-health`, `GET /api/monitor/ws-health`, `GET /api/monitor/sessions`, `GET /api/monitor/screen-funnel`

- [ ] **Step 1: Create src/index.ts**

```typescript
// services/app-monitor-service/src/index.ts
import 'dotenv/config'
import Fastify from 'fastify'
import { Pool } from 'pg'
import Redis from 'ioredis'
import pino from 'pino'
import { MonitorIngestor } from './monitor-ingestor'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })

const app = Fastify({ logger: false })

const ingestor = new MonitorIngestor(pool, redis, logger)

app.get('/health', async (_req, reply) => {
  try {
    await pool.query('SELECT 1')
    await redis.ping()
    return reply.send({ success: true, data: { status: 'ok', service: 'app-monitor-service', timestamp: new Date().toISOString() } })
  } catch (err: any) {
    return reply.code(500).send({ success: false, error: err.message })
  }
})

app.post<{ Body: Record<string, unknown> }>('/api/monitor/events', async (req, reply) => {
  try {
    const payload = req.body as any
    if (!payload.session_id || !payload.device_id || !Array.isArray(payload.events)) {
      return reply.code(400).send({ success: false, error: 'Missing required fields: session_id, device_id, events' })
    }
    if (payload.events.length > 100) {
      return reply.code(400).send({ success: false, error: 'Batch too large: max 100 events' })
    }
    await ingestor.ingestBatch(payload)
    return reply.send({ success: true })
  } catch (err: any) {
    if (err.statusCode === 429) {
      return reply.code(429).send({ success: false, error: 'Rate limit exceeded' })
    }
    logger.error({ err }, 'Ingest error')
    return reply.code(500).send({ success: false, error: 'Ingest failed' })
  }
})

app.get('/api/monitor/stats', async (_req, reply) => {
  try {
    const data = await ingestor.getStats()
    return reply.send({ success: true, data })
  } catch (err: any) {
    logger.error({ err }, 'getStats error')
    return reply.code(500).send({ success: false, error: 'Failed to fetch stats' })
  }
})

app.get<{ Querystring: { hours?: string; limit?: string } }>(
  '/api/monitor/errors',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '24', 10)
      const limit = parseInt(req.query.limit ?? '50', 10)
      const data = await ingestor.getErrors(hours, limit)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getErrors error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch errors' })
    }
  }
)

app.get<{ Querystring: { hours?: string } }>(
  '/api/monitor/api-health',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '1', 10)
      const data = await ingestor.getApiHealth(hours)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getApiHealth error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch API health' })
    }
  }
)

app.get<{ Querystring: { hours?: string } }>(
  '/api/monitor/ws-health',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '24', 10)
      const data = await ingestor.getWsHealth(hours)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getWsHealth error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch WS health' })
    }
  }
)

app.get<{ Querystring: { limit?: string; offset?: string; active?: string } }>(
  '/api/monitor/sessions',
  async (req, reply) => {
    try {
      const limit  = parseInt(req.query.limit  ?? '10', 10)
      const offset = parseInt(req.query.offset ?? '0',  10)
      const activeOnly = req.query.active === 'true'
      const data = await ingestor.getSessions(limit, offset, activeOnly)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getSessions error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch sessions' })
    }
  }
)

app.get<{ Querystring: { hours?: string } }>(
  '/api/monitor/screen-funnel',
  async (req, reply) => {
    try {
      const hours = parseInt(req.query.hours ?? '24', 10)
      const data = await ingestor.getScreenFunnel(hours)
      return reply.send({ success: true, data })
    } catch (err: any) {
      logger.error({ err }, 'getScreenFunnel error')
      return reply.code(500).send({ success: false, error: 'Failed to fetch screen funnel' })
    }
  }
)

async function start() {
  if (redis.status === 'wait') await redis.connect()

  const port = parseInt(process.env.PORT ?? '3015', 10)
  await app.listen({ port, host: '0.0.0.0' })
  logger.info(`app-monitor-service listening on port ${port}`)
}

start().catch(err => {
  logger.error(err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  logger.info('SIGTERM — shutting down')
  await app.close()
  await redis.quit()
  await pool.end()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await app.close()
  await redis.quit()
  await pool.end()
  process.exit(0)
})
```

- [ ] **Step 2: Build**

```bash
cd services/app-monitor-service && npm run build
```

Expected: `dist/index.js` created, zero TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add services/app-monitor-service/src/index.ts
git commit -m "feat: add app-monitor-service Fastify server with all 7 endpoints (App Monitor)"
```

---

## Task 5: Admin-Service Monitor Proxy Routes

**Files:**
- Create: `services/admin-service/src/monitor-routes.ts`
- Modify: `services/admin-service/src/index.ts` (add import + register call)
- Modify: `services/admin-service/.env.example` (add APP_MONITOR_SERVICE_URL)

**Interfaces:**
- Consumes: `authenticate`, `requireRole` from admin-service `start()` (same pattern as `churn-routes.ts`)
- Produces: proxy routes at `/api/admin/monitor/*` → `app-monitor-service`

- [ ] **Step 1: Read services/admin-service/src/churn-routes.ts for exact proxy pattern**

Read the file to understand the axios proxy pattern before writing.

- [ ] **Step 2: Create monitor-routes.ts**

```typescript
// services/admin-service/src/monitor-routes.ts
import { FastifyInstance } from 'fastify'
import axios from 'axios'

const MONITOR_URL = process.env.APP_MONITOR_SERVICE_URL || 'http://localhost:3015'

export async function registerMonitorRoutes(
  app: FastifyInstance,
  authenticate: any,
  requireRole: any
) {
  app.get('/api/admin/monitor/stats', { onRequest: [authenticate] }, async (_req, reply) => {
    try {
      const res = await axios.get(`${MONITOR_URL}/api/monitor/stats`)
      return reply.send(res.data)
    } catch (err: any) {
      return reply.code(err.response?.status ?? 500).send(
        err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
      )
    }
  })

  app.get<{ Querystring: { hours?: string; limit?: string } }>(
    '/api/admin/monitor/errors',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/errors`, { params: req.query })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { hours?: string } }>(
    '/api/admin/monitor/api-health',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/api-health`, { params: req.query })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { hours?: string } }>(
    '/api/admin/monitor/ws-health',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/ws-health`, { params: req.query })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { limit?: string; offset?: string; active?: string } }>(
    '/api/admin/monitor/sessions',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/sessions`, { params: req.query })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )

  app.get<{ Querystring: { hours?: string } }>(
    '/api/admin/monitor/screen-funnel',
    { onRequest: [authenticate] },
    async (req, reply) => {
      try {
        const res = await axios.get(`${MONITOR_URL}/api/monitor/screen-funnel`, { params: req.query })
        return reply.send(res.data)
      } catch (err: any) {
        return reply.code(err.response?.status ?? 500).send(
          err.response?.data ?? { success: false, error: 'App monitor service unavailable' }
        )
      }
    }
  )
}
```

- [ ] **Step 3: Modify services/admin-service/src/index.ts**

Read the file first. Find the line `import { registerBotLearningRoutes } from './bot-learning-routes'` and add after it:

```typescript
import { registerMonitorRoutes } from './monitor-routes'
```

Find the line `await registerBotLearningRoutes(app, authenticate, requireRole)` and add after it:

```typescript
await registerMonitorRoutes(app, authenticate, requireRole)
```

- [ ] **Step 4: Add env var to .env.example**

Read `services/admin-service/.env.example` and append:

```
APP_MONITOR_SERVICE_URL=http://localhost:3015
```

- [ ] **Step 5: Build admin-service**

```bash
cd services/admin-service && npm run build
```

Expected: zero TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add services/admin-service/src/monitor-routes.ts services/admin-service/src/index.ts "services/admin-service/.env.example"
git commit -m "feat: add monitor proxy routes to admin-service (App Monitor)"
```

---

## Task 6: Flutter MonitorService Singleton

**Files:**
- Create: `mobile/lib/core/monitor/monitor_service.dart`

**Interfaces:**
- Produces:
  - `MonitorService.instance` singleton
  - `Future<void> init()` — call once in main.dart before runApp
  - `void setUserId(String? userId)` — call after login/logout
  - `void enqueue(Map<String, dynamic> event)` — called by interceptor, observer, wrapper
  - `String? currentScreen` — readable by MonitorInterceptor
  - `void dispose()` — call on app termination

- [ ] **Step 1: Create mobile/lib/core/monitor/ directory and write the file**

```dart
// mobile/lib/core/monitor/monitor_service.dart
import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:uuid/uuid.dart';
import '../constants/app_config.dart';

class MonitorService {
  static final MonitorService instance = MonitorService._();
  MonitorService._();

  static const _storage = FlutterSecureStorage();
  static const _uuid = Uuid();

  final List<Map<String, dynamic>> _queue = [];
  Timer? _flushTimer;
  Dio? _monitorDio;

  String? _sessionId;
  String? _deviceId;
  String? _appVersion;
  String? _platform;
  String? _osVersion;
  String? _userId;

  /// Set by MonitorNavigatorObserver — read by MonitorInterceptor to tag API calls with screen.
  String? currentScreen;

  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    try {
      _sessionId = _uuid.v4();

      // Persistent device ID across app reinstalls (stored in secure storage)
      _deviceId = await _storage.read(key: 'monitor_device_id');
      if (_deviceId == null) {
        _deviceId = _uuid.v4();
        await _storage.write(key: 'monitor_device_id', value: _deviceId!);
      }

      final info = await PackageInfo.fromPlatform();
      _appVersion = info.version;
      _platform = Platform.isAndroid ? 'android' : 'ios';
      // e.g. "Android 14" or "iOS 17.0"
      _osVersion = Platform.operatingSystemVersion.split(' ').take(2).join(' ');

      // Separate Dio instance — no auth interceptors, no monitor interceptor (avoids loops)
      _monitorDio = Dio(BaseOptions(
        baseUrl: AppConfig.apiBaseUrl.trim(),
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 5),
        headers: {'Content-Type': 'application/json'},
      ));

      _flushTimer = Timer.periodic(const Duration(seconds: 10), (_) => _flush());
    } catch (_) {
      // MonitorService must never crash the app
    }
  }

  /// Call after successful login with the authenticated user's ID.
  /// Call with null on logout.
  void setUserId(String? userId) {
    _userId = userId;
  }

  /// Add an event to the queue. Silently drops if not initialized or queue is full.
  void enqueue(Map<String, dynamic> event) {
    if (!_initialized) return;
    try {
      if (_queue.length >= 200) _queue.removeAt(0); // cap memory at 200 events
      _queue.add({
        ...event,
        'ts': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {}
  }

  Future<void> _flush() async {
    if (_queue.isEmpty || _monitorDio == null) return;

    final batch = List<Map<String, dynamic>>.from(_queue);
    _queue.clear();

    try {
      await _monitorDio!.post('/api/monitor/events', data: {
        'session_id': _sessionId,
        'user_id': _userId,
        'device_id': _deviceId,
        'app_version': _appVersion ?? 'unknown',
        'platform': _platform ?? 'android',
        'os_version': _osVersion ?? 'unknown',
        'events': batch,
      });
    } catch (_) {
      // Re-enqueue on failure (respecting cap)
      for (final e in batch) {
        if (_queue.length < 200) _queue.add(e);
      }
    }
  }

  /// Best-effort flush before the app closes. Call from lifecycle observer.
  void dispose() {
    _flushTimer?.cancel();
    _flush(); // fire-and-forget
  }
}
```

- [ ] **Step 2: Verify the file compiles by checking imports exist**

```bash
grep -r "package_info_plus\|uuid\|flutter_secure_storage" mobile/pubspec.yaml
```

Expected: all three found

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/core/monitor/monitor_service.dart
git commit -m "feat: add MonitorService singleton with event queue and 10s flush (App Monitor SDK)"
```

---

## Task 7: Flutter MonitorInterceptor + ApiClient Wiring

**Files:**
- Create: `mobile/lib/core/monitor/monitor_interceptor.dart`
- Modify: `mobile/lib/core/network/api_client.dart`

**Interfaces:**
- Consumes: `MonitorService.instance` from `../monitor/monitor_service.dart`
- Produces: `MonitorInterceptor extends Interceptor` — add to `ApiClient.dio.interceptors`

- [ ] **Step 1: Create monitor_interceptor.dart**

```dart
// mobile/lib/core/monitor/monitor_interceptor.dart
import 'package:dio/dio.dart';
import 'monitor_service.dart';

/// Dio interceptor that records API call timing and errors.
/// Never logs request/response bodies or query string parameters (PII risk).
class MonitorInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // Store start time in extra map — retrieved in onResponse/onError
    options.extra['_monitor_start'] = DateTime.now().millisecondsSinceEpoch;
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    _record(
      options: response.requestOptions,
      statusCode: response.statusCode ?? 0,
      errorMessage: null,
    );
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    _record(
      options: err.requestOptions,
      statusCode: err.response?.statusCode ?? 0,
      errorMessage: err.message != null
          ? err.message!.substring(0, err.message!.length.clamp(0, 200))
          : null,
    );
    handler.next(err);
  }

  void _record({
    required RequestOptions options,
    required int statusCode,
    String? errorMessage,
  }) {
    try {
      final start = options.extra['_monitor_start'] as int?;
      final durationMs = start != null
          ? DateTime.now().millisecondsSinceEpoch - start
          : null;

      // Use path only — never include query string (may contain tokens/phone numbers)
      final endpoint = options.uri.path;

      MonitorService.instance.enqueue({
        'event_type': 'api_call',
        'screen': MonitorService.instance.currentScreen,
        'endpoint': endpoint,
        'method': options.method,
        'status_code': statusCode,
        if (durationMs != null) 'duration_ms': durationMs,
        if (errorMessage != null) 'error_message': errorMessage,
      });
    } catch (_) {}
  }
}
```

- [ ] **Step 2: Read mobile/lib/core/network/api_client.dart**

Read the file to locate where `dio.interceptors.add(InterceptorsWrapper(...))` is.

- [ ] **Step 3: Modify api_client.dart — add import and MonitorInterceptor**

Add import at top of `api_client.dart` (after existing imports):

```dart
import '../monitor/monitor_interceptor.dart';
```

In `ApiClient._internal()`, after the closing `));` of the existing `InterceptorsWrapper` add:

```dart
    dio.interceptors.add(MonitorInterceptor());
```

The final interceptors block should look like:

```dart
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await SecureStorage.getAccessToken();
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (err, handler) async {
        if (err.response?.statusCode == 401) {
          final refreshed = await _refreshToken();
          if (refreshed) {
            final token = await SecureStorage.getAccessToken();
            err.requestOptions.headers['Authorization'] = 'Bearer $token';
            final response = await dio.fetch(err.requestOptions);
            return handler.resolve(response);
          } else {
            await SecureStorage.clearAll();
          }
        }
        handler.next(err);
      },
    ));
    dio.interceptors.add(MonitorInterceptor());
```

- [ ] **Step 4: Verify Flutter analyzes cleanly**

```bash
cd mobile && flutter analyze lib/core/monitor/monitor_interceptor.dart lib/core/network/api_client.dart 2>&1 | tail -5
```

Expected: `No issues found!` or only pre-existing warnings

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/core/monitor/monitor_interceptor.dart mobile/lib/core/network/api_client.dart
git commit -m "feat: add MonitorInterceptor and wire into ApiClient Dio instance (App Monitor SDK)"
```

---

## Task 8: Flutter MonitorNavigatorObserver + GoRouter Wiring

**Files:**
- Create: `mobile/lib/core/monitor/monitor_navigator_observer.dart`
- Modify: `mobile/lib/app.dart`

**Interfaces:**
- Consumes: `MonitorService.instance`
- Produces: `MonitorNavigatorObserver extends NavigatorObserver` — add to `GoRouter(observers: [...])`

- [ ] **Step 1: Create monitor_navigator_observer.dart**

```dart
// mobile/lib/core/monitor/monitor_navigator_observer.dart
import 'package:flutter/material.dart';
import 'monitor_service.dart';

/// Tracks screen transitions via GoRouter's NavigatorObserver hook.
/// Records each screen's name and time spent before navigating away.
class MonitorNavigatorObserver extends NavigatorObserver {
  int? _screenStartMs;
  String? _currentScreen;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _trackTransition(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    if (newRoute != null) _trackTransition(newRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (previousRoute != null) _trackTransition(previousRoute);
  }

  void _trackTransition(Route<dynamic> incomingRoute) {
    try {
      final now = DateTime.now().millisecondsSinceEpoch;

      // Emit duration for the screen we're leaving
      if (_currentScreen != null && _screenStartMs != null) {
        MonitorService.instance.enqueue({
          'event_type': 'screen_view',
          'screen': _currentScreen,
          'duration_ms': now - _screenStartMs!,
        });
      }

      // GoRouter sets settings.name to the route path (e.g. '/home', '/games/aviator')
      final screenName = incomingRoute.settings.name ?? 'unknown';
      _currentScreen = screenName;
      _screenStartMs = now;

      // Keep MonitorService.currentScreen in sync so MonitorInterceptor can tag API calls
      MonitorService.instance.currentScreen = screenName;
    } catch (_) {}
  }
}
```

- [ ] **Step 2: Read mobile/lib/app.dart**

Read the file to find `final GoRouter _router = GoRouter(`.

- [ ] **Step 3: Modify app.dart — add import and observer**

Add import after existing imports in `app.dart`:

```dart
import 'core/monitor/monitor_navigator_observer.dart';
```

Change the `GoRouter(` constructor to add the `observers` parameter (insert after `initialLocation: '/splash',`):

```dart
final GoRouter _router = GoRouter(
  initialLocation: '/splash',
  observers: [MonitorNavigatorObserver()],
  redirect: (context, state) async {
```

- [ ] **Step 4: Analyze**

```bash
cd mobile && flutter analyze lib/core/monitor/monitor_navigator_observer.dart lib/app.dart 2>&1 | tail -5
```

Expected: `No issues found!`

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/core/monitor/monitor_navigator_observer.dart mobile/lib/app.dart
git commit -m "feat: add MonitorNavigatorObserver and wire into GoRouter (App Monitor SDK)"
```

---

## Task 9: Flutter SocketMonitorWrapper + SocketService Wiring

**Files:**
- Create: `mobile/lib/core/monitor/socket_monitor_wrapper.dart`

**Interfaces:**
- Consumes: `SocketService()` singleton (public `status` and `lastError` ValueNotifiers), `MonitorService.instance`
- Produces: `SocketMonitorWrapper` class — instantiate once in `main.dart` after `MonitorService.init()`

- [ ] **Step 1: Create socket_monitor_wrapper.dart**

```dart
// mobile/lib/core/monitor/socket_monitor_wrapper.dart
import '../socket/socket_service.dart';
import 'monitor_service.dart';

/// Attaches listeners to SocketService's public ValueNotifiers to track
/// WebSocket connection lifecycle events without modifying SocketService itself.
class SocketMonitorWrapper {
  final SocketService _socket;
  int _reconnectAttempt = 0;
  String? _prevStatus;

  SocketMonitorWrapper(this._socket) {
    _socket.status.addListener(_onStatusChange);
  }

  void _onStatusChange() {
    try {
      final newStatus = _socket.status.value;
      if (newStatus == _prevStatus) return;
      _prevStatus = newStatus;

      if (newStatus == 'connected') {
        _reconnectAttempt = 0;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'connected',
        });
      } else if (newStatus.contains('reconnect') || newStatus.contains('retry')) {
        _reconnectAttempt++;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'reconnect',
          'properties': {'attempt': _reconnectAttempt},
        });
      } else if (newStatus == 'disconnected' || newStatus.contains('disconnect')) {
        final errMsg = _socket.lastError.value;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'disconnected',
          if (errMsg.isNotEmpty)
            'error_message': errMsg.substring(0, errMsg.length.clamp(0, 200)),
        });
      } else if (newStatus.contains('error') ||
          newStatus.contains('failed') ||
          newStatus == 'no-token') {
        final errMsg = _socket.lastError.value.isNotEmpty
            ? _socket.lastError.value
            : newStatus;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'error',
          'error_message': errMsg.substring(0, errMsg.length.clamp(0, 200)),
        });
      }
    } catch (_) {}
  }

  void dispose() {
    _socket.status.removeListener(_onStatusChange);
  }
}
```

- [ ] **Step 2: Analyze**

```bash
cd mobile && flutter analyze lib/core/monitor/socket_monitor_wrapper.dart 2>&1 | tail -5
```

Expected: `No issues found!`

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/core/monitor/socket_monitor_wrapper.dart
git commit -m "feat: add SocketMonitorWrapper to track WS connect/disconnect/error events (App Monitor SDK)"
```

---

## Task 10: Flutter main.dart — Error Hooks + MonitorService Init

**Files:**
- Modify: `mobile/lib/main.dart`

**Interfaces:**
- Consumes: `MonitorService` from `core/monitor/monitor_service.dart`, `SocketMonitorWrapper` from `core/monitor/socket_monitor_wrapper.dart`, `SocketService` from `core/socket/socket_service.dart`
- Produces: complete wiring of all SDK components at app startup

- [ ] **Step 1: Read mobile/lib/main.dart**

Read the file to understand the existing startup sequence (Firebase init, Hive, etc.)

- [ ] **Step 2: Modify main.dart**

Add imports after existing imports:

```dart
import 'package:flutter/foundation.dart';
import 'core/monitor/monitor_service.dart';
import 'core/monitor/socket_monitor_wrapper.dart';
import 'core/socket/socket_service.dart';
```

In the `main()` function, add the following block BEFORE `runApp(const MyOnlineJokerApp())`:

```dart
  // ── App Monitor SDK ──────────────────────────────────────────────────────
  // Init MonitorService before runApp so the session_id exists from the first frame.
  await MonitorService.instance.init();

  // Override Flutter framework errors (widget build exceptions, layout errors, etc.)
  FlutterError.onError = (FlutterErrorDetails details) {
    MonitorService.instance.enqueue({
      'event_type': 'error',
      'screen': MonitorService.instance.currentScreen,
      'error_message': details.exceptionAsString()
          .substring(0, details.exceptionAsString().length.clamp(0, 500)),
      'properties': {
        'stack': details.stack?.toString().substring(
              0, details.stack.toString().length.clamp(0, 1000)) ?? '',
        'source': 'flutter_error',
      },
    });
    // Still show red screen in debug mode
    if (kDebugMode) FlutterError.presentError(details);
  };

  // Override platform/isolate errors (async exceptions not caught by Flutter framework)
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    MonitorService.instance.enqueue({
      'event_type': 'error',
      'screen': MonitorService.instance.currentScreen,
      'error_message': error.toString()
          .substring(0, error.toString().length.clamp(0, 500)),
      'properties': {
        'stack': stack.toString().substring(
              0, stack.toString().length.clamp(0, 1000)),
        'source': 'platform_dispatcher',
      },
    });
    return true; // handled
  };

  // Attach WebSocket event monitoring (no changes to SocketService required)
  SocketMonitorWrapper(SocketService());
  // ─────────────────────────────────────────────────────────────────────────
```

The final `main()` function should end with:

```dart
  // ── App Monitor SDK ──────────────────────────────────────────────────────
  await MonitorService.instance.init();

  FlutterError.onError = (FlutterErrorDetails details) {
    MonitorService.instance.enqueue({
      'event_type': 'error',
      'screen': MonitorService.instance.currentScreen,
      'error_message': details.exceptionAsString()
          .substring(0, details.exceptionAsString().length.clamp(0, 500)),
      'properties': {
        'stack': details.stack?.toString().substring(
              0, details.stack.toString().length.clamp(0, 1000)) ?? '',
        'source': 'flutter_error',
      },
    });
    if (kDebugMode) FlutterError.presentError(details);
  };

  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    MonitorService.instance.enqueue({
      'event_type': 'error',
      'screen': MonitorService.instance.currentScreen,
      'error_message': error.toString()
          .substring(0, error.toString().length.clamp(0, 500)),
      'properties': {
        'stack': stack.toString().substring(
              0, stack.toString().length.clamp(0, 1000)),
        'source': 'platform_dispatcher',
      },
    });
    return true;
  };

  SocketMonitorWrapper(SocketService());
  // ─────────────────────────────────────────────────────────────────────────

  runApp(const MyOnlineJokerApp());
```

- [ ] **Step 3: Analyze the whole lib directory**

```bash
cd mobile && flutter analyze lib/ 2>&1 | tail -10
```

Expected: `No issues found!` (or only pre-existing warnings, no new errors)

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/main.dart
git commit -m "feat: wire MonitorService init, error hooks, and SocketMonitorWrapper in main.dart (App Monitor SDK)"
```

---

## Task 11: Admin Panel — AppMonitorTab + 5th Tab in AI Control Center

**Files:**
- Create: `admin-panel/src/components/AI/AppMonitorTab.tsx`
- Modify: `admin-panel/src/pages/AIControlCenter.tsx`

**Interfaces:**
- Consumes: `adminApi` from `../../api/client`; proxy routes at `/monitor/*` (via adminApi which prefixes `/api/admin`)
- Produces: `AppMonitorTab` component with 4 sections; `AIControlCenter.tsx` 5th tab

- [ ] **Step 1: Read admin-panel/src/components/AI/ChurnTab.tsx and admin-panel/src/pages/AIControlCenter.tsx**

Read both files to understand component patterns, import styles, and existing tab structure.

- [ ] **Step 2: Create AppMonitorTab.tsx**

```tsx
// admin-panel/src/components/AI/AppMonitorTab.tsx
import { useState, useEffect, useCallback } from 'react'
import {
  Card, Row, Col, Statistic, Table, Tag, Select, Spin, Badge, Radio, Typography
} from 'antd'
import {
  BugOutlined, ApiOutlined, MobileOutlined, WifiOutlined, ReloadOutlined
} from '@ant-design/icons'
import { adminApi } from '../../api/client'

const { Text } = Typography

interface MonitorStats {
  active_sessions: number
  errors_last_5min: number
  api_error_rate_pct: number
  avg_api_latency_ms: number
  ws_disconnect_last_1h: number
  sessions_today: number
}

interface ErrorGroup {
  error_message: string
  screen: string | null
  count: number
  affected_users: number
  first_seen: string
  last_seen: string
}

interface ApiEndpoint {
  endpoint: string
  method: string
  total_calls: number
  error_count: number
  error_rate_pct: number
  avg_ms: number
  p95_ms: number
}

interface ScreenFunnel {
  screen: string
  visit_count: number
  avg_duration_s: number
  unique_users: number
}

interface Session {
  session_id: string
  user_id: string | null
  platform: string
  app_version: string
  started_at: string
  ended_at: string | null
  last_seen_at: string
  event_count: number
  status: 'active' | 'ended'
}

// SVG bar chart — follows Dashboard.tsx custom SVG pattern
function SVGBarChart({
  data,
  height = 160,
}: {
  data: { label: string; value: number; secondary?: string }[]
  height?: number
}) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
        No screen data yet
      </div>
    )
  }
  const maxVal = Math.max(...data.map(d => d.value), 1)
  const width = 560
  const barSpacing = width / data.length
  const barW = Math.min(36, barSpacing - 6)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const barH = Math.max(2, (d.value / maxVal) * (height - 40))
        const x = i * barSpacing + (barSpacing - barW) / 2
        const y = height - 24 - barH
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill="#1890ff" rx={3} opacity={0.75} />
            <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="9" fill="#666">
              {d.label.split('/').pop() || d.label}
            </text>
            {d.secondary && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="#aaa">
                {d.secondary}
              </text>
            )}
            <title>{`${d.label}\nVisits: ${d.value}\n${d.secondary ?? ''}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

export function AppMonitorTab() {
  const [stats, setStats] = useState<MonitorStats | null>(null)
  const [errors, setErrors] = useState<ErrorGroup[]>([])
  const [apiHealth, setApiHealth] = useState<ApiEndpoint[]>([])
  const [funnel, setFunnel] = useState<ScreenFunnel[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [errorHours, setErrorHours] = useState(24)
  const [apiHours, setApiHours] = useState(1)

  const load = useCallback(async () => {
    try {
      const [statsRes, errorsRes, apiRes, funnelRes, sessionsRes] = await Promise.allSettled([
        adminApi.get('/monitor/stats'),
        adminApi.get('/monitor/errors', { params: { hours: errorHours, limit: 50 } }),
        adminApi.get('/monitor/api-health', { params: { hours: apiHours } }),
        adminApi.get('/monitor/screen-funnel', { params: { hours: 24 } }),
        adminApi.get('/monitor/sessions', { params: { limit: 10, offset: 0 } }),
      ])
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data?.data ?? null)
      if (errorsRes.status === 'fulfilled') setErrors(errorsRes.value.data?.data ?? [])
      if (apiRes.status === 'fulfilled') setApiHealth(apiRes.value.data?.data ?? [])
      if (funnelRes.status === 'fulfilled') setFunnel(funnelRes.value.data?.data ?? [])
      if (sessionsRes.status === 'fulfilled') setSessions(sessionsRes.value.data?.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [errorHours, apiHours])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  const errorRowColor = (count: number) => {
    if (count > 10) return '#fff1f0'
    if (count > 3) return '#fff7e6'
    return undefined
  }

  const apiRateColor = (rate: number): string => {
    if (rate > 5) return 'red'
    if (rate > 1) return 'orange'
    return 'green'
  }

  return (
    <Spin spinning={loading && !stats}>
      {/* ── Section 1: Stats bar ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {[
          { title: 'Active Sessions', value: stats?.active_sessions ?? 0, icon: <MobileOutlined />, color: '#52c41a' },
          { title: 'Errors (5 min)', value: stats?.errors_last_5min ?? 0, icon: <BugOutlined />, color: stats?.errors_last_5min ? '#ff4d4f' : '#52c41a' },
          { title: 'Avg API Latency', value: `${stats?.avg_api_latency_ms ?? 0}ms`, icon: <ApiOutlined />, color: '#1890ff' },
          { title: 'API Error Rate', value: `${stats?.api_error_rate_pct ?? 0}%`, icon: <ApiOutlined />, color: (stats?.api_error_rate_pct ?? 0) > 5 ? '#ff4d4f' : '#52c41a' },
          { title: 'WS Disconnects (1h)', value: stats?.ws_disconnect_last_1h ?? 0, icon: <WifiOutlined />, color: '#faad14' },
          { title: 'Sessions Today', value: stats?.sessions_today ?? 0, icon: <MobileOutlined />, color: '#722ed1' },
        ].map((s, i) => (
          <Col span={4} key={i}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <Statistic
                title={<span style={{ fontSize: 12 }}>{s.title}</span>}
                value={s.value}
                valueStyle={{ color: s.color, fontSize: 20 }}
                prefix={s.icon}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── Section 2: Error Feed + API Health ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card
            size="small"
            title={<span><BugOutlined /> Error Feed</span>}
            extra={
              <Select size="small" value={errorHours} onChange={setErrorHours} style={{ width: 90 }}>
                <Select.Option value={1}>Last 1h</Select.Option>
                <Select.Option value={24}>Last 24h</Select.Option>
                <Select.Option value={168}>Last 7d</Select.Option>
              </Select>
            }
          >
            <Table<ErrorGroup>
              dataSource={errors}
              rowKey={(r, i) => `${r.error_message}-${i}`}
              size="small"
              pagination={{ pageSize: 8, size: 'small' }}
              rowClassName={r => errorRowColor(r.count) ? 'error-row' : ''}
              onRow={r => ({ style: { background: errorRowColor(r.count) } })}
              columns={[
                {
                  title: 'Screen',
                  dataIndex: 'screen',
                  width: 100,
                  render: v => <Tag>{v ?? 'unknown'}</Tag>,
                },
                {
                  title: 'Error',
                  dataIndex: 'error_message',
                  ellipsis: true,
                  render: v => <Text style={{ fontSize: 11 }}>{v}</Text>,
                },
                { title: 'Count', dataIndex: 'count', width: 60, sorter: (a, b) => a.count - b.count },
                { title: 'Users', dataIndex: 'affected_users', width: 55 },
              ]}
            />
          </Card>
        </Col>

        <Col span={12}>
          <Card
            size="small"
            title={<span><ApiOutlined /> API Health</span>}
            extra={
              <Radio.Group size="small" value={apiHours} onChange={e => setApiHours(e.target.value)} buttonStyle="solid">
                <Radio.Button value={1}>1h</Radio.Button>
                <Radio.Button value={6}>6h</Radio.Button>
                <Radio.Button value={24}>24h</Radio.Button>
              </Radio.Group>
            }
          >
            <Table<ApiEndpoint>
              dataSource={apiHealth}
              rowKey={(r, i) => `${r.endpoint}-${i}`}
              size="small"
              pagination={{ pageSize: 8, size: 'small' }}
              columns={[
                {
                  title: 'Endpoint',
                  dataIndex: 'endpoint',
                  ellipsis: true,
                  render: (v, r) => <span><Tag color="blue" style={{ fontSize: 10 }}>{r.method}</Tag>{v}</span>,
                },
                { title: 'Calls', dataIndex: 'total_calls', width: 60 },
                {
                  title: 'Err%',
                  dataIndex: 'error_rate_pct',
                  width: 60,
                  render: v => <Tag color={apiRateColor(v)}>{v}%</Tag>,
                },
                { title: 'Avg ms', dataIndex: 'avg_ms', width: 65 },
                { title: 'P95 ms', dataIndex: 'p95_ms', width: 65 },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Section 3: Screen Funnel ── */}
      <Card
        size="small"
        title="Screen Funnel (last 24h)"
        style={{ marginBottom: 24 }}
      >
        <SVGBarChart
          data={funnel.map(f => ({
            label: f.screen,
            value: f.visit_count,
            secondary: `${f.avg_duration_s}s avg`,
          }))}
        />
      </Card>

      {/* ── Section 4: Recent Sessions ── */}
      <Card size="small" title={<span><MobileOutlined /> Recent Sessions</span>}>
        <Table<Session>
          dataSource={sessions}
          rowKey="session_id"
          size="small"
          pagination={{ pageSize: 10, size: 'small' }}
          columns={[
            {
              title: 'Platform',
              dataIndex: 'platform',
              width: 90,
              render: v => <Tag color={v === 'android' ? 'green' : 'blue'}>{v}</Tag>,
            },
            { title: 'Version', dataIndex: 'app_version', width: 75 },
            {
              title: 'Started',
              dataIndex: 'started_at',
              render: v => new Date(v).toLocaleString(),
            },
            {
              title: 'Events',
              dataIndex: 'event_count',
              width: 65,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 80,
              render: v => (
                <Badge
                  status={v === 'active' ? 'processing' : 'default'}
                  text={v}
                />
              ),
            },
          ]}
        />
      </Card>
    </Spin>
  )
}
```

- [ ] **Step 3: Modify AIControlCenter.tsx — add 5th tab**

Read `admin-panel/src/pages/AIControlCenter.tsx`. Add import:

```tsx
import { AppMonitorTab } from '../components/AI/AppMonitorTab'
```

Add `MobileOutlined` to the antd icons import (it already imports from `@ant-design/icons`):

```tsx
import { RobotOutlined, SettingOutlined, DashboardOutlined, SyncOutlined, AlertOutlined, MobileOutlined } from '@ant-design/icons'
```

Add 5th tab to `tabItems` array (after the Churn Intelligence entry):

```tsx
    {
      key: '5',
      label: (
        <span>
          <MobileOutlined />
          App Monitor
        </span>
      ),
      children: <AppMonitorTab />,
      extra: <Tag color="cyan">Live SDK</Tag>,
    },
```

- [ ] **Step 4: Build admin panel**

```bash
cd admin-panel && npm run build
```

Expected: zero TypeScript errors, Vite builds successfully

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/components/AI/AppMonitorTab.tsx admin-panel/src/pages/AIControlCenter.tsx
git commit -m "feat: add AppMonitorTab as 5th tab in AI Control Center (App Monitor)"
```

---

## Task 12: PM2 ecosystem.config.js

**Files:**
- Modify: `ecosystem.config.js`

**Interfaces:**
- Produces: `teen-app-monitor` PM2 process entry (port 3015, `cwd: ./services/app-monitor-service`)

- [ ] **Step 1: Read ecosystem.config.js**

Read the file. Locate the `teen-bot-learning` entry added in Phase 3 — the new entry goes immediately after it.

- [ ] **Step 2: Add teen-app-monitor entry**

Following the exact same pattern as `teen-bot-learning`, add inside the `apps` array:

```js
    {
      name: 'teen-app-monitor',
      cwd: `${BASE}/app-monitor-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('app-monitor-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3015,
      },
    },
```

- [ ] **Step 3: Validate syntax**

```bash
node -e "require('./ecosystem.config.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add ecosystem.config.js
git commit -m "chore: add teen-app-monitor to PM2 ecosystem config (App Monitor)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| DB: app_sessions table | Task 1 |
| DB: app_events table with CHECK constraint | Task 1 |
| MonitorService singleton, queue, 10s flush | Task 6 |
| Separate Dio for flush (no recursive loop) | Task 6 |
| package_info_plus for app version | Task 6 (already in pubspec) |
| uuid for session_id | Task 6 (already in pubspec) |
| Persistent device_id in secure storage | Task 6 |
| MonitorInterceptor on Dio — path only, no query string | Task 7 |
| MonitorNavigatorObserver on GoRouter | Task 8 |
| SocketMonitorWrapper on public ValueNotifiers | Task 9 |
| FlutterError.onError + PlatformDispatcher.onError | Task 10 |
| app-monitor-service port 3015 | Task 4 |
| Rate limiting: 1 batch/8s per device_id via Redis SET NX | Task 3 |
| Max 100 events per batch, reject 400 | Task 4 |
| Ingest: upsert app_sessions, bulk-insert app_events | Task 3 |
| ended_at set on lifecycle:background/terminated | Task 3 |
| Redis active sessions (35s TTL per device) | Task 3 |
| Redis error sliding window (5min sorted set) | Task 3 |
| getStats(), getErrors(), getApiHealth() with PERCENTILE_CONT | Task 3 |
| getWsHealth(), getSessions(), getScreenFunnel() | Task 3 |
| Admin-service proxy at /api/admin/monitor/* | Task 5 |
| AppMonitorTab: 6 stat cards | Task 11 |
| AppMonitorTab: Error Feed table with time filter | Task 11 |
| AppMonitorTab: API Health table with method + color coding | Task 11 |
| AppMonitorTab: SVG bar chart screen funnel | Task 11 |
| AppMonitorTab: Recent sessions with Active/Ended badge | Task 11 |
| 5th tab in AIControlCenter with MobileOutlined icon | Task 11 |
| 30s auto-refresh | Task 11 |
| PM2 entry for port 3015 | Task 12 |

All requirements covered. No placeholders found.
