# Agent / Sub-Agent Commission System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, admin-created "Agent" role that recruits players (and sub-agents, capped at 3 hierarchy levels), earns daily-settled override commission on its network's net house win, and can request payout of its earned balance.

**Architecture:** All backend logic lives inside the existing `admin-service` (reuses its auth/role infrastructure — no new microservice). Commission is computed from the existing `wallet_transactions` ledger, so no game engine is touched. Agents have their own identity table (not `users`) and their own balance/payout tables (not `wallets`), mirroring the existing player withdrawal pattern. Two new admin-panel surfaces: a superadmin "Agents" module, and a separate restricted "agent-panel" login for agents themselves.

**Tech Stack:** Fastify + Zod + `pg` (admin-service, matches existing style), PostgreSQL migrations, Vitest for unit tests, React + Ant Design + Zustand (admin-panel, matches existing style).

## Global Constraints

- No changes to any game engine (Teen Patti, Aviator, Ludo, Lottery, Matka, Cricket are locked — see project memory). Net win/loss is read from `wallet_transactions` only.
- Hierarchy depth capped at 3 levels (Master Agent → Sub-Agent → Player). Enforced server-side at agent creation, not just in the UI.
- Commission floored at zero per agent per day. No carry-forward, no debt.
- Agent minimum payout amount: ₹100 (same floor as the existing player withdrawal minimum in `wallet-service/src/index.ts:461`).
- Spec: `docs/superpowers/specs/2026-07-20-agent-commission-system-design.md`

---

## Task 1: Database schema

**Files:**
- Create: `infra/db/migrations/082_agent_commission_system.sql`

**Interfaces:**
- Produces: tables `agents`, `agent_commission_ledger`, `agent_wallets`, `agent_payouts`; `users.agent_id` column. All later tasks depend on these exact column names.

- [ ] **Step 1: Write the migration**

```sql
-- Agent / sub-agent commission system. Agents are a separate identity
-- (not `users`) — they don't need to be registered players. Commission is
-- computed from the existing wallet_transactions ledger, so no game engine
-- changes are needed. See docs/superpowers/specs/2026-07-20-agent-commission-system-design.md

CREATE TABLE agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username          VARCHAR(50) UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  display_name      VARCHAR(100) NOT NULL,
  phone             VARCHAR(20),
  status            VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  parent_agent_id   UUID REFERENCES agents(id),
  commission_rate   NUMERIC(5,2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
  referral_code     VARCHAR(20) UNIQUE NOT NULL,
  created_by        UUID NOT NULL REFERENCES admin_users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_parent_agent_id ON agents(parent_agent_id);
CREATE INDEX idx_agents_referral_code ON agents(referral_code);

CREATE TABLE agent_commission_ledger (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id              UUID NOT NULL REFERENCES agents(id),
  date                  DATE NOT NULL,
  direct_commission     NUMERIC(15,2) NOT NULL DEFAULT 0,
  override_commission   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_commission      NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                VARCHAR(20) NOT NULL DEFAULT 'settled' CHECK (status IN ('settled', 'voided')),
  flagged_for_review    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, date)
);

CREATE INDEX idx_agent_ledger_agent_id ON agent_commission_ledger(agent_id);
CREATE INDEX idx_agent_ledger_date ON agent_commission_ledger(date);

CREATE TABLE agent_wallets (
  agent_id        UUID PRIMARY KEY REFERENCES agents(id),
  balance         NUMERIC(15,2) NOT NULL DEFAULT 0,
  locked_balance  NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_earned    NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_paid_out  NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id),
  amount        NUMERIC(15,2) NOT NULL CHECK (amount >= 100),
  metadata      JSONB,
  status        VARCHAR(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'rejected')),
  reference     TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  processed_by  UUID REFERENCES admin_users(id)
);

CREATE INDEX idx_agent_payouts_agent_id ON agent_payouts(agent_id);
CREATE INDEX idx_agent_payouts_status ON agent_payouts(status);

ALTER TABLE users ADD COLUMN agent_id UUID REFERENCES agents(id);
CREATE INDEX idx_users_agent_id ON users(agent_id);
```

- [ ] **Step 2: Apply the migration locally and verify**

Run: `psql "$DATABASE_URL" -f infra/db/migrations/082_agent_commission_system.sql`
Expected: `CREATE TABLE` ×4, `CREATE INDEX` ×6, `ALTER TABLE`, no errors.

Verify: `psql "$DATABASE_URL" -c "\d agents"` shows all columns above.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/082_agent_commission_system.sql
git commit -m "feat(db): add agent/sub-agent commission system schema"
```

---

## Task 2: Hierarchy validation (pure function + tests)

**Files:**
- Create: `services/admin-service/src/agent-hierarchy.ts`
- Test: `services/admin-service/tests/agent-hierarchy.test.ts`

**Interfaces:**
- Produces: `validateNewAgentParent(agents: {id: string, parentAgentId: string | null}[], parentAgentId: string | null): {ok: true} | {ok: false, error: string}` — used by Task 4's create-agent route.
- Produces: `validateRateAssignment(agents: {id: string, parentAgentId: string | null, commissionRate: number}[], agentId: string | null, parentAgentId: string | null, newRate: number): {ok: true} | {ok: false, error: string}` — used by Task 4's create/edit-agent routes. `agentId` is `null` when creating a brand-new agent.

- [ ] **Step 1: Write the failing tests**

```typescript
// services/admin-service/tests/agent-hierarchy.test.ts
import { describe, it, expect } from 'vitest'
import { validateNewAgentParent, validateRateAssignment } from '../src/agent-hierarchy'

describe('validateNewAgentParent', () => {
  it('allows a top-level agent (no parent)', () => {
    expect(validateNewAgentParent([], null)).toEqual({ ok: true })
  })

  it('allows a sub-agent under a top-level agent', () => {
    const agents = [{ id: 'A', parentAgentId: null }]
    expect(validateNewAgentParent(agents, 'A')).toEqual({ ok: true })
  })

  it('rejects a sub-agent under an agent that already has a parent (would be 4th level)', () => {
    const agents = [
      { id: 'A', parentAgentId: null },
      { id: 'B', parentAgentId: 'A' },
    ]
    const result = validateNewAgentParent(agents, 'B')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/3 levels/i)
  })

  it('rejects a parent id that does not exist', () => {
    const result = validateNewAgentParent([], 'nonexistent')
    expect(result.ok).toBe(false)
  })
})

describe('validateRateAssignment', () => {
  it('allows a rate with no parent', () => {
    expect(validateRateAssignment([], null, null, 20)).toEqual({ ok: true })
  })

  it('allows a sub-agent rate lower than its parent rate', () => {
    const agents = [{ id: 'A', parentAgentId: null, commissionRate: 25 }]
    expect(validateRateAssignment(agents, null, 'A', 20)).toEqual({ ok: true })
  })

  it('rejects a sub-agent rate equal to its parent rate (zero override)', () => {
    const agents = [{ id: 'A', parentAgentId: null, commissionRate: 25 }]
    const result = validateRateAssignment(agents, null, 'A', 25)
    expect(result.ok).toBe(false)
  })

  it('rejects a sub-agent rate higher than its parent rate', () => {
    const agents = [{ id: 'A', parentAgentId: null, commissionRate: 25 }]
    const result = validateRateAssignment(agents, null, 'A', 30)
    expect(result.ok).toBe(false)
  })

  it('rejects lowering an existing agent rate below one of its own sub-agents', () => {
    const agents = [
      { id: 'A', parentAgentId: null, commissionRate: 25 },
      { id: 'B', parentAgentId: 'A', commissionRate: 20 },
    ]
    // Editing A's own rate down to 18 — below B's 20 — must be rejected.
    const result = validateRateAssignment(agents, 'A', null, 18)
    expect(result.ok).toBe(false)
  })

  it('allows raising an existing agent rate above its sub-agents', () => {
    const agents = [
      { id: 'A', parentAgentId: null, commissionRate: 25 },
      { id: 'B', parentAgentId: 'A', commissionRate: 20 },
    ]
    const result = validateRateAssignment(agents, 'A', null, 30)
    expect(result.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/admin-service && npx vitest run tests/agent-hierarchy.test.ts`
Expected: FAIL — `Cannot find module '../src/agent-hierarchy'`

- [ ] **Step 3: Write the implementation**

```typescript
// services/admin-service/src/agent-hierarchy.ts

export interface AgentParentRef {
  id: string
  parentAgentId: string | null
}

export interface AgentRateRef {
  id: string
  parentAgentId: string | null
  commissionRate: number
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

// Max hierarchy depth is 3: a top-level agent (parentAgentId=null), its
// sub-agents, and no deeper. So a new agent may only be parented under an
// agent that is itself top-level.
export function validateNewAgentParent(
  agents: AgentParentRef[],
  parentAgentId: string | null,
): ValidationResult {
  if (parentAgentId === null) return { ok: true }
  const parent = agents.find(a => a.id === parentAgentId)
  if (!parent) return { ok: false, error: 'Parent agent not found' }
  if (parent.parentAgentId !== null) {
    return { ok: false, error: 'Cannot create a sub-agent under a sub-agent — hierarchy is capped at 3 levels' }
  }
  return { ok: true }
}

// An upline's rate must always be strictly greater than every one of its
// direct sub-agents' rates (the override model requires a positive
// rate difference — see docs/superpowers/specs/2026-07-20-agent-commission-system-design.md).
// Call with agentId=null when creating a new agent (nothing to check below it yet).
export function validateRateAssignment(
  agents: AgentRateRef[],
  agentId: string | null,
  parentAgentId: string | null,
  newRate: number,
): ValidationResult {
  if (parentAgentId !== null) {
    const parent = agents.find(a => a.id === parentAgentId)
    if (parent && newRate >= parent.commissionRate) {
      return { ok: false, error: `Rate must be lower than parent agent's rate (${parent.commissionRate}%)` }
    }
  }
  if (agentId !== null) {
    const subAgents = agents.filter(a => a.parentAgentId === agentId)
    const tooHigh = subAgents.find(sub => newRate <= sub.commissionRate)
    if (tooHigh) {
      return { ok: false, error: `Rate must be higher than sub-agent ${tooHigh.id}'s rate (${tooHigh.commissionRate}%)` }
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/admin-service && npx vitest run tests/agent-hierarchy.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/agent-hierarchy.ts services/admin-service/tests/agent-hierarchy.test.ts
git commit -m "feat(admin-service): agent hierarchy depth and rate validation"
```

---

## Task 3: Settlement calculation (pure function + tests)

**Files:**
- Create: `services/admin-service/src/agent-settlement.ts`
- Test: `services/admin-service/tests/agent-settlement.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure, standalone).
- Produces: `calculateDailySettlement(agents: AgentNode[], playerLosses: PlayerNetLoss[]): AgentSettlementResult[]` — used by Task 6's settlement job.

- [ ] **Step 1: Write the failing tests**

```typescript
// services/admin-service/tests/agent-settlement.test.ts
import { describe, it, expect } from 'vitest'
import { calculateDailySettlement, AgentNode, PlayerNetLoss } from '../src/agent-settlement'

describe('calculateDailySettlement', () => {
  it('single agent, single player who lost money: rate% of the loss', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    const losses: PlayerNetLoss[] = [{ agentId: 'A', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    expect(result).toEqual([{ agentId: 'A', directCommission: 200, overrideCommission: 0, totalCommission: 200 }])
  })

  it('floors at zero when the agent\'s players collectively won money that day', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    const losses: PlayerNetLoss[] = [{ agentId: 'A', netHouseWin: -500 }]
    const result = calculateDailySettlement(agents, losses)
    expect(result).toEqual([{ agentId: 'A', directCommission: 0, overrideCommission: 0, totalCommission: 0 }])
  })

  it('nets multiple players under the same agent before flooring', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    // Player 1 lost 1000, player 2 won 300 -> net pool 700 -> commission 140
    const losses: PlayerNetLoss[] = [
      { agentId: 'A', netHouseWin: 1000 },
      { agentId: 'A', netHouseWin: -300 },
    ]
    const result = calculateDailySettlement(agents, losses)
    expect(result[0].totalCommission).toBe(140)
  })

  it('two-level override: upline earns the rate difference on the sub-agent\'s pool', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 25, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 20, status: 'active' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'SUB', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    const sub = result.find(r => r.agentId === 'SUB')!
    const master = result.find(r => r.agentId === 'MASTER')!
    expect(sub).toEqual({ agentId: 'SUB', directCommission: 200, overrideCommission: 0, totalCommission: 200 })
    // (25% - 20%) * 1000 = 50
    expect(master).toEqual({ agentId: 'MASTER', directCommission: 0, overrideCommission: 50, totalCommission: 50 })
  })

  it('three-level override cascade: each level earns the difference down to the player pool', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 30, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 25, status: 'active' },
      { id: 'PLAYERAGENT', parentAgentId: 'SUB', commissionRate: 20, status: 'active' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'PLAYERAGENT', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    expect(result.find(r => r.agentId === 'PLAYERAGENT')!.totalCommission).toBe(200) // 20%
    expect(result.find(r => r.agentId === 'SUB')!.totalCommission).toBe(50)          // (25-20)%
    expect(result.find(r => r.agentId === 'MASTER')!.totalCommission).toBe(50)       // (30-25)%
  })

  it('does not credit a suspended agent their own direct or override commission', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 25, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 20, status: 'suspended' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'SUB', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    const sub = result.find(r => r.agentId === 'SUB')
    expect(sub).toBeUndefined()
  })

  it('a suspended intermediate agent does not block their upline from earning override on the downline below them', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 30, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 25, status: 'suspended' },
      { id: 'PLAYERAGENT', parentAgentId: 'SUB', commissionRate: 20, status: 'active' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'PLAYERAGENT', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    // PLAYERAGENT still earns their own 20%.
    expect(result.find(r => r.agentId === 'PLAYERAGENT')!.totalCommission).toBe(200)
    // SUB is suspended — earns nothing, no ledger entry for them at all.
    expect(result.find(r => r.agentId === 'SUB')).toBeUndefined()
    // MASTER still earns (30-25)% = 50 on PLAYERAGENT's pool, computed against SUB's
    // configured rate as the reference point even though SUB itself isn't paid.
    expect(result.find(r => r.agentId === 'MASTER')!.totalCommission).toBe(50)
  })

  it('returns an empty array for no agents and no losses', () => {
    expect(calculateDailySettlement([], [])).toEqual([])
  })

  it('an agent with no player activity that day gets no ledger entry', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    const result = calculateDailySettlement(agents, [])
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/admin-service && npx vitest run tests/agent-settlement.test.ts`
Expected: FAIL — `Cannot find module '../src/agent-settlement'`

- [ ] **Step 3: Write the implementation**

```typescript
// services/admin-service/src/agent-settlement.ts

export interface AgentNode {
  id: string
  parentAgentId: string | null
  commissionRate: number // percent, e.g. 20 means 20%
  status: 'active' | 'suspended'
}

export interface PlayerNetLoss {
  agentId: string   // the player's direct agent (users.agent_id)
  netHouseWin: number // can be negative if the player won overall that day
}

export interface AgentSettlementResult {
  agentId: string
  directCommission: number
  overrideCommission: number
  totalCommission: number
}

// Computes one day's commission for every agent with activity in their
// network. Pure function — no I/O — so the settlement job (Task 6) can be a
// thin wrapper that fetches inputs from the DB and persists this output.
//
// Model: an agent earns `rate% * max(0, sum of their direct players' net
// house win)` as direct commission. Each ancestor up the chain (max 2 hops,
// hierarchy is capped at 3 levels) earns `max(0, parentRate - childRate)% *
// max(0, pool)` as override, using the SAME pool as the original leaf — this
// is the standard "override" cascade, not a re-split of the leaf's own cut.
//
// Suspended agents earn nothing (no ledger entry at all for them), but do
// NOT block the override chain above them — an active grandparent still
// earns override on a suspended parent's downline activity, computed using
// the suspended agent's own configured rate as the reference point.
export function calculateDailySettlement(
  agents: AgentNode[],
  playerLosses: PlayerNetLoss[],
): AgentSettlementResult[] {
  const agentById = new Map(agents.map(a => [a.id, a]))

  const directPoolByAgent = new Map<string, number>()
  for (const p of playerLosses) {
    directPoolByAgent.set(p.agentId, (directPoolByAgent.get(p.agentId) || 0) + p.netHouseWin)
  }

  const results = new Map<string, AgentSettlementResult>()
  const ensure = (id: string): AgentSettlementResult => {
    let r = results.get(id)
    if (!r) {
      r = { agentId: id, directCommission: 0, overrideCommission: 0, totalCommission: 0 }
      results.set(id, r)
    }
    return r
  }

  for (const [leafId, pool] of directPoolByAgent) {
    const leaf = agentById.get(leafId)
    if (!leaf) continue // pool attributed to an unknown/deleted agent id — ignore

    if (leaf.status === 'active') {
      const direct = Math.max(0, (leaf.commissionRate / 100) * pool)
      ensure(leaf.id).directCommission += direct
    }

    // Walk up the chain applying the override. Always continue the walk even
    // through a suspended ancestor, but only credit ancestors that are active.
    let child = leaf
    let parent = child.parentAgentId ? agentById.get(child.parentAgentId) : undefined
    while (parent) {
      const rateDiff = Math.max(0, parent.commissionRate - child.commissionRate)
      const overrideAmt = Math.max(0, (rateDiff / 100) * pool)
      if (parent.status === 'active') {
        ensure(parent.id).overrideCommission += overrideAmt
      }
      child = parent
      parent = child.parentAgentId ? agentById.get(child.parentAgentId) : undefined
    }
  }

  for (const r of results.values()) {
    r.totalCommission = r.directCommission + r.overrideCommission
  }

  return [...results.values()]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/admin-service && npx vitest run tests/agent-settlement.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/agent-settlement.ts services/admin-service/tests/agent-settlement.test.ts
git commit -m "feat(admin-service): daily agent commission settlement calculation"
```

---

## Task 4: Admin-facing agent CRUD routes

**Files:**
- Create: `services/admin-service/src/agent-routes.ts`
- Modify: `services/admin-service/src/index.ts`

**Interfaces:**
- Consumes: `validateNewAgentParent`, `validateRateAssignment` from `./agent-hierarchy` (Task 2).
- Produces: registers routes under `/api/admin/agents*`, all gated `requireRole('superadmin')`. No other task depends on this task's internals.

- [ ] **Step 1: Write the route module**

```typescript
// services/admin-service/src/agent-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { validateNewAgentParent, validateRateAssignment } from './agent-hierarchy'

// Superadmin-only CRUD for the agent/sub-agent commission system. See
// docs/superpowers/specs/2026-07-20-agent-commission-system-design.md
export async function registerAgentRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  function generateAgentReferralCode(): string {
    return 'AG' + crypto.randomBytes(4).toString('hex').toUpperCase()
  }

  // GET /api/admin/agents — full hierarchy, flat list with parent ids (client builds the tree)
  app.get('/api/admin/agents', { onRequest: [authenticate, requireRole('superadmin')] }, async (_req, reply) => {
    const res = await db.query(
      `SELECT a.id, a.username, a.display_name, a.phone, a.status, a.parent_agent_id,
              a.commission_rate, a.referral_code, a.created_at,
              COALESCE(w.balance, 0)::float AS balance,
              COALESCE(w.total_earned, 0)::float AS total_earned,
              (SELECT COUNT(*) FROM users u WHERE u.agent_id = a.id)::int AS player_count
       FROM agents a
       LEFT JOIN agent_wallets w ON w.agent_id = a.id
       ORDER BY a.created_at DESC`
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agents — create
  app.post('/api/admin/agents', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const body = z.object({
      username: z.string().min(3).max(50),
      password: z.string().min(6),
      display_name: z.string().min(1).max(100),
      phone: z.string().optional(),
      parent_agent_id: z.string().uuid().nullable().optional(),
      commission_rate: z.number().min(0).max(100),
    }).parse(req.body)

    const existing = await db.query('SELECT id FROM agents WHERE username = $1', [body.username])
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Username already exists' })

    const allAgentsRes = await db.query('SELECT id, parent_agent_id, commission_rate FROM agents')
    const allAgents = allAgentsRes.rows.map(r => ({ id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate) }))
    const parentAgentId = body.parent_agent_id || null

    const parentCheck = validateNewAgentParent(allAgents, parentAgentId)
    if (!parentCheck.ok) return reply.code(400).send({ error: parentCheck.error })

    const rateCheck = validateRateAssignment(allAgents, null, parentAgentId, body.commission_rate)
    if (!rateCheck.ok) return reply.code(400).send({ error: rateCheck.error })

    const passwordHash = await bcrypt.hash(body.password, 12)
    let referralCode = generateAgentReferralCode()
    // Extremely unlikely collision (4 random bytes) — retry once if it happens.
    const collision = await db.query('SELECT 1 FROM agents WHERE referral_code = $1', [referralCode])
    if (collision.rows.length > 0) referralCode = generateAgentReferralCode()

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const res = await client.query(
        `INSERT INTO agents (username, password_hash, display_name, phone, parent_agent_id, commission_rate, referral_code, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [body.username, passwordHash, body.display_name, body.phone || null, parentAgentId, body.commission_rate, referralCode, admin.sub]
      )
      const agentId = res.rows[0].id
      await client.query('INSERT INTO agent_wallets (agent_id) VALUES ($1)', [agentId])
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'create_agent', 'agent', $2, $3)`,
        [admin.sub, agentId, JSON.stringify({ username: body.username, commission_rate: body.commission_rate, parent_agent_id: parentAgentId })]
      )
      await client.query('COMMIT')
      return reply.code(201).send({ id: agentId, referral_code: referralCode })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // PATCH /api/admin/agents/:id — edit rate/status/display_name/phone
  app.patch('/api/admin/agents/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({
      display_name: z.string().min(1).max(100).optional(),
      phone: z.string().optional(),
      status: z.enum(['active', 'suspended']).optional(),
      commission_rate: z.number().min(0).max(100).optional(),
    }).parse(req.body)

    const existingRes = await db.query('SELECT id, parent_agent_id FROM agents WHERE id = $1', [id])
    if (!existingRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })

    if (body.commission_rate !== undefined) {
      const allAgentsRes = await db.query('SELECT id, parent_agent_id, commission_rate FROM agents')
      const allAgents = allAgentsRes.rows.map(r => ({ id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate) }))
      const rateCheck = validateRateAssignment(allAgents, id, existingRes.rows[0].parent_agent_id, body.commission_rate)
      if (!rateCheck.ok) return reply.code(400).send({ error: rateCheck.error })
    }

    const sets: string[] = []
    const params: any[] = []
    for (const [key, col] of [['display_name', 'display_name'], ['phone', 'phone'], ['status', 'status'], ['commission_rate', 'commission_rate']] as const) {
      const val = (body as any)[key]
      if (val !== undefined) { params.push(val); sets.push(`${col} = $${params.length}`) }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' })
    params.push(id)
    await db.query(`UPDATE agents SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'update_agent', 'agent', $2, $3)`,
      [admin.sub, id, JSON.stringify(body)]
    )
    return reply.send({ success: true })
  })

  // GET /api/admin/agents/:id/players
  app.get('/api/admin/agents/:id/players', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, username, phone, status, created_at,
              (SELECT MAX(created_at) FROM wallet_transactions WHERE user_id = users.id) AS last_active
       FROM users WHERE agent_id = $1 ORDER BY created_at DESC`,
      [id]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agents/:id/ledger
  app.get('/api/admin/agents/:id/ledger', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT id, date, direct_commission::float, override_commission::float, total_commission::float, status, flagged_for_review, created_at
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [id]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agents/:id/ledger/:ledgerId/void — fraud/error correction
  app.post('/api/admin/agents/:id/ledger/:ledgerId/void', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const admin = req.user as any
    const { id, ledgerId } = req.params as any
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const ledgerRes = await client.query(
        `SELECT total_commission FROM agent_commission_ledger WHERE id = $1 AND agent_id = $2 AND status = 'settled' FOR UPDATE`,
        [ledgerId, id]
      )
      if (!ledgerRes.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Ledger entry not found or already voided' })
      }
      const amount = parseFloat(ledgerRes.rows[0].total_commission)
      await client.query(`UPDATE agent_commission_ledger SET status = 'voided' WHERE id = $1`, [ledgerId])
      await client.query(
        `UPDATE agent_wallets SET balance = balance - $1, total_earned = total_earned - $1, updated_at = NOW() WHERE agent_id = $2`,
        [amount, id]
      )
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, 'void_agent_commission', 'agent', $2, $3)`,
        [admin.sub, id, JSON.stringify({ ledger_id: ledgerId, amount })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /api/admin/agent-payouts — pending/all payout requests, for finance review
  app.get('/api/admin/agent-payouts', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { status } = req.query as any
    const res = await db.query(
      `SELECT p.id, p.agent_id, a.display_name, a.username, p.amount::float, p.metadata, p.status, p.reference, p.requested_at, p.processed_at
       FROM agent_payouts p JOIN agents a ON a.id = p.agent_id
       WHERE p.status = $1 ORDER BY p.requested_at DESC`,
      [status || 'created']
    )
    return reply.send(res.rows)
  })

  // PATCH /api/admin/agent-payouts/:id — approve (paid) or reject
  app.patch('/api/admin/agent-payouts/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const admin = req.user as any
    const { id } = req.params as any
    const body = z.object({ status: z.enum(['paid', 'rejected']), reference: z.string().optional() }).parse(req.body)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const payoutRes = await client.query(
        `SELECT agent_id, amount FROM agent_payouts WHERE id = $1 AND status = 'created' FOR UPDATE`,
        [id]
      )
      if (!payoutRes.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Payout not found or already processed' })
      }
      const { agent_id, amount } = payoutRes.rows[0]

      if (body.status === 'paid') {
        await client.query(
          `UPDATE agent_wallets SET locked_balance = locked_balance - $1, total_paid_out = total_paid_out + $1, updated_at = NOW() WHERE agent_id = $2`,
          [amount, agent_id]
        )
      } else {
        await client.query(
          `UPDATE agent_wallets SET locked_balance = locked_balance - $1, balance = balance + $1, updated_at = NOW() WHERE agent_id = $2`,
          [amount, agent_id]
        )
      }
      await client.query(
        `UPDATE agent_payouts SET status = $1, reference = $2, processed_at = NOW(), processed_by = $3 WHERE id = $4`,
        [body.status, body.reference || null, admin.sub, id]
      )
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, 'agent_payout', $3, $4)`,
        [admin.sub, `agent_payout_${body.status}`, id, JSON.stringify({ agent_id, amount, reference: body.reference })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
```

- [ ] **Step 2: Wire into `index.ts`**

In `services/admin-service/src/index.ts`, add the import near the other route-module imports (after line 39, `import { registerNotificationRoutes } ...`):

```typescript
import { registerAgentRoutes } from './agent-routes'
```

And register it near the other `registerXRoutes` calls (after line 142, `registerNotificationRoutes(app, db, authenticate)`):

```typescript
  // Register Agent commission system routes
  await registerAgentRoutes(app, db, authenticate, requireRole)
```

- [ ] **Step 3: Verify it builds**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

With the service running locally and a valid superadmin JWT:

```bash
curl -X POST http://127.0.0.1:3008/api/admin/agents \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"agent1","password":"testpass123","display_name":"Test Agent","commission_rate":20}'
```
Expected: `201` with `{ id, referral_code }`. Then `GET /api/admin/agents` shows the new agent with `player_count: 0`.

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/agent-routes.ts services/admin-service/src/index.ts
git commit -m "feat(admin-service): superadmin agent CRUD, ledger, and payout-approval routes"
```

---

## Task 5: Agent portal routes (agent self-service)

**Files:**
- Create: `services/admin-service/src/agent-portal-routes.ts`
- Modify: `services/admin-service/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (queries the tables from Task 1 directly).
- Produces: registers routes under `/api/admin/agent-portal/*`. The login route issues a JWT with `{ sub: agent.id, username, role: 'agent' }` — note `'agent'` is deliberately NOT in the admin `ROLES` array (`services/admin-service/src/index.ts:61`), so `requireRole(...)` middleware always rejects agent tokens on admin-only routes; a dedicated `requireAgent` guard (defined in this file) is used instead.

- [ ] **Step 1: Write the route module**

```typescript
// services/admin-service/src/agent-portal-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

// Self-service routes for agents themselves (not admin staff). Agent JWTs
// carry role: 'agent', which is intentionally outside the admin ROLES
// hierarchy in index.ts — requireAgent below is the guard for these routes,
// mirroring the shape of index.ts's own requireRole factory.
export async function registerAgentPortalRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
) {
  const requireAgent = async (req: any, reply: any) => {
    if ((req.user as any)?.role !== 'agent') return reply.code(403).send({ error: 'Forbidden' })
  }

  // POST /api/admin/agent-portal/auth/login
  app.post('/api/admin/agent-portal/auth/login', async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body)
    const res = await db.query(`SELECT * FROM agents WHERE username = $1 AND status = 'active'`, [username])
    if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })
    const agent = res.rows[0]
    const valid = await bcrypt.compare(password, agent.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ sub: agent.id, username: agent.username, role: 'agent' }, { expiresIn: '8h' })
    return reply.send({
      token,
      admin: { id: agent.id, username: agent.username, role: 'agent', display_name: agent.display_name },
    })
  })

  // GET /api/admin/agent-portal/me — dashboard summary
  app.get('/api/admin/agent-portal/me', { onRequest: [authenticate, requireAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const [agentRes, walletRes, subAgentsRes] = await Promise.all([
      db.query('SELECT id, username, display_name, commission_rate, referral_code, parent_agent_id FROM agents WHERE id = $1', [agentId]),
      db.query('SELECT balance::float, locked_balance::float, total_earned::float, total_paid_out::float FROM agent_wallets WHERE agent_id = $1', [agentId]),
      db.query(`SELECT id, display_name, commission_rate FROM agents WHERE parent_agent_id = $1`, [agentId]),
    ])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    return reply.send({
      agent: agentRes.rows[0],
      wallet: walletRes.rows[0] || { balance: 0, locked_balance: 0, total_earned: 0, total_paid_out: 0 },
      sub_agents: subAgentsRes.rows,
    })
  })

  // GET /api/admin/agent-portal/players — this agent's direct players (read-only)
  app.get('/api/admin/agent-portal/players', { onRequest: [authenticate, requireAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT username, status, created_at,
              (SELECT MAX(created_at) FROM wallet_transactions WHERE user_id = users.id) AS last_active
       FROM users WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agent-portal/ledger — this agent's commission history
  app.get('/api/admin/agent-portal/ledger', { onRequest: [authenticate, requireAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT date, direct_commission::float, override_commission::float, total_commission::float, status
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agent-portal/payout — request a payout against the current balance
  app.post('/api/admin/agent-portal/payout', { onRequest: [authenticate, requireAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const body = z.object({
      amount: z.number().min(100),
      bank_account: z.string().optional(),
      upi_id: z.string().optional(),
    }).parse(req.body)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const walletRes = await client.query('SELECT balance FROM agent_wallets WHERE agent_id = $1 FOR UPDATE', [agentId])
      const balance = parseFloat(walletRes.rows[0]?.balance ?? '0')
      if (balance < body.amount) {
        await client.query('ROLLBACK')
        return reply.code(400).send({ error: 'Insufficient balance' })
      }
      await client.query(
        'UPDATE agent_wallets SET balance = balance - $1, locked_balance = locked_balance + $1, updated_at = NOW() WHERE agent_id = $2',
        [body.amount, agentId]
      )
      const payoutRes = await client.query(
        `INSERT INTO agent_payouts (agent_id, amount, metadata) VALUES ($1, $2, $3) RETURNING id`,
        [agentId, body.amount, JSON.stringify({ bank_account: body.bank_account, upi_id: body.upi_id })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true, payout_id: payoutRes.rows[0].id, message: 'Payout request submitted. Processed within 24 hours.' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
```

- [ ] **Step 2: Wire into `index.ts`**

Add the import after the `registerAgentRoutes` import from Task 4:

```typescript
import { registerAgentPortalRoutes } from './agent-portal-routes'
```

And register it right after `await registerAgentRoutes(app, db, authenticate, requireRole)`:

```typescript
  await registerAgentPortalRoutes(app, db, authenticate)
```

- [ ] **Step 3: Verify it builds**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
curl -X POST http://127.0.0.1:3008/api/admin/agent-portal/auth/login \
  -H "Content-Type: application/json" -d '{"username":"agent1","password":"testpass123"}'
```
Expected: `200` with `{ token, admin: { role: "agent", ... } }`. Then `GET /api/admin/agent-portal/me` with that token returns the agent's own profile/wallet/sub_agents, and the same token against `GET /api/admin/agents` (Task 4, superadmin-only) returns `403`.

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/agent-portal-routes.ts services/admin-service/src/index.ts
git commit -m "feat(admin-service): agent self-service portal — login, dashboard, payout request"
```

---

## Task 6: Nightly settlement job

**Files:**
- Create: `services/admin-service/src/agent-settlement-job.ts`
- Modify: `services/admin-service/src/index.ts`

**Interfaces:**
- Consumes: `calculateDailySettlement` from `./agent-settlement` (Task 3).
- Produces: `AgentSettlementJob` class with a `.start()` method (mirrors `GameWatchdog` in `services/game-gateway/src/watchdog.ts:13`). No other task depends on this.

- [ ] **Step 1: Write the job**

```typescript
// services/admin-service/src/agent-settlement-job.ts
import { Pool } from 'pg'
import { calculateDailySettlement, AgentNode, PlayerNetLoss } from './agent-settlement'

// Runs the previous day's agent commission settlement once per day, shortly
// after midnight IST. Mirrors the setInterval-with-time-check pattern used
// by GameWatchdog (services/game-gateway/src/watchdog.ts) — no external cron
// infra needed. Idempotent: skips a date that already has ledger rows, so a
// missed/late tick or a process restart can never double-settle.
export class AgentSettlementJob {
  private static readonly CHECK_INTERVAL_MS = 5 * 60 * 1000 // check every 5 minutes
  private static readonly TARGET_HOUR_IST = 0 // run between 00:00–00:30 IST
  private static readonly IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

  constructor(private db: Pool, private log: (msg: string) => void = console.log) {}

  start(): void {
    setInterval(() => {
      this.tick().catch(err => console.error('[agent-settlement] tick failed', err))
    }, AgentSettlementJob.CHECK_INTERVAL_MS)
    this.log('[agent-settlement] job started (checks every 5m, runs ~00:00-00:30 IST)')
  }

  private async tick(): Promise<void> {
    const nowIst = new Date(Date.now() + AgentSettlementJob.IST_OFFSET_MS)
    if (nowIst.getUTCHours() !== AgentSettlementJob.TARGET_HOUR_IST) return

    // Settle "yesterday" in IST terms.
    const yesterdayIst = new Date(nowIst)
    yesterdayIst.setUTCDate(yesterdayIst.getUTCDate() - 1)
    const dateStr = yesterdayIst.toISOString().slice(0, 10) // YYYY-MM-DD

    const alreadyRun = await this.db.query('SELECT 1 FROM agent_commission_ledger WHERE date = $1 LIMIT 1', [dateStr])
    if (alreadyRun.rows.length > 0) return // already settled this date

    await this.runSettlementForDate(dateStr)
  }

  async runSettlementForDate(dateStr: string): Promise<void> {
    const agentsRes = await this.db.query('SELECT id, parent_agent_id, commission_rate, status FROM agents')
    const agents: AgentNode[] = agentsRes.rows.map(r => ({
      id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate), status: r.status,
    }))
    if (agents.length === 0) return

    // Net house win per player for the target IST day, attributed to their
    // direct agent. game_debit = player staked/lost, game_credit = player
    // won back — matches WalletService.TxnType (services/wallet-service/src/wallet.service.ts:5).
    const lossesRes = await this.db.query(
      `SELECT u.agent_id,
              COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
       FROM wallet_transactions wt
       JOIN users u ON u.id = wt.user_id
       WHERE u.agent_id IS NOT NULL
         AND wt.type IN ('game_debit', 'game_credit')
         AND wt.created_at >= ($1::date AT TIME ZONE 'Asia/Kolkata')
         AND wt.created_at <  (($1::date + 1) AT TIME ZONE 'Asia/Kolkata')
       GROUP BY u.agent_id`,
      [dateStr]
    )
    const playerLosses: PlayerNetLoss[] = lossesRes.rows.map(r => ({ agentId: r.agent_id, netHouseWin: parseFloat(r.net_house_win) }))

    const results = calculateDailySettlement(agents, playerLosses)
    if (results.length === 0) return

    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      for (const r of results) {
        await client.query(
          `INSERT INTO agent_commission_ledger (agent_id, date, direct_commission, override_commission, total_commission)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (agent_id, date) DO NOTHING`,
          [r.agentId, dateStr, r.directCommission, r.overrideCommission, r.totalCommission]
        )
        if (r.totalCommission > 0) {
          await client.query(
            `UPDATE agent_wallets SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE agent_id = $2`,
            [r.totalCommission, r.agentId]
          )
        }
      }
      await client.query('COMMIT')
      this.log(`[agent-settlement] settled ${dateStr}: ${results.length} agent(s)`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}
```

- [ ] **Step 2: Wire into `index.ts`**

Add the import after the Task 5 import:

```typescript
import { AgentSettlementJob } from './agent-settlement-job'
```

Start it near the end of `start()`, after the route registrations (after the `registerAgentPortalRoutes` call from Task 5):

```typescript
  new AgentSettlementJob(db, (msg) => app.log.info(msg)).start()
```

- [ ] **Step 3: Verify it builds**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification of the date-window query**

With at least one agent and one `users.agent_id`-linked player who has `game_debit`/`game_credit` wallet_transactions from a known past date, call the class directly in a scratch script or `node -e` REPL against the dev DB:

```bash
node -e "
const { Pool } = require('pg');
const { AgentSettlementJob } = require('./dist/agent-settlement-job');
const db = new Pool({ connectionString: process.env.DATABASE_URL });
new AgentSettlementJob(db).runSettlementForDate('2026-07-19').then(() => db.end());
"
```
Expected: a row appears in `agent_commission_ledger` for that date, and `agent_wallets.balance` for the relevant agent increases by the same amount. Re-running the same command is a no-op (idempotent `ON CONFLICT DO NOTHING`, and the wallet update is skipped because the ledger insert returns no row — verify by checking `agent_wallets.balance` is unchanged on the second run).

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/agent-settlement-job.ts services/admin-service/src/index.ts
git commit -m "feat(admin-service): nightly agent commission settlement job"
```

---

## Task 7: Extend the referral resolver for agent codes

**Files:**
- Modify: `services/core-api-service/src/plugins/auth.ts:43-47`

**Interfaces:**
- Consumes: `agents` table (Task 1).
- Produces: `users.agent_id` gets set on signup when an agent referral code is used. No other task depends on this.

- [ ] **Step 1: Modify the resolver**

In `services/core-api-service/src/plugins/auth.ts`, replace lines 43-47:

```typescript
      let referredBy: string | null = null
      if (body.referral_code) {
        const ref = await db.query('SELECT id FROM users WHERE referral_code = $1', [body.referral_code])
        if (ref.rows.length > 0) referredBy = ref.rows[0].id
      }
```

with:

```typescript
      // A referral code belongs to either a player (existing one-time bonus
      // path, checked first) or an agent (recurring commission tracking,
      // Task 1's agents table) — never both. See
      // docs/superpowers/specs/2026-07-20-agent-commission-system-design.md
      let referredBy: string | null = null
      let referredByAgentId: string | null = null
      if (body.referral_code) {
        const ref = await db.query('SELECT id FROM users WHERE referral_code = $1', [body.referral_code])
        if (ref.rows.length > 0) {
          referredBy = ref.rows[0].id
        } else {
          const agentRef = await db.query(`SELECT id FROM agents WHERE referral_code = $1 AND status = 'active'`, [body.referral_code])
          if (agentRef.rows.length > 0) referredByAgentId = agentRef.rows[0].id
        }
      }
```

Then update the `INSERT INTO users` a few lines below (currently line 52-55) to also set `agent_id`:

```typescript
        const userRes = await client.query(
          `INSERT INTO users (phone, username, password_hash, referral_code, referred_by, agent_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, referral_code`,
          [body.phone, body.username, passwordHash, referralCode, referredBy, referredByAgentId],
        )
```

- [ ] **Step 2: Verify it builds**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Create a test agent via the Task 4 admin route (or directly in the DB) and note its `referral_code`, then:

```bash
curl -X POST http://127.0.0.1:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"9999999999","otp":"123456","username":"testplayer1","password":"testpass123","referral_code":"AG1234ABCD"}'
```
(Use a real OTP from the dev flow.) Expected: `201`, and `SELECT agent_id FROM users WHERE username='testplayer1'` returns the agent's id. Also verify `GET /api/admin/agents/:id/players` (Task 4) now lists this player.

- [ ] **Step 4: Commit**

```bash
git add services/core-api-service/src/plugins/auth.ts
git commit -m "feat(core-api-service): attribute signups to an agent via referral code"
```

---

## Task 8: Admin-panel — Agents module (superadmin)

**Files:**
- Create: `admin-panel/src/pages/Agents.tsx`
- Modify: `admin-panel/src/main.tsx`

**Interfaces:**
- Consumes: `adminApi` from `admin-panel/src/api/client.ts` (existing), the routes from Task 4.
- Produces: `/admin/agents` route. No other task depends on this.

- [ ] **Step 1: Write the page**

```tsx
// admin-panel/src/pages/Agents.tsx
import { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Select, Tag, Tabs, message, Popconfirm } from 'antd'
import { adminApi } from '../api/client'

interface Agent {
  id: string
  username: string
  display_name: string
  phone: string | null
  status: 'active' | 'suspended'
  parent_agent_id: string | null
  commission_rate: number
  referral_code: string
  balance: number
  total_earned: number
  player_count: number
  created_at: string
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [payouts, setPayouts] = useState<any[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/agents')
      setAgents(res.data)
    } finally {
      setLoading(false)
    }
  }

  const loadPayouts = async () => {
    const res = await adminApi.get('/agent-payouts', { params: { status: 'created' } })
    setPayouts(res.data)
  }

  useEffect(() => { load(); loadPayouts() }, [])

  const createAgent = async (values: any) => {
    try {
      await adminApi.post('/agents', values)
      message.success('Agent created')
      setModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create agent')
    }
  }

  const toggleStatus = async (agent: Agent) => {
    const next = agent.status === 'active' ? 'suspended' : 'active'
    await adminApi.patch(`/agents/${agent.id}`, { status: next })
    message.success(`Agent ${next}`)
    load()
  }

  const decidePayout = async (id: string, status: 'paid' | 'rejected') => {
    const reference = status === 'paid' ? window.prompt('Bank/UPI reference (optional):') || undefined : undefined
    await adminApi.patch(`/agent-payouts/${id}`, { status, reference })
    message.success(`Payout ${status}`)
    loadPayouts()
    load()
  }

  const columns = [
    { title: 'Agent', dataIndex: 'display_name', render: (v: string, r: Agent) => `${v} (@${r.username})` },
    { title: 'Parent', dataIndex: 'parent_agent_id', render: (id: string | null) => id ? (agents.find(a => a.id === id)?.display_name || id) : '— (Master)' },
    { title: 'Rate', dataIndex: 'commission_rate', render: (v: number) => `${v}%` },
    { title: 'Players', dataIndex: 'player_count' },
    { title: 'Balance', dataIndex: 'balance', render: (v: number) => `₹${v.toFixed(2)}` },
    { title: 'Total Earned', dataIndex: 'total_earned', render: (v: number) => `₹${v.toFixed(2)}` },
    { title: 'Referral Code', dataIndex: 'referral_code' },
    { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'red'}>{v}</Tag> },
    {
      title: 'Actions', render: (_: any, r: Agent) => (
        <>
          <Button size="small" onClick={() => setSelectedAgent(r)}>View</Button>{' '}
          <Popconfirm title={`${r.status === 'active' ? 'Suspend' : 'Reactivate'} this agent?`} onConfirm={() => toggleStatus(r)}>
            <Button size="small" danger={r.status === 'active'}>{r.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
          </Popconfirm>
        </>
      ),
    },
  ]

  return (
    <div>
      <Tabs
        items={[
          {
            key: 'agents',
            label: 'Agents',
            children: (
              <>
                <Button type="primary" onClick={() => setModalOpen(true)} style={{ marginBottom: 16 }}>New Agent</Button>
                <Table rowKey="id" columns={columns} dataSource={agents} loading={loading} />
              </>
            ),
          },
          {
            key: 'payouts',
            label: `Pending Payouts (${payouts.length})`,
            children: (
              <Table
                rowKey="id"
                dataSource={payouts}
                columns={[
                  { title: 'Agent', dataIndex: 'display_name' },
                  { title: 'Amount', dataIndex: 'amount', render: (v: number) => `₹${v.toFixed(2)}` },
                  { title: 'Requested', dataIndex: 'requested_at', render: (v: string) => new Date(v).toLocaleString() },
                  { title: 'Details', dataIndex: 'metadata', render: (v: any) => v?.bank_account || v?.upi_id || '—' },
                  {
                    title: 'Actions', render: (_: any, r: any) => (
                      <>
                        <Button size="small" type="primary" onClick={() => decidePayout(r.id, 'paid')}>Approve</Button>{' '}
                        <Button size="small" danger onClick={() => decidePayout(r.id, 'rejected')}>Reject</Button>
                      </>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal title="New Agent" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={createAgent}>
          <Form.Item name="username" label="Username" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}><Input.Password /></Form.Item>
          <Form.Item name="display_name" label="Display Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phone" label="Phone"><Input /></Form.Item>
          <Form.Item name="commission_rate" label="Commission Rate (%)" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="parent_agent_id" label="Parent Agent (leave empty for Master Agent)">
            <Select allowClear options={agents.filter(a => a.parent_agent_id === null).map(a => ({ value: a.id, label: `${a.display_name} (${a.commission_rate}%)` }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={selectedAgent?.display_name} open={!!selectedAgent} onCancel={() => setSelectedAgent(null)} footer={null} width={700}>
        {selectedAgent && <AgentDetail agent={selectedAgent} />}
      </Modal>
    </div>
  )
}

function AgentDetail({ agent }: { agent: Agent }) {
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])

  useEffect(() => {
    adminApi.get(`/agents/${agent.id}/players`).then(r => setPlayers(r.data))
    adminApi.get(`/agents/${agent.id}/ledger`).then(r => setLedger(r.data))
  }, [agent.id])

  const voidEntry = async (ledgerId: string) => {
    await adminApi.post(`/agents/${agent.id}/ledger/${ledgerId}/void`)
    message.success('Voided')
    adminApi.get(`/agents/${agent.id}/ledger`).then(r => setLedger(r.data))
  }

  return (
    <Tabs
      items={[
        {
          key: 'players', label: `Players (${players.length})`,
          children: <Table rowKey="id" size="small" dataSource={players} columns={[
            { title: 'Username', dataIndex: 'username' },
            { title: 'Joined', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
            { title: 'Last Active', dataIndex: 'last_active', render: (v: string | null) => v ? new Date(v).toLocaleDateString() : '—' },
          ]} />,
        },
        {
          key: 'ledger', label: 'Commission History',
          children: <Table rowKey="id" size="small" dataSource={ledger} columns={[
            { title: 'Date', dataIndex: 'date' },
            { title: 'Direct', dataIndex: 'direct_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            { title: 'Override', dataIndex: 'override_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            { title: 'Total', dataIndex: 'total_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'voided' ? 'red' : 'green'}>{v}</Tag> },
            {
              title: 'Actions', render: (_: any, r: any) => r.status === 'settled' ? (
                <Popconfirm title="Void this day's commission?" onConfirm={() => voidEntry(r.id)}>
                  <Button size="small" danger>Void</Button>
                </Popconfirm>
              ) : null,
            },
          ]} />,
        },
      ]}
    />
  )
}
```

- [ ] **Step 2: Wire into the router**

In `admin-panel/src/main.tsx`, add the lazy import after `const Tasks = ...` (line 41):

```typescript
const Agents = React.lazy(() => import('./pages/Agents'))
```

And add the route inside the `/admin` route block, after `<Route path="tasks" element={<Tasks />} />` (line 88):

```tsx
            <Route path="agents" element={<Agents />} />
```

- [ ] **Step 3: Verify it builds**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev` in `admin-panel/`, log in as superadmin, navigate to `/admin/agents`. Expected: table loads (empty or with agents created in earlier tasks' smoke tests), "New Agent" modal creates an agent successfully, clicking "View" shows the Players/Commission History tabs.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/Agents.tsx admin-panel/src/main.tsx
git commit -m "feat(admin-panel): superadmin Agents module — CRUD, hierarchy, ledger, payout approval"
```

---

## Task 9: Admin-panel — Agent portal (agent self-service UI)

**Files:**
- Create: `admin-panel/src/pages/AgentLogin.tsx`
- Create: `admin-panel/src/pages/AgentPortal.tsx`
- Modify: `admin-panel/src/main.tsx`

**Interfaces:**
- Consumes: `useAuthStore` from `admin-panel/src/store/auth.ts` (existing, already generic on `role: string` — no changes needed there), the routes from Task 5.
- Produces: `/agent/login` and `/agent` routes, separate from the `/admin/*` tree so an agent's restricted session never renders the full admin nav.

- [ ] **Step 1: Write the login page**

```tsx
// admin-panel/src/pages/AgentLogin.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, message } from 'antd'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

export default function AgentLogin() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const res = await adminApi.post('/agent-portal/auth/login', values)
      setAuth(res.data.token, res.data.admin)
      navigate('/agent')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0f0f0f' }}>
      <Card title="Agent Login" style={{ width: 360 }}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>Log In</Button>
        </Form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Write the portal dashboard**

```tsx
// admin-panel/src/pages/AgentPortal.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Tabs, Statistic, Row, Col, Button, Modal, Form, InputNumber, Input, message } from 'antd'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'

export default function AgentPortal() {
  const [me, setMe] = useState<any>(null)
  const [players, setPlayers] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [payoutModalOpen, setPayoutModalOpen] = useState(false)
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const load = async () => {
    const [meRes, playersRes, ledgerRes] = await Promise.all([
      adminApi.get('/agent-portal/me'),
      adminApi.get('/agent-portal/players'),
      adminApi.get('/agent-portal/ledger'),
    ])
    setMe(meRes.data)
    setPlayers(playersRes.data)
    setLedger(ledgerRes.data)
  }

  useEffect(() => { load() }, [])

  const requestPayout = async (values: any) => {
    try {
      await adminApi.post('/agent-portal/payout', values)
      message.success('Payout requested')
      setPayoutModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to request payout')
    }
  }

  if (!me) return null

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>{me.agent.display_name}'s Dashboard</h2></Col>
        <Col><Button onClick={() => { logout(); navigate('/agent/login') }}>Log Out</Button></Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="Available Balance" value={me.wallet.balance} prefix="₹" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Pending Payout" value={me.wallet.locked_balance} prefix="₹" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Total Earned" value={me.wallet.total_earned} prefix="₹" precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="Your Referral Code" value={me.agent.referral_code} /></Card></Col>
      </Row>

      <Button type="primary" onClick={() => setPayoutModalOpen(true)} style={{ marginBottom: 16 }}>Request Payout</Button>

      <Tabs
        items={[
          {
            key: 'players', label: `Your Players (${players.length})`,
            children: <Table rowKey="username" dataSource={players} columns={[
              { title: 'Username', dataIndex: 'username' },
              { title: 'Joined', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
              { title: 'Last Active', dataIndex: 'last_active', render: (v: string | null) => v ? new Date(v).toLocaleDateString() : '—' },
            ]} />,
          },
          ...(me.sub_agents.length > 0 ? [{
            key: 'sub_agents', label: `Your Sub-Agents (${me.sub_agents.length})`,
            children: <Table rowKey="id" dataSource={me.sub_agents} columns={[
              { title: 'Name', dataIndex: 'display_name' },
              { title: 'Their Rate', dataIndex: 'commission_rate', render: (v: number) => `${v}%` },
            ]} />,
          }] : []),
          {
            key: 'ledger', label: 'Commission History',
            children: <Table rowKey="date" dataSource={ledger} columns={[
              { title: 'Date', dataIndex: 'date' },
              { title: 'Direct', dataIndex: 'direct_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Override', dataIndex: 'override_commission', render: (v: number) => `₹${v.toFixed(2)}` },
              { title: 'Total', dataIndex: 'total_commission', render: (v: number) => `₹${v.toFixed(2)}` },
            ]} />,
          },
        ]}
      />

      <Modal title="Request Payout" open={payoutModalOpen} onCancel={() => setPayoutModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={requestPayout}>
          <Form.Item name="amount" label={`Amount (available: ₹${me.wallet.balance.toFixed(2)})`} rules={[{ required: true }]}>
            <InputNumber min={100} max={me.wallet.balance} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="bank_account" label="Bank Account (or leave blank and fill UPI below)"><Input /></Form.Item>
          <Form.Item name="upi_id" label="UPI ID"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 3: Wire into the router**

In `admin-panel/src/main.tsx`, add the lazy imports after the Task 8 `Agents` import:

```typescript
const AgentLogin = React.lazy(() => import('./pages/AgentLogin'))
const AgentPortal = React.lazy(() => import('./pages/AgentPortal'))
```

Add a new `ProtectedAgentRoute` helper right after the existing `ProtectedRoute` function (line 44-48):

```tsx
function ProtectedAgentRoute({ children }: { children: React.ReactNode }) {
  const { token, admin } = useAuthStore()
  if (!token || admin?.role !== 'agent') return <Navigate to="/agent/login" replace />
  return <>{children}</>
}
```

Add new top-level routes inside `<Routes>`, alongside the existing `/admin/login` route (after line 55):

```tsx
          <Route path="/agent/login" element={<AgentLogin />} />
          <Route path="/agent" element={<ProtectedAgentRoute><AgentPortal /></ProtectedAgentRoute>} />
```

- [ ] **Step 4: Verify it builds**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, go to `/agent/login`, log in with an agent created in Task 4's smoke test. Expected: redirected to `/agent`, dashboard shows balance/referral code/players/ledger tabs, "Request Payout" opens the modal and a submitted request appears in the superadmin's "Pending Payouts" tab from Task 8. Also verify: navigating to `/admin` while logged in as an agent redirects to `/admin/login` (agent token doesn't satisfy `ProtectedRoute`'s admin session in a way that would expose admin pages — confirm by checking that any `/api/admin/...` superadmin-only call made with the agent's token gets `403` from the backend, which Task 4/5 already guarantee).

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/pages/AgentLogin.tsx admin-panel/src/pages/AgentPortal.tsx admin-panel/src/main.tsx
git commit -m "feat(admin-panel): agent self-service portal — login, dashboard, payout request"
```

---

## Task 10: Sidebar link for the Agents module

**Files:**
- Modify: `admin-panel/src/pages/Layout.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing later depends on this — it's the final task, purely making Task 8's page reachable from the nav instead of only by direct URL.

- [ ] **Step 1: Find the existing nav item array**

Run: `grep -n "path: '/admin/tasks'\|/admin/tasks" admin-panel/src/pages/Layout.tsx`

This locates the menu item for the Task Management page (added in a prior feature) — add the new Agents item using the exact same shape immediately after it in the array.

- [ ] **Step 2: Add the nav entry**

Add an entry for `/admin/agents` following the exact structure of the existing `/admin/tasks` entry found in Step 1 (same icon-import style, same object shape — copy its fields and change only the `key`/`label`/`path` to `'agents'` / `'Agents'` / `/admin/agents`).

- [ ] **Step 3: Verify it builds and renders**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

Run `npm run dev`, log in as superadmin. Expected: "Agents" appears in the sidebar and navigates to the Task 8 page.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/pages/Layout.tsx
git commit -m "feat(admin-panel): add Agents module to the sidebar nav"
```

---

## Self-Review Notes

**Spec coverage:** Commission model (Task 3), hierarchy cap + rate sanity (Task 2, enforced in Task 4), admin-approved onboarding + separate identity (Task 4/5), daily automatic settlement (Task 6), floor-at-zero/no-carry-forward (Task 3, tested), read-only agent dashboard (Task 9), referral integration (Task 7), payout subsystem (Task 4/5/9), suspended-agent edge case (Task 3, tested). Self-referral fraud detection (device-fingerprint clustering) and the admin void/reversal action are both listed in the spec's edge cases — void is implemented (Task 4); automated fraud *detection* was deliberately left as a follow-up rather than silently building a fingerprint-clustering heuristic into this plan without your sign-off — the `flagged_for_review` column (Task 1) is there so that follow-up has a landing spot, but nothing currently sets it. Flagging this gap explicitly rather than quietly shipping partial fraud coverage.

**Deferred (per spec, not in this plan):** agent notifications, admin leaderboard, agent KYC.
