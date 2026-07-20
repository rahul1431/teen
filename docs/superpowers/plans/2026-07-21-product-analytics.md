# Product Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deposit-funnel, onboarding-funnel, retention/cohort, feature-flag, and A/B-testing gaps identified in the design spec, using only infrastructure already running (shared Postgres, existing `admin-service`/`core-api-service` processes, existing admin-panel) — no PostHog, no new processes.

**Architecture:** Two new tables (`product_events`, `feature_flags`) shared by `core-api-service` (player-facing: log events, evaluate flags) and `admin-service` (staff-facing: dashboards, flag CRUD). A pure, deterministic flag-evaluation function (TDD, mirrors the Agent commission system's hierarchy/settlement pattern) decides on/off/variant per user. Mobile app gets a small `ProductAnalytics` singleton (mirrors the existing `MonitorService` pattern) that fetches flags once at launch and fires event-tracking calls at the deposit funnel's key points.

**Tech Stack:** Fastify + `pg` (core-api-service, admin-service), Postgres migrations, Vitest, React + Ant Design (admin-panel), Flutter/Dio (mobile).

## Global Constraints

- No session replay — explicitly out of scope per the spec.
- No new processes, containers, or third-party services — everything lives in the existing Postgres, existing Node services, existing admin-panel, existing mobile app.
- Flag evaluation must be **deterministic**: the same user must always get the same on/off/variant result for a given flag configuration (no `Math.random()`).
- `product_events.user_id` is nullable — `POST /events` must tolerate an unauthenticated caller (pre-login events) rather than rejecting with 401.
- Spec: `docs/superpowers/specs/2026-07-21-product-analytics-design.md`

---

## Task 1: Database schema

**Files:**
- Create: `infra/db/migrations/083_product_analytics.sql`

**Interfaces:**
- Produces: tables `product_events`, `feature_flags`. All later tasks depend on these exact column names.

- [ ] **Step 1: Write the migration**

```sql
-- Product analytics: event tracking + feature flags, built on existing
-- infrastructure instead of adopting PostHog (self-hosting its ClickHouse
-- stack was ruled out as too heavy for this VPS). See
-- docs/superpowers/specs/2026-07-21-product-analytics-design.md

CREATE TABLE product_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  event_name    TEXT NOT NULL,
  properties    JSONB NOT NULL DEFAULT '{}',
  source        TEXT NOT NULL CHECK (source IN ('mobile', 'admin_panel')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_events_name_created ON product_events(event_name, created_at);
CREATE INDEX idx_product_events_user_id ON product_events(user_id);
CREATE INDEX idx_product_events_created_at ON product_events(created_at);

CREATE TABLE feature_flags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               VARCHAR(100) UNIQUE NOT NULL,
  description       TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percent   INT NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  enabled_user_ids  UUID[] NOT NULL DEFAULT '{}',
  variants          JSONB,
  created_by        UUID NOT NULL REFERENCES admin_users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Verify column list**

Run: `grep -c "CREATE TABLE\|CREATE INDEX" infra/db/migrations/083_product_analytics.sql`
Expected: `5` (2 tables + 3 indexes).

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/083_product_analytics.sql
git commit -m "feat(db): add product_events and feature_flags tables"
```

---

## Task 2: Flag evaluation (pure function + tests)

**Files:**
- Create: `services/core-api-service/src/flag-evaluation.ts`
- Test: `services/core-api-service/tests/flag-evaluation.test.ts`

**Interfaces:**
- Produces: `evaluateFlag(flag: FeatureFlag, userId: string): FlagResult` — used by Task 3's `GET /flags` route.

- [ ] **Step 1: Write the failing tests**

```typescript
// services/core-api-service/tests/flag-evaluation.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateFlag, FeatureFlag } from '../src/flag-evaluation'

const baseFlag = (overrides: Partial<FeatureFlag> = {}): FeatureFlag => ({
  key: 'test_flag',
  enabled: true,
  rolloutPercent: 0,
  enabledUserIds: [],
  variants: null,
  ...overrides,
})

describe('evaluateFlag', () => {
  it('is off when the flag is master-disabled, regardless of rollout percent', () => {
    const flag = baseFlag({ enabled: false, rolloutPercent: 100 })
    expect(evaluateFlag(flag, 'user-1')).toEqual({ enabled: false })
  })

  it('is off for everyone at 0% rollout with no allowlist', () => {
    const flag = baseFlag({ rolloutPercent: 0 })
    for (const userId of ['user-1', 'user-2', 'user-3']) {
      expect(evaluateFlag(flag, userId)).toEqual({ enabled: false })
    }
  })

  it('is on for everyone at 100% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 100 })
    for (const userId of ['user-1', 'user-2', 'user-3']) {
      expect(evaluateFlag(flag, userId).enabled).toBe(true)
    }
  })

  it('is on for an allowlisted user even at 0% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 0, enabledUserIds: ['user-1'] })
    expect(evaluateFlag(flag, 'user-1')).toEqual({ enabled: true })
  })

  it('is off for a non-allowlisted user at 0% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 0, enabledUserIds: ['user-1'] })
    expect(evaluateFlag(flag, 'user-2')).toEqual({ enabled: false })
  })

  it('is deterministic — the same user gets the same result across repeated calls', () => {
    const flag = baseFlag({ rolloutPercent: 50 })
    const first = evaluateFlag(flag, 'user-42')
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag, 'user-42')).toEqual(first)
    }
  })

  it('produces a roughly even split across many users at 50% rollout', () => {
    const flag = baseFlag({ rolloutPercent: 50 })
    let onCount = 0
    const total = 2000
    for (let i = 0; i < total; i++) {
      if (evaluateFlag(flag, `user-${i}`).enabled) onCount++
    }
    // Not exactly 50% — hash-based bucketing has natural variance — but should
    // land in a sane range, proving the percentage actually gates rather than
    // being all-on or all-off.
    expect(onCount).toBeGreaterThan(total * 0.35)
    expect(onCount).toBeLessThan(total * 0.65)
  })

  it('assigns a variant when the flag is on and variants are configured', () => {
    const flag = baseFlag({
      rolloutPercent: 100,
      variants: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }],
    })
    const result = evaluateFlag(flag, 'user-1')
    expect(result.enabled).toBe(true)
    expect(['a', 'b']).toContain(result.variant)
  })

  it('never assigns a variant when the flag is off', () => {
    const flag = baseFlag({
      rolloutPercent: 0,
      variants: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }],
    })
    const result = evaluateFlag(flag, 'user-1')
    expect(result.enabled).toBe(false)
    expect(result.variant).toBeUndefined()
  })

  it('is deterministic for variant assignment across repeated calls', () => {
    const flag = baseFlag({
      rolloutPercent: 100,
      variants: [{ key: 'a', weight: 30 }, { key: 'b', weight: 70 }],
    })
    const first = evaluateFlag(flag, 'user-99').variant
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag, 'user-99').variant).toBe(first)
    }
  })

  it('produces a roughly weighted split across variants at configured weights', () => {
    const flag = baseFlag({
      rolloutPercent: 100,
      variants: [{ key: 'a', weight: 20 }, { key: 'b', weight: 80 }],
    })
    let bCount = 0
    const total = 2000
    for (let i = 0; i < total; i++) {
      if (evaluateFlag(flag, `user-${i}`).variant === 'b') bCount++
    }
    // Expect roughly 80% — allow a wide band for hash variance.
    expect(bCount).toBeGreaterThan(total * 0.65)
    expect(bCount).toBeLessThan(total * 0.95)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/core-api-service && npx vitest run tests/flag-evaluation.test.ts`
Expected: FAIL — `Cannot find module '../src/flag-evaluation'`

- [ ] **Step 3: Write the implementation**

```typescript
// services/core-api-service/src/flag-evaluation.ts
import { createHash } from 'crypto'

export interface FeatureFlagVariant {
  key: string
  weight: number
}

export interface FeatureFlag {
  key: string
  enabled: boolean
  rolloutPercent: number
  enabledUserIds: string[]
  variants: FeatureFlagVariant[] | null
}

export interface FlagResult {
  enabled: boolean
  variant?: string
}

// Deterministic 0-99 bucket for a (userId, salt) pair — the same inputs
// always produce the same bucket, so a user's on/off/variant state never
// flip-flops between requests. sha256 avoids the poor distribution of
// simple string-sum hashes.
function bucket(userId: string, salt: string): number {
  const hash = createHash('sha256').update(`${userId}:${salt}`).digest()
  // First 4 bytes as an unsigned 32-bit int, mod 100.
  return hash.readUInt32BE(0) % 100
}

function assignVariant(flag: FeatureFlag, userId: string): string | undefined {
  if (!flag.variants || flag.variants.length === 0) return undefined
  const totalWeight = flag.variants.reduce((sum, v) => sum + v.weight, 0)
  const roll = bucket(userId, `${flag.key}:variant`) % totalWeight
  let cumulative = 0
  for (const v of flag.variants) {
    cumulative += v.weight
    if (roll < cumulative) return v.key
  }
  return flag.variants[flag.variants.length - 1].key // fallback for rounding edge cases
}

export function evaluateFlag(flag: FeatureFlag, userId: string): FlagResult {
  if (!flag.enabled) return { enabled: false }

  const allowlisted = flag.enabledUserIds.includes(userId)
  const inRollout = bucket(userId, flag.key) < flag.rolloutPercent
  const on = allowlisted || inRollout

  if (!on) return { enabled: false }
  const variant = assignVariant(flag, userId)
  return variant !== undefined ? { enabled: true, variant } : { enabled: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/core-api-service && npx vitest run tests/flag-evaluation.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/flag-evaluation.ts services/core-api-service/tests/flag-evaluation.test.ts
git commit -m "feat(core-api-service): deterministic feature-flag evaluation"
```

---

## Task 3: Player-facing analytics plugin (events + flags)

**Files:**
- Create: `services/core-api-service/src/plugins/analytics.ts`
- Modify: `services/core-api-service/src/index.ts`

**Interfaces:**
- Consumes: `evaluateFlag` from `../flag-evaluation` (Task 2).
- Produces: `POST /events`, `GET /flags` routes, registered as `analyticsPlugin(db)`.

- [ ] **Step 1: Write the plugin**

```typescript
// services/core-api-service/src/plugins/analytics.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import { evaluateFlag, FeatureFlag } from '../flag-evaluation'

// Player-facing event tracking + feature-flag evaluation. See
// docs/superpowers/specs/2026-07-21-product-analytics-design.md
export function analyticsPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    // POST /events tolerates an unauthenticated caller (pre-login events,
    // e.g. "app_opened" before signup) — user_id is nullable, so we attempt
    // jwtVerify but never reject on failure, unlike app.authenticate.
    app.post('/events', async (req, reply) => {
      const body = z.object({
        event_name: z.string().min(1).max(100),
        properties: z.record(z.any()).optional(),
      }).parse(req.body)

      let userId: string | null = null
      try {
        await req.jwtVerify()
        userId = (req.user as any)?.sub ?? null
      } catch {
        // Not logged in — user_id stays null, which the schema allows.
      }

      await db.query(
        `INSERT INTO product_events (user_id, event_name, properties, source) VALUES ($1, $2, $3, 'mobile')`,
        [userId, body.event_name, JSON.stringify(body.properties || {})]
      )
      return reply.send({ success: true })
    })

    // GET /flags requires a logged-in player — evaluated once per app launch
    // and cached client-side, not called per screen/check.
    app.get('/flags', { onRequest: [app.authenticate] }, async (req, reply) => {
      const userId = (req.user as any).sub
      const flagsRes = await db.query(
        `SELECT key, enabled, rollout_percent, enabled_user_ids, variants FROM feature_flags`
      )
      const results: Record<string, { enabled: boolean; variant?: string }> = {}
      for (const row of flagsRes.rows) {
        const flag: FeatureFlag = {
          key: row.key,
          enabled: row.enabled,
          rolloutPercent: row.rollout_percent,
          enabledUserIds: row.enabled_user_ids || [],
          variants: row.variants,
        }
        results[row.key] = evaluateFlag(flag, userId)
      }
      return reply.send(results)
    })
  }
}
```

- [ ] **Step 2: Wire into `index.ts`**

In `services/core-api-service/src/index.ts`, add the import after the other plugin imports (after `import { seoMarketingPlugin } from './plugins/seo-marketing'` or wherever the last plugin import is):

```typescript
import { analyticsPlugin } from './plugins/analytics'
```

And register it after `await app.register(bettingPlugin(bettingDb))` (line 78):

```typescript
  await app.register(analyticsPlugin(db))
```

- [ ] **Step 3: Verify it builds**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

With the service running locally against a dev DB:

```bash
curl -X POST http://127.0.0.1:3001/events -H "Content-Type: application/json" \
  -d '{"event_name":"app_opened","properties":{"platform":"android"}}'
```
Expected: `200 {"success":true}`, and `SELECT * FROM product_events ORDER BY created_at DESC LIMIT 1` shows a row with `user_id` NULL (no auth token sent) and `source='mobile'`.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/plugins/analytics.ts services/core-api-service/src/index.ts
git commit -m "feat(core-api-service): player-facing event tracking and flag evaluation routes"
```

---

## Task 4: nginx routing for the new endpoints

**Files:**
- Modify: `infra/nginx/game.myonlinejoker.com.conf`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `/api/analytics/*` publicly reachable, proxied to `core-api-service`. Required for Task 3's routes and Task 8's mobile client to be reachable at all in production.

- [ ] **Step 1: Add the location block**

In `infra/nginx/game.myonlinejoker.com.conf`, add a new block following the exact style of the existing `/api/betting/` block (find it and place this immediately after it):

```nginx
# ── Product Analytics (events + feature flags) → core-api ──
location /api/analytics/ {
    rewrite ^/api/analytics/(.*) /$1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- [ ] **Step 2: Verify the rewrite is correct**

Confirm the `rewrite` strips exactly the `/api/analytics/` prefix so `/api/analytics/events` → `/events` and `/api/analytics/flags` → `/flags`, matching Task 3's route paths exactly (no leading prefix in the Fastify plugin).

- [ ] **Step 3: Commit**

```bash
git add infra/nginx/game.myonlinejoker.com.conf
git commit -m "feat(nginx): route /api/analytics/ to core-api-service"
```

*(Note: this file is a tracked reference copy — deploying it means copying the changed block into the live config at `/home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf_api` on the VPS and reloading nginx, the same way other nginx changes in this repo have been deployed.)*

---

## Task 5: Admin-facing analytics routes

**Files:**
- Create: `services/admin-service/src/analytics-routes.ts`
- Modify: `services/admin-service/src/index.ts`

**Interfaces:**
- Consumes: `product_events`, `feature_flags` tables (Task 1). Does not depend on Task 2/3's code directly — flag CRUD here only reads/writes raw flag config; evaluation happens client-side (core-api-service).
- Produces: registers routes under `/api/admin/analytics/*`, all `requireRole('superadmin')` except the dashboards which are `requireRole('finance')` (read-only, matches the existing pattern where finance staff can view money-adjacent dashboards).

- [ ] **Step 1: Write the route module**

```typescript
// services/admin-service/src/analytics-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Staff-facing dashboards + feature-flag CRUD. See
// docs/superpowers/specs/2026-07-21-product-analytics-design.md
export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  // GET /api/admin/analytics/funnels/deposit?days=7
  app.get('/api/admin/analytics/funnels/deposit', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(90).default(7) }).parse(req.query)
    const res = await db.query(
      `SELECT event_name, COUNT(*)::int AS count
       FROM product_events
       WHERE source = 'mobile'
         AND event_name IN ('deposit_screen_opened', 'deposit_submitted')
         AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY event_name`,
      [days]
    )
    const opened = res.rows.find(r => r.event_name === 'deposit_screen_opened')?.count || 0
    const submitted = res.rows.find(r => r.event_name === 'deposit_submitted')?.count || 0
    return reply.send({
      days,
      deposit_screen_opened: opened,
      deposit_submitted: submitted,
      conversion_rate: opened > 0 ? Number((submitted / opened * 100).toFixed(1)) : 0,
    })
  })

  // GET /api/admin/analytics/funnels/onboarding?days=30
  // Computed entirely from existing tables — no product_events involved.
  app.get('/api/admin/analytics/funnels/onboarding', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(180).default(30) }).parse(req.query)
    const res = await db.query(
      `SELECT
         COUNT(*)::int AS signups,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type = 'deposit'
         ))::int AS deposited,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt WHERE wt.user_id = u.id AND wt.type = 'game_debit'
         ))::int AS placed_bet
       FROM users u
       WHERE u.created_at >= NOW() - ($1 || ' days')::interval`,
      [days]
    )
    const row = res.rows[0]
    return reply.send({
      days,
      signups: row.signups,
      deposited: row.deposited,
      placed_bet: row.placed_bet,
      signup_to_deposit_rate: row.signups > 0 ? Number((row.deposited / row.signups * 100).toFixed(1)) : 0,
      deposit_to_bet_rate: row.deposited > 0 ? Number((row.placed_bet / row.deposited * 100).toFixed(1)) : 0,
    })
  })

  // GET /api/admin/analytics/retention?days=30
  // Agent-referred vs. direct-signup retention — computed entirely from
  // existing tables, no product_events involved.
  app.get('/api/admin/analytics/retention', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(180).default(30) }).parse(req.query)
    const res = await db.query(
      `SELECT
         (u.agent_id IS NOT NULL) AS is_agent_referred,
         COUNT(*)::int AS cohort_size,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM wallet_transactions wt
           WHERE wt.user_id = u.id AND wt.created_at >= u.created_at + INTERVAL '7 days'
         ))::int AS active_after_week_1
       FROM users u
       WHERE u.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY is_agent_referred`,
      [days]
    )
    return reply.send(res.rows.map(r => ({
      cohort: r.is_agent_referred ? 'agent_referred' : 'direct_signup',
      cohort_size: r.cohort_size,
      active_after_week_1: r.active_after_week_1,
      retention_rate: r.cohort_size > 0 ? Number((r.active_after_week_1 / r.cohort_size * 100).toFixed(1)) : 0,
    })))
  })

  // GET /api/admin/analytics/flags
  app.get('/api/admin/analytics/flags', { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT id, key, description, enabled, rollout_percent, enabled_user_ids, variants, created_at, updated_at FROM feature_flags ORDER BY created_at DESC`
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/analytics/flags
  app.post('/api/admin/analytics/flags', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const body = z.object({
      key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers, underscores only'),
      description: z.string().optional(),
      enabled: z.boolean().default(false),
      rollout_percent: z.number().min(0).max(100).default(0),
      enabled_user_ids: z.array(z.string().uuid()).default([]),
      variants: z.array(z.object({ key: z.string(), weight: z.number().min(1) })).nullable().optional(),
    }).parse(req.body)

    const existing = await db.query('SELECT id FROM feature_flags WHERE key = $1', [body.key])
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Flag key already exists' })

    const res = await db.query(
      `INSERT INTO feature_flags (key, description, enabled, rollout_percent, enabled_user_ids, variants, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [body.key, body.description || null, body.enabled, body.rollout_percent, body.enabled_user_ids, body.variants ? JSON.stringify(body.variants) : null, admin.sub]
    )
    return reply.code(201).send({ id: res.rows[0].id })
  })

  // PATCH /api/admin/analytics/flags/:id
  app.patch('/api/admin/analytics/flags/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const body = z.object({
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      rollout_percent: z.number().min(0).max(100).optional(),
      enabled_user_ids: z.array(z.string().uuid()).optional(),
      variants: z.array(z.object({ key: z.string(), weight: z.number().min(1) })).nullable().optional(),
    }).parse(req.body)

    const sets: string[] = []
    const params: any[] = []
    const colFor: Record<string, string> = { description: 'description', enabled: 'enabled', rollout_percent: 'rollout_percent', enabled_user_ids: 'enabled_user_ids', variants: 'variants' }
    for (const [key, col] of Object.entries(colFor)) {
      const val = (body as any)[key]
      if (val !== undefined) {
        params.push(key === 'variants' ? (val ? JSON.stringify(val) : null) : val)
        sets.push(`${col} = $${params.length}`)
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' })
    sets.push('updated_at = NOW()')
    params.push(id)
    const res = await db.query(`UPDATE feature_flags SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
    if (res.rowCount === 0) return reply.code(404).send({ error: 'Flag not found' })
    return reply.send({ success: true })
  })

  // GET /api/admin/analytics/ab-results/:flagKey
  // Compares conversion (deposit_submitted) rate per variant, tagged on
  // events by the mobile client after calling GET /flags.
  app.get('/api/admin/analytics/ab-results/:flagKey', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { flagKey } = req.params as any
    const res = await db.query(
      `SELECT properties->>'variant' AS variant,
              COUNT(*) FILTER (WHERE event_name = 'deposit_screen_opened')::int AS exposures,
              COUNT(*) FILTER (WHERE event_name = 'deposit_submitted')::int AS conversions
       FROM product_events
       WHERE properties->>'flag_key' = $1
       GROUP BY variant`,
      [flagKey]
    )
    return reply.send(res.rows.map(r => ({
      variant: r.variant,
      exposures: r.exposures,
      conversions: r.conversions,
      conversion_rate: r.exposures > 0 ? Number((r.conversions / r.exposures * 100).toFixed(1)) : 0,
    })))
  })

  // POST /api/admin/analytics/events — admin-panel usage tracking
  app.post('/api/admin/analytics/events', { onRequest: [authenticate] }, async (req, reply) => {
    const admin = req.user as any
    const body = z.object({ event_name: z.string().min(1).max(100), properties: z.record(z.any()).optional() }).parse(req.body)
    await db.query(
      `INSERT INTO product_events (user_id, event_name, properties, source) VALUES ($1, $2, $3, 'admin_panel')`,
      [admin.sub, body.event_name, JSON.stringify(body.properties || {})]
    )
    return reply.send({ success: true })
  })
}
```

- [ ] **Step 2: Wire into `index.ts`**

In `services/admin-service/src/index.ts`, add the import after the `registerAgentPortalRoutes` import:

```typescript
import { registerAnalyticsRoutes } from './analytics-routes'
```

And register it after `await registerAgentPortalRoutes(app, db, authenticate)`:

```typescript
  await registerAnalyticsRoutes(app, db, authenticate, requireRole)
```

- [ ] **Step 3: Verify it builds**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

With a valid superadmin JWT:

```bash
curl -X POST http://127.0.0.1:3008/api/admin/analytics/flags \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"test_flag","description":"smoke test","enabled":true,"rollout_percent":50}'
```
Expected: `201` with `{id}`. Then `GET /api/admin/analytics/funnels/onboarding?days=30` returns `200` with signup/deposit/bet counts (zeros are fine if no data in range).

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/analytics-routes.ts services/admin-service/src/index.ts
git commit -m "feat(admin-service): analytics dashboards and feature-flag CRUD routes"
```

---

## Task 6: Admin-panel Analytics page

**Files:**
- Create: `admin-panel/src/pages/Analytics.tsx`
- Modify: `admin-panel/src/main.tsx`

**Interfaces:**
- Consumes: `adminApi` from `admin-panel/src/api/client.ts`, the routes from Task 5.
- Produces: `/admin/analytics` route.

- [ ] **Step 1: Write the page**

```tsx
// admin-panel/src/pages/Analytics.tsx
import { useEffect, useState } from 'react'
import { Tabs, Card, Statistic, Row, Col, Table, Button, Modal, Form, Input, InputNumber, Switch, Select, message, Popconfirm, Tag } from 'antd'
import { adminApi } from '../api/client'

export default function Analytics() {
  return (
    <Tabs
      items={[
        { key: 'deposit', label: 'Deposit Funnel', children: <DepositFunnel /> },
        { key: 'onboarding', label: 'Onboarding Funnel', children: <OnboardingFunnel /> },
        { key: 'retention', label: 'Retention Cohorts', children: <Retention /> },
        { key: 'flags', label: 'Feature Flags', children: <FeatureFlags /> },
      ]}
    />
  )
}

function DepositFunnel() {
  const [data, setData] = useState<any>(null)
  useEffect(() => { adminApi.get('/analytics/funnels/deposit', { params: { days: 7 } }).then(r => setData(r.data)) }, [])
  if (!data) return null
  return (
    <Row gutter={16}>
      <Col span={6}><Card><Statistic title="Deposit Screen Opened (7d)" value={data.deposit_screen_opened} /></Card></Col>
      <Col span={6}><Card><Statistic title="Deposit Submitted (7d)" value={data.deposit_submitted} /></Card></Col>
      <Col span={6}><Card><Statistic title="Conversion Rate" value={data.conversion_rate} suffix="%" /></Card></Col>
    </Row>
  )
}

function OnboardingFunnel() {
  const [data, setData] = useState<any>(null)
  useEffect(() => { adminApi.get('/analytics/funnels/onboarding', { params: { days: 30 } }).then(r => setData(r.data)) }, [])
  if (!data) return null
  return (
    <Row gutter={16}>
      <Col span={6}><Card><Statistic title="Signups (30d)" value={data.signups} /></Card></Col>
      <Col span={6}><Card><Statistic title="Deposited" value={data.deposited} /></Card></Col>
      <Col span={6}><Card><Statistic title="Placed a Bet" value={data.placed_bet} /></Card></Col>
      <Col span={6}><Card><Statistic title="Signup → Deposit" value={data.signup_to_deposit_rate} suffix="%" /></Card></Col>
    </Row>
  )
}

function Retention() {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { adminApi.get('/analytics/retention', { params: { days: 30 } }).then(r => setRows(r.data)) }, [])
  return (
    <Table
      rowKey="cohort"
      dataSource={rows}
      columns={[
        { title: 'Cohort', dataIndex: 'cohort', render: (v: string) => v === 'agent_referred' ? 'Agent-Referred' : 'Direct Signup' },
        { title: 'Cohort Size', dataIndex: 'cohort_size' },
        { title: 'Active After Week 1', dataIndex: 'active_after_week_1' },
        { title: 'Retention Rate', dataIndex: 'retention_rate', render: (v: number) => `${v}%` },
      ]}
    />
  )
}

function FeatureFlags() {
  const [flags, setFlags] = useState<any[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()

  const load = () => adminApi.get('/analytics/flags').then(r => setFlags(r.data))
  useEffect(() => { load() }, [])

  const createFlag = async (values: any) => {
    try {
      await adminApi.post('/analytics/flags', values)
      message.success('Flag created')
      setModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create flag')
    }
  }

  const updateRollout = async (id: string, rollout_percent: number) => {
    try {
      await adminApi.patch(`/analytics/flags/${id}`, { rollout_percent })
      message.success('Rollout updated')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update')
    }
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await adminApi.patch(`/analytics/flags/${id}`, { enabled })
      message.success(enabled ? 'Flag enabled' : 'Flag disabled')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to update')
    }
  }

  return (
    <div>
      <Button type="primary" onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>New Flag</Button>
      <Table
        rowKey="id"
        dataSource={flags}
        columns={[
          { title: 'Key', dataIndex: 'key' },
          { title: 'Description', dataIndex: 'description' },
          {
            title: 'Enabled', dataIndex: 'enabled', render: (v: boolean, r: any) => (
              <Popconfirm title={`${v ? 'Disable' : 'Enable'} this flag?`} onConfirm={() => toggleEnabled(r.id, !v)}>
                <Switch checked={v} />
              </Popconfirm>
            ),
          },
          {
            title: 'Rollout %', dataIndex: 'rollout_percent', render: (v: number, r: any) => (
              <InputNumber min={0} max={100} defaultValue={v} onPressEnter={(e: any) => updateRollout(r.id, Number(e.target.value))} onBlur={(e: any) => updateRollout(r.id, Number(e.target.value))} />
            ),
          },
          { title: 'Variants', dataIndex: 'variants', render: (v: any) => v ? v.map((x: any) => <Tag key={x.key}>{x.key}:{x.weight}</Tag>) : '—' },
        ]}
      />

      <Modal title="New Feature Flag" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={createFlag}>
          <Form.Item name="key" label="Key (lowercase, underscores)" rules={[{ required: true, pattern: /^[a-z0-9_]+$/ }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input /></Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
          <Form.Item name="rollout_percent" label="Rollout %" initialValue={0}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Wire into the router**

In `admin-panel/src/main.tsx`, add the lazy import after the `Agents` import:

```typescript
const Analytics = React.lazy(() => import('./pages/Analytics'))
```

And add the route inside the `/admin` route block, after `<Route path="agents" element={<Agents />} />`:

```tsx
            <Route path="analytics" element={<Analytics />} />
```

- [ ] **Step 3: Verify it builds**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, log in as superadmin, navigate to `/admin/analytics`. Expected: all 4 tabs load without error (zeros/empty tables are fine with no data yet), "New Flag" modal creates a flag, toggling Enabled and editing Rollout % both persist after a page refresh.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/Analytics.tsx admin-panel/src/main.tsx
git commit -m "feat(admin-panel): Analytics module — funnels, retention, feature flags"
```

---

## Task 7: Sidebar link for the Analytics module

**Files:**
- Modify: `admin-panel/src/pages/Layout.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing later depends on this — makes Task 6's page reachable from the nav instead of only by direct URL.

- [ ] **Step 1: Find the existing nav item array**

Run: `grep -n "path: '/admin/agents'\|/admin/agents" admin-panel/src/pages/Layout.tsx`

This locates the Agents menu item added in the prior Agent-system feature — add the new Analytics item using the exact same shape immediately after it.

- [ ] **Step 2: Add the nav entry**

Add an entry for `/admin/analytics` following the exact structure of the `/admin/agents` entry found in Step 1 — same icon-import style, same object shape — change only the `key`/`label`/`path` fields to `'analytics'` / `'Analytics'` / `/admin/analytics`. Pick an icon distinct from any already used in the file (e.g. `LineChartOutlined` from `@ant-design/icons`, adding the import alongside the file's other icon imports if not already present).

- [ ] **Step 3: Verify it builds and renders**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

Run `npm run dev`, log in as superadmin. Expected: "Analytics" appears in the sidebar and navigates to the Task 6 page.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/Layout.tsx
git commit -m "feat(admin-panel): add Analytics module to the sidebar nav"
```

---

## Task 8: Mobile ProductAnalytics service

**Files:**
- Create: `mobile/lib/core/analytics/product_analytics.dart`
- Modify: `mobile/lib/main.dart`

**Interfaces:**
- Consumes: `ApiClient` from `mobile/lib/core/network/api_client.dart` (existing).
- Produces: `ProductAnalytics.instance.init()`, `ProductAnalytics.instance.track(event, properties)`, `ProductAnalytics.instance.isEnabled(flagKey)` — used by Task 9's deposit-flow instrumentation.

- [ ] **Step 1: Write the service**

```dart
// mobile/lib/core/analytics/product_analytics.dart
import '../network/api_client.dart';

/// Product analytics: event tracking + feature-flag evaluation. Mirrors the
/// singleton-init pattern used by MonitorService, but talks to
/// /api/analytics/* instead — a separate, lighter-weight concern (product
/// funnels/flags, not app-health telemetry).
class ProductAnalytics {
  static final ProductAnalytics instance = ProductAnalytics._();
  ProductAnalytics._();

  Map<String, dynamic> _flags = {};
  bool _initialized = false;

  /// Fetches all flag evaluations once at app launch and caches them.
  /// Call after login (flags require an authenticated player) — safe to
  /// call multiple times, only the first successful call populates the cache.
  Future<void> init() async {
    if (_initialized) return;
    try {
      final res = await ApiClient().dio.get('/api/analytics/flags');
      _flags = Map<String, dynamic>.from(res.data as Map);
      _initialized = true;
    } catch (_) {
      // Never block app startup on analytics — flags default to off.
    }
  }

  /// Fire-and-forget event log. Never throws — a tracking failure must
  /// never surface to the user or interrupt their flow.
  void track(String eventName, [Map<String, dynamic>? properties]) {
    ApiClient().dio.post('/api/analytics/events', data: {
      'event_name': eventName,
      'properties': properties ?? {},
    }).catchError((_) {
      // Swallow — analytics is best-effort.
    });
  }

  bool isEnabled(String flagKey) {
    final entry = _flags[flagKey];
    if (entry == null) return false;
    return entry['enabled'] == true;
  }

  String? variant(String flagKey) {
    final entry = _flags[flagKey];
    if (entry == null) return null;
    return entry['variant'] as String?;
  }
}
```

- [ ] **Step 2: Call `init()` after login**

Find where the app currently transitions to the logged-in/home state after a successful login (search for where `SecureStorage.saveTokens` or the home route is pushed after auth success — likely in a login/auth flow file, not `main.dart`, since flags require a logged-in player). Add:

```dart
import 'core/analytics/product_analytics.dart';
```

and call `await ProductAnalytics.instance.init();` immediately after tokens are saved on successful login, before navigating to the home screen. If you cannot find a single clear post-login hook, report DONE_WITH_CONCERNS with the file/line you considered and why — don't guess at a location that might not actually run on every login path (e.g. skip a silent-refresh path that isn't a fresh login).

- [ ] **Step 3: Verify it builds**

Run: `cd mobile && flutter analyze lib/core/analytics/product_analytics.dart`
Expected: no errors (warnings pre-existing elsewhere in the codebase are fine, per established convention this session — only new errors in this file block).

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/core/analytics/product_analytics.dart mobile/lib/main.dart
git commit -m "feat(mobile): ProductAnalytics service — event tracking + feature flags"
```

*(Note: whichever login-flow file actually got the `init()` call in Step 2 will also show as modified — include it in this commit.)*

---

## Task 9: Instrument the deposit funnel

**Files:**
- Modify: `mobile/lib/features/wallet/wallet_page.dart`

**Interfaces:**
- Consumes: `ProductAnalytics.instance.track()` from Task 8.
- Produces: `deposit_screen_opened` and `deposit_submitted` events feeding Task 5's `GET /analytics/funnels/deposit` dashboard.

- [ ] **Step 1: Track `deposit_screen_opened`**

In `mobile/lib/features/wallet/wallet_page.dart`, `_WalletPageState._openDeposit()` (around line 135) is where the deposit bottom sheet is opened. Add the import at the top of the file:

```dart
import '../../core/analytics/product_analytics.dart';
```

Then at the very start of `_openDeposit()`, before the `showModalBottomSheet` call:

```dart
  Future<void> _openDeposit() async {
    ProductAnalytics.instance.track('deposit_screen_opened');
    final ok = await showModalBottomSheet<bool>(
```

- [ ] **Step 2: Track `deposit_submitted`**

In the same file, `_DepositSheetState._submit()` (around line 390), the deposit request is POSTed at line 416-417 (`await widget.api.dio.post('/api/wallet/deposit/submit', data: form);`). Add the tracking call right after that POST succeeds (immediately before the existing `if (mounted) Navigator.pop(context, true);` at line 418):

```dart
      final res =
          await widget.api.dio.post('/api/wallet/deposit/submit', data: form);
      ProductAnalytics.instance.track('deposit_submitted', {'amount': amount});
      if (mounted) Navigator.pop(context, true);
```

- [ ] **Step 3: Verify it builds**

Run: `cd mobile && flutter analyze lib/features/wallet/wallet_page.dart`
Expected: no new errors (the file has 2 known pre-existing warnings elsewhere per project history — don't let those block; only new errors from this change matter).

- [ ] **Step 4: Manual verification**

With the app pointed at a dev backend running Tasks 1-4, open the Wallet page, tap Deposit (opens the sheet) — confirm a `deposit_screen_opened` row appears in `product_events`. Fill in and submit a test deposit — confirm a `deposit_submitted` row appears with `properties.amount` matching what was entered.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/features/wallet/wallet_page.dart
git commit -m "feat(mobile): instrument deposit funnel with ProductAnalytics events"
```

---

## Self-Review Notes

**Spec coverage:** deposit funnel (Task 9 events + Task 5 dashboard), onboarding funnel (Task 5, zero new instrumentation as designed), retention cohorts (Task 5, zero new instrumentation), feature flags with rollout% + allowlist (Tasks 1/2/3/5/6), A/B testing (Task 5's `ab-results` route, keyed on a `flag_key`/`variant` convention in event `properties` — see note below), admin-panel usage tracking (Task 5's `POST /analytics/events`, not separately wired to any admin-panel click yet — the endpoint exists per spec but instrumenting specific admin-panel actions was not called out as a concrete gap worth specific tasks; add `adminApi.post('/analytics/events', ...)` calls at specific points if/when a concrete question arises, following Task 9's pattern).

**A/B testing wiring note:** Task 5's `ab-results` route expects events tagged with `properties.flag_key` and `properties.variant`. This plan does not include a task that actually tags an event this way, because no concrete A/B test was in scope yet (the spec calls for the *capability*, not a specific experiment). When a real experiment is run, the pattern is: call `ProductAnalytics.instance.variant('some_flag')` after `init()`, include `{'flag_key': 'some_flag', 'variant': variant}` in the `properties` of whatever conversion event is being compared (e.g. `deposit_submitted`), and the existing `ab-results` route will aggregate it — no backend changes needed at that point.

**Deferred (per spec, not in this plan):** session replay.

