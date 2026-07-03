// services/app-monitor-service/src/monitor-ingestor.ts
import { Pool } from 'pg'
import Redis from 'ioredis'
import { Logger } from 'pino'
import { GeoResult } from './geo'

export interface AppEvent {
  event_type: 'screen_view' | 'api_call' | 'ws_event' | 'error' | 'lifecycle' | 'game_event' | 'location'
  screen?: string
  endpoint?: string
  method?: string
  status_code?: number
  duration_ms?: number
  error_message?: string
  ws_status?: string
  action?: string
  lat?: number
  lon?: number
  accuracy_m?: number
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
  device_model?: string
  manufacturer?: string
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

const ALLOWED_EVENT_TYPES = new Set([
  'screen_view', 'api_call', 'ws_event', 'error', 'lifecycle', 'game_event', 'location'
])

export function deriveLastScreenGame(events: AppEvent[]): { last_screen: string | null; last_game: string | null } {
  let last_screen: string | null = null
  let last_game: string | null = null
  for (const e of events) {
    if (e.event_type === 'screen_view' && e.screen) last_screen = e.screen
    if (e.event_type === 'game_event' && (e as any).action) last_game = (e as any).action
  }
  return { last_screen, last_game }
}

export class MonitorIngestor {
  constructor(
    private pool: Pool,
    private redis: Redis,
    private logger: Logger
  ) {}

  async ingestBatch(payload: IngestPayload, geo: GeoResult, ip: string | null): Promise<void> {
    const { session_id, user_id, device_id, app_version, platform, os_version,
            device_model, manufacturer, events } = payload

    // Rate limit: 1 batch per 8s per device
    const rateLimitKey = `monitor:ratelimit:${device_id}`
    const acquired = await this.redis.set(rateLimitKey, '1', 'EX', 8, 'NX')
    if (!acquired) {
      throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 })
    }

    const { last_screen, last_game } = deriveLastScreenGame(events)

    // Upsert session
    await this.pool.query(
      `INSERT INTO app_sessions
         (id, user_id, device_id, app_version, platform, os_version,
          device_model, manufacturer, ip_address, geo_city, geo_region, geo_country,
          geo_lat, geo_lon, last_screen, last_game, started_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET
         last_seen_at = NOW(), ended_at = NULL,
         user_id      = COALESCE(EXCLUDED.user_id, app_sessions.user_id),
         device_model = COALESCE(EXCLUDED.device_model, app_sessions.device_model),
         manufacturer = COALESCE(EXCLUDED.manufacturer, app_sessions.manufacturer),
         ip_address   = COALESCE(EXCLUDED.ip_address, app_sessions.ip_address),
         geo_city     = COALESCE(EXCLUDED.geo_city, app_sessions.geo_city),
         geo_region   = COALESCE(EXCLUDED.geo_region, app_sessions.geo_region),
         geo_country  = COALESCE(EXCLUDED.geo_country, app_sessions.geo_country),
         geo_lat      = COALESCE(EXCLUDED.geo_lat, app_sessions.geo_lat),
         geo_lon      = COALESCE(EXCLUDED.geo_lon, app_sessions.geo_lon),
         last_screen  = COALESCE(EXCLUDED.last_screen, app_sessions.last_screen),
         last_game    = COALESCE(EXCLUDED.last_game, app_sessions.last_game)`,
      [session_id, user_id ?? null, device_id, app_version, platform, os_version,
       device_model ?? null, manufacturer ?? null, ip ?? null,
       geo.city, geo.region, geo.country, geo.lat, geo.lon,
       last_screen, last_game]
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

    // GPS pings → dedicated table
    const locEvents = events.filter(e => e.event_type === 'location' && typeof (e as any).lat === 'number')
    if (locEvents.length > 0) {
      await this._bulkInsertLocations(session_id, user_id ?? null, locEvents)
    }

    // Everything else (except location) → app_events, filtered to valid event types
    const validEvents = events.filter(
      e => e.event_type !== 'location' && ALLOWED_EVENT_TYPES.has(e.event_type)
    )
    if (validEvents.length > 0) {
      await this._bulkInsertEvents(session_id, user_id ?? null, validEvents)
    }

    // Update Redis counters (fire-and-forget)
    this._updateRedisCounters(device_id, validEvents).catch(err =>
      this.logger.warn({ err }, 'Redis counter update failed')
    )
  }

  private async _bulkInsertLocations(
    sessionId: string, userId: string | null, events: AppEvent[]
  ): Promise<void> {
    const cols = ['session_id', 'user_id', 'lat', 'lon', 'accuracy_m', 'created_at']
    const params: unknown[] = []
    const rows = events.map((e, i) => {
      const base = i * cols.length
      params.push(sessionId, userId, (e as any).lat, (e as any).lon,
                  (e as any).accuracy_m ?? null, e.ts ?? new Date().toISOString())
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`
    })
    await this.pool.query(
      `INSERT INTO app_device_locations (${cols.join(', ')}) VALUES ${rows.join(', ')}`, params
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
    let activeSessions = 0
    const stream = this.redis.scanStream({ match: 'monitor:session:*', count: 100 })
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (keys: string[]) => { activeSessions += keys.length })
      stream.on('end', resolve)
      stream.on('error', reject)
    })

    // Errors in last 5 min from sorted set
    const errorsLast5min = await this.redis.zcount(
      'monitor:errors:5min',
      Date.now() - 300_000,
      '+inf'
    )

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
      [Math.min(limit, 100), Math.max(0, offset)]
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
