# Automatic cricket contest pipeline — design

## Correction from the original draft of this spec

This spec was first written against `docs/games/cricket/*.md`, which turned out to be stale — the codebase has moved well past them (commits `e90c153`, `ba47981`, `4d420a0`). Re-reading the actual source (`services/core-api-service/src/plugins/betting.ts`, `helpers/cricapi-client.ts`, `helpers/fantasy-scoring.ts`, `helpers/cricket.ts`) turned up:

- The hardcoded CricAPI fallback key is already fixed: `cricApiFetch()` round-robins a configurable pool of keys (`game_configs.special_rules.api_keys`), fails over on rate-limit, and only uses a hardcoded key as a non-production dev convenience — never in production.
- Match-winner/toss markets no longer exist (archived in migration `067`) — the product already committed to fantasy-only, no odds-based betting. Session ("fancy") betting still exists and stays out of scope, as originally planned.
- A full Dream11-point-system scoring engine already exists (`helpers/fantasy-scoring.ts`: `DEFAULT_SCORING_RULES`, `aggregateScorecard()`, `computeFantasyPoints()`) — **including fielding points** (catches/stumpings/run-outs), computed from CricAPI's `catching` array per innings, not text-parsing. My original design's "fielding = 0" decision was based on a wrong assumption; the app already computes it, so this build uses what's already there rather than reintroducing a worse manual carve-out.
- `POST /internal/cricket/fantasy/finalize` already exists: given a `match_id`, it re-fetches the scorecard, computes every player's points via the engine above, and calls `settleFantasyLeague()` — i.e. one-click Dream11-style settlement already works, it's just admin-triggered.
- `POST /internal/cricket/sync-api` already discovers new matches and refreshes live scores for existing ones in one call (`currentMatches` endpoint, upserts on `match_api_id`).

**What's actually missing, and the real scope of this build**: nothing runs on a schedule. Every one of the pieces above requires an admin to click a button. There is also no daily API-call budget anywhere — `cricApiFetch()` spreads load across keys but has no cap, fine for occasional manual clicks, not fine for an unattended loop. And there's no auto-contest-creation at all — leagues are 100% hand-created via the admin panel today.

## Problem

Automate three things without an admin online: (1) discover new matches and keep live scores fresh, (2) auto-create the ₹49/₹99/₹149 fixed-price fantasy contests for eligible matches, (3) auto-trigger the existing finalize/settle flow once a match ends — all while staying inside a configurable daily CricAPI call budget.

## Scope

**In scope**: a cron scheduler in `core-api-service` that calls the *existing* sync/finalize logic on a timer instead of requiring a click, plus new auto-contest-creation, plus a budget guard around the automated calls.

**Out of scope** (unchanged from original): session ("fancy") betting stays manual. Switching fixed-pool contests to entries-scaled pools is a later step — ships fixed-pool only, per your explicit call given the current low player base. Series-based forward-looking discovery (`sync-series` + `import-series-matches`, which needs an admin to search a series by name) stays a manual admin action — the scheduler only automates what `sync-api`'s `currentMatches` endpoint already covers on its own (this is what the admin panel's existing "Sync Live/Upcoming Matches" button already relies on), avoiding a bigger, separate discovery mechanism you didn't ask for.

## Architecture

One new cron job set, inside `core-api-service`, following the existing `modules/lottery/daily/scheduler.ts` pattern (`CronJob` from the already-installed `cron` package, sharing the process's DB pool).

New folder: `services/core-api-service/src/modules/cricket/`
- `apiBudget.ts` — `tryConsumeApiCall(db): Promise<boolean>` — atomic daily budget check/increment; the only new piece guarding CricAPI usage.
- `contestFactory.ts` — `createDefaultContests(db, matchId): Promise<number>` — auto-creates the 3 fixed-price leagues for a match if not already present.
- `scheduler.ts` — wires up 2 `CronJob`s and exports `startCricketAutomationScheduler(db)`, called from `index.ts` next to the existing lottery/leaderboard scheduler starts.

No new HTTP routes. The scheduler calls the *same internal logic* `sync-api` and `finalize` already use — refactored just enough to be callable as plain functions instead of only as route handlers (see Task breakdown in the plan), so there is exactly one implementation of "how to sync a match" / "how to finalize a match," not a duplicate.

## Config

New keys under the existing `game_configs.special_rules` row for `game_type = 'cricket'` (same row that already holds `api_key`/`api_keys`):

```json
{
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
}
```

Editable via the same raw-JSON config path admins already use for `api_key`/`api_keys`. Every number above is a seeded default, not hardcoded logic — tunable without a deploy.

Why one interval (15 min), not separate discovery/live/settlement cadences from the original draft: `sync-api` already does discovery + live-score refresh in the same call (it upserts new matches AND updates existing ones from the same `currentMatches` response), so splitting them into separate schedules would just mean calling the same endpoint twice for no benefit. 15 min (vs. the originally-discussed 5 min) is deliberately more conservative — one call per match-relevant tick instead of every 5 min — since the budget guard is the real safety net, not the interval; a slower default leaves more daily headroom for however many matches end up live at once, and it's a one-line config change if you want it faster later.

## Scheduler behavior (`scheduler.ts`, every `match_sync_interval_minutes`)

Single `CronJob`, one tick does, in order:

1. **Budget check**: if `tryConsumeApiCall()` returns false (budget exhausted for today), log once and skip the entire tick — no partial work, no wasted DB queries for the rest of the steps.
2. **Sync**: call the extracted `syncCurrentMatches(db)` function (same logic as today's `/internal/cricket/sync-api` route, now shared) — discovers new matches, updates live scores for existing ones. Bug fix folded in here: today this function sets a match straight to `status = 'settled'` when CricAPI reports `matchEnded` — with nothing having actually settled underneath it (no points computed, no leagues paid). This build changes that one branch to set `status = 'closed'` instead (already a valid, used status value in this codebase — gates session bets and fantasy-team submission the same way `'settled'` does), so step 4 has a real match-ended signal to act on, and `'settled'` only ever means "actually settled" going forward. The admin-facing manual "Sync" button gets this same fix for free, since it's the same function.
3. **Auto-create contests**: for every match returned as newly-inserted by step 2, check both team names resolve to `cricket_fantasy_players.team_name` rows (skip + log if not — expected for teams without seeded squads yet), then call `contestFactory.createDefaultContests(db, matchId)`.
4. **Auto-finalize**: for every match now in `status = 'closed'` (this tick's newly-closed ones, plus any still-closed from a previous tick that hasn't finalized yet — e.g. a prior attempt failed), if `auto_contests_enabled` and budget allows another call, invoke the extracted `finalizeMatch(db, matchId)` function (same logic `/internal/cricket/fantasy/finalize` already uses) — pulls the scorecard, computes points via the existing scoring engine, calls `settleFantasyLeague()`, which sets `status = 'settled'` on success. A match that fails to finalize (CricAPI error, no scorecard yet) simply stays `'closed'` and is retried next tick — no new state needed.

## Contest auto-creation (`contestFactory.ts`)

For each tier in `contest_tiers`, insert one `cricket_fantasy_leagues` row for the match if a row with that `(match_id, entry_fee)` doesn't already exist (a `SELECT` before `INSERT` — no new unique constraint, since admins can still hand-create leagues at other price points). `name = "<tier.name> Contest"`, `status = 'open'`.

## API budget (`apiBudget.ts`)

```sql
CREATE TABLE IF NOT EXISTS cricket_api_usage (
  usage_date DATE PRIMARY KEY,
  calls_used INT NOT NULL DEFAULT 0
);
```

`tryConsumeApiCall(db)`: `INSERT INTO cricket_api_usage (usage_date, calls_used) VALUES (CURRENT_DATE, 1) ON CONFLICT (usage_date) DO UPDATE SET calls_used = cricket_api_usage.calls_used + 1 RETURNING calls_used`, compared against `special_rules.cricket.api_daily_budget` (default 300) read from `game_configs`. Returns `false` (without having incremented past the cap — the increment itself is what's compared, so it always accurately reflects calls actually made) when over budget. This only gates the scheduler's own calls; it does not change behavior of admin-manual button clicks, which stay unmetered as they are today (a human clicking a button is inherently rate-limited by human attention).

## Error handling

- Steps 2–4 each wrap their per-match work in try/catch so one bad match doesn't stop the tick (same pattern as the existing lottery scheduler's per-tier loop).
- CricAPI errors surface through `cricApiFetch()`'s existing `{status: 'failure', reason}` shape — already handled by both `syncCurrentMatches` and `finalizeMatch`'s existing error paths (route handlers already return `502`/`500` on this; the extracted functions will `throw` instead so the scheduler's try/catch can log and continue, since there's no HTTP response to send from a cron tick).

## Testing

No automated test suite exists for `core-api-service` (project convention). Verification plan: run the scheduler manually against a scratch Postgres DB seeded with a mix of upcoming/live/recently-ended matches and mocked CricAPI responses (fixture JSON shaped like real `currentMatches`/`match_scorecard` payloads), confirm idempotent contest creation across repeated ticks, confirm the budget guard skips a tick once exhausted, confirm a `matchEnded` match transitions `closed` → `settled` with correct computed payouts. Manual review before enabling against the real key/production data.
