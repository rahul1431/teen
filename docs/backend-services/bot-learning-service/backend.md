# Bot Learning Service — Backend

## HTTP surface (`index.ts`)

Every route below (except `/health`) now requires an `x-internal-key` header matching `INTERNAL_SERVICE_KEY` (fixed 2026-07-29, `authenticateInternal` — matches the pattern used by `risk-service`/`wallet-service`), and the service listens on `127.0.0.1` only instead of `0.0.0.0`. See "Authentication" below.

| Route | Handler (`index.ts`) | Purpose |
|---|---|---|
| `GET /health` | `:28-30` | Static `{ status: 'ok', service: 'bot-learning-service', timestamp }`. No DB/Redis ping. |
| `GET /api/bots/profile?game_type=&difficulty=` | `:33-49` | Single profile lookup (Redis-cached). 400 if either query param missing, 404 if no row. |
| `GET /api/bots/profiles` | `:52-60` | All profiles, `ORDER BY game_type, difficulty`, wrapped as `{ profiles, count }`. |
| `POST /api/bots/rebuild` | `:62-67` | Fire-and-forget: kicks off `builder.runRebuild()` (not awaited) and returns `{ status: 'started', game_types: [...] }` immediately. No way to poll completion or see errors from the HTTP caller — only the service's own logs. |
| `GET /api/bots/config` | `:69-78` | Returns the 8 rebuild-tuning knobs (below). |
| `PATCH /api/bots/config` | `:80-90` | Body is `Record<string, string>` — arbitrary key/value pairs merged into `bot_learning_config`, no schema restricting which keys are accepted (see "Validation gaps" below). |
| `PATCH /api/bots/profiles/:gameType/:difficulty` | `:92-105` | Manual override of one profile's numeric fields (allow-listed in `overrideProfile`, below). |

## Scheduled jobs (`index.ts:20-25`, `111-112`)

- **Nightly rebuild**: `cron.schedule(\`0 ${cfg.rebuild_hour} * * *\`, ...)`, where `cfg.rebuild_hour` is read once at process startup from `bot_learning_config` (default `2`, i.e. 2 AM UTC — the cron string has no explicit timezone, so it runs in whatever timezone the Node process/OS is in). **This means changing `rebuild_hour` via `PATCH /api/bots/config` only takes effect after the next process restart** — the cron job is scheduled once at boot (`:21-25`) and never re-scheduled when the config value changes later; `updateConfig()` just writes the new Postgres value, it doesn't touch the already-registered `node-cron` job.
- **Startup rebuild**: `builder.runRebuild().catch(...)` fires once, non-blocking, immediately after `app.listen()` succeeds (`:112`) — so every PM2 restart of `teen-bot-learning` also triggers an immediate full rebuild in addition to whatever the nightly schedule does.

There is no 6-hourly/incremental rebuild, no drift detection, no Slack alerting, no Kafka streaming consumer in the actual `src/` — those only exist in the stale, untracked `dist/` build described in `overview.md`.

## The rebuild algorithm (`ProfileBuilder.rebuildForGame`, `profile-builder.ts:111-215`)

Runs once per entry in `GAME_TYPES = ['teen_patti', 'ludo', 'aviator']` (`:31`), inside `runRebuild()` (`:83-104`), which loops with per-game try/catch (one game's failure doesn't stop the others).

**Step 1 — pull real player stats** (`:113-132`): 
```sql
SELECT gp.user_id, COUNT(gp.id) games_played,
       SUM(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee)) total_profit,
       AVG(...) avg_profit,
       COUNT(CASE WHEN gp.prize_won > COALESCE(...) THEN 1 END) wins,
       AVG(gr.entry_fee) avg_stake
FROM game_participants gp
JOIN game_rooms gr ON gr.id = gp.room_id
JOIN users u ON u.id = gp.user_id
WHERE gr.game_type = $1 AND u.is_bot = false AND u.status = 'active'
  AND gp.joined_at > NOW() - INTERVAL '<history_lookback_days> days'
GROUP BY gp.user_id
HAVING COUNT(gp.id) >= $2         -- min_sample_size
ORDER BY total_profit ASC
```
Real humans only (`is_bot = false`), active accounts only, ordered **ascending by total profit** — so index 0 is the most-losing real player, and the tail of the array is the most-winning real player. `history_lookback_days` is interpolated directly into the `INTERVAL` string via `parseInt(String(cfg.history_lookback_days), 10)` rather than passed as a bound parameter (`:127`) — safe here since it's always coerced through `parseInt` first, but worth noting as the one place in this file SQL is string-built rather than parameterized.

If fewer than `min_sample_size` (default 10) distinct players qualify, the whole game type is skipped for this cycle (`:135-138`, logged as a `warn`) and the existing `bot_profiles` rows are left untouched — this is the path Ludo (status `"planned"` in `games/registry.json`, no live traffic) and Aviator (see below) permanently take.

**Step 2 — percentile-slice into difficulty tiers** (`:142-151`): given `total` qualifying players sorted worst-to-best profit, cutoffs are `floor(total * pct / 100)` for `easy_percentile_max` (default 25), `medium_percentile_min`/`medium_percentile_max` (default 40/60), `hard_percentile_min` (default 75). `easyPlayers = players.slice(0, easyMax)` — the **worst-performing** real players become the behavioral template for **easy**-tier bots; `hardPlayers = players.slice(hardMin)` — the **best-performing** real players become the template for **hard**-tier bots. This is the actual meaning of "difficulty" for the fold/call/raise/delay fields: it's modeled on how real players in that percentile band actually play, not a designed difficulty curve.

**Step 3 — stream enrichment (stub, always empty)**: `getStreamActionData()` (`:217-220`) is called with `(gameType, cfg.stream_lookback_days)` but its body is `// Phase 4: enrich profiles from Redis stream events` followed by `return {}` — it ignores both arguments and always returns an empty object. **`stream_lookback_days` in `bot_learning_config` is therefore dead configuration** — nothing reads it downstream of this one no-op call. Every profile's `fold_probability`/`call_probability`/`avg_decision_delay_ms` consequently always falls through to the two derive-from-win-rate/difficulty functions below, never to real per-action Redis stream data despite the config knob and the "Stream lookback (days)" field the admin UI exposes for it (`BotLearningSection.tsx:201-203`).

**Step 4 — build and upsert each tier** (`:156-214`), for each of easy/medium/hard with ≥1 player in its slice:
- `avgStake` = mean `avg_stake` across the tier's players (fallback `10` per player if null).
- `avgWinRate` = mean of `(wins/games_played)*100` across the tier — this becomes `win_rate_target`, rounded to 1 decimal (`:202`). **This is the only place `win_rate_target` is set in production** — there is no admin-facing way to set it directly; see `admin.md`.
- `foldProb`/`callProb` come from `streamStats` (always `undefined`, per Step 3) `?? deriveFromWinRate(avgWinRate, 'fold'|'call')` (`:222-226`): `fold = max(0.15, 0.60 - winRate/200)`, `call = max(0.20, 0.55 - winRate/500)` — higher observed win rate → lower fold rate (a winning cohort's bots fold less).
- `delayMs` comes from `streamStats?.avg_delay_ms ?? deriveDelayFromDifficulty(difficulty)` (`:228-230`): flat constants `easy=2800, medium=2000, hard=1400` — **not derived from real data at all**, purely a difficulty-label lookup, unlike every other field in this row.
- Clamping: `normalizedFold ∈ [0.05, 0.70]`, `normalizedCall ∈ [0.15, 0.75]`, `normalizedRaise = max(0, 1 - fold - call)` (`:176-178`). The intermediate `raiseProb = 1 - foldProb - callProb` computed just above (`:173`) is explicitly discarded (`void raiseProb`, `:182`) in favor of the clamped `normalizedRaise` — dead local variable, harmless, but worth knowing the pre-clamp value is never actually used for anything.
- `aggression = normalizedRaise / (normalizedCall + normalizedFold) * 10` (`:179`) — a derived ratio, rounded to 1 decimal for storage.
- Upsert into `bot_profiles` `ON CONFLICT (game_type, difficulty) DO UPDATE` (`:184-211`), setting `win_rate_target, fold_probability, call_probability, raise_probability, avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size, last_rebuilt_at = NOW()`.

After all three game types are processed, `runRebuild()` deletes all 9 `bot:profile:<gameType>:<difficulty>` Redis cache keys (`:96-100`) so the next `getProfile()` call re-reads Postgres, then publishes `bot:profiles:rebuilt` with a timestamp to a Redis pub/sub channel (`:102`) — **nothing in the codebase subscribes to this channel**; it's a no-op broadcast today.

## Dead / non-functional fields worth knowing about

- `avg_stake_preference` and `aggression_score` are computed, stored, and returned by the API (and `aggression_score` is displayed as a `<Statistic>` in `BotLearningSection.tsx:156`), but **no downstream consumer reads either field**: `main.go` only reads `win_rate_target`; `game-gateway`'s `getBotProfile()` only destructures `fold_probability`/`call_probability`/`raise_probability`/`avg_decision_delay_ms` (`bot-profile.ts:59-64`). They're derived-but-inert analytics, not behavior-driving values.
- `getStats()` (`profile-builder.ts:279-291`) and the `rebuildAllProfiles()`/`getAllProfiles()` aliases (`:106-109`, `239-242`) are never called from `index.ts` — no route wires them up. Compatibility surface for a caller that doesn't exist in this codebase today.
- Aviator's tier of `bot_profiles` is permanently stuck at its migration-seeded values — see `docs/Bugs/bot-learning-service-builds-dead-aviator-bot-profiles.md`.

## Config table (`bot_learning_config`, read/written by `getConfig`/`updateConfig`, `:47-81`)

| Key | Default | Used for |
|---|---|---|
| `rebuild_hour` | 2 | Nightly cron hour (only applied at process boot — see above) |
| `stream_lookback_days` | 7 | **Dead** — passed to `getStreamActionData`, which ignores it |
| `history_lookback_days` | 30 | Window for the Step 1 player-stats query |
| `min_sample_size` | 10 | Minimum qualifying players before a game type's tiers are (re)built |
| `easy_percentile_max` | 25 | Upper cutoff (as % of qualifying players) for the easy tier |
| `medium_percentile_min`/`_max` | 40/60 | Medium tier band |
| `hard_percentile_min` | 75 | Lower cutoff for the hard tier |

`updateConfig()` (`:63-81`) validates that any of these 8 keys, if present in the PATCH body, parse as integers (`isNaN` check, thrown as an `Error` → surfaces as a 500 to the caller) — but the route accepts **arbitrary additional keys** with no allow-list at all; any string key/value pair in the PATCH body gets upserted into `bot_learning_config` via `INSERT ... ON CONFLICT (key) DO UPDATE`, since the loop just checks `numericKeys.includes(key)` before validating, it doesn't gate on it (`:69-73`). In practice this is trusted-input-only exposure (the admin-panel form only ever sends the 3 fields it renders — `rebuild_hour`, `stream_lookback_days`, `min_sample_size`, `BotLearningSection.tsx:195-207`), and as of 2026-07-29 the route itself is no longer reachable without the internal service key (below) — previously any network caller could seed arbitrary junk keys into this table.

## `overrideProfile` allow-list (`profile-builder.ts:260-277`)

```ts
const allowed = ['win_rate_target', 'fold_probability', 'call_probability', 'raise_probability',
                 'avg_decision_delay_ms', 'avg_stake_preference', 'aggression_score']
```
Any subset of these 7 fields can be PATCHed directly per `(game_type, difficulty)`; unknown keys are silently dropped rather than rejected. **No range/sanity validation at all** — unlike `updateConfig`'s numeric-parse check, there's no clamp here: a caller can set `fold_probability` to `5`, or `win_rate_target` to `-40` or `999`, and it's written verbatim (then immediately affects real DDA swaps / bot decisions, since `getProfile`'s Redis cache is invalidated right after, `:276`). `win_rate_target` is in the allow-list and **can** be set this way — the gap is entirely on the admin-panel side never sending it; see `admin.md` and `docs/Bugs/teen-patti-dda-admin-control-gap.md`.

## Authentication (fixed 2026-07-29)

Every route in `index.ts` except `/health` — including the three that mutate live bot behavior (`PATCH /api/bots/config`, `PATCH /api/bots/profiles/:gameType/:difficulty`, `POST /api/bots/rebuild`) and the four `/internal/*` routes — now requires an `x-internal-key` header matching `INTERNAL_SERVICE_KEY` (`authenticateInternal`, mirroring `services/risk-service/src/index.ts:173-174` and `services/wallet-service/src/index.ts:98-102`). The two callers — `services/admin-service/src/bot-learning-routes.ts`'s `axios` calls (which already apply `authenticate` + `requireRole('superadmin')` on their own proxy routes) and `services/game-gateway/src/bot-profile.ts`'s `axios.get` — now attach that header. The Fastify listener also binds to `127.0.0.1` instead of `0.0.0.0`, since neither caller ever reaches it from outside the host. Previously none of this existed — bot-learning-service trusted every inbound request unconditionally, and admin-service's RBAC was the only thing standing between an anonymous caller and a bot-profile mutation. Was filed as `docs/Bugs/bot-learning-service-no-authentication.md`.

## Cross-reference

Full DDA mechanism this table feeds: `docs/backend-services/teen-patti-engine/backend.md`. Admin-panel wiring: `admin.md`. No mobile-facing surface: `frontend.md`.
