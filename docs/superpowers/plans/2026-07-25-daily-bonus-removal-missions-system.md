# Remove Daily Login Bonus + Add Missions System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Daily Login Bonus feature entirely, and replace it with a "Missions" system — admin-configurable Weekly/Monthly/One-time player tasks (deposit, referral, play-a-game, join-Telegram, manual-proof) with automatic progress tracking, wallet reward crediting, and a Telegram-bot-backed group-membership check.

**Architecture:** Three services touched — `core-api-service` (player-facing `/users/missions` + `/telegram` routes), `admin-service` (admin CRUD + review queue), and the shared Postgres DB (new `player_missions` / `user_mission_completions` / `user_telegram_links` tables). A single "progress engine" module computes IST-aligned period boundaries and a `completions_available = floor(metric/target) - claimed` formula reused by every metric type. Admin panel (`admin-panel`) and mobile (`mobile/`, Flutter) get new UI; Daily Login Bonus is deleted from all three.

**Tech Stack:** Fastify + Zod + `pg` (Postgres) on the backend, React + antd + Vite on `admin-panel`, Flutter + `dio` on `mobile`, Vitest for tests.

## Global Constraints

- The player-facing feature is named **Missions**, never "Tasks" — `tasks`/`task_comments` tables, `/api/admin/tasks` routes, and `admin-panel/src/pages/Tasks.tsx` already exist for an unrelated internal employee task-tracker. Every new table, route, and file uses "mission"/"Mission".
- Weekly periods reset **Monday 00:00 IST**; monthly periods reset **1st of month 00:00 IST** (IST = UTC+5:30, fixed offset, no DST). This matches the IST convention used elsewhere in the app (e.g. Lottery).
- Mission rewards are credited via `wallet-service`'s existing `POST /internal/wallet/credit` (never inserted into the shared `bonuses` table — its `bonus_type_enum` is a closed enum not worth extending). Map `reward_wallet_type: 'bonus'` → `type: 'bonus'`, `reward_wallet_type: 'real'` → `type: 'manual_credit'` in the credit call, since the endpoint derives wallet type from `type`.
- Idempotency key format for mission rewards: `mission:{mission_id}:{user_id}:{period_key}:{completion_number}`.
- All new admin-service write routes (create/update/deactivate mission, approve/reject submission) require `requireRole('finance')`, matching the precedent set by the old Daily Bonus config route.
- No hard DELETE on missions — "delete" in the admin UI sets `is_active = false` to preserve `user_mission_completions` history/FK integrity.

---

### Task 1: Migration — drop Daily Login Bonus tables

**Files:**
- Create: `infra/db/migrations/20260725_drop_daily_login_bonus.sql`

**Interfaces:**
- Produces: nothing consumed elsewhere — this is a standalone destructive migration.

- [ ] **Step 1: Write the migration**

```sql
-- Daily Login Bonus feature removed — replaced by the Missions system.
-- See docs/superpowers/specs/2026-07-25-daily-bonus-removal-task-system-design.md
DROP TABLE IF EXISTS user_login_streaks;
DROP TABLE IF EXISTS login_bonus_config;
```

- [ ] **Step 2: Apply it against the local dev DB**

Run: `psql "postgresql://teen:teen_secret_2024@localhost:5432/teen_db" -f infra/db/migrations/20260725_drop_daily_login_bonus.sql`
Expected: `DROP TABLE` printed twice, no errors.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/20260725_drop_daily_login_bonus.sql
git commit -m "chore(db): drop daily login bonus tables"
```

---

### Task 2: Remove Daily Login Bonus backend code

**Files:**
- Modify: `services/core-api-service/src/plugins/users.ts:102-164` (delete both routes)
- Modify: `services/admin-service/src/index.ts:3235-3297` (delete the "Daily Login Bonus Config" section — verify exact end line by finding the next `// ──` section header after line 3235 before deleting, since line numbers shift as other concurrent work lands)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing — pure removal

- [ ] **Step 1: Delete the two routes from `users.ts`**

Open `services/core-api-service/src/plugins/users.ts` and delete the full block from the `app.get('/users/daily-bonus/status', ...)` line through the closing `})` of `app.post('/users/daily-bonus/claim', ...)` (lines 102-164 in the current file — re-locate by searching for `daily-bonus` if line numbers have shifted).

- [ ] **Step 2: Delete the two admin routes from `index.ts`**

Open `services/admin-service/src/index.ts`, find the `// ── Daily Login Bonus Config ──` comment, and delete everything from that comment through the end of the `GET /api/admin/bonus/stats` handler (the block ends right before the next `// ──` section comment or route registration).

- [ ] **Step 3: Verify no remaining references**

Run: `grep -rn "daily-bonus\|daily_login\|login_bonus_config\|user_login_streaks" services/core-api-service/src services/admin-service/src`
Expected: no output.

- [ ] **Step 4: Type-check both services**

Run: `cd services/core-api-service && npx tsc --noEmit`
Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no new errors introduced by this change.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/plugins/users.ts services/admin-service/src/index.ts
git commit -m "feat(missions): remove daily login bonus backend routes"
```

---

### Task 3: Remove Daily Login Bonus admin panel UI

**Files:**
- Delete: `admin-panel/src/pages/DailyBonus.tsx`
- Modify: `admin-panel/src/main.tsx:34` (remove lazy import), `:95` (remove `<Route path="daily-bonus" ...>`)
- Modify: `admin-panel/src/pages/layout/menuConfig.ts:69` (remove the Daily Bonus menu entry)
- Modify: `admin-panel/src/pages/layout/menuConfig.test.ts:19` (remove `'/admin/daily-bonus'` from `EXPECTED_KEYS`)

**Interfaces:**
- Consumes: nothing
- Produces: nothing — pure removal (Task 12 re-adds a `Missions` entry in the same nav slot)

- [ ] **Step 1: Delete the page file**

```bash
git rm admin-panel/src/pages/DailyBonus.tsx
```

- [ ] **Step 2: Remove the lazy import and route in `main.tsx`**

Delete line 34: `const DailyBonus = React.lazy(() => import('./pages/DailyBonus'))`
Delete line 95: `<Route path="daily-bonus" element={<DailyBonus />} />`

- [ ] **Step 3: Remove the menu entry**

In `admin-panel/src/pages/layout/menuConfig.ts`, delete line 69:
```ts
{ key: '/admin/daily-bonus', icon: createElement(GiftOutlined), label: link('/admin/daily-bonus', 'Daily Bonus') },
```

- [ ] **Step 4: Update the menu test**

In `admin-panel/src/pages/layout/menuConfig.test.ts`, remove `'/admin/daily-bonus',` from the `EXPECTED_KEYS` array (line 19).

- [ ] **Step 5: Run the menu test**

Run: `cd admin-panel && npx vitest run src/pages/layout/menuConfig.test.ts`
Expected: PASS (once Task 12 adds `/admin/missions` back, this test will need that key added too — for now it should pass with Daily Bonus's key simply gone).

- [ ] **Step 6: Type-check**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -A admin-panel/src
git commit -m "feat(missions): remove daily login bonus admin panel UI"
```

---

### Task 4: Remove Daily Login Bonus mobile UI

**Files:**
- Delete: `mobile/lib/features/daily_bonus/` (whole directory)
- Modify: `mobile/lib/app.dart:32` (remove import), `:135` (remove `GoRoute` for `/daily-bonus`)
- Modify: `mobile/lib/features/home/home_page.dart:425` (remove the decorative "🎯 Daily Bonus" hero badge) and `:616-622` (remove the tappable "Daily Login Bonus" promo card — this is the real navigation entry point; the hero badge has no `onTap` at all)

**Interfaces:**
- Consumes: nothing
- Produces: nothing — pure removal

- [ ] **Step 1: Delete the feature directory**

```bash
git rm -r mobile/lib/features/daily_bonus
```

- [ ] **Step 2: Remove the import and route from `app.dart`**

Delete line 32: `import 'features/daily_bonus/daily_bonus_page.dart';`
Delete line 135: `GoRoute(path: '/daily-bonus', builder: (_, __) => const DailyBonusPage()),`

- [ ] **Step 3: Remove both home-screen references in `home_page.dart`**

Remove the decorative hero badge (line 425 — this one has no `onTap`, it's cosmetic):
```dart
_heroBadge('🎯 Daily Bonus', AppColors.green),
const SizedBox(width: 8),
```
(Leave the `_heroBadge('🎰 Jackpot ₹10 CR', AppColors.orange)` line.)

Remove the actual tappable promo card in `_buildPromoStrip()` (lines 616-622 — this is the real navigation entry point to Daily Bonus):
```dart
_promoCard(
    '🎁',
    'Daily Login\nBonus',
    'Claim ₹100 Now!',
    [const Color(0xFF1A4C2E), const Color(0xFF0D2E19)],
    AppColors.green,
    onTap: () => context.push('/daily-bonus')),
```
(Leave the `Refer & Earn` and `Leaderboard Reward` promo cards; Task 14 will insert a Missions promo card in this same spot.)

- [ ] **Step 4: Analyze**

Run: `cd mobile && flutter analyze lib/app.dart lib/features/home/home_page.dart`
Expected: no new errors (pre-existing warnings elsewhere are fine).

- [ ] **Step 5: Commit**

```bash
git add -A mobile/lib
git commit -m "feat(missions): remove daily login bonus mobile UI"
```

---

### Task 5: Migration — create Missions schema

**Files:**
- Create: `infra/db/migrations/20260725_missions_system.sql`

**Interfaces:**
- Produces: `player_missions`, `user_mission_completions`, `user_telegram_links` tables consumed by every backend task below.

- [ ] **Step 1: Write the migration**

```sql
-- Missions system: admin-configurable Weekly/Monthly/One-time player rewards.
-- See docs/superpowers/specs/2026-07-25-daily-bonus-removal-task-system-design.md
-- Named "mission" (not "task") to avoid colliding with the existing employee
-- task-tracker (tasks/task_comments, migration 064_task_management.sql).

CREATE TABLE player_missions (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                       VARCHAR(200) NOT NULL,
  description                 TEXT,
  emoji                       VARCHAR(10) NOT NULL DEFAULT '🎯',
  category                    VARCHAR(10) NOT NULL CHECK (category IN ('weekly', 'monthly', 'one_time')),
  metric_type                 VARCHAR(20) NOT NULL CHECK (metric_type IN ('deposit_amount', 'referral_count', 'game_played', 'telegram_join', 'manual_proof')),
  game_type                   VARCHAR(20),
  min_stake                   NUMERIC(15,2),
  target_value                NUMERIC(15,2) NOT NULL CHECK (target_value > 0),
  reward_amount               NUMERIC(15,2) NOT NULL CHECK (reward_amount > 0),
  reward_wallet_type          VARCHAR(10) NOT NULL DEFAULT 'bonus' CHECK (reward_wallet_type IN ('real', 'bonus')),
  max_completions_per_period  INT CHECK (max_completions_per_period IS NULL OR max_completions_per_period > 0),
  verification_type           VARCHAR(15) NOT NULL CHECK (verification_type IN ('auto', 'telegram_bot', 'manual_review')),
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  sort_order                  INT NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_player_missions_active ON player_missions(is_active, category, sort_order);

CREATE TABLE user_mission_completions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id        UUID NOT NULL REFERENCES player_missions(id) ON DELETE CASCADE,
  period_key        VARCHAR(10) NOT NULL,
  completion_number INT NOT NULL,
  reward_amount     NUMERIC(15,2) NOT NULL,
  status            VARCHAR(15) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending_review', 'rejected')),
  proof_url         TEXT,
  admin_note        TEXT,
  reviewed_by       UUID REFERENCES admin_users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mission_id, period_key, completion_number)
);

CREATE INDEX idx_user_mission_completions_user ON user_mission_completions(user_id, mission_id, period_key);
CREATE INDEX idx_user_mission_completions_pending ON user_mission_completions(status) WHERE status = 'pending_review';

CREATE TABLE user_telegram_links (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id  BIGINT UNIQUE NOT NULL,
  telegram_username TEXT,
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Apply it against the local dev DB**

Run: `psql "postgresql://teen:teen_secret_2024@localhost:5432/teen_db" -f infra/db/migrations/20260725_missions_system.sql`
Expected: three `CREATE TABLE` and index statements succeed, no errors.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/20260725_missions_system.sql
git commit -m "feat(missions): add player_missions schema"
```

---

### Task 6: Mission progress engine (pure functions + unit tests)

**Files:**
- Create: `services/core-api-service/src/helpers/missions.ts`
- Create: `services/core-api-service/src/helpers/missions.test.ts`

**Interfaces:**
- Produces:
  - `type MissionCategory = 'weekly' | 'monthly' | 'one_time'`
  - `getCurrentPeriod(category: MissionCategory, now: Date): { key: string; start: Date; end: Date }`
  - `computeCompletionsAvailable(metricValue: number, targetValue: number, maxCompletionsPerPeriod: number | null, alreadyClaimed: number): number`
- Consumed by: Task 7 (metric queries), Task 8 (missions routes)

- [ ] **Step 1: Write the failing tests**

```ts
// services/core-api-service/src/helpers/missions.test.ts
import { describe, it, expect } from 'vitest'
import { getCurrentPeriod, computeCompletionsAvailable } from './missions'

describe('getCurrentPeriod', () => {
  it('one_time always returns the "lifetime" key', () => {
    const p = getCurrentPeriod('one_time', new Date('2026-07-25T10:00:00Z'))
    expect(p.key).toBe('lifetime')
  })

  it('monthly returns the IST calendar month, even near a UTC month boundary', () => {
    // 2026-07-31T19:00:00Z = 2026-08-01T00:30 IST -> already August in IST
    const p = getCurrentPeriod('monthly', new Date('2026-07-31T19:00:00Z'))
    expect(p.key).toBe('2026-08')
  })

  it('monthly period start/end bracket the whole IST month', () => {
    const p = getCurrentPeriod('monthly', new Date('2026-07-15T10:00:00Z'))
    expect(p.key).toBe('2026-07')
    // July 1 00:00 IST = June 30 18:30 UTC
    expect(p.start.toISOString()).toBe('2026-06-30T18:30:00.000Z')
    // Aug 1 00:00 IST = July 31 18:30 UTC
    expect(p.end.toISOString()).toBe('2026-07-31T18:30:00.000Z')
  })

  it('weekly resets Monday 00:00 IST', () => {
    // Monday 2026-07-20 is the ISO week start; check a Sunday just before IST midnight rollover
    // 2026-07-19T19:00:00Z = 2026-07-20T00:30 IST -> Monday already in IST
    const p = getCurrentPeriod('weekly', new Date('2026-07-19T19:00:00Z'))
    expect(p.key).toBe('2026-W30')
    expect(p.start.toISOString()).toBe('2026-07-19T18:30:00.000Z') // Mon 00:00 IST
    expect(p.end.toISOString()).toBe('2026-07-26T18:30:00.000Z')   // next Mon 00:00 IST
  })

  it('weekly stays in the same week for a Sunday morning IST', () => {
    // 2026-07-25 (Sat) 10:00 UTC = 15:30 IST, still week of 2026-W30 (Mon 07-20 to Sun 07-26)
    const p = getCurrentPeriod('weekly', new Date('2026-07-25T10:00:00Z'))
    expect(p.key).toBe('2026-W30')
  })
})

describe('computeCompletionsAvailable', () => {
  it('caps at 1 for a single-completion mission ("play 1 Teen Patti game")', () => {
    expect(computeCompletionsAvailable(1, 1, 1, 0)).toBe(1)
    expect(computeCompletionsAvailable(5, 1, 1, 0)).toBe(1) // extra games don't multiply the reward
    expect(computeCompletionsAvailable(1, 1, 1, 1)).toBe(0) // already claimed this period
  })

  it('is uncapped for repeatable missions ("invite a friend")', () => {
    expect(computeCompletionsAvailable(3, 1, null, 0)).toBe(3)
    expect(computeCompletionsAvailable(3, 1, null, 2)).toBe(1)
  })

  it('handles a large threshold with a cap ("100 referrals -> reward once")', () => {
    expect(computeCompletionsAvailable(37, 100, 1, 0)).toBe(0)
    expect(computeCompletionsAvailable(150, 100, 1, 0)).toBe(1) // floor(150/100)=1, capped at 1 anyway
  })

  it('never returns a negative number', () => {
    expect(computeCompletionsAvailable(0, 1000, 1, 0)).toBe(0)
    expect(computeCompletionsAvailable(1, 1, 1, 5)).toBe(0) // claimed more than available (shouldn't happen, but must not go negative)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/core-api-service && npx vitest run src/helpers/missions.test.ts`
Expected: FAIL with "Cannot find module './missions'"

- [ ] **Step 3: Write the implementation**

```ts
// services/core-api-service/src/helpers/missions.ts
export type MissionCategory = 'weekly' | 'monthly' | 'one_time'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function toIstShifted(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS)
}

function fromIstShifted(d: Date): Date {
  return new Date(d.getTime() - IST_OFFSET_MS)
}

function isoWeekKey(istShiftedMonday: Date): string {
  // istShiftedMonday is already the Monday 00:00 of the IST week, expressed
  // in the shifted (fake-UTC) frame. Standard ISO-8601 week number algorithm.
  const d = new Date(Date.UTC(istShiftedMonday.getUTCFullYear(), istShiftedMonday.getUTCMonth(), istShiftedMonday.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/**
 * Computes the current mission period for a given category, aligned to IST
 * day boundaries (weekly resets Monday 00:00 IST, monthly resets the 1st
 * 00:00 IST). Returned start/end are real UTC instants suitable for a SQL
 * `created_at >= start AND created_at < end` range query.
 */
export function getCurrentPeriod(category: MissionCategory, now: Date): { key: string; start: Date; end: Date } {
  if (category === 'one_time') {
    return { key: 'lifetime', start: new Date(0), end: new Date(now.getTime() + 1) }
  }

  const ist = toIstShifted(now)

  if (category === 'monthly') {
    const startIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1))
    const endIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1))
    const key = `${startIst.getUTCFullYear()}-${String(startIst.getUTCMonth() + 1).padStart(2, '0')}`
    return { key, start: fromIstShifted(startIst), end: fromIstShifted(endIst) }
  }

  // weekly
  const isoDay = (ist.getUTCDay() + 6) % 7 // Monday=0 .. Sunday=6
  const startIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - isoDay))
  const endIst = new Date(startIst.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { key: isoWeekKey(startIst), start: fromIstShifted(startIst), end: fromIstShifted(endIst) }
}

/**
 * The one formula every mission metric type shares: how many more times can
 * this user claim the reward this period, given their raw activity metric?
 */
export function computeCompletionsAvailable(
  metricValue: number,
  targetValue: number,
  maxCompletionsPerPeriod: number | null,
  alreadyClaimed: number,
): number {
  const eligible = Math.floor(metricValue / targetValue)
  const capped = maxCompletionsPerPeriod === null ? eligible : Math.min(eligible, maxCompletionsPerPeriod)
  return Math.max(0, capped - alreadyClaimed)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/core-api-service && npx vitest run src/helpers/missions.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/helpers/missions.ts services/core-api-service/src/helpers/missions.test.ts
git commit -m "feat(missions): add IST period + completions-available progress engine"
```

---

### Task 7: Mission metric queries (DB-backed) + tests

**Files:**
- Create: `services/core-api-service/src/helpers/mission-metrics.ts`
- Create: `services/core-api-service/src/helpers/mission-metrics.test.ts`

**Interfaces:**
- Consumes: `pool` from `services/core-api-service/src/db/pool.ts` (already initialized by the betting plugin at app boot — these tests run against the local dev DB the same way `lottery-bot-fill.test.ts` does)
- Produces:
  - `getDepositSum(userId: string, start: Date, end: Date): Promise<number>`
  - `getReferralCount(userId: string, start: Date, end: Date): Promise<number>`
  - `getGamePlayedCount(userId: string, gameType: string, minStake: number | null, start: Date, end: Date): Promise<number>`
- Consumed by: Task 8 (missions routes)

- [ ] **Step 1: Write the failing tests**

```ts
// services/core-api-service/src/helpers/mission-metrics.test.ts
import { pool } from '../db/pool'
import crypto from 'crypto'
import { getDepositSum, getReferralCount, getGamePlayedCount } from './mission-metrics'

async function createTestUser(): Promise<string> {
  const phone = `9${crypto.randomInt(100000000, 999999999)}`
  const res = await pool.query(
    `INSERT INTO users (phone, username, referral_code) VALUES ($1, $2, $3) RETURNING id`,
    [phone, `test_${phone}`, `REF${phone.slice(-6)}`],
  )
  return res.rows[0].id
}

describe('getDepositSum', () => {
  it('sums only completed deposits within the window', async () => {
    const userId = await createTestUser()
    await pool.query(
      `INSERT INTO wallet_transactions (user_id, type, wallet_type, amount, balance_before, balance_after, idempotency_key, status)
       VALUES
       ($1, 'deposit', 'real', 500, 0, 500, $2, 'completed'),
       ($1, 'deposit', 'real', 600, 500, 1100, $3, 'pending'),
       ($1, 'withdrawal', 'real', 200, 1100, 900, $4, 'completed')`,
      [userId, `dep1_${userId}`, `dep2_${userId}`, `wd1_${userId}`],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    const sum = await getDepositSum(userId, start, end)
    expect(sum).toBe(500) // pending deposit and the withdrawal are excluded
  })

  it('excludes deposits outside the window', async () => {
    const userId = await createTestUser()
    await pool.query(
      `INSERT INTO wallet_transactions (user_id, type, wallet_type, amount, balance_before, balance_after, idempotency_key, status, created_at)
       VALUES ($1, 'deposit', 'real', 1000, 0, 1000, $2, 'completed', NOW() - INTERVAL '10 days')`,
      [userId, `old_dep_${userId}`],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    expect(await getDepositSum(userId, start, end)).toBe(0)
  })
})

describe('getReferralCount', () => {
  it('counts only qualified/rewarded referrals in the window', async () => {
    const referrer = await createTestUser()
    const rewarded = await createTestUser()
    const pending = await createTestUser()
    await pool.query(
      `INSERT INTO referrals (referrer_id, referee_id, status, qualified_at) VALUES ($1, $2, 'rewarded', NOW())`,
      [referrer, rewarded],
    )
    await pool.query(
      `INSERT INTO referrals (referrer_id, referee_id, status) VALUES ($1, $2, 'pending')`,
      [referrer, pending],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    expect(await getReferralCount(referrer, start, end)).toBe(1)
  })
})

describe('getGamePlayedCount', () => {
  it('counts non-bot games of the given type with stake >= minStake in the window', async () => {
    const userId = await createTestUser()
    const highStakeRoom = (await pool.query(
      `INSERT INTO game_rooms (game_type, entry_fee) VALUES ('ludo', 50) RETURNING id`,
    )).rows[0].id
    const lowStakeRoom = (await pool.query(
      `INSERT INTO game_rooms (game_type, entry_fee) VALUES ('ludo', 10) RETURNING id`,
    )).rows[0].id
    await pool.query(
      `INSERT INTO game_participants (room_id, user_id, seat_number, is_bot) VALUES ($1, $2, 0, false)`,
      [highStakeRoom, userId],
    )
    await pool.query(
      `INSERT INTO game_participants (room_id, user_id, seat_number, is_bot) VALUES ($1, $2, 0, false)`,
      [lowStakeRoom, userId],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    expect(await getGamePlayedCount(userId, 'ludo', 50, start, end)).toBe(1)
    expect(await getGamePlayedCount(userId, 'ludo', null, start, end)).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/core-api-service && npx vitest run src/helpers/mission-metrics.test.ts`
Expected: FAIL with "Cannot find module './mission-metrics'"

- [ ] **Step 3: Write the implementation**

```ts
// services/core-api-service/src/helpers/mission-metrics.ts
import { pool } from '../db/pool'

export async function getDepositSum(userId: string, start: Date, end: Date): Promise<number> {
  const res = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions
     WHERE user_id = $1 AND type = 'deposit' AND status = 'completed'
       AND created_at >= $2 AND created_at < $3`,
    [userId, start, end],
  )
  return parseFloat(res.rows[0].total)
}

export async function getReferralCount(userId: string, start: Date, end: Date): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM referrals
     WHERE referrer_id = $1 AND status IN ('qualified', 'rewarded')
       AND COALESCE(qualified_at, created_at) >= $2 AND COALESCE(qualified_at, created_at) < $3`,
    [userId, start, end],
  )
  return res.rows[0].count
}

export async function getGamePlayedCount(
  userId: string,
  gameType: string,
  minStake: number | null,
  start: Date,
  end: Date,
): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM game_participants gp
     JOIN game_rooms gr ON gr.id = gp.room_id
     WHERE gp.user_id = $1 AND gr.game_type = $2 AND gp.is_bot = false
       AND ($3::numeric IS NULL OR gr.entry_fee >= $3)
       AND gp.joined_at >= $4 AND gp.joined_at < $5`,
    [userId, gameType, minStake, start, end],
  )
  return res.rows[0].count
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/core-api-service && npx vitest run src/helpers/mission-metrics.test.ts`
Expected: PASS (4 tests) — requires local Postgres at `DATABASE_URL` from `.env` to be running and migrated, same as the existing `lottery-bot-fill.test.ts` suite.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/helpers/mission-metrics.ts services/core-api-service/src/helpers/mission-metrics.test.ts
git commit -m "feat(missions): add deposit/referral/game-played metric queries"
```

---

### Task 8: Missions plugin routes (core-api-service)

**Files:**
- Create: `services/core-api-service/src/plugins/missions.ts`
- Modify: `services/core-api-service/src/index.ts` (import + register, alongside the other plugin registrations around line 75-82)

**Interfaces:**
- Consumes: `getCurrentPeriod`, `computeCompletionsAvailable` (Task 6); `getDepositSum`, `getReferralCount`, `getGamePlayedCount` (Task 7); `player_missions` / `user_mission_completions` / `user_telegram_links` tables (Task 5)
- Produces: `GET /users/missions`, `POST /users/missions/:id/claim`, `POST /users/missions/:id/submit` — response shape for `GET /users/missions`:
  ```ts
  {
    weekly: MissionView[],  // includes one_time missions
    monthly: MissionView[],
  }
  // MissionView:
  {
    id: string, title: string, description: string | null, emoji: string,
    category: 'weekly' | 'monthly' | 'one_time', metric_type: string,
    target_value: number, reward_amount: number, reward_wallet_type: 'real' | 'bonus',
    progress_current: number, progress_target: number, completions_available: number,
    state: 'claim' | 'in_progress' | 'connect_telegram' | 'submit_proof' | 'pending_review' | 'completed_period',
  }
  ```
  Consumed by Task 14 (mobile).

- [ ] **Step 1: Write the plugin**

```ts
// services/core-api-service/src/plugins/missions.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import crypto from 'crypto'
import { getCurrentPeriod, computeCompletionsAvailable } from '../helpers/missions'
import { getDepositSum, getReferralCount, getGamePlayedCount } from '../helpers/mission-metrics'

const PROOF_UPLOAD_DIR = process.env.MISSION_PROOF_UPLOAD_DIR || '/opt/teen/uploads/mission-proofs'
const APP_URL = process.env.APP_URL || 'https://game.myonlinejoker.com'
const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL || 'http://127.0.0.1:3003'
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || ''

interface Mission {
  id: string
  title: string
  description: string | null
  emoji: string
  category: 'weekly' | 'monthly' | 'one_time'
  metric_type: 'deposit_amount' | 'referral_count' | 'game_played' | 'telegram_join' | 'manual_proof'
  game_type: string | null
  min_stake: string | null
  target_value: string
  reward_amount: string
  reward_wallet_type: 'real' | 'bonus'
  max_completions_per_period: number | null
  verification_type: 'auto' | 'telegram_bot' | 'manual_review'
}

async function creditWallet(userId: string, mission: Mission, idempotencyKey: string) {
  const type = mission.reward_wallet_type === 'bonus' ? 'bonus' : 'manual_credit'
  await fetch(`${WALLET_SERVICE_URL}/internal/wallet/credit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_SERVICE_KEY },
    body: JSON.stringify({
      user_id: userId,
      amount: parseFloat(mission.reward_amount),
      type,
      idempotency_key: idempotencyKey,
      description: `Mission reward: ${mission.title}`,
    }),
  }).catch(err => console.error('[missions] wallet credit failed:', err))
}

async function getMetricValue(db: Pool, userId: string, mission: Mission, start: Date, end: Date): Promise<number> {
  switch (mission.metric_type) {
    case 'deposit_amount':
      return getDepositSum(userId, start, end)
    case 'referral_count':
      return getReferralCount(userId, start, end)
    case 'game_played':
      return getGamePlayedCount(userId, mission.game_type!, mission.min_stake ? parseFloat(mission.min_stake) : null, start, end)
    case 'telegram_join': {
      const res = await db.query(`SELECT 1 FROM user_telegram_links WHERE user_id = $1`, [userId])
      return res.rows.length ? 1 : 0
    }
    default:
      return 0
  }
}

async function getAlreadyClaimed(db: Pool, userId: string, missionId: string, periodKey: string): Promise<number> {
  const res = await db.query(
    `SELECT COUNT(*)::int AS count FROM user_mission_completions
     WHERE user_id = $1 AND mission_id = $2 AND period_key = $3 AND status != 'rejected'`,
    [userId, missionId, periodKey],
  )
  return res.rows[0].count
}

async function getNextCompletionNumber(db: Pool, userId: string, missionId: string, periodKey: string): Promise<number> {
  const res = await db.query(
    `SELECT COUNT(*)::int AS count FROM user_mission_completions WHERE user_id = $1 AND mission_id = $2 AND period_key = $3`,
    [userId, missionId, periodKey],
  )
  return res.rows[0].count + 1
}

export function missionsPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    fs.mkdirSync(PROOF_UPLOAD_DIR, { recursive: true })

    app.get('/users/missions', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const missionsRes = await db.query<Mission>(`SELECT * FROM player_missions WHERE is_active = true ORDER BY category, sort_order`)
      const now = new Date()

      const views = await Promise.all(missionsRes.rows.map(async (mission) => {
        const period = getCurrentPeriod(mission.category, now)
        const alreadyClaimed = await getAlreadyClaimed(db, user.sub, mission.id, period.key)
        const target = parseFloat(mission.target_value)
        const reward = parseFloat(mission.reward_amount)

        if (mission.metric_type === 'manual_proof') {
          const latest = await db.query(
            `SELECT status FROM user_mission_completions WHERE user_id = $1 AND mission_id = $2 AND period_key = $3
             ORDER BY completion_number DESC LIMIT 1`,
            [user.sub, mission.id, period.key],
          )
          const latestStatus = latest.rows[0]?.status
          const state = alreadyClaimed >= (mission.max_completions_per_period ?? 1)
            ? 'completed_period'
            : latestStatus === 'pending_review' ? 'pending_review' : 'submit_proof'
          return {
            id: mission.id, title: mission.title, description: mission.description, emoji: mission.emoji,
            category: mission.category, metric_type: mission.metric_type,
            target_value: target, reward_amount: reward, reward_wallet_type: mission.reward_wallet_type,
            progress_current: alreadyClaimed, progress_target: mission.max_completions_per_period ?? 1,
            completions_available: 0, state,
          }
        }

        const metricValue = await getMetricValue(db, user.sub, mission, period.start, period.end)
        const completionsAvailable = computeCompletionsAvailable(metricValue, target, mission.max_completions_per_period, alreadyClaimed)

        let state: string
        if (mission.metric_type === 'telegram_join' && metricValue === 0) {
          state = 'connect_telegram'
        } else if (completionsAvailable > 0) {
          state = 'claim'
        } else if (metricValue < target) {
          state = 'in_progress'
        } else {
          state = 'completed_period'
        }

        return {
          id: mission.id, title: mission.title, description: mission.description, emoji: mission.emoji,
          category: mission.category, metric_type: mission.metric_type,
          target_value: target, reward_amount: reward, reward_wallet_type: mission.reward_wallet_type,
          progress_current: metricValue, progress_target: target,
          completions_available: completionsAvailable, state,
        }
      }))

      return reply.send({
        weekly: views.filter(v => v.category === 'weekly' || v.category === 'one_time'),
        monthly: views.filter(v => v.category === 'monthly'),
      })
    })

    app.post('/users/missions/:id/claim', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as { id: string }
      const missionRes = await db.query<Mission>(
        `SELECT * FROM player_missions WHERE id = $1 AND is_active = true AND verification_type IN ('auto', 'telegram_bot')`,
        [id],
      )
      const mission = missionRes.rows[0]
      if (!mission) return reply.code(404).send({ error: 'Mission not found' })

      const period = getCurrentPeriod(mission.category, new Date())
      const alreadyClaimed = await getAlreadyClaimed(db, user.sub, mission.id, period.key)
      const metricValue = await getMetricValue(db, user.sub, mission, period.start, period.end)
      const target = parseFloat(mission.target_value)
      const completionsAvailable = computeCompletionsAvailable(metricValue, target, mission.max_completions_per_period, alreadyClaimed)
      if (completionsAvailable < 1) return reply.code(400).send({ error: 'Nothing to claim yet' })

      const completionNumber = await getNextCompletionNumber(db, user.sub, mission.id, period.key)
      const rewardAmount = parseFloat(mission.reward_amount)
      try {
        await db.query(
          `INSERT INTO user_mission_completions (user_id, mission_id, period_key, completion_number, reward_amount, status)
           VALUES ($1, $2, $3, $4, $5, 'completed')`,
          [user.sub, mission.id, period.key, completionNumber, rewardAmount],
        )
      } catch (err: any) {
        if (err.code === '23505') return reply.code(409).send({ error: 'Already claimed' }) // unique violation race
        throw err
      }

      await creditWallet(user.sub, mission, `mission:${mission.id}:${user.sub}:${period.key}:${completionNumber}`)
      return reply.send({ success: true, reward_amount: rewardAmount, completion_number: completionNumber })
    })

    app.post('/users/missions/:id/submit', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as { id: string }
      const missionRes = await db.query<Mission>(
        `SELECT * FROM player_missions WHERE id = $1 AND is_active = true AND verification_type = 'manual_review'`,
        [id],
      )
      const mission = missionRes.rows[0]
      if (!mission) return reply.code(404).send({ error: 'Mission not found' })

      const period = getCurrentPeriod(mission.category, new Date())
      const alreadyClaimed = await getAlreadyClaimed(db, user.sub, mission.id, period.key)
      const cap = mission.max_completions_per_period ?? 1
      if (alreadyClaimed >= cap) return reply.code(400).send({ error: 'Already submitted for this period' })

      let proofUrl: string | null = null
      if (req.isMultipart()) {
        const data = await (req as any).file()
        if (data) {
          const ext = path.extname(data.filename || '.jpg').toLowerCase()
          const filename = `${user.sub}_${mission.id}_${crypto.randomBytes(6).toString('hex')}${ext}`
          await pipeline(data.file, fs.createWriteStream(path.join(PROOF_UPLOAD_DIR, filename)))
          proofUrl = `${APP_URL}/uploads/mission-proofs/${filename}`
        }
      }

      const completionNumber = await getNextCompletionNumber(db, user.sub, mission.id, period.key)
      await db.query(
        `INSERT INTO user_mission_completions (user_id, mission_id, period_key, completion_number, reward_amount, status, proof_url)
         VALUES ($1, $2, $3, $4, $5, 'pending_review', $6)`,
        [user.sub, mission.id, period.key, completionNumber, mission.reward_amount, proofUrl],
      )
      return reply.send({ success: true, status: 'pending_review' })
    })
  }
}
```

- [ ] **Step 2: Register the plugin**

In `services/core-api-service/src/index.ts`, add near the other plugin imports (after line 19):
```ts
import { missionsPlugin } from './plugins/missions'
```
And near the other `app.register` calls (after `await app.register(referralPlugin(db))`):
```ts
await app.register(missionsPlugin(db))
```

- [ ] **Step 3: Add the upload dir env var to `.env.example`**

Append to `services/core-api-service/.env.example`:
```
MISSION_PROOF_UPLOAD_DIR=/opt/teen/uploads/mission-proofs
```

- [ ] **Step 4: Type-check**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run: `cd services/core-api-service && npm run dev` (or however the service is normally started locally), then in another terminal:
```bash
curl -s http://localhost:3001/users/missions -H "Authorization: Bearer <a real test JWT>"
```
Expected: `{"weekly":[],"monthly":[]}` (empty, since no missions exist in the DB yet — Task 10 adds admin CRUD to create some).

- [ ] **Step 6: Commit**

```bash
git add services/core-api-service/src/plugins/missions.ts services/core-api-service/src/index.ts services/core-api-service/.env.example
git commit -m "feat(missions): add player-facing missions routes"
```

---

### Task 9: Telegram linking plugin (core-api-service)

**Files:**
- Create: `services/core-api-service/src/plugins/telegram.ts`
- Modify: `services/core-api-service/src/index.ts` (import + register)

**Interfaces:**
- Consumes: `user_telegram_links` table (Task 5); `app.jwt` (from `@fastify/jwt`, already registered in `index.ts`)
- Produces: `GET /telegram/deep-link` (authenticated), `POST /telegram/webhook` (public, secret-header-verified)

- [ ] **Step 1: Write the plugin**

```ts
// services/core-api-service/src/plugins/telegram.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || ''
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || ''
const TELEGRAM_GROUP_INVITE_LINK = process.env.TELEGRAM_GROUP_INVITE_LINK || ''
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

async function callTelegramApi(method: string, params: Record<string, any>) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return res.json()
}

export function telegramPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    app.get('/telegram/deep-link', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const token = app.jwt.sign({ sub: user.sub, purpose: 'telegram_link' }, { expiresIn: '15m' })
      return reply.send({ link: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}` })
    })

    app.post('/telegram/webhook', async (req, reply) => {
      const secret = req.headers['x-telegram-bot-api-secret-token']
      if (secret !== TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ error: 'Unauthorized' })

      const body = req.body as any
      const message = body?.message
      const text: string | undefined = message?.text
      if (!text || !text.startsWith('/start ')) return reply.send({ ok: true })

      const token = text.slice('/start '.length).trim()
      let payload: any
      try {
        payload = app.jwt.verify(token)
      } catch {
        await callTelegramApi('sendMessage', { chat_id: message.chat.id, text: 'This link has expired — go back to the app and tap "Connect Telegram" again.' })
        return reply.send({ ok: true })
      }
      if (payload.purpose !== 'telegram_link') return reply.send({ ok: true })

      const telegramUserId = message.from.id
      const member = await callTelegramApi('getChatMember', { chat_id: TELEGRAM_GROUP_CHAT_ID, user_id: telegramUserId })
      const isMember = member?.ok && ['member', 'administrator', 'creator'].includes(member.result?.status)

      if (!isMember) {
        await callTelegramApi('sendMessage', {
          chat_id: message.chat.id,
          text: `You need to join the group first: ${TELEGRAM_GROUP_INVITE_LINK}\nThen come back and tap "Connect Telegram" again.`,
        })
        return reply.send({ ok: true })
      }

      await db.query(
        `INSERT INTO user_telegram_links (user_id, telegram_user_id, telegram_username, linked_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id, telegram_username = EXCLUDED.telegram_username, linked_at = NOW()`,
        [payload.sub, telegramUserId, message.from.username || null],
      )
      await callTelegramApi('sendMessage', { chat_id: message.chat.id, text: '✅ Verified! Go back to the app to claim your reward.' })
      return reply.send({ ok: true })
    })
  }
}
```

- [ ] **Step 2: Register the plugin**

In `services/core-api-service/src/index.ts`, add the import alongside `missionsPlugin` and register it:
```ts
import { telegramPlugin } from './plugins/telegram'
// ...
await app.register(telegramPlugin(db))
```

- [ ] **Step 3: Add env vars**

Append to `services/core-api-service/.env.example`:
```
# Telegram bot (Join Group mission verification)
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_BOT_USERNAME=YourBotUsername
TELEGRAM_GROUP_CHAT_ID=-1001234567890
TELEGRAM_GROUP_INVITE_LINK=https://t.me/your_group_invite
TELEGRAM_WEBHOOK_SECRET=a_random_secret_you_choose
```

- [ ] **Step 4: Type-check**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/plugins/telegram.ts services/core-api-service/src/index.ts services/core-api-service/.env.example
git commit -m "feat(missions): add Telegram deep-link + webhook group verification"
```

**Deployment note (not a code step — flag to the user before going live):** after deploying, register the webhook once with `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://game.myonlinejoker.com/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"` using the real `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` values.

---

### Task 10: Admin-service mission-routes.ts: CRUD

**Files:**
- Create: `services/admin-service/src/mission-routes.ts`
- Modify: `services/admin-service/src/index.ts` (import + register, alongside `registerTaskRoutes`)

**Interfaces:**
- Consumes: `player_missions` table (Task 5); `authenticate`, `requireRole` from `index.ts` (same signature as `registerTaskRoutes(app, db, authenticate, requireRole)`)
- Produces: `registerMissionRoutes(app, db, authenticate, requireRole)` exposing `GET/POST/PUT/DELETE /api/admin/missions[/:id]`
- Consumed by: Task 11 (adds review-queue routes to the same file), Task 12 (admin panel)

- [ ] **Step 1: Write the CRUD routes**

```ts
// services/admin-service/src/mission-routes.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'

// Backs the Missions admin page (admin-panel/src/pages/Missions.tsx).
// Named "mission" to avoid colliding with the unrelated employee task-tracker
// (tasks/task_comments, registerTaskRoutes in task-routes.ts).
// See docs/superpowers/specs/2026-07-25-daily-bonus-removal-task-system-design.md

const missionBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  emoji: z.string().max(10).default('🎯'),
  category: z.enum(['weekly', 'monthly', 'one_time']),
  metric_type: z.enum(['deposit_amount', 'referral_count', 'game_played', 'telegram_join', 'manual_proof']),
  game_type: z.string().max(20).optional(),
  min_stake: z.number().min(0).optional(),
  target_value: z.number().positive(),
  reward_amount: z.number().positive(),
  reward_wallet_type: z.enum(['real', 'bonus']).default('bonus'),
  max_completions_per_period: z.number().int().positive().nullable().default(1),
  verification_type: z.enum(['auto', 'telegram_bot', 'manual_review']),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
})

export async function registerMissionRoutes(
  app: FastifyInstance,
  db: Pool,
  authenticate: any,
  requireRole: any,
) {
  app.get('/api/admin/missions', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query(`SELECT * FROM player_missions ORDER BY category, sort_order, created_at`)
    return reply.send(res.rows)
  })

  app.post('/api/admin/missions', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const b = missionBodySchema.parse(req.body)
    const res = await db.query(
      `INSERT INTO player_missions
       (title, description, emoji, category, metric_type, game_type, min_stake, target_value, reward_amount, reward_wallet_type, max_completions_per_period, verification_type, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [b.title, b.description ?? null, b.emoji, b.category, b.metric_type, b.game_type ?? null, b.min_stake ?? null,
       b.target_value, b.reward_amount, b.reward_wallet_type, b.max_completions_per_period, b.verification_type, b.is_active, b.sort_order],
    )
    return reply.code(201).send(res.rows[0])
  })

  app.put('/api/admin/missions/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = missionBodySchema.parse(req.body)
    const res = await db.query(
      `UPDATE player_missions SET
         title=$1, description=$2, emoji=$3, category=$4, metric_type=$5, game_type=$6, min_stake=$7,
         target_value=$8, reward_amount=$9, reward_wallet_type=$10, max_completions_per_period=$11,
         verification_type=$12, is_active=$13, sort_order=$14, updated_at=NOW()
       WHERE id = $15 RETURNING *`,
      [b.title, b.description ?? null, b.emoji, b.category, b.metric_type, b.game_type ?? null, b.min_stake ?? null,
       b.target_value, b.reward_amount, b.reward_wallet_type, b.max_completions_per_period, b.verification_type, b.is_active, b.sort_order, id],
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Mission not found' })
    return reply.send(res.rows[0])
  })

  // "Delete" deactivates rather than removing the row, so mission history in
  // user_mission_completions (and its FK) stays intact.
  app.delete('/api/admin/missions/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const res = await db.query(`UPDATE player_missions SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [id])
    if (!res.rows.length) return reply.code(404).send({ error: 'Mission not found' })
    return reply.send({ success: true })
  })
}
```

- [ ] **Step 2: Register in `index.ts`**

Add import after `import { registerTaskRoutes } from './task-routes'`:
```ts
import { registerMissionRoutes } from './mission-routes'
```
Add registration after `await registerTaskRoutes(app, db, authenticate, requireRole)`:
```ts
// Register Missions routes (player-facing rewards — distinct from the employee Task Management above)
await registerMissionRoutes(app, db, authenticate, requireRole)
```

- [ ] **Step 3: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Run the admin-service locally, then:
```bash
curl -s -X POST http://localhost:3000/api/admin/missions \
  -H "Authorization: Bearer <a real finance/superadmin admin JWT>" -H "Content-Type: application/json" \
  -d '{"title":"Play 1 Ludo Match","category":"weekly","metric_type":"game_played","game_type":"ludo","min_stake":50,"target_value":1,"reward_amount":20,"verification_type":"auto"}'
```
Expected: 201 with the created mission row.

- [ ] **Step 5: Commit**

```bash
git add services/admin-service/src/mission-routes.ts services/admin-service/src/index.ts
git commit -m "feat(missions): add admin mission CRUD routes"
```

---

### Task 11: Admin-service mission-routes.ts: review queue + stats

**Files:**
- Modify: `services/admin-service/src/mission-routes.ts` (append routes to the same `registerMissionRoutes` function)

**Interfaces:**
- Consumes: `user_mission_completions` table (Task 5); wallet-service `/internal/wallet/credit`
- Produces: `GET /api/admin/missions/review-queue`, `POST /api/admin/missions/review-queue/:id/approve`, `POST /api/admin/missions/review-queue/:id/reject`, `GET /api/admin/missions/stats`
- Consumed by: Task 13 (admin panel Review Queue tab)

- [ ] **Step 1: Add the routes**

Add these inside `registerMissionRoutes`, after the `DELETE /api/admin/missions/:id` route, and add `INTERNAL_SERVICE_KEY`/`WALLET_SERVICE_URL` constants + a credit helper at the top of the file (below the imports):

```ts
// (add near the top of mission-routes.ts, after the imports)
const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL || 'http://127.0.0.1:3003'
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || ''

async function creditMissionReward(userId: string, rewardWalletType: 'real' | 'bonus', amount: number, description: string, idempotencyKey: string) {
  const type = rewardWalletType === 'bonus' ? 'bonus' : 'manual_credit'
  await fetch(`${WALLET_SERVICE_URL}/internal/wallet/credit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_SERVICE_KEY },
    body: JSON.stringify({ user_id: userId, amount, type, idempotency_key: idempotencyKey, description }),
  })
}
```

```ts
// (add inside registerMissionRoutes, after the DELETE route)
app.get('/api/admin/missions/review-queue', { onRequest: [authenticate] }, async (_req, reply) => {
  const res = await db.query(
    `SELECT c.id, c.user_id, u.username, c.mission_id, m.title AS mission_title, c.period_key,
            c.reward_amount, c.proof_url, c.created_at
     FROM user_mission_completions c
     JOIN player_missions m ON m.id = c.mission_id
     JOIN users u ON u.id = c.user_id
     WHERE c.status = 'pending_review'
     ORDER BY c.created_at ASC`,
  )
  return reply.send(res.rows)
})

app.post('/api/admin/missions/review-queue/:id/approve', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
  const { id } = req.params as { id: string }
  const admin = req.user as any
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query(
      `UPDATE user_mission_completions SET status = 'completed', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND status = 'pending_review' RETURNING *`,
      [admin.sub, id],
    )
    if (!res.rows.length) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Submission not found or already reviewed' }) }
    const completion = res.rows[0]
    const missionRes = await client.query(`SELECT title, reward_wallet_type FROM player_missions WHERE id = $1`, [completion.mission_id])
    await client.query('COMMIT')

    const mission = missionRes.rows[0]
    await creditMissionReward(
      completion.user_id, mission.reward_wallet_type, parseFloat(completion.reward_amount),
      `Mission reward: ${mission.title}`,
      `mission:${completion.mission_id}:${completion.user_id}:${completion.period_key}:${completion.completion_number}`,
    )
    return reply.send({ success: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

app.post('/api/admin/missions/review-queue/:id/reject', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
  const { id } = req.params as { id: string }
  const admin = req.user as any
  const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body)
  const res = await db.query(
    `UPDATE user_mission_completions SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $3 AND status = 'pending_review' RETURNING id`,
    [reason, admin.sub, id],
  )
  if (!res.rows.length) return reply.code(404).send({ error: 'Submission not found or already reviewed' })
  return reply.send({ success: true })
})

app.get('/api/admin/missions/stats', { onRequest: [authenticate] }, async (_req, reply) => {
  const [today, allTime, pending] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(reward_amount),0) AS amount FROM user_mission_completions WHERE status = 'completed' AND created_at::date = CURRENT_DATE`),
    db.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(reward_amount),0) AS amount FROM user_mission_completions WHERE status = 'completed'`),
    db.query(`SELECT COUNT(*)::int AS count FROM user_mission_completions WHERE status = 'pending_review'`),
  ])
  return reply.send({
    today: { completions: today.rows[0].count, distributed: today.rows[0].amount },
    all_time: { completions: allTime.rows[0].count, distributed: allTime.rows[0].amount },
    pending_review: pending.rows[0].count,
  })
})
```

- [ ] **Step 2: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

With a `pending_review` row already in the DB (submit one via the `/users/missions/:id/submit` route from Task 8 against a `manual_review` mission created in Task 10's smoke test):
```bash
curl -s http://localhost:3000/api/admin/missions/review-queue -H "Authorization: Bearer <admin JWT>"
```
Expected: an array containing that submission.

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/mission-routes.ts
git commit -m "feat(missions): add admin review queue + stats routes"
```

---

### Task 12: Admin panel Missions.tsx — Config tab

**Files:**
- Create: `admin-panel/src/pages/Missions.tsx`
- Modify: `admin-panel/src/main.tsx` (lazy import + route, replacing where `DailyBonus` used to be)
- Modify: `admin-panel/src/pages/layout/menuConfig.ts` (menu entry, replacing where Daily Bonus used to be — reuse `GiftOutlined` or switch to `TrophyOutlined`, already imported for other pages)
- Modify: `admin-panel/src/pages/layout/menuConfig.test.ts` (add `/admin/missions` to `EXPECTED_KEYS`)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/admin/missions` (Task 10)
- Produces: the `Missions` page component, extended by Task 13 with a second tab

- [ ] **Step 1: Write the Config tab**

```tsx
// admin-panel/src/pages/Missions.tsx
import { useEffect, useState } from 'react'
import {
  Card, Table, Input, InputNumber, Button, Select, Switch, Typography, Space,
  message, Tag, Modal, Form, Tabs, Popconfirm,
} from 'antd'
import { PlusOutlined, TrophyOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

interface Mission {
  id: string
  title: string
  description: string | null
  emoji: string
  category: 'weekly' | 'monthly' | 'one_time'
  metric_type: 'deposit_amount' | 'referral_count' | 'game_played' | 'telegram_join' | 'manual_proof'
  game_type: string | null
  min_stake: number | null
  target_value: number
  reward_amount: number
  reward_wallet_type: 'real' | 'bonus'
  max_completions_per_period: number | null
  verification_type: 'auto' | 'telegram_bot' | 'manual_review'
  is_active: boolean
  sort_order: number
}

const METRIC_LABELS: Record<Mission['metric_type'], string> = {
  deposit_amount: 'Deposit Amount (₹)',
  referral_count: 'Referral Count',
  game_played: 'Games Played',
  telegram_join: 'Telegram Group Join',
  manual_proof: 'Manual Proof (Review Queue)',
}

function MissionConfigTab() {
  const { token } = useAuthStore()
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Mission | null>(null)
  const [form] = Form.useForm()

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchMissions = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/missions', { headers })
      setMissions(await res.json())
    } catch {
      message.error('Failed to load missions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMissions() }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ emoji: '🎯', reward_wallet_type: 'bonus', max_completions_per_period: 1, is_active: true, sort_order: 0 })
    setModalOpen(true)
  }

  const openEdit = (m: Mission) => {
    setEditing(m)
    form.setFieldsValue(m)
    setModalOpen(true)
  }

  const save = async () => {
    const values = await form.validateFields()
    const url = editing ? `/api/admin/missions/${editing.id}` : '/api/admin/missions'
    const method = editing ? 'PUT' : 'POST'
    const res = await fetch(url, { method, headers, body: JSON.stringify(values) })
    if (!res.ok) return message.error('Save failed')
    message.success(editing ? 'Mission updated' : 'Mission created')
    setModalOpen(false)
    fetchMissions()
  }

  const deactivate = async (id: string) => {
    const res = await fetch(`/api/admin/missions/${id}`, { method: 'DELETE', headers })
    if (!res.ok) return message.error('Failed to deactivate')
    message.success('Mission deactivated')
    fetchMissions()
  }

  const columns = [
    { title: 'Emoji', dataIndex: 'emoji', width: 60 },
    { title: 'Title', dataIndex: 'title' },
    { title: 'Category', dataIndex: 'category', render: (v: string) => <Tag color={v === 'weekly' ? 'blue' : v === 'monthly' ? 'purple' : 'gold'}>{v}</Tag> },
    { title: 'Metric', dataIndex: 'metric_type', render: (v: Mission['metric_type']) => METRIC_LABELS[v] },
    { title: 'Target', dataIndex: 'target_value' },
    { title: 'Reward', dataIndex: 'reward_amount', render: (v: number, row: Mission) => `₹${v} (${row.reward_wallet_type})` },
    { title: 'Max/Period', dataIndex: 'max_completions_per_period', render: (v: number | null) => v ?? 'Unlimited' },
    { title: 'Verification', dataIndex: 'verification_type' },
    { title: 'Active', dataIndex: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? 'Active' : 'Inactive'}</Tag> },
    {
      title: '', width: 160,
      render: (_: any, row: Mission) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>Edit</Button>
          {row.is_active && (
            <Popconfirm title="Deactivate this mission?" onConfirm={() => deactivate(row.id)}>
              <Button size="small" danger>Deactivate</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      style={{ background: '#161b22', border: '1px solid #30363d' }}
      title={<Space><TrophyOutlined style={{ color: '#d4af37' }} /><Text style={{ color: '#fff' }}>Missions ({missions.length})</Text></Space>}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchMissions}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ background: '#d4af37', borderColor: '#d4af37', color: '#000', fontWeight: 700 }}>
            New Mission
          </Button>
        </Space>
      }
    >
      <Table dataSource={missions} columns={columns} rowKey="id" loading={loading} pagination={false} scroll={{ x: 'max-content' }} size="small" />

      <Modal title={editing ? 'Edit Mission' : 'New Mission'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={save} okText="Save" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="emoji" label="Emoji" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'one_time', label: 'One-time' }]} />
          </Form.Item>
          <Form.Item name="metric_type" label="Metric" rules={[{ required: true }]}>
            <Select options={Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="game_type" label="Game Type (only for Games Played)">
            <Select allowClear options={[{ value: 'teen_patti', label: 'Teen Patti' }, { value: 'ludo', label: 'Ludo' }]} />
          </Form.Item>
          <Form.Item name="min_stake" label="Min Stake (only for Games Played)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="target_value" label="Target Value" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="reward_amount" label="Reward Amount (₹)" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="reward_wallet_type" label="Reward Wallet" rules={[{ required: true }]}>
            <Select options={[{ value: 'bonus', label: '🎁 Bonus' }, { value: 'real', label: '💵 Real' }]} />
          </Form.Item>
          <Form.Item name="max_completions_per_period" label="Max Completions Per Period (blank = unlimited)">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="verification_type" label="Verification" rules={[{ required: true }]}>
            <Select options={[{ value: 'auto', label: 'Automatic' }, { value: 'telegram_bot', label: 'Telegram Bot' }, { value: 'manual_review', label: 'Manual Review' }]} />
          </Form.Item>
          <Form.Item name="sort_order" label="Sort Order"><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

export default function Missions() {
  return (
    <div style={{ padding: 24, background: '#0d1117', minHeight: '100vh' }}>
      <Title level={3} style={{ color: '#fff' }}><TrophyOutlined style={{ color: '#d4af37', marginRight: 10 }} />Missions</Title>
      <Text style={{ color: '#8b949e', display: 'block', marginBottom: 24 }}>Configure player missions and review manual submissions</Text>
      <Tabs
        items={[{ key: 'config', label: 'Mission Config', children: <MissionConfigTab /> }]}
      />
    </div>
  )
}
```

- [ ] **Step 2: Wire up routing**

In `admin-panel/src/main.tsx`, replace the removed `DailyBonus` lazy import (from Task 3) with:
```ts
const Missions = React.lazy(() => import('./pages/Missions'))
```
And replace the removed route with:
```tsx
<Route path="missions" element={<Missions />} />
```

- [ ] **Step 3: Wire up the menu**

In `admin-panel/src/pages/layout/menuConfig.ts`, replace the removed Daily Bonus entry (from Task 3) with:
```ts
{ key: '/admin/missions', icon: createElement(TrophyOutlined), label: link('/admin/missions', 'Missions') },
```
(Import `TrophyOutlined` from `@ant-design/icons` at the top of the file if not already imported.)

- [ ] **Step 4: Update the menu test**

In `admin-panel/src/pages/layout/menuConfig.test.ts`, add `'/admin/missions',` to `EXPECTED_KEYS`.

- [ ] **Step 5: Run the menu test**

Run: `cd admin-panel && npx vitest run src/pages/layout/menuConfig.test.ts`
Expected: PASS

- [ ] **Step 6: Type-check**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add admin-panel/src
git commit -m "feat(missions): add admin panel Missions config page"
```

---

### Task 13: Admin panel Missions.tsx — Review Queue tab

**Files:**
- Modify: `admin-panel/src/pages/Missions.tsx` (add a second tab, following the approve/reject + `Image` pattern already used in `admin-panel/src/pages/KYC.tsx`)

**Interfaces:**
- Consumes: `GET /api/admin/missions/review-queue`, `POST /api/admin/missions/review-queue/:id/approve`, `POST /api/admin/missions/review-queue/:id/reject`, `GET /api/admin/missions/stats` (Task 11)

- [ ] **Step 1: Add the Review Queue tab component**

Add to `admin-panel/src/pages/Missions.tsx`, above the `export default function Missions()`:

```tsx
interface Submission {
  id: string
  user_id: string
  username: string
  mission_id: string
  mission_title: string
  period_key: string
  reward_amount: number
  proof_url: string | null
  created_at: string
}

interface Stats {
  today: { completions: number; distributed: number }
  all_time: { completions: number; distributed: number }
  pending_review: number
}

function ReviewQueueTab() {
  const { token } = useAuthStore()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [rejectTarget, setRejectTarget] = useState<Submission | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [subsRes, statsRes] = await Promise.all([
        fetch('/api/admin/missions/review-queue', { headers }),
        fetch('/api/admin/missions/stats', { headers }),
      ])
      setSubmissions(await subsRes.json())
      setStats(await statsRes.json())
    } catch {
      message.error('Failed to load review queue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const approve = async (id: string) => {
    const res = await fetch(`/api/admin/missions/review-queue/${id}/approve`, { method: 'POST', headers })
    if (!res.ok) return message.error('Approve failed')
    message.success('Approved — wallet credited')
    fetchAll()
  }

  const reject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return message.warning('Enter a rejection reason')
    const res = await fetch(`/api/admin/missions/review-queue/${rejectTarget.id}/reject`, {
      method: 'POST', headers, body: JSON.stringify({ reason: rejectReason }),
    })
    if (!res.ok) return message.error('Reject failed')
    message.success('Rejected')
    setRejectTarget(null)
    setRejectReason('')
    fetchAll()
  }

  const columns = [
    { title: 'User', dataIndex: 'username' },
    { title: 'Mission', dataIndex: 'mission_title' },
    { title: 'Period', dataIndex: 'period_key' },
    { title: 'Reward', dataIndex: 'reward_amount', render: (v: number) => `₹${v}` },
    { title: 'Proof', dataIndex: 'proof_url', render: (v: string | null) => v ? <a href={v} target="_blank" rel="noreferrer">View</a> : '—' },
    { title: 'Submitted', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '', width: 180,
      render: (_: any, row: Submission) => (
        <Space>
          <Button size="small" type="primary" onClick={() => approve(row.id)} style={{ background: '#00c853', borderColor: '#00c853' }}>Approve</Button>
          <Button size="small" danger onClick={() => setRejectTarget(row)}>Reject</Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      {stats && (
        <Space style={{ marginBottom: 16 }} size="large">
          <Text style={{ color: '#8b949e' }}>Today: <Text style={{ color: '#00c853' }}>{stats.today.completions} completions, ₹{stats.today.distributed}</Text></Text>
          <Text style={{ color: '#8b949e' }}>All-time: <Text style={{ color: '#d4af37' }}>{stats.all_time.completions} completions, ₹{stats.all_time.distributed}</Text></Text>
          <Tag color="orange">{stats.pending_review} pending review</Tag>
        </Space>
      )}
      <Table dataSource={submissions} columns={columns} rowKey="id" loading={loading} pagination={false} scroll={{ x: 'max-content' }} size="small" />
      <Modal title="Reject Submission" open={!!rejectTarget} onCancel={() => setRejectTarget(null)} onOk={reject} okText="Reject" okButtonProps={{ danger: true }}>
        <Input.TextArea rows={3} placeholder="Reason for rejection" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
      </Modal>
    </>
  )
}
```

- [ ] **Step 2: Register the tab**

In the `Missions` default export, change the `Tabs` `items` to include both tabs:
```tsx
<Tabs
  items={[
    { key: 'config', label: 'Mission Config', children: <MissionConfigTab /> },
    { key: 'review', label: 'Review Queue', children: <ReviewQueueTab /> },
  ]}
/>
```

- [ ] **Step 3: Type-check**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Run: `cd admin-panel && npm run dev`, log in, navigate to `/admin/missions`, confirm both tabs render and the Review Queue tab loads stats without erroring (even with zero submissions).

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/Missions.tsx
git commit -m "feat(missions): add admin panel review queue tab"
```

---

### Task 14: Mobile Missions page

**Files:**
- Create: `mobile/lib/features/missions/missions_page.dart`
- Modify: `mobile/lib/app.dart` (import + route)
- Modify: `mobile/lib/features/home/home_page.dart` (hero badge, replacing the one removed in Task 4)

**Interfaces:**
- Consumes: `GET /api/users/missions`, `POST /api/users/missions/:id/claim`, `POST /api/users/missions/:id/submit`, `GET /telegram/deep-link` (Tasks 8-9)

- [ ] **Step 1: Write the Missions page**

```dart
// mobile/lib/features/missions/missions_page.dart
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart'; // AppColors, AppSnackBar, formatCurrency all live here

class MissionsPage extends StatefulWidget {
  const MissionsPage({super.key});
  @override
  State<MissionsPage> createState() => _MissionsPageState();
}

class _MissionsPageState extends State<MissionsPage> with SingleTickerProviderStateMixin {
  bool _loading = true;
  List<dynamic> _weekly = [];
  List<dynamic> _monthly = [];
  final Set<String> _busy = {};
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/users/missions');
      if (!mounted) return;
      setState(() {
        _weekly = res.data['weekly'] ?? [];
        _monthly = res.data['monthly'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _claim(String id) async {
    setState(() => _busy.add(id));
    try {
      final res = await ApiClient().dio.post('/api/users/missions/$id/claim');
      if (!mounted) return;
      final amount = res.data['reward_amount'] ?? 0;
      AppSnackBar.show(context, 'Claimed! +${formatCurrency(amount)}');
      await _load();
    } catch (e) {
      if (mounted) {
        final msg = (e as dynamic).response?.data?['error'] ?? 'Could not claim';
        AppSnackBar.show(context, msg, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _submitProof(String id) async {
    setState(() => _busy.add(id));
    try {
      await ApiClient().dio.post('/api/users/missions/$id/submit');
      if (!mounted) return;
      AppSnackBar.show(context, 'Submitted for review!');
      await _load();
    } catch (e) {
      if (mounted) {
        final msg = (e as dynamic).response?.data?['error'] ?? 'Could not submit';
        AppSnackBar.show(context, msg, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _connectTelegram(String id) async {
    setState(() => _busy.add(id));
    try {
      final res = await ApiClient().dio.get('/api/telegram/deep-link');
      final link = res.data['link'] as String;
      await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) AppSnackBar.show(context, 'Could not open Telegram', error: true);
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Widget _actionButton(Map<String, dynamic> m) {
    final id = m['id'] as String;
    final busy = _busy.contains(id);
    switch (m['state']) {
      case 'claim':
        return ElevatedButton(
          onPressed: busy ? null : () => _claim(id),
          style: ElevatedButton.styleFrom(backgroundColor: AppColors.green),
          child: busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Claim'),
        );
      case 'connect_telegram':
        return OutlinedButton(onPressed: busy ? null : () => _connectTelegram(id), child: const Text('Connect Telegram'));
      case 'submit_proof':
        return OutlinedButton(onPressed: busy ? null : () => _submitProof(id), child: const Text('I\'ve Done It'));
      case 'pending_review':
        return const Chip(label: Text('Pending Review'));
      case 'in_progress':
        return Text('${m['progress_current']}/${m['progress_target']}', style: const TextStyle(color: AppColors.textSecondary));
      default:
        return const Chip(label: Text('Done ✓'));
    }
  }

  Widget _missionCard(Map<String, dynamic> m) {
    return Card(
      color: AppColors.surface,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Text(m['emoji'] ?? '🎯', style: const TextStyle(fontSize: 28)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m['title'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  Text('Reward: ${formatCurrency(m['reward_amount'])}', style: const TextStyle(color: AppColors.gold, fontSize: 12)),
                ],
              ),
            ),
            _actionButton(m),
          ],
        ),
      ),
    );
  }

  Widget _list(List<dynamic> missions) {
    if (missions.isEmpty) return const Center(child: Text('No missions right now — check back soon!', style: TextStyle(color: AppColors.textSecondary)));
    return ListView(children: missions.map((m) => _missionCard(m as Map<String, dynamic>)).toList());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Missions'),
        backgroundColor: AppColors.surface,
        leading: const BackButton(color: AppColors.gold),
        bottom: TabBar(controller: _tabController, tabs: const [Tab(text: 'Weekly'), Tab(text: 'Monthly')]),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: TabBarView(controller: _tabController, children: [_list(_weekly), _list(_monthly)]),
            ),
    );
  }
}
```

- [ ] **Step 2: Wire up routing**

In `mobile/lib/app.dart`, replace the removed `daily_bonus` import (from Task 4) with:
```dart
import 'features/missions/missions_page.dart';
```
And replace the removed route with:
```dart
GoRoute(path: '/missions', builder: (_, __) => const MissionsPage()),
```

- [ ] **Step 3: Wire up the home promo card**

In `mobile/lib/features/home/home_page.dart`, `context.push` is already available (the file imports `package:go_router/go_router.dart` at the top). In `_buildPromoStrip()`, where the Daily Login Bonus promo card was removed (Task 4, lines 616-622), add a Missions promo card in its place, using the exact same `_promoCard(...)` helper already used by the `Refer & Earn` and `Leaderboard Reward` cards right after it:
```dart
_promoCard(
    '🎯',
    'Weekly\nMissions',
    'Earn Extra Rewards!',
    [const Color(0xFF1A4C2E), const Color(0xFF0D2E19)],
    AppColors.green,
    onTap: () => context.push('/missions')),
```

- [ ] **Step 4: Confirm `url_launcher` is available**

Run: `grep -n "url_launcher" mobile/pubspec.yaml`
Expected: a version line already present (used elsewhere in the app, e.g. for the referral share link). If missing, add `url_launcher: ^6.2.0` under `dependencies:` and run `cd mobile && flutter pub get`.

- [ ] **Step 5: Analyze**

Run: `cd mobile && flutter analyze lib/features/missions/missions_page.dart lib/app.dart lib/features/home/home_page.dart`
Expected: no errors.

- [ ] **Step 6: Manual smoke test**

Run: `cd mobile && flutter run`, log in, tap the "🎯 Missions" badge on the home screen, confirm the Weekly/Monthly tabs load without crashing (empty state is fine if no missions were created on this device's backend yet).

- [ ] **Step 7: Commit**

```bash
git add mobile/lib
git commit -m "feat(missions): add mobile Missions page"
```

---

## Post-implementation checklist (not a task — a reminder for whoever deploys this)

- Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_GROUP_CHAT_ID`, `TELEGRAM_GROUP_INVITE_LINK`, `TELEGRAM_WEBHOOK_SECRET` in `core-api-service`'s production `.env`.
- Register the Telegram webhook once (see the note at the end of Task 9).
- Run both new migrations (Tasks 1 and 5) against the production DB during deploy.
- Use the admin panel's new Missions page to actually create the six example missions from the original request (Join Telegram Group, Share Winning, Invite a Friend, Deposit 1000→250 Bonus, Play 1 Teen Patti, Play 1 Ludo ≥₹50, and the monthly 100-referral mission) — the migration only creates the schema, not seed data, since reward amounts are a business decision for the admin to configure.
