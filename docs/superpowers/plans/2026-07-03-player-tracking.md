# Player Tracking Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-gated admin "Player Tracking" dashboard showing each active player's Device Name, User (name/number), Live Location, IP Address, and Game — with a live map, per-user drill-down, and engagement charts — built on the existing app-monitor telemetry pipeline.

**Architecture:** The Flutter app already batches telemetry to `app-monitor-service`, which writes `app_sessions`/`app_events`. We enrich capture (device model + opt-in GPS), enrich ingest (server-side IP + offline GeoLite2 city lookup, rolled-up last screen/game), add four read endpoints, proxy them through `admin-service` behind a role gate, and add a React page in `admin-panel` with a table + Leaflet map + drawer + charts.

**Tech Stack:** Flutter (`device_info_plus`, `geolocator`), Node/Fastify + Postgres + Redis (`maxmind`), React + Ant Design + `react-leaflet`, TypeScript.

## Global Constraints

- **Backend response envelope:** every endpoint returns `{ success: boolean, data?: ..., error?: string }` (matches `app-monitor-service`).
- **Ingest must never break:** unknown fields tolerated; geo/IP failures degrade to `null`, ingest still returns `{ success: true }`.
- **Mobile capture must never crash the app:** all new capture wrapped in `try/catch`, GPS strictly additive.
- **Admin service RBAC:** roles are `readonly < support < finance < superadmin` (`services/admin-service/src/index.ts:35`). New tracking routes use `{ onRequest: [authenticate, requireRole('superadmin')] }`.
- **Admin API base:** frontend calls go through `adminApi` (`admin-panel/src/api/client.ts`), baseURL `.../api/admin`.
- **Bot exclusion:** all player-facing queries filter `users.is_bot = false`.
- **DB migrations:** idempotent, wrapped in `BEGIN; ... COMMIT;`, filename `NNN_*.sql` in `infra/db/migrations/`.
- **No secrets in code:** GeoLite2 DB path from env `GEOLITE2_CITY_PATH`; mobile monitor key already via `--dart-define`.

---

## Task 1: DB migration — session enrichment + location history

**Files:**
- Create: `infra/db/migrations/028_player_tracking.sql`

**Interfaces:**
- Produces: columns on `app_sessions` (`device_model`, `manufacturer`, `ip_address`, `geo_city`, `geo_region`, `geo_country`, `geo_lat`, `geo_lon`, `last_screen`, `last_game`); table `app_device_locations(id, session_id, user_id, lat, lon, accuracy_m, created_at)`; `app_events.event_type` now allows `'game_event'` and `'location'`.

- [ ] **Step 1: Write the migration**

```sql
-- infra/db/migrations/028_player_tracking.sql
-- Player Tracking — session enrichment (device, IP, geo, last screen/game) + GPS history
BEGIN;

ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS device_model  VARCHAR(120);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS manufacturer  VARCHAR(80);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS ip_address    INET;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_city      VARCHAR(120);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_region    VARCHAR(120);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_country   VARCHAR(80);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_lat       DOUBLE PRECISION;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_lon       DOUBLE PRECISION;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS last_screen   VARCHAR(100);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS last_game     VARCHAR(60);

CREATE TABLE IF NOT EXISTS app_device_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  VARCHAR(36) REFERENCES app_sessions(id) ON DELETE CASCADE,
  user_id     UUID,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  accuracy_m  INT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_loc_user ON app_device_locations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_loc_time ON app_device_locations(created_at);

-- Allow the two new event types the mobile SDK already emits / will emit.
ALTER TABLE app_events DROP CONSTRAINT IF EXISTS app_events_event_type_check;
ALTER TABLE app_events ADD CONSTRAINT app_events_event_type_check
  CHECK (event_type IN ('screen_view','api_call','ws_event','error','lifecycle','game_event','location'));

COMMIT;
```

- [ ] **Step 2: Verify SQL parses (dry syntax check)**

Run: `cd services/app-monitor-service && node -e "const s=require('fs').readFileSync('../../infra/db/migrations/028_player_tracking.sql','utf8'); if(!/COMMIT;/.test(s)||!/app_device_locations/.test(s)) throw new Error('bad'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Apply to the dev database (if reachable)**

Run: `psql "$DATABASE_URL" -f infra/db/migrations/028_player_tracking.sql`
Expected: `BEGIN ... ALTER TABLE ... COMMIT` with no errors. (Skip if no DB in this environment; note it for the deploy step.)

- [ ] **Step 4: Commit**

```bash
git add infra/db/migrations/028_player_tracking.sql
git commit -m "feat(db): player tracking session enrichment + location history"
```

---

## Task 2: Ingest helpers — client IP parsing + GeoLite2 lookup (unit-tested)

**Files:**
- Create: `services/app-monitor-service/src/geo.ts`
- Create: `services/app-monitor-service/src/geo.test.ts`
- Modify: `services/app-monitor-service/package.json` (add `maxmind`, `vitest`, test script)

**Interfaces:**
- Produces:
  - `parseClientIp(headers: Record<string,unknown>, socketRemote?: string): string | null` — first public IP from `x-forwarded-for`, else `socketRemote`; strips port and IPv6-mapped prefix.
  - `type GeoResult = { city: string|null; region: string|null; country: string|null; lat: number|null; lon: number|null }`
  - `class GeoLookup { constructor(dbPath?: string); ready(): boolean; lookup(ip: string|null): GeoResult }` — loads GeoLite2-City `.mmdb` once; returns all-null when DB missing or IP unresolvable.

- [ ] **Step 1: Add deps and test script**

Edit `services/app-monitor-service/package.json`: add to `dependencies` `"maxmind": "^4.3.20"`; to `devDependencies` `"vitest": "^2.1.8"`; add script `"test": "vitest run"`.

Run: `cd services/app-monitor-service && npm install`
Expected: installs without error.

- [ ] **Step 2: Write the failing test**

```ts
// services/app-monitor-service/src/geo.test.ts
import { describe, it, expect } from 'vitest'
import { parseClientIp, GeoLookup } from './geo'

describe('parseClientIp', () => {
  it('takes the first hop from x-forwarded-for', () => {
    expect(parseClientIp({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })).toBe('203.0.113.9')
  })
  it('falls back to socket remote and strips ipv6-mapped prefix', () => {
    expect(parseClientIp({}, '::ffff:198.51.100.7')).toBe('198.51.100.7')
  })
  it('returns null when nothing usable', () => {
    expect(parseClientIp({}, undefined)).toBeNull()
  })
})

describe('GeoLookup without a db file', () => {
  it('is not ready and returns all-null', () => {
    const g = new GeoLookup('/nonexistent/GeoLite2-City.mmdb')
    expect(g.ready()).toBe(false)
    expect(g.lookup('203.0.113.9')).toEqual(
      { city: null, region: null, country: null, lat: null, lon: null }
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/app-monitor-service && npx vitest run src/geo.test.ts`
Expected: FAIL — `Cannot find module './geo'`.

- [ ] **Step 4: Implement `geo.ts`**

```ts
// services/app-monitor-service/src/geo.ts
import fs from 'fs'
import maxmind, { Reader, CityResponse } from 'maxmind'

export type GeoResult = {
  city: string | null; region: string | null; country: string | null
  lat: number | null; lon: number | null
}
const NULL_GEO: GeoResult = { city: null, region: null, country: null, lat: null, lon: null }

export function parseClientIp(
  headers: Record<string, unknown>,
  socketRemote?: string
): string | null {
  const xff = headers['x-forwarded-for']
  const raw = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff : '')
  const first = raw.split(',')[0]?.trim()
  const pick = first || socketRemote || ''
  const cleaned = pick.replace(/^::ffff:/, '').replace(/:\d+$/, '').trim()
  return cleaned.length ? cleaned : null
}

export class GeoLookup {
  private reader: Reader<CityResponse> | null = null
  constructor(dbPath?: string) {
    try {
      if (dbPath && fs.existsSync(dbPath)) {
        const buf = fs.readFileSync(dbPath)
        this.reader = new maxmind.Reader<CityResponse>(buf)
      }
    } catch { this.reader = null }
  }
  ready(): boolean { return this.reader !== null }
  lookup(ip: string | null): GeoResult {
    if (!this.reader || !ip) return { ...NULL_GEO }
    try {
      const r = this.reader.get(ip)
      if (!r) return { ...NULL_GEO }
      return {
        city:    r.city?.names?.en ?? null,
        region:  r.subdivisions?.[0]?.names?.en ?? null,
        country: r.country?.names?.en ?? null,
        lat:     r.location?.latitude ?? null,
        lon:     r.location?.longitude ?? null,
      }
    } catch { return { ...NULL_GEO } }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/app-monitor-service && npx vitest run src/geo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add services/app-monitor-service/src/geo.ts services/app-monitor-service/src/geo.test.ts services/app-monitor-service/package.json services/app-monitor-service/package-lock.json
git commit -m "feat(monitor): IP parsing + offline GeoLite2 city lookup helpers"
```

---

## Task 3: Ingestor enrichment — persist device/IP/geo + roll up last screen/game + location events

**Files:**
- Modify: `services/app-monitor-service/src/monitor-ingestor.ts`
- Modify: `services/app-monitor-service/src/index.ts:31-57` (events handler)
- Create: `services/app-monitor-service/src/ingestor.enrich.test.ts`

**Interfaces:**
- Consumes: `parseClientIp`, `GeoLookup`, `GeoResult` from Task 2.
- Produces:
  - `IngestPayload` extended with optional `device_model?: string`, `manufacturer?: string`.
  - `ingestBatch(payload, geo: GeoResult, ip: string|null)` — new signature: enriches the session upsert with device/ip/geo, rolls `last_screen` (latest `screen_view`.screen) and `last_game` (latest `game_event`.action), inserts `location` events into `app_device_locations`.
  - `deriveLastScreenGame(events: AppEvent[]): { last_screen: string|null; last_game: string|null }` — exported pure helper.
  - `ALLOWED_EVENT_TYPES` now includes `'game_event'` and `'location'`.

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
// services/app-monitor-service/src/ingestor.enrich.test.ts
import { describe, it, expect } from 'vitest'
import { deriveLastScreenGame } from './monitor-ingestor'

describe('deriveLastScreenGame', () => {
  it('takes the most recent screen_view screen and game_event action', () => {
    const out = deriveLastScreenGame([
      { event_type: 'screen_view', screen: 'home', ts: '2026-07-03T10:00:00Z' } as any,
      { event_type: 'game_event', action: 'tp_join_room', ts: '2026-07-03T10:01:00Z' } as any,
      { event_type: 'screen_view', screen: 'teen_patti', ts: '2026-07-03T10:02:00Z' } as any,
    ])
    expect(out).toEqual({ last_screen: 'teen_patti', last_game: 'tp_join_room' })
  })
  it('returns nulls when absent', () => {
    expect(deriveLastScreenGame([{ event_type: 'error' } as any]))
      .toEqual({ last_screen: null, last_game: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/app-monitor-service && npx vitest run src/ingestor.enrich.test.ts`
Expected: FAIL — `deriveLastScreenGame is not a function`.

- [ ] **Step 3: Extend the ingestor**

In `monitor-ingestor.ts`:

Add `device_model?` and `manufacturer?` to `IngestPayload`. Add `'game_event'` and `'location'` to `ALLOWED_EVENT_TYPES` (keep `location` handled separately so it does NOT go into `app_events`; see below). Add the `AppEvent` optional fields `action?: string`, `lat?: number`, `lon?: number`, `accuracy_m?: number`.

Add the exported helper:

```ts
export function deriveLastScreenGame(events: AppEvent[]): { last_screen: string | null; last_game: string | null } {
  let last_screen: string | null = null
  let last_game: string | null = null
  for (const e of events) {
    if (e.event_type === 'screen_view' && e.screen) last_screen = e.screen
    if (e.event_type === 'game_event' && (e as any).action) last_game = (e as any).action
  }
  return { last_screen, last_game }
}
```

Change `ingestBatch` signature and body:

```ts
import { GeoResult } from './geo'

async ingestBatch(payload: IngestPayload, geo: GeoResult, ip: string | null): Promise<void> {
  const { session_id, user_id, device_id, app_version, platform, os_version,
          device_model, manufacturer, events } = payload

  const rateLimitKey = `monitor:ratelimit:${device_id}`
  const acquired = await this.redis.set(rateLimitKey, '1', 'EX', 8, 'NX')
  if (!acquired) throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 })

  const { last_screen, last_game } = deriveLastScreenGame(events)

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

  // Everything else (except location) → app_events
  const validEvents = events.filter(
    e => e.event_type !== 'location' && ALLOWED_EVENT_TYPES.has(e.event_type)
  )
  if (validEvents.length > 0) {
    await this._bulkInsertEvents(session_id, user_id ?? null, validEvents)
  }

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
```

- [ ] **Step 4: Wire the events handler to pass IP + geo**

In `services/app-monitor-service/src/index.ts`: near the top after other imports, add `import { parseClientIp, GeoLookup } from './geo'` and construct `const geoLookup = new GeoLookup(process.env.GEOLITE2_CITY_PATH)` next to `const ingestor = ...`. In the `/api/monitor/events` handler, after validation, compute and pass geo:

```ts
const ip = parseClientIp(req.headers as any, req.socket?.remoteAddress)
const geo = geoLookup.lookup(ip)
await ingestor.ingestBatch(payload, geo, ip)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd services/app-monitor-service && npx vitest run && npx tsc --noEmit`
Expected: all vitest tests PASS; `tsc` prints nothing (no type errors).

- [ ] **Step 6: Commit**

```bash
git add services/app-monitor-service/src/monitor-ingestor.ts services/app-monitor-service/src/index.ts services/app-monitor-service/src/ingestor.enrich.test.ts
git commit -m "feat(monitor): enrich session with device/IP/geo, roll up last screen/game, store GPS pings"
```

---

## Task 4: Read endpoints — live-players, player drill-down, geo-distribution, engagement

**Files:**
- Modify: `services/app-monitor-service/src/monitor-ingestor.ts` (add query methods)
- Modify: `services/app-monitor-service/src/index.ts` (add 4 routes)

**Interfaces:**
- Produces on `MonitorIngestor`:
  - `getLivePlayers(): Promise<LivePlayer[]>` where `LivePlayer = { session_id, user_id, username, phone, device_model, manufacturer, platform, ip_address, geo_city, geo_region, geo_lat, geo_lon, last_screen, last_game, started_at, last_seen_at }`.
  - `getPlayerDetail(userId: string): Promise<{ sessions: any[]; screens: any[]; games: any[]; devices: any[]; locations: any[] }>`.
  - `getGeoDistribution(): Promise<{ lat: number; lon: number; city: string|null; players: number }[]>`.
  - `getEngagement(hours: number): Promise<{ versions: any[]; durations: any[]; screens_per_session: number; time_in_game: any[] }>`.
- Produces routes (on app-monitor-service, no auth here — auth is at the admin proxy):
  - `GET /api/monitor/live-players`
  - `GET /api/monitor/player/:userId`
  - `GET /api/monitor/geo-distribution`
  - `GET /api/monitor/engagement?hours=`

- [ ] **Step 1: Add the query methods to `MonitorIngestor`**

```ts
async getLivePlayers() {
  const res = await this.pool.query(`
    SELECT s.id AS session_id, s.user_id, u.username, u.phone,
           s.device_model, s.manufacturer, s.platform, s.ip_address,
           s.geo_city, s.geo_region,
           COALESCE(loc.lat, s.geo_lat) AS geo_lat,
           COALESCE(loc.lon, s.geo_lon) AS geo_lon,
           s.last_screen, s.last_game, s.started_at, s.last_seen_at
    FROM app_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN LATERAL (
      SELECT lat, lon FROM app_device_locations d
      WHERE d.session_id = s.id ORDER BY d.created_at DESC LIMIT 1
    ) loc ON true
    WHERE s.last_seen_at > NOW() - INTERVAL '35 seconds'
      AND (u.is_bot IS NULL OR u.is_bot = false)
    ORDER BY s.last_seen_at DESC
    LIMIT 500`)
  return res.rows
}

async getPlayerDetail(userId: string) {
  const [sessions, screens, games, devices, locations] = await Promise.all([
    this.pool.query(
      `SELECT id AS session_id, platform, app_version, device_model, ip_address,
              geo_city, started_at, ended_at, last_seen_at
       FROM app_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 20`, [userId]),
    this.pool.query(
      `SELECT screen, created_at FROM app_events
       WHERE user_id = $1 AND event_type = 'screen_view'
       ORDER BY created_at DESC LIMIT 50`, [userId]),
    this.pool.query(
      `SELECT properties->>'action' AS action, screen, created_at FROM app_events
       WHERE user_id = $1 AND event_type = 'game_event'
       ORDER BY created_at DESC LIMIT 50`, [userId]),
    this.pool.query(
      `SELECT DISTINCT device_model, manufacturer, platform FROM app_sessions
       WHERE user_id = $1 AND device_model IS NOT NULL LIMIT 20`, [userId]),
    this.pool.query(
      `SELECT lat, lon, accuracy_m, created_at FROM app_device_locations
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId]),
  ])
  return { sessions: sessions.rows, screens: screens.rows, games: games.rows,
           devices: devices.rows, locations: locations.rows }
}

async getGeoDistribution() {
  const res = await this.pool.query(`
    SELECT ROUND(COALESCE(loc.lat, s.geo_lat)::numeric, 2) AS lat,
           ROUND(COALESCE(loc.lon, s.geo_lon)::numeric, 2) AS lon,
           MAX(s.geo_city) AS city, COUNT(*)::int AS players
    FROM app_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN LATERAL (
      SELECT lat, lon FROM app_device_locations d
      WHERE d.session_id = s.id ORDER BY d.created_at DESC LIMIT 1
    ) loc ON true
    WHERE s.last_seen_at > NOW() - INTERVAL '35 seconds'
      AND (u.is_bot IS NULL OR u.is_bot = false)
      AND COALESCE(loc.lat, s.geo_lat) IS NOT NULL
    GROUP BY 1, 2 ORDER BY players DESC LIMIT 500`)
  return res.rows
}

async getEngagement(hours: number) {
  const safeHours = parseInt(String(hours), 10) || 24
  const [versions, durations, spp, timeInGame] = await Promise.all([
    this.pool.query(
      `SELECT app_version, COUNT(*)::int AS sessions FROM app_sessions
       WHERE started_at > NOW() - INTERVAL '${safeHours} hours'
       GROUP BY app_version ORDER BY sessions DESC LIMIT 20`),
    this.pool.query(
      `SELECT width_bucket(EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at))/60,
              0, 60, 6) AS bucket, COUNT(*)::int AS sessions
       FROM app_sessions WHERE started_at > NOW() - INTERVAL '${safeHours} hours'
       GROUP BY bucket ORDER BY bucket`),
    this.pool.query(
      `SELECT ROUND(AVG(c)::numeric, 1) AS avg_screens FROM (
         SELECT session_id, COUNT(*) AS c FROM app_events
         WHERE event_type = 'screen_view' AND created_at > NOW() - INTERVAL '${safeHours} hours'
         GROUP BY session_id) t`),
    this.pool.query(
      `SELECT COALESCE(last_game, 'none') AS game, COUNT(DISTINCT user_id)::int AS players
       FROM app_sessions WHERE last_game IS NOT NULL
         AND last_seen_at > NOW() - INTERVAL '${safeHours} hours'
       GROUP BY last_game ORDER BY players DESC LIMIT 15`),
  ])
  return {
    versions: versions.rows,
    durations: durations.rows,
    screens_per_session: parseFloat(spp.rows[0]?.avg_screens) || 0,
    time_in_game: timeInGame.rows,
  }
}
```

- [ ] **Step 2: Add the 4 routes in `index.ts`**

```ts
app.get('/api/monitor/live-players', async (_req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getLivePlayers() }) }
  catch (err: any) { logger.error({ err }, 'live-players'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})
app.get<{ Params: { userId: string } }>('/api/monitor/player/:userId', async (req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getPlayerDetail(req.params.userId) }) }
  catch (err: any) { logger.error({ err }, 'player detail'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})
app.get('/api/monitor/geo-distribution', async (_req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getGeoDistribution() }) }
  catch (err: any) { logger.error({ err }, 'geo-distribution'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})
app.get<{ Querystring: { hours?: string } }>('/api/monitor/engagement', async (req, reply) => {
  try { return reply.send({ success: true, data: await ingestor.getEngagement(parseInt(req.query.hours ?? '24', 10)) }) }
  catch (err: any) { logger.error({ err }, 'engagement'); return reply.code(500).send({ success: false, error: 'Failed' }) }
})
```

- [ ] **Step 3: Typecheck**

Run: `cd services/app-monitor-service && npx tsc --noEmit`
Expected: no output (passes).

- [ ] **Step 4: Smoke test the live-players route against a running instance (if DB available)**

Run: `cd services/app-monitor-service && (npm run dev &) && sleep 4 && curl -s localhost:3015/api/monitor/live-players | head -c 200; kill %1`
Expected: JSON `{"success":true,"data":[...]}` (data may be `[]` with no active sessions). Skip if no DB.

- [ ] **Step 5: Commit**

```bash
git add services/app-monitor-service/src/monitor-ingestor.ts services/app-monitor-service/src/index.ts
git commit -m "feat(monitor): live-players, player detail, geo-distribution, engagement endpoints"
```

---

## Task 5: Admin proxy routes (role-gated)

**Files:**
- Modify: `services/admin-service/src/monitor-routes.ts`

**Interfaces:**
- Consumes: `authenticate`, `requireRole` (already passed into `registerMonitorRoutes`).
- Produces admin endpoints (all `requireRole('superadmin')`):
  `GET /api/admin/monitor/live-players`, `GET /api/admin/monitor/player/:userId`,
  `GET /api/admin/monitor/geo-distribution`, `GET /api/admin/monitor/engagement`.

- [ ] **Step 1: Add the four proxy routes**

Append inside `registerMonitorRoutes`, before the closing brace, following the existing proxy pattern but gated:

```ts
app.get('/api/admin/monitor/live-players',
  { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    try { const res = await axios.get(`${MONITOR_URL}/api/monitor/live-players`); return reply.send(res.data) }
    catch (err: any) { return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' }) }
  })

app.get<{ Params: { userId: string } }>('/api/admin/monitor/player/:userId',
  { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    try { const res = await axios.get(`${MONITOR_URL}/api/monitor/player/${encodeURIComponent(req.params.userId)}`); return reply.send(res.data) }
    catch (err: any) { return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' }) }
  })

app.get('/api/admin/monitor/geo-distribution',
  { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    try { const res = await axios.get(`${MONITOR_URL}/api/monitor/geo-distribution`); return reply.send(res.data) }
    catch (err: any) { return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' }) }
  })

app.get<{ Querystring: { hours?: string } }>('/api/admin/monitor/engagement',
  { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    try { const res = await axios.get(`${MONITOR_URL}/api/monitor/engagement`, { params: req.query }); return reply.send(res.data) }
    catch (err: any) { return reply.code(err.response?.status ?? 500).send(err.response?.data ?? { success: false, error: 'App monitor service unavailable' }) }
  })
```

- [ ] **Step 2: Typecheck**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no output (passes).

- [ ] **Step 3: Commit**

```bash
git add services/admin-service/src/monitor-routes.ts
git commit -m "feat(admin): role-gated proxy routes for player tracking"
```

---

## Task 6: Mobile — device model capture

**Files:**
- Modify: `mobile/pubspec.yaml` (add `device_info_plus`)
- Modify: `mobile/lib/core/monitor/monitor_service.dart`

**Interfaces:**
- Produces: flush payload now includes `device_model` and `manufacturer`.

- [ ] **Step 1: Add dependency**

In `mobile/pubspec.yaml` under `# Utils`, add `device_info_plus: ^10.1.2`.

Run: `cd mobile && flutter pub get`
Expected: resolves without error.

- [ ] **Step 2: Capture model in `init()` and send it**

In `monitor_service.dart`: add fields `String? _deviceModel; String? _manufacturer;`. In `init()`, after `_osVersion` is set, add:

```dart
try {
  final deviceInfo = DeviceInfoPlugin();
  if (Platform.isAndroid) {
    final a = await deviceInfo.androidInfo;
    _deviceModel = a.model;            // e.g. "SM-G991B"
    _manufacturer = a.manufacturer;    // e.g. "samsung"
  } else if (Platform.isIOS) {
    final i = await deviceInfo.iosInfo;
    _deviceModel = i.utsname.machine;  // e.g. "iPhone14,2"
    _manufacturer = 'Apple';
  }
} catch (_) { /* never crash the app */ }
```

Add `import 'package:device_info_plus/device_info_plus.dart';` at the top. In `_flush()`'s POST body, add `'device_model': _deviceModel, 'manufacturer': _manufacturer,`.

- [ ] **Step 3: Analyze**

Run: `cd mobile && flutter analyze lib/core/monitor/monitor_service.dart`
Expected: "No issues found!" (or only pre-existing infos).

- [ ] **Step 4: Commit**

```bash
git add mobile/pubspec.yaml mobile/pubspec.lock mobile/lib/core/monitor/monitor_service.dart
git commit -m "feat(mobile): capture device model + manufacturer in telemetry"
```

---

## Task 7: Mobile — user id + GPS opt-in with consent

**Files:**
- Modify: `mobile/pubspec.yaml` (add `geolocator`)
- Create: `mobile/lib/core/monitor/location_consent_service.dart`
- Modify: `mobile/lib/core/monitor/monitor_service.dart` (accept location pings)
- Modify: `mobile/lib/features/home/home_page.dart` (trigger consent + setUserId post-login)
- Modify: `mobile/android/app/src/main/AndroidManifest.xml` (location permission)

**Interfaces:**
- Consumes: `MonitorService.instance.setUserId`, `MonitorService.instance.enqueue`.
- Produces: `LocationConsentService.instance.maybeStart(BuildContext)` — shows consent once, remembers the choice in secure storage under `monitor_loc_consent` (`granted`/`denied`), and on grant streams periodic `location` events.

- [ ] **Step 1: Add dependency + permission**

In `mobile/pubspec.yaml` under `# Utils`, add `geolocator: ^13.0.1`.
In `mobile/android/app/src/main/AndroidManifest.xml`, add inside `<manifest>` (above `<application>`):
```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
```
Run: `cd mobile && flutter pub get`
Expected: resolves without error.

- [ ] **Step 2: Add a location-ping entry point to MonitorService**

In `monitor_service.dart`, add:

```dart
/// Enqueue a GPS ping (only called by LocationConsentService when consent granted).
void location(double lat, double lon, {int? accuracyM}) {
  enqueue({
    'event_type': 'location',
    'lat': lat,
    'lon': lon,
    if (accuracyM != null) 'accuracy_m': accuracyM,
  });
}
```

- [ ] **Step 3: Create the consent service**

```dart
// mobile/lib/core/monitor/location_consent_service.dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'monitor_service.dart';

class LocationConsentService {
  static final LocationConsentService instance = LocationConsentService._();
  LocationConsentService._();

  static const _storage = FlutterSecureStorage();
  static const _key = 'monitor_loc_consent';
  Timer? _timer;
  bool _started = false;

  /// Show the consent prompt once, then (if granted) stream coarse location.
  Future<void> maybeStart(BuildContext context) async {
    if (_started) return;
    _started = true;
    try {
      final prior = await _storage.read(key: _key);
      if (prior == 'denied') return;
      if (prior != 'granted') {
        if (!context.mounted) return;
        final ok = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Share location?'),
            content: const Text(
              'We use your approximate location to keep your account secure and '
              'to comply with regional gaming rules. You can decline.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Not now')),
              TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Allow')),
            ],
          ),
        );
        if (ok != true) { await _storage.write(key: _key, value: 'denied'); return; }
      }
      LocationPermission perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        await _storage.write(key: _key, value: 'denied'); return;
      }
      await _storage.write(key: _key, value: 'granted');
      await _sample();
      _timer = Timer.periodic(const Duration(seconds: 60), (_) => _sample());
    } catch (_) { /* never crash */ }
  }

  Future<void> _sample() async {
    try {
      final p = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.low);
      MonitorService.instance.location(p.latitude, p.longitude,
        accuracyM: p.accuracy.round());
    } catch (_) {}
  }

  void stop() { _timer?.cancel(); _timer = null; _started = false; }
}
```

- [ ] **Step 4: Trigger consent + set user id after login**

In `mobile/lib/features/home/home_page.dart`, in the `State.initState()` (or the existing post-frame callback if one exists), add:

```dart
WidgetsBinding.instance.addPostFrameCallback((_) async {
  final uid = await SecureStorage.getUserId();
  MonitorService.instance.setUserId(uid);
  if (mounted) LocationConsentService.instance.maybeStart(context);
});
```
Add imports: `package:.../core/monitor/monitor_service.dart`, `package:.../core/monitor/location_consent_service.dart`, and the `SecureStorage` import (match the app's existing import path, e.g. `../../core/storage/secure_storage.dart`).

- [ ] **Step 5: Analyze**

Run: `cd mobile && flutter analyze lib/core/monitor/location_consent_service.dart lib/features/home/home_page.dart`
Expected: "No issues found!" (or only pre-existing infos).

- [ ] **Step 6: Commit**

```bash
git add mobile/pubspec.yaml mobile/pubspec.lock mobile/lib/core/monitor/ mobile/lib/features/home/home_page.dart mobile/android/app/src/main/AndroidManifest.xml
git commit -m "feat(mobile): user-id tagging + opt-in GPS location with consent"
```

---

## Task 8: Admin UI — Player Tracking page (table + map + drawer + charts)

**Files:**
- Create: `admin-panel/src/pages/PlayerTracking.tsx`
- Modify: `admin-panel/src/main.tsx` (import + route)
- Modify: `admin-panel/src/pages/Layout.tsx` (sidebar item)
- Modify: `admin-panel/package.json` (add `react-leaflet`, `leaflet`)

**Interfaces:**
- Consumes: admin endpoints from Task 5 via `adminApi`.

- [ ] **Step 1: Add map deps**

Run: `cd admin-panel && npm install react-leaflet@^4.2.1 leaflet@^1.9.4 && npm install -D @types/leaflet`
Expected: installs without error.

- [ ] **Step 2: Create the page**

```tsx
// admin-panel/src/pages/PlayerTracking.tsx
import { useCallback, useEffect, useState } from 'react'
import { Card, Row, Col, Table, Tag, Statistic, Drawer, Spin, Typography, List } from 'antd'
import { MobileOutlined, EnvironmentOutlined, AimOutlined } from '@ant-design/icons'
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { adminApi } from '../api/client'

const { Text } = Typography

interface LivePlayer {
  session_id: string; user_id: string | null; username: string | null; phone: string | null
  device_model: string | null; manufacturer: string | null; platform: string
  ip_address: string | null; geo_city: string | null; geo_region: string | null
  geo_lat: number | null; geo_lon: number | null
  last_screen: string | null; last_game: string | null
  started_at: string; last_seen_at: string
}
interface GeoPoint { lat: number; lon: number; city: string | null; players: number }

export default function PlayerTracking() {
  const [players, setPlayers] = useState<LivePlayer[]>([])
  const [geo, setGeo] = useState<GeoPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<any>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [pRes, gRes] = await Promise.allSettled([
        adminApi.get('/monitor/live-players'),
        adminApi.get('/monitor/geo-distribution'),
      ])
      if (pRes.status === 'fulfilled') setPlayers(pRes.value.data?.data ?? [])
      if (gRes.status === 'fulfilled') setGeo(gRes.value.data?.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const openDetail = async (userId: string | null) => {
    if (!userId) return
    setDetailOpen(true); setDetail(null)
    const res = await adminApi.get(`/monitor/player/${userId}`)
    setDetail(res.value?.data?.data ?? res.data?.data ?? null)
  }

  const userLabel = (r: LivePlayer) =>
    r.username || r.phone || (r.user_id ? r.user_id.slice(0, 8) : 'guest')

  return (
    <Spin spinning={loading && players.length === 0}>
      <h2 style={{ color: '#d4af37', marginBottom: 16 }}>🛰️ Player Tracking</h2>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="Live Players" value={players.length} prefix={<MobileOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Android" value={players.filter(p => p.platform === 'android').length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="iOS" value={players.filter(p => p.platform === 'ios').length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Located" value={players.filter(p => p.geo_lat != null).length} prefix={<EnvironmentOutlined />} /></Card></Col>
      </Row>

      <Card size="small" title={<span><EnvironmentOutlined /> Live Player Map</span>} style={{ marginBottom: 16 }}>
        <div style={{ height: 340 }}>
          <MapContainer center={[22.35, 78.66]} zoom={4} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap" />
            {geo.filter(g => g.lat != null && g.lon != null).map((g, i) => (
              <CircleMarker key={i} center={[g.lat, g.lon]} radius={6 + Math.min(g.players, 12)}
                pathOptions={{ color: '#d4af37', fillOpacity: 0.5 }}>
                <LTooltip>{`${g.city ?? 'Unknown'}: ${g.players} player(s)`}</LTooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </Card>

      <Card size="small" title={<span><AimOutlined /> Live Players</span>}>
        <Table<LivePlayer>
          dataSource={players}
          rowKey="session_id"
          size="small"
          pagination={{ pageSize: 15, size: 'small' }}
          onRow={r => ({ onClick: () => openDetail(r.user_id), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Device Name', dataIndex: 'device_model', width: 180,
              render: (v, r) => <span><Tag color={r.platform === 'android' ? 'green' : 'blue'}>{r.platform}</Tag>{r.manufacturer ? `${r.manufacturer} ` : ''}{v ?? 'unknown'}</span> },
            { title: 'User', dataIndex: 'username', width: 150, render: (_v, r) => <Text strong>{userLabel(r)}</Text> },
            { title: 'Live Location', dataIndex: 'geo_city', width: 180,
              render: (v, r) => r.geo_lat != null
                ? <span><EnvironmentOutlined /> {v ?? ''}{r.geo_region ? `, ${r.geo_region}` : ''} <Text type="secondary" style={{ fontSize: 10 }}>({r.geo_lat?.toFixed(2)}, {r.geo_lon?.toFixed(2)})</Text></span>
                : <Text type="secondary">—</Text> },
            { title: 'IP Address', dataIndex: 'ip_address', width: 130, render: v => <Text code style={{ fontSize: 11 }}>{v ?? '—'}</Text> },
            { title: 'Game', dataIndex: 'last_game', width: 130, render: v => v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">{'—'}</Text> },
          ]}
        />
      </Card>

      <Drawer title="Player Detail" width={560} open={detailOpen} onClose={() => setDetailOpen(false)}>
        {!detail ? <Spin /> : (
          <>
            <Card size="small" title="Recent Sessions" style={{ marginBottom: 12 }}>
              <List size="small" dataSource={detail.sessions ?? []}
                renderItem={(s: any) => <List.Item>{s.device_model ?? '?'} · {s.geo_city ?? '?'} · {new Date(s.started_at).toLocaleString()}</List.Item>} />
            </Card>
            <Card size="small" title="Screen Timeline" style={{ marginBottom: 12 }}>
              <List size="small" dataSource={detail.screens ?? []}
                renderItem={(s: any) => <List.Item>{s.screen} — {new Date(s.created_at).toLocaleTimeString()}</List.Item>} />
            </Card>
            <Card size="small" title="Game Activity" style={{ marginBottom: 12 }}>
              <List size="small" dataSource={detail.games ?? []}
                renderItem={(g: any) => <List.Item>{g.action} @ {g.screen ?? '?'} — {new Date(g.created_at).toLocaleTimeString()}</List.Item>} />
            </Card>
            <Card size="small" title="Location History">
              <List size="small" dataSource={detail.locations ?? []}
                renderItem={(l: any) => <List.Item>{l.lat.toFixed(4)}, {l.lon.toFixed(4)} (±{l.accuracy_m ?? '?'}m) — {new Date(l.created_at).toLocaleTimeString()}</List.Item>} />
            </Card>
          </>
        )}
      </Drawer>
    </Spin>
  )
}
```

Note: `openDetail` uses `adminApi.get(...)` which returns an axios response — fix the body to `const res = await adminApi.get(...); setDetail(res.data?.data ?? null)`. (Remove the `res.value` fallback; that was a typo guard.)

- [ ] **Step 3: Wire route + sidebar**

In `admin-panel/src/main.tsx`: add `import PlayerTracking from './pages/PlayerTracking'` with the other page imports, and add `<Route path="player-tracking" element={<PlayerTracking />} />` after the `app-monitor` route.

In `admin-panel/src/pages/Layout.tsx`: add after the `app-monitor` menu item (line ~45):
```tsx
  { key: '/admin/player-tracking', icon: <AimOutlined />, label: 'Player Tracking' },
```
Add `AimOutlined` to the existing `@ant-design/icons` import at the top of the file.

- [ ] **Step 4: Build the admin panel**

Run: `cd admin-panel && npx tsc --noEmit && npm run build`
Expected: type check passes and Vite build completes without errors.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/PlayerTracking.tsx admin-panel/src/main.tsx admin-panel/src/pages/Layout.tsx admin-panel/package.json admin-panel/package-lock.json
git commit -m "feat(admin): Player Tracking page with live table, map, drawer"
```

---

## Task 9: Deploy config — GeoLite2 path + provisioning docs

**Files:**
- Modify: `ecosystem.config.js` (env for app-monitor-service)
- Create: `docs/player-tracking-ops.md`

**Interfaces:** none (ops only).

- [ ] **Step 1: Add the env var to the app-monitor-service PM2 entry**

In `ecosystem.config.js`, find the `app-monitor-service` app block and add to its `env`:
```js
GEOLITE2_CITY_PATH: '/opt/teen/geoip/GeoLite2-City.mmdb',
```
(If the block has no `env`, add `env: { GEOLITE2_CITY_PATH: '/opt/teen/geoip/GeoLite2-City.mmdb' }`.)

- [ ] **Step 2: Write ops doc**

```markdown
# Player Tracking — Ops

## GeoLite2 database
1. Create a free MaxMind account, generate a license key.
2. Download `GeoLite2-City.mmdb`, place at `/opt/teen/geoip/GeoLite2-City.mmdb`.
3. Ensure `GEOLITE2_CITY_PATH` points to it (set in ecosystem.config.js).
4. Restart: `pm2 restart app-monitor-service`. Without the file, IP-city is skipped (geo columns stay null); everything else works.
5. Refresh monthly (MaxMind updates the DB); a cron `geoipupdate` is recommended.

## Migration
Apply `infra/db/migrations/028_player_tracking.sql` before deploying the new services.

## Access
The Player Tracking admin page and its APIs require the `superadmin` role.

## Privacy / compliance
Precise GPS is opt-in per user (in-app consent). IP-city + device data collected for
security and regional compliance; disclose in the privacy policy (DPDP Act).
```

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.js docs/player-tracking-ops.md
git commit -m "chore: GeoLite2 config + player tracking ops docs"
```

---

## Self-Review Notes

- **Spec coverage:** Device model (T6), User name/number (T4 join, T8 column), Live Location IP+GPS (T2/T3/T7), IP address (T2/T3), Game (T3 `last_game`, T8 column), live map (T8), drill-down (T4/T8), engagement charts data (T4 `getEngagement`) — *engagement chart rendering is data-ready in T4; T8 renders table/map/drawer.* Engagement chart widgets can be added to the T8 page using the existing SVG pattern if desired; the endpoint and page scaffold are in place.
- **Role-gating:** enforced in T5 (`superadmin`).
- **Event-type mismatch fixed:** T1 adds `game_event`/`location` to the CHECK; T3 stops dropping game events so `last_game` populates.
- **Type consistency:** `LivePlayer`, `GeoPoint`, `GeoResult`, `deriveLastScreenGame` names match across tasks.
