# Automatic Cricket Contest Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run cricket match discovery, live-score refresh, fixed-price fantasy contest creation, and Dream11-style settlement on a timer instead of requiring an admin to click buttons — without exceeding a configurable daily CricAPI call budget.

**Architecture:** A single new `CronJob` (the `cron` npm package, already a dependency) runs every `match_sync_interval_minutes` inside `core-api-service`. It reuses two pieces of existing logic — match sync and fantasy finalize — extracted out of their route handlers into plain async functions so both the admin's manual button and the new scheduler call the exact same code. Two genuinely new pieces are added: a daily API-call budget guard, and auto-creation of the three fixed-price leagues per eligible match.

**Tech Stack:** Node.js/TypeScript, Fastify, `pg` (node-postgres), `cron` (CronJob), `zod` — all already in `services/core-api-service/package.json`. No new dependencies.

## Global Constraints

- No automated test suite exists for `core-api-service` — verify manually against a scratch Postgres DB per `CLAUDE.md`. Every task below ends with a manual verification step, not a unit test file.
- Do not change the public behavior/response shape of the existing `/internal/cricket/sync-api` or `/internal/cricket/fantasy/finalize` HTTP routes — only their internals move into shared functions. The admin panel must keep working unmodified.
- `game_configs.special_rules` for `game_type = 'cricket'` already holds `api_key`/`api_keys` (and possibly `scoring_rules`) — every migration/write to this column must merge (`||`), never overwrite the whole JSONB value.
- Match status values in use today: `'upcoming' | 'live' | 'closed' | 'settled'` (cast/checked in `betting.ts:734`). This build uses `'closed'` as the "match ended, not yet settled" signal — do not introduce a new status string.

---

### Task 1: Migration — API usage table + seeded automation config

**Files:**
- Create: `infra/db/migrations/091_cricket_automation_config.sql`

**Interfaces:**
- Produces: table `cricket_api_usage(usage_date DATE PRIMARY KEY, calls_used INT NOT NULL DEFAULT 0)`, and `game_configs.special_rules` (for `game_type='cricket'`) gains keys `auto_contests_enabled` (bool), `match_sync_interval_minutes` (int), `api_daily_budget` (int), `contest_tiers` (JSON array of `{name, entry_fee, max_entries, prize_pool, prize_distribution}`).

- [ ] **Step 1: Write the migration**

```sql
-- Automatic cricket contest pipeline: tracks daily CricAPI call usage for
-- the new scheduler's budget guard, and seeds the config the scheduler
-- reads for tier pricing/cadence/budget. Merges into special_rules with
-- `||` so it never clobbers an already-configured api_key/api_keys row.

CREATE TABLE IF NOT EXISTS cricket_api_usage (
  usage_date DATE PRIMARY KEY,
  calls_used INT NOT NULL DEFAULT 0
);

UPDATE game_configs
SET special_rules = special_rules || '{
  "auto_contests_enabled": true,
  "match_sync_interval_minutes": 15,
  "api_daily_budget": 300,
  "contest_tiers": [
    { "name": "Bronze", "entry_fee": 49, "max_entries": 500, "prize_pool": 15000,
      "prize_distribution": [
        { "rank_start": 1, "rank_end": 1, "payout": 5000 },
        { "rank_start": 2, "rank_end": 3, "payout": 1500 },
        { "rank_start": 4, "rank_end": 10, "payout": 500 },
        { "rank_start": 11, "rank_end": 100, "payout": 50 }
      ] },
    { "name": "Silver", "entry_fee": 99, "max_entries": 300, "prize_pool": 18000,
      "prize_distribution": [
        { "rank_start": 1, "rank_end": 1, "payout": 8000 },
        { "rank_start": 2, "rank_end": 3, "payout": 2000 },
        { "rank_start": 4, "rank_end": 10, "payout": 600 },
        { "rank_start": 11, "rank_end": 45, "payout": 60 }
      ] },
    { "name": "Gold", "entry_fee": 149, "max_entries": 150, "prize_pool": 15000,
      "prize_distribution": [
        { "rank_start": 1, "rank_end": 1, "payout": 6000 },
        { "rank_start": 2, "rank_end": 3, "payout": 2000 },
        { "rank_start": 4, "rank_end": 10, "payout": 500 },
        { "rank_start": 11, "rank_end": 15, "payout": 100 }
      ] }
  ]
}'::jsonb
WHERE game_type = 'cricket';
```

- [ ] **Step 2: Run it against a scratch database to verify it applies cleanly**

```bash
psql "$SCRATCH_DATABASE_URL" -f infra/db/migrations/091_cricket_automation_config.sql
psql "$SCRATCH_DATABASE_URL" -c "SELECT special_rules->'contest_tiers' FROM game_configs WHERE game_type='cricket';"
psql "$SCRATCH_DATABASE_URL" -c "\d cricket_api_usage"
```

Expected: the `contest_tiers` JSON prints back correctly, and any pre-existing `api_key`/`api_keys` value on that row (seed one first if the scratch DB doesn't have one: `UPDATE game_configs SET special_rules = special_rules || '{"api_keys":["test-key"]}' WHERE game_type='cricket';` before running the migration) is still present after — proving the merge didn't clobber it. `cricket_api_usage` describes with the two columns above.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/091_cricket_automation_config.sql
git commit -m "feat(cricket): add API usage tracking table and seed automation config"
```

---

### Task 2: Extract match sync into a shared function, fix the settled-without-settling bug

**Files:**
- Create: `services/core-api-service/src/helpers/cricket-sync.ts`
- Modify: `services/core-api-service/src/plugins/betting.ts:788-813` (the `/internal/cricket/sync-api` handler body)

**Interfaces:**
- Produces: `syncCurrentMatches(db: Pool): Promise<{ insertedIds: string[]; updatedCount: number }>` — same upsert logic as today's route, with one behavior change: when CricAPI reports `matchEnded`, the row's `status` is set to `'closed'` (not `'settled'`) since nothing has actually been settled yet. Throws on CricAPI failure (`data.status !== 'success'`) instead of returning an error object — the route wraps it back into its existing `502` response, the scheduler (Task 6) wraps it in try/catch.
- Consumes: `cricApiFetch` from `../helpers/cricapi-client` (existing, unchanged).

- [ ] **Step 1: Create the shared function**

```typescript
// services/core-api-service/src/helpers/cricket-sync.ts
import { Pool } from 'pg'
import { cricApiFetch } from './cricapi-client'

export interface SyncResult {
  insertedIds: string[]
  updatedCount: number
}

// Discovers new matches and refreshes live scores for existing ones from
// CricAPI's currentMatches endpoint — shared by the admin's manual "Sync"
// button and the automatic scheduler so there is exactly one
// implementation. A match reported matchEnded is set to 'closed', not
// 'settled' — nothing has actually settled the fantasy leagues on it yet,
// that only happens via finalizeMatch() (cricket-finalize.ts). Setting
// 'settled' directly here (the old behavior) left leagues open forever
// with a match that already looked finished.
export async function syncCurrentMatches(db: Pool): Promise<SyncResult> {
  const currentData = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`)
  if (currentData.status !== 'success') throw new Error(currentData.reason || 'CricAPI sync failed')

  const flagsRes = await db.query('SELECT name, flag_url FROM cricket_countries')
  const flagMap = new Map(flagsRes.rows.map((r: any) => [r.name.toLowerCase(), r.flag_url]))
  const findFlag = (n: string) => { for (const [k, v] of flagMap) if (n?.toLowerCase().includes(k as string) || (k as string).includes(n?.toLowerCase())) return v; return null }

  const insertedIds: string[] = []
  let updatedCount = 0

  for (const m of (currentData.data || [])) {
    if (!m.id) continue
    const [team_a, team_b] = [m.teams?.[0] || 'Team A', m.teams?.[1] || 'Team B']
    const status = m.matchEnded ? 'closed' : m.matchStarted ? 'live' : 'upcoming'
    const live_score = m.score?.length ? { runs: m.score.at(-1).r, wickets: m.score.at(-1).w, overs: m.score.at(-1).o, description: m.status } : {}
    const existing = await db.query('SELECT id FROM cricket_matches WHERE match_api_id = $1', [m.id])
    if (existing.rows.length) {
      await db.query(`UPDATE cricket_matches SET status = $1, live_score = $2, team_a_flag = $3, team_b_flag = $4 WHERE id = $5`, [status, JSON.stringify(live_score), findFlag(team_a), findFlag(team_b), existing.rows[0].id])
      updatedCount++
    } else {
      const ins = await db.query(`INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, match_api_id, status, live_score, team_a_flag, team_b_flag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [m.name || 'Current Match', m.matchType || 't20', team_a, team_b, m.teamInfo?.[0]?.shortname || team_a.substring(0,3).toUpperCase(), m.teamInfo?.[1]?.shortname || team_b.substring(0,3).toUpperCase(), m.dateTimeGMT ? `${m.dateTimeGMT}Z` : new Date().toISOString(), m.id, status, JSON.stringify(live_score), findFlag(team_a), findFlag(team_b)])
      insertedIds.push(ins.rows[0].id)
    }
  }

  return { insertedIds, updatedCount }
}
```

- [ ] **Step 2: Point the existing route at the shared function**

Replace `betting.ts:788-813` (the whole `app.post('/internal/cricket/sync-api', ...)` handler) with:

```typescript
    app.post('/internal/cricket/sync-api', { onRequest: [internal] }, async (req, reply) => {
      try {
        const { insertedIds, updatedCount } = await syncCurrentMatches(db)
        return { success: true, inserted: insertedIds.length, updated: updatedCount }
      } catch (e: any) { return reply.code(500).send({ error: `API Sync failed: ${e.message}` }) }
    })
```

Add the import near the top of `betting.ts` (alongside the existing `cricApiFetch` import at line 11):

```typescript
import { syncCurrentMatches } from '../helpers/cricket-sync'
```

- [ ] **Step 3: Verify the route's response shape is unchanged**

Start `core-api-service` against a scratch DB with a configured CricAPI key (or `NODE_ENV` unset so the dev fallback key applies), then:

```bash
curl -s -X POST http://localhost:3001/internal/cricket/sync-api -H "x-internal-key: $INTERNAL_SERVICE_KEY"
```

Expected: `{"success":true,"inserted":<n>,"updated":<n>}` — same shape as before this change. Then check a match CricAPI reports as ended:

```bash
psql "$SCRATCH_DATABASE_URL" -c "SELECT status FROM cricket_matches WHERE match_api_id IN (SELECT match_api_id FROM cricket_matches WHERE status IN ('closed','settled'));"
```

Expected: any match CricAPI reports `matchEnded` now shows `status = 'closed'`, not `'settled'` — confirming the bug fix.

- [ ] **Step 4: Commit**

```bash
git add services/core-api-service/src/helpers/cricket-sync.ts services/core-api-service/src/plugins/betting.ts
git commit -m "refactor(cricket): extract match sync into shared function, fix ended-without-settled status bug"
```

---

### Task 3: Extract fantasy finalize into a shared function

**Files:**
- Create: `services/core-api-service/src/helpers/cricket-finalize.ts`
- Modify: `services/core-api-service/src/plugins/betting.ts:759-782` (the `/internal/cricket/fantasy/finalize` handler body)

**Interfaces:**
- Consumes: `settleFantasyLeague` from `./cricket` (existing), `aggregateScorecard`/`computeFantasyPoints`/`DEFAULT_SCORING_RULES` from `./fantasy-scoring` (existing), `cricApiFetch` from `./cricapi-client` (existing).
- Produces: `finalizeMatch(db: Pool, matchId: string): Promise<{ settledLeagues: number; entriesUpdated: number; totalPaid: number; playersScored: number }>`. Throws (does not return an error object) on: no linked `match_api_id`, CricAPI failure, or missing scorecard — callers decide how to surface that (route → HTTP error, scheduler → log and retry next tick).

- [ ] **Step 1: Create the shared function**

```typescript
// services/core-api-service/src/helpers/cricket-finalize.ts
import { Pool } from 'pg'
import { settleFantasyLeague } from './cricket'
import { aggregateScorecard, computeFantasyPoints, DEFAULT_SCORING_RULES } from './fantasy-scoring'
import { cricApiFetch } from './cricapi-client'

// Dream11-style finalize: pulls a match's final scorecard, computes every
// drafted player's points via the scoring rulebook, then settles every
// open league on the match. Shared by the admin's manual "Finalize" button
// and the automatic scheduler (cricket/scheduler.ts) — one implementation.
export async function finalizeMatch(db: Pool, matchId: string) {
  const matchRes = await db.query('SELECT match_api_id FROM cricket_matches WHERE id = $1', [matchId])
  if (!matchRes.rows.length || !matchRes.rows[0].match_api_id) {
    throw new Error('Match has no linked external match — cannot fetch a scorecard to finalize from')
  }

  const configRes = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const rules = configRes.rows[0]?.special_rules?.scoring_rules
    ? { ...DEFAULT_SCORING_RULES, ...configRes.rows[0].special_rules.scoring_rules }
    : DEFAULT_SCORING_RULES

  const data = await cricApiFetch(db, apiKey => `https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${matchRes.rows[0].match_api_id}`)
  if (data.status !== 'success' || !data.data?.scorecard) {
    throw new Error(`Could not fetch final scorecard: ${data.reason || 'unknown error'}`)
  }

  const statsByPlayer = aggregateScorecard(data.data.scorecard)
  const playerPoints: Record<string, number> = {}
  for (const stats of statsByPlayer.values()) {
    const pRes = await db.query('SELECT id FROM cricket_fantasy_players WHERE external_id = $1', [stats.playerId])
    if (!pRes.rows.length) continue
    playerPoints[pRes.rows[0].id] = computeFantasyPoints(rules, stats)
  }

  const result = await settleFantasyLeague(db, matchId, playerPoints)
  return { ...result, playersScored: Object.keys(playerPoints).length }
}
```

- [ ] **Step 2: Point the existing route at the shared function**

Replace `betting.ts:759-782` (the whole `app.post('/internal/cricket/fantasy/finalize', ...)` handler) with:

```typescript
    app.post('/internal/cricket/fantasy/finalize', { onRequest: [internal] }, async (req, reply) => {
      const body = z.object({ match_id: z.string().uuid() }).parse(req.body)
      try {
        const res = await finalizeMatch(db, body.match_id)
        return { success: true, ...res }
      } catch (e: any) {
        return reply.code(502).send({ error: e.message })
      }
    })
```

Add the import near the top of `betting.ts`:

```typescript
import { finalizeMatch } from '../helpers/cricket-finalize'
```

`aggregateScorecard`, `computeFantasyPoints`, `DEFAULT_SCORING_RULES` at the top of `betting.ts` (line 11) are used nowhere else in the file after this change (verified: the finalize handler was their only call site) — delete that whole import line:

```typescript
import { aggregateScorecard, computeFantasyPoints, DEFAULT_SCORING_RULES } from '../helpers/fantasy-scoring'
```

`tsconfig.json` doesn't set `noUnusedLocals`, so leaving it wouldn't break the build, but delete it anyway — a dangling import for code that moved elsewhere is misleading to the next reader.

- [ ] **Step 3: Verify the route's response shape is unchanged**

```bash
curl -s -X POST http://localhost:3001/internal/cricket/fantasy/finalize \
  -H "x-internal-key: $INTERNAL_SERVICE_KEY" -H "Content-Type: application/json" \
  -d '{"match_id":"<a closed match id from the scratch DB>"}'
```

Expected: `{"success":true,"settledLeagues":<n>,"entriesUpdated":<n>,"totalPaid":<n>,"playersScored":<n>}` — same fields as before this change (`playersScored` was already returned by the old inline handler at line 782 — this preserves that field).

- [ ] **Step 4: Run `npm run build` in `services/core-api-service` to confirm no TypeScript errors**

```bash
cd services/core-api-service && npm run build
```

Expected: clean `tsc` output, no unused-import or type errors.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/helpers/cricket-finalize.ts services/core-api-service/src/plugins/betting.ts
git commit -m "refactor(cricket): extract fantasy finalize into shared function"
```

---

### Task 4: API budget guard

**Files:**
- Create: `services/core-api-service/src/modules/cricket/apiBudget.ts`

**Interfaces:**
- Produces: `tryConsumeApiCall(db: Pool): Promise<boolean>` — atomically increments today's usage counter and returns `true` if the pre-call count was under `api_daily_budget`, `false` (already incremented past budget, call should be skipped) otherwise. `getApiDailyBudget(db: Pool): Promise<number>` — reads `special_rules.cricket.api_daily_budget`, default 300 if unset.

- [ ] **Step 1: Write the module**

```typescript
// services/core-api-service/src/modules/cricket/apiBudget.ts
import { Pool } from 'pg'

const DEFAULT_DAILY_BUDGET = 300

export async function getApiDailyBudget(db: Pool): Promise<number> {
  const res = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const budget = res.rows[0]?.special_rules?.api_daily_budget
  return typeof budget === 'number' && budget > 0 ? budget : DEFAULT_DAILY_BUDGET
}

// Atomically records one CricAPI call against today's usage and reports
// whether it's within budget. The increment happens unconditionally (so
// concurrent callers never double-count the same slot); the caller must
// check the returned boolean BEFORE actually firing the CricAPI request —
// a false return means this call should be skipped, not made.
export async function tryConsumeApiCall(db: Pool): Promise<boolean> {
  const budget = await getApiDailyBudget(db)
  const res = await db.query(
    `INSERT INTO cricket_api_usage (usage_date, calls_used) VALUES (CURRENT_DATE, 1)
     ON CONFLICT (usage_date) DO UPDATE SET calls_used = cricket_api_usage.calls_used + 1
     RETURNING calls_used`,
  )
  return res.rows[0].calls_used <= budget
}
```

- [ ] **Step 2: Verify budget enforcement manually against a scratch DB**

```bash
psql "$SCRATCH_DATABASE_URL" -c "UPDATE game_configs SET special_rules = special_rules || '{\"api_daily_budget\": 3}' WHERE game_type = 'cricket';"
```

Then in a `node -e` REPL (or a throwaway script) against that DB, call `tryConsumeApiCall` 4 times in a row and confirm it returns `true, true, true, false`. Also confirm `SELECT calls_used FROM cricket_api_usage WHERE usage_date = CURRENT_DATE;` reads `4` (it still increments on the call that returns `false`, so the budget line is precise — the 4th caller correctly sees it's over and skips its own CricAPI request, but the row accurately reflects "4 attempts happened at that instant," not "4 CricAPI calls succeeded").

- [ ] **Step 3: Commit**

```bash
git add services/core-api-service/src/modules/cricket/apiBudget.ts
git commit -m "feat(cricket): add daily CricAPI call budget guard"
```

---

### Task 5: Contest auto-creation

**Files:**
- Create: `services/core-api-service/src/modules/cricket/contestFactory.ts`

**Interfaces:**
- Produces: `createDefaultContests(db: Pool, matchId: string): Promise<number>` — returns count of leagues actually inserted (0 if all 3 tiers already exist for this match, or if no `contest_tiers` are configured).
- Consumes: nothing beyond `pg`'s `Pool`.

- [ ] **Step 1: Write the module**

```typescript
// services/core-api-service/src/modules/cricket/contestFactory.ts
import { Pool } from 'pg'

interface ContestTier {
  name: string
  entry_fee: number
  max_entries: number
  prize_pool: number
  prize_distribution: { rank_start: number; rank_end: number; payout: number }[]
}

async function getContestTiers(db: Pool): Promise<ContestTier[]> {
  const res = await db.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const tiers = res.rows[0]?.special_rules?.contest_tiers
  return Array.isArray(tiers) ? tiers : []
}

// Auto-creates the fixed-price fantasy leagues for a match, one per
// configured tier, skipping any tier that already has a league for this
// match (idempotent — safe to call every scheduler tick for the same
// match without creating duplicates, and doesn't collide with an admin
// hand-creating a league at some other price point).
export async function createDefaultContests(db: Pool, matchId: string): Promise<number> {
  const tiers = await getContestTiers(db)
  let created = 0
  for (const tier of tiers) {
    const existing = await db.query(
      'SELECT id FROM cricket_fantasy_leagues WHERE match_id = $1 AND entry_fee = $2',
      [matchId, tier.entry_fee],
    )
    if (existing.rows.length) continue
    await db.query(
      `INSERT INTO cricket_fantasy_leagues (match_id, name, entry_fee, prize_pool, max_entries, prize_distribution)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [matchId, `${tier.name} Contest`, tier.entry_fee, tier.prize_pool, tier.max_entries, JSON.stringify(tier.prize_distribution)],
    )
    created++
  }
  return created
}
```

- [ ] **Step 2: Verify against a scratch DB**

```bash
psql "$SCRATCH_DATABASE_URL" -c "INSERT INTO cricket_matches (series, format, team_a, team_b, team_a_short, team_b_short, start_time, status) VALUES ('Test Series','t20','India','Australia','IND','AUS', now() + interval '1 day', 'upcoming') RETURNING id;"
```

Then in a throwaway script, call `createDefaultContests(pool, '<that match id>')` twice in a row.

Expected: first call returns `3` (Bronze/Silver/Gold created), second call returns `0` (idempotent — no duplicates). Confirm with:

```bash
psql "$SCRATCH_DATABASE_URL" -c "SELECT name, entry_fee, prize_pool, max_entries FROM cricket_fantasy_leagues WHERE match_id = '<that match id>' ORDER BY entry_fee;"
```

Expected: exactly 3 rows, ₹49/₹99/₹149.

- [ ] **Step 3: Commit**

```bash
git add services/core-api-service/src/modules/cricket/contestFactory.ts
git commit -m "feat(cricket): auto-create fixed-price fantasy contests for a match"
```

---

### Task 6: Scheduler — wire it all together

**Files:**
- Create: `services/core-api-service/src/modules/cricket/scheduler.ts`
- Modify: `services/core-api-service/src/plugins/betting.ts:19-21` (where `startLotteryDailyScheduler()` is called)

**Interfaces:**
- Consumes: `syncCurrentMatches` (Task 2), `finalizeMatch` (Task 3), `tryConsumeApiCall` (Task 4), `createDefaultContests` (Task 5), `pool` from `../../db/pool` (existing, already initialized by `initPool(db)` at the top of `bettingPlugin`).
- Produces: `startCricketAutomationScheduler(): void`.

- [ ] **Step 1: Write the scheduler**

```typescript
// services/core-api-service/src/modules/cricket/scheduler.ts
import { CronJob } from 'cron'
import { pool } from '../../db/pool'
import { syncCurrentMatches } from '../../helpers/cricket-sync'
import { finalizeMatch } from '../../helpers/cricket-finalize'
import { tryConsumeApiCall } from './apiBudget'
import { createDefaultContests } from './contestFactory'

async function isAutomationEnabled(): Promise<boolean> {
  const res = await pool.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  return res.rows[0]?.special_rules?.auto_contests_enabled !== false
}

async function getSyncIntervalMinutes(): Promise<number> {
  const res = await pool.query("SELECT special_rules FROM game_configs WHERE game_type = 'cricket'")
  const minutes = res.rows[0]?.special_rules?.match_sync_interval_minutes
  return typeof minutes === 'number' && minutes > 0 ? minutes : 15
}

// Both eligibility check and contest creation for one match, isolated so
// one bad match can't stop the rest of the tick.
async function autoCreateContestsIfEligible(matchId: string): Promise<void> {
  try {
    const matchRes = await pool.query('SELECT team_a, team_b FROM cricket_matches WHERE id = $1', [matchId])
    if (!matchRes.rows.length) return
    const { team_a, team_b } = matchRes.rows[0]
    const playersRes = await pool.query(
      'SELECT DISTINCT team_name FROM cricket_fantasy_players WHERE team_name = ANY($1)',
      [[team_a, team_b]],
    )
    const seededTeams = new Set(playersRes.rows.map((r: any) => r.team_name))
    if (!seededTeams.has(team_a) || !seededTeams.has(team_b)) {
      console.log(`[Cricket Automation] Skipping contest creation for match ${matchId} — no seeded squad for "${team_a}" and/or "${team_b}"`)
      return
    }
    const created = await createDefaultContests(pool, matchId)
    if (created > 0) console.log(`[Cricket Automation] Created ${created} contests for match ${matchId} (${team_a} vs ${team_b})`)
  } catch (err: any) {
    console.error(`[Cricket Automation] Error auto-creating contests for match ${matchId}:`, err.message)
  }
}

async function runTick(): Promise<void> {
  if (!(await isAutomationEnabled())) return

  if (!(await tryConsumeApiCall(pool))) {
    console.log('[Cricket Automation] Daily API budget exhausted — skipping this tick')
    return
  }

  let syncResult: { insertedIds: string[]; updatedCount: number }
  try {
    syncResult = await syncCurrentMatches(pool)
  } catch (err: any) {
    console.error('[Cricket Automation] Sync failed:', err.message)
    return
  }

  for (const matchId of syncResult.insertedIds) {
    await autoCreateContestsIfEligible(matchId)
  }

  const closedRes = await pool.query("SELECT id FROM cricket_matches WHERE status = 'closed'")
  for (const row of closedRes.rows) {
    if (!(await tryConsumeApiCall(pool))) {
      console.log('[Cricket Automation] Daily API budget exhausted mid-tick — remaining matches will finalize on a later tick')
      break
    }
    try {
      const res = await finalizeMatch(pool, row.id)
      console.log(`[Cricket Automation] Finalized match ${row.id}: ${res.settledLeagues} leagues, ₹${res.totalPaid} paid`)
    } catch (err: any) {
      console.error(`[Cricket Automation] Finalize failed for match ${row.id} (will retry next tick):`, err.message)
    }
  }
}

export async function startCricketAutomationScheduler(): Promise<void> {
  const minutes = await getSyncIntervalMinutes()
  runTick()
  new CronJob(`*/${minutes} * * * *`, runTick).start()
  console.log(`[Cricket Automation] Scheduler started (every ${minutes} min)`)
}
```

- [ ] **Step 2: Wire it into `bettingPlugin`**

In `betting.ts`, add the import near the other scheduler import (line 16):

```typescript
import { startCricketAutomationScheduler } from '../modules/cricket/scheduler'
```

Change lines 19-21 from:

```typescript
  initPool(db)
  startLotteryDailyScheduler()
```

to:

```typescript
  initPool(db)
  startLotteryDailyScheduler()
  startCricketAutomationScheduler()
```

- [ ] **Step 3: Run `npm run build` to confirm no TypeScript errors**

```bash
cd services/core-api-service && npm run build
```

Expected: clean build.

- [ ] **Step 4: End-to-end manual verification against a scratch DB**

Seed a scratch Postgres DB per the project's existing scratch-DB verification convention (`docs/games/cricket/player-data.md`'s "Verification method" — mimicking production with existing squads/config), with `NODE_ENV` unset (so the dev CricAPI fallback key is used) or a real test key configured via `api_keys`. Start `core-api-service` pointed at it (`npm run dev`), and observe:

1. Console log `[Cricket Automation] Scheduler started (every 15 min)` on boot, and one immediate tick's logs (the `runTick()` call before `new CronJob(...).start()`).
2. `SELECT * FROM cricket_matches ORDER BY created_at DESC LIMIT 5;` shows matches from `currentMatches` (or confirms zero if none are currently live/scheduled in the real API right now — acceptable, re-run once a real match is live).
3. For any match discovered with both teams already seeded (e.g. India vs Australia, since those squads exist per `docs/games/cricket/player-data.md`), `SELECT * FROM cricket_fantasy_leagues WHERE match_id = '<id>';` shows the 3 auto-created contests.
4. `SELECT calls_used FROM cricket_api_usage WHERE usage_date = CURRENT_DATE;` increments by roughly 1 per tick (2 if a `'closed'` match triggered a finalize call too).
5. Manually flip a test match to `status = 'closed'` with a valid `match_api_id` pointing at a completed real match, wait for (or manually trigger) the next tick, and confirm it transitions to `status = 'settled'` with `cricket_fantasy_leagues.status = 'settled'` and `cricket_fantasy_entries.payout_received` populated for any test entries.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/modules/cricket/scheduler.ts services/core-api-service/src/plugins/betting.ts
git commit -m "feat(cricket): wire automatic match sync, contest creation, and settlement into a scheduler"
```

---

## Self-Review Notes

- **Spec coverage**: match discovery + live refresh → Task 2 (`syncCurrentMatches`, called every tick). Auto-contest-creation → Task 5, invoked from Task 6. Budget guard → Task 4, invoked before every CricAPI-calling step in Task 6. Auto-settlement via existing scoring engine (including fielding points, corrected from the original draft) → Task 3 (`finalizeMatch`, unmodified scoring logic, just relocated). The `'closed'` intermediate status fix → folded into Task 2 since it's a one-line change in the same function being extracted anyway, not worth a separate task. Config → Task 1.
- **No new HTTP routes, no new admin UI** — matches the spec's explicit "no dedicated config UI required for v1" call; tuning `contest_tiers`/`api_daily_budget`/`match_sync_interval_minutes` post-launch means a direct `UPDATE game_configs SET special_rules = special_rules || '{...}'` SQL statement, not a form. Worth knowing before this ships, not a gap in this plan.
- **Type/name consistency check**: `syncCurrentMatches` returns `{ insertedIds, updatedCount }` in Task 2 and is consumed with exactly those field names in Task 6's `runTick()`. `finalizeMatch` returns `{ settledLeagues, entriesUpdated, totalPaid, playersScored }` in Task 3 and Task 6 reads `res.settledLeagues`/`res.totalPaid` — consistent. `tryConsumeApiCall(db)` and `createDefaultContests(db, matchId)` signatures match between their defining tasks (4, 5) and their call sites in Task 6.
