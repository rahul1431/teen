# Automatic cricket contest pipeline — design

## Problem

Cricket betting today is entirely admin-driven (`docs/games/cricket/overview.md`): an admin must manually click "Sync Live/Upcoming Matches," manually create every fantasy league, manually click "Publish Live Update" during play, and manually type in a full scorecard to settle. This does not scale and requires a human online for every match.

We want three fixed-price fantasy contests (₹49/₹99/₹149, Dream11/MPL-style tiered payouts) auto-created for every eligible upcoming match, live scores kept fresh without an admin, and those contests auto-settled from CricAPI's scorecard once a match ends — while staying inside CricAPI's rate limits.

## Scope

**In scope**: match discovery + auto-creation of matches and their 3 fantasy leagues, live-score polling with a budget cap, auto-settlement of those fantasy leagues (batting + bowling points only).

**Out of scope**: match-winner markets and session ("fancy") bets are not auto-created or auto-settled — those need bookmaker-set odds, a manual admin judgment call CricAPI can't supply. Fielding points (catches/stumpings/run-outs) are not auto-computed — see "Auto-settlement" below. Switching from fixed-pool to entries-scaled prize pools is a later step (schema already supports it via `prize_pool`/`current_entries`); this build ships fixed-pool only, per explicit product decision (low current player base).

## Prerequisite fix: remove the hardcoded CricAPI fallback key

`services/core-api-service/src/plugins/betting.ts` currently falls back to a hardcoded CricAPI key (`dd511ce4-aeb7-4e1f-86f4-1160404b2776`, 3 call sites: lines 391, 420, 436) if `game_configs.special_rules.api_key` isn't set, and `admin-panel/src/pages/games/Cricket.tsx:444-451` advertises this key to every admin as a free default. Automation will call CricAPI continuously and unattended — far higher volume than today's manual clicks — so this must be fixed first:

- Remove the hardcoded fallback in all 3 call sites; if no key is configured, the sync call (and all 3 new schedulers) log a clear one-time error and no-op rather than silently sharing quota across every deployment.
- Remove the "free key" `Alert` text in `Cricket.tsx`.

## Architecture

Three new cron jobs, all running inside `core-api-service` (same process as the HTTP routes — shares the initialized DB pool and business logic, following the existing pattern in `services/core-api-service/src/modules/lottery/daily/scheduler.ts` and `modules/leaderboard/scheduler.ts`, both built on the already-installed `cron` npm package's `CronJob`).

New folder: `services/core-api-service/src/modules/cricket/`
- `cricapiClient.ts` — thin wrapper around CricAPI HTTP calls that enforces the daily budget (see below) before every request.
- `matchSync.ts` — job 1: match discovery.
- `contestFactory.ts` — auto-creation of the 3 fantasy leagues for an eligible match.
- `liveScorePoller.ts` — job 2: live-score polling.
- `autoSettlement.ts` — job 3: scorecard-based settlement, calling the existing `settleFantasyLeague()` in `helpers/cricket.ts` unchanged.
- `scheduler.ts` — wires up the 3 `CronJob`s and exports `startCricketAutomationScheduler()`, called from `index.ts` alongside the existing lottery/leaderboard scheduler starts.

## Config

New JSONB block `game_configs.special_rules.cricket` (same row/pattern already used for `api_key`), admin-editable, no new config UI required for v1 (defaults are sane; editing via the existing raw JSON path admins already use for `api_key` is acceptable — a dedicated settings UI can follow later if needed):

```json
{
  "api_key": "<existing field>",
  "match_type_filter": ["international"],
  "sync_horizon_days": 3,
  "match_sync_interval_hours": 6,
  "live_poll_interval_minutes": 5,
  "api_daily_budget": 300,
  "auto_settlement_enabled": true,
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

All numbers above are seeded defaults, tunable without a deploy.

## Match discovery (`matchSync.ts`, every 6h)

1. If no `api_key` configured, log once per process start and skip.
2. Call CricAPI's upcoming-matches endpoint for the next `sync_horizon_days` days.
3. Filter to matches whose `matchType`/series name matches `match_type_filter`.
4. Upsert into `cricket_matches` keyed on `match_api_id` (already a column) — idempotent re-runs.
5. For each newly-inserted match, check both team names resolve to existing rows in `cricket_fantasy_players.team_name`. If either team has zero seeded players, skip contest creation for that match and log it (expected for associate nations without seeded squads yet — not an error).
6. For eligible matches, call `contestFactory.createDefaultContests(matchId)`.

Also runs once immediately on service startup (self-heals after a restart), same as the lottery scheduler's job 1.

## Contest auto-creation (`contestFactory.ts`)

For each tier in `contest_tiers`, insert one `cricket_fantasy_leagues` row for the match if a row with that `(match_id, entry_fee)` doesn't already exist yet (idempotency check — a plain `SELECT` before `INSERT`, no new unique constraint needed since admins can still hand-create leagues at other price points). `name` is set to `"<Tier name> Contest"`, `status = 'open'`.

## Live-score polling (`liveScorePoller.ts`, every 5 min) + API budget

New table (migration):

```sql
CREATE TABLE IF NOT EXISTS cricket_api_usage (
  usage_date DATE PRIMARY KEY,
  calls_used INT NOT NULL DEFAULT 0
);
```

- Before any CricAPI call (from any of the 3 jobs), `cricapiClient.ts` does an atomic `INSERT ... ON CONFLICT (usage_date) DO UPDATE SET calls_used = cricket_api_usage.calls_used + 1 RETURNING calls_used`, then checks the returned value against `api_daily_budget`. Over budget → the call is skipped, logged, and the budget row still increments only for calls that actually go out (the check happens on the *pre-increment* read, not after firing the request, so we never fire a request past budget).
- Every 5 min, the poller lists `cricket_matches` where `status = 'live'`. If budget is tight, it sorts by total contest entries across that match's leagues (descending) and polls in that order until budget runs out for the cycle — remaining matches wait for the next tick.
- On each poll: update `live_score`/`live_tv_url` same as the existing manual sync path. If CricAPI reports the match ended, flip `status = 'settled'`... actually **flip to a new intermediate state `'ended'`** (not `'settled'`) so auto-settlement (below) has a clear trigger and we don't reuse `'settled'` to mean two different things (today `'settled'` is set by the sync heuristic with nothing actually settled underneath it — a pre-existing bug we should not perpetuate). `autoSettlement.ts` is what transitions a match to `'settled'`, and only once leagues are actually settled.

## Auto-settlement (`autoSettlement.ts`)

Runs as part of the same 5-min tick, after the live-score update step: for every match with `status = 'ended'` and `auto_settlement_enabled = true`:

1. Call CricAPI's scorecard endpoint for that match (counts against the same daily budget).
2. For each player in the scorecard's batting/bowling entries, match by exact name within `cricket_fantasy_players` scoped to the match's two teams. Unmatched names are logged (`console.error` with match/player context) and skipped — not blocking.
3. Compute fantasy points from structured fields only. There is no existing scoring formula anywhere in the codebase today — `fantasy_points` is currently 100% admin-typed with no computed convention — so this introduces the first one, a standard Dream11-like table (min 10 balls faced / 5 overs bowled for the rate bonuses to apply, matching Dream11's own qualifying thresholds):

   | Batting | Points | | Bowling | Points |
   |---|---|---|---|---|
   | Run | 1 each | | Wicket | 25 each |
   | Four | 1 each | | Maiden over | 8 each |
   | Six | 2 each | | 3-wicket bonus | +8 |
   | 50-run bonus | +8 | | 5-wicket bonus | +16 |
   | 100-run bonus | +16 | | Economy ≤ 5/over | +6 |
   | Duck (batsman/all-rounder/keeper, out for 0) | −2 | | Economy 5–6/over | +4 |
   | Strike rate ≥ 170 (min 10 balls) | +6 | | Economy 9–10/over | −2 |
   | Strike rate 150–170 | +4 | | Economy 10–11/over | −4 |
   | Strike rate 130–150 | +2 | | Economy > 11/over | −6 |
   | Strike rate 60–70 (min 10 balls) | −2 | | | |
   | Strike rate 50–60 | −4 | | | |
   | Strike rate < 50 | −6 | | | |

   Captain/vice-captain multipliers (×2.0/×1.5) are already applied downstream by `settleFantasyLeague()` — this step only writes the base per-player `fantasy_points`, unchanged from how the admin-manual path works today.
   - Fielding (catches/stumpings/run-outs): always 0 for auto-settled matches — CricAPI's free-text dismissal strings aren't reliably structured enough to safely attribute, per explicit product decision.
4. Upsert into `cricket_match_players.fantasy_points` (same columns `settleFantasyLeague()` already reads) and call the existing `settleFantasyLeague()` unchanged — it already does the ranking/payout/credit/mark-settled work.
5. On success, match `status` becomes `'settled'` (set inside the existing settlement transaction, as today).
6. On any failure mid-way (CricAPI scorecard call fails, DB error), the match stays `'ended'` and is retried on the next 5-min tick — no partial state, matching the transactional guarantee `settleFantasyLeague()` already provides.

## Error handling

- Every per-match/per-league operation in all 3 jobs is wrapped in its own try/catch so one bad match doesn't stop the cycle (same defensive pattern as the existing lottery scheduler's per-tier loop).
- CricAPI HTTP errors (429/5xx/timeout/malformed JSON) are logged and that match is skipped for the current tick; no retries within a tick, next scheduled tick tries again naturally.
- Budget-table increments are atomic (`INSERT ... ON CONFLICT DO UPDATE`) so concurrent job overlap (e.g. a slow tick still running when the next fires) can't double-spend budget.

## Testing

No automated test suite exists for `core-api-service` (project convention — see root `CLAUDE.md`). Verification plan:

1. Build against a scratch Postgres database seeded with realistic `cricket_matches`/`cricket_fantasy_players` rows (mirroring the verification method already used for the country-squad migrations in `docs/games/cricket/player-data.md`).
2. Stub/mock CricAPI HTTP responses with fixture JSON shaped like real upcoming-matches/live-score/scorecard payloads, run all 3 jobs manually against the scratch DB, and confirm: idempotent match/contest creation on repeated runs, budget enforcement kicks in correctly when exceeded, settlement math matches hand-computed expected points/payouts.
3. Manually review computed points/payouts by eye before enabling against a real CricAPI key and production data.
