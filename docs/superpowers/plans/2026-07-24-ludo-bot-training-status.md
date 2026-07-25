# Ludo Bot Training & Coordination — Status (resume: say "Ludo Bot Training")

**Last updated:** 2026-07-24
**Feature status:** Deployed to production, awaiting live-game verification of the latest fix.

## What this feature does

In 1 RP + 3 Bot Ludo games, bots coordinate to elect one bot to win and the
other bots play as "helpers" (block the RP, clear the winner's path,
occasionally sacrifice) to push that bot's win rate up. Configurable via
admin panel: enable/disable, target win rate, aggressiveness.

## Bugs found & fixed this session (in order)

1. **`targetWinRate` validation 400** — frontend sent percentage (85-100),
   backend expected decimal (0.85-1.0). Fixed conversion both directions.
2. **Wrong deploy docroot** — admin panel is actually served from
   `/home/admin/web/game.myonlinejoker.com/public_html/admin/`, not
   `/opt/teen-prod/admin-panel/dist`. Redeployed to the correct path.
3. **Config not persisting (silent Redis-only fallback)** — repository
   queried a nonexistent `config` table and silently fell back to
   Redis-only writes (1hr TTL). Fixed to use existing `admin_config` table.
4. **"Enable Bot Coordination" switch always showed off** — antd
   `Form.Item` had two children (`<Switch/>` + text), which breaks its
   `checked`/`onChange` binding. Fixed by moving text into the `label` prop.
5. **game-gateway had a duplicate, still-broken config repository** — same
   `config`-table bug as #3, in a second copy of the file. User explicitly
   authorized this fix. Found via matchmaking.js bot-fill error logs.
6. **`BigInt(bot.userId)` SyntaxError** — bot/user IDs on this platform are
   UUIDs, not numeric, but the original feature assumed BigInt-convertible
   IDs. Required a real DB migration
   (`infra/db/migrations/20260724_bot_learning_sessions_uuid_ids.sql`)
   changing `winner_bot_id`/`actual_winner_id`/`rp_id` to UUID, plus
   removing all `BigInt()`/`.toString()` conversions across
   admin-service and game-gateway (repositories, election algorithm,
   game recorder, stats loader, tests rewritten with string IDs).
7. **Coordination recorded correctly but never affected gameplay** — the
   Ludo engine's `/start` call never received the `botCoordination` field,
   so `state.coordination` was always `undefined` and bots always played
   normally. User explicitly authorized touching the (locked) Ludo engine
   to wire this through (`game-gateway/src/matchmaking.ts` → Ludo engine
   `/start`, and `/bot-turn` now computes `isHelper` per-turn instead of a
   static room-wide flag).
8. **"Blue and yellow token acted stuck"** — once coordination activated
   for the first time, a latent coordinate-space bug surfaced:
   `coordination.ts` compared raw per-player-relative `progress` values
   directly across different players instead of converting through
   `absoluteCell(seatIndex, progress)` first. Rewrote the blocking/path-
   clearing logic to use `absoluteCell()` consistently (matching the
   engine's own capture-logic pattern). Also fixed the same bug baked into
   `coordination.test.ts`'s test data. All 5 tests pass, deployed, `teen-ludo`
   restarted clean and stable.

## Current state

- Fix #8 is deployed to `teen-ludo` on the VPS and confirmed stable
  (no crash loop).
- **Not yet verified**: user has not yet played a post-fix-#8 game to
  confirm the "stuck token" symptom is actually resolved.

## Next step when resumed

Ask the user to play one more 1 RP + 3 Bot Ludo game, then check:
- `bot_learning_sessions` row created correctly (UUID ids)
- Helper bots' move choices in game logs look sane (no repeated/stuck
  token selection)
- Winner election vs. actual game outcome

## Key files touched (for quick orientation)

- `admin-panel/src/components/BotTrainingConfigPanel.tsx`
- `admin-panel/src/components/BotTrainingAuditTrail.tsx`
- `services/admin-service/src/repositories/botTrainingConfigRepository.ts`
- `services/admin-service/src/repositories/botTrainingSessionsRepository.ts`
- `services/admin-service/src/routes/index.ts`
- `services/game-gateway/src/repositories/botTrainingConfigRepository.ts`
- `services/game-gateway/src/matchmaking.ts`
- `services/game-gateway/src/botCoordination/botStatsLoader.ts`
- `services/game-gateway/src/botCoordination/electionAlgorithm.ts`
- `services/game-gateway/src/botCoordination/gameRecorder.ts`
- `services/game-gateway/src/tests/botCoordination.test.ts`
- `services/game-engines/ludo/src/rules.ts`
- `services/game-engines/ludo/src/index.ts`
- `services/game-engines/ludo/src/coordination.ts`
- `services/game-engines/ludo/src/coordination.test.ts`
- `infra/db/migrations/20260724_bot_learning_sessions_uuid_ids.sql`

## Note on lockdown

Ludo is normally under COMPLETE LOCKDOWN per project memory. The engine
changes in this session (items 7-8) were explicitly authorized by the user
turn-by-turn ("yes, go ahead and wire it up", "fix it"). Once this feature
is fully verified working, re-lock and record a fresh lockdown memory.

## Root cause found + smart winner-bot feature (same session, continued)

After fix #8 deployed, the user played a game and reported "the bot is
never winning." Investigation (DB: `bot_learning_sessions`, code read) found
the real cause: the elected winner bot got **zero advantage** — only the 3
helper bots had special (defensive) behavior; the winner bot's own turns
fell through to plain `chooseBotToken`, identical to an uncoordinated bot.

User explicitly authorized building a fix + advanced features. Brainstormed
and implemented (not yet deployed to VPS):

1. **Tiered winner-bot smart play** (`services/game-engines/ludo/src/coordination.ts`,
   `chooseWinnerBotToken` + tier functions):
   - `casual` — capture > safe cell > most-progressed (same as existing
     'hard' bot-difficulty logic, reused via `chooseBotToken(..., 'hard')`).
   - `skilled` — casual + avoids landing where the RP could capture next
     turn, when a non-exposed alternative exists.
   - `expert` — full scoring pass (capture/home/progress/RP-exposure),
     weighted by a new `boldness` (0-1) parameter: bold favours
     progress/captures, cautious favours safety.
   - `services/game-engines/ludo/src/rules.ts`: `LudoState.coordination`
     gained `winnerSkill`/`boldness`; new `WinnerSkill` type exported.
   - `services/game-engines/ludo/src/index.ts`: `/start` and `/bot-turn`
     wired through. 4 new tests added to `coordination.test.ts`, all pass
     (9/9). `rules.test.ts` has pre-existing unrelated failures (confirmed
     via `git stash` — present before this session's changes too).

2. **Adaptive Boldness (self-learning)** — new
   `services/game-gateway/src/botCoordination/adaptiveBoldness.ts` (mirrored
   in `services/admin-service/src/repositories/adaptiveBoldness.ts` for the
   read-only admin panel readout): simple proportional controller — looks at
   the last 20 `bot_learning_sessions.coordination_success` values, and when
   the toggle is on, nudges `winnerBotBoldness` toward closing the gap vs.
   `targetWinRate` (needs ≥5 samples, else falls back to the configured
   value). Wired into `matchmaking.ts` at game-start time.

3. **Config**: both `botTrainingConfigRepository.ts` files (game-gateway +
   admin-service) gained `winnerBotSkill`, `winnerBotBoldness`,
   `adaptiveBoldness`, with validation and default-merging for
   backward-compat with configs saved before this change.

4. **Admin panel** (`admin-panel/src/pages/games/Ludo.tsx`, Bot Training tab):
   - `BotTrainingConfigPanel.tsx` — added Winner Bot Skill select, Winner
     Bot Boldness slider (hidden when skill=casual), Adaptive Boldness
     switch, and a live "Current Effective Boldness" readout.
   - New `BotTrainingTrendChart.tsx` — line chart of rolling coordination
     success rate vs. target win rate over the last 30 days (recharts),
     backed by a new `GET /api/admin/ludo/bot-training/trend` route.
   - `BotMetricsTable.tsx` (per-bot stats) already existed but was fed
     placeholder data (`vs_rp_win_rate` hardcoded 0, `last_10_games` always
     `[]`) — fixed the `/api/admin/ludo/bot-stats` query in
     `services/admin-service/src/routes/index.ts` to compute both for real
     from `bot_learning_sessions` (per-bot aggregation across `bot_ids`, not
     just games where the bot was the elected winner).

All 4 touched projects (`game-engines/ludo`, `game-gateway`, `admin-service`,
`admin-panel`) type-check clean. Gateway's existing `botCoordination.test.ts`
(21 tests) and Ludo engine's `coordination.test.ts` (9 tests) all pass.

**Not yet done:** deploy to VPS, verify with a live game, and see the new
dashboard/config actually render in the browser. No new DB migration needed
(everything reuses existing `bot_learning_sessions` / `admin_config` tables).
