# Rummy Game — Design Spec

**Date:** 2026-07-30
**Status:** Approved for planning

## 1. Goal

Add Rummy (13-card Indian Points Rummy, single-deal) as a fifth live, real-money game — full stack: game engine, `game-gateway` integration, mobile client, admin panel. `games/registry.json` already lists `rummy` as `"status": "planned"`; `services/game-engines/rummy` does not exist yet (confirmed greenfield — no directory on disk). `game_type_enum` in Postgres already includes `'rummy'` (from `001_initial.sql`), but its `game_configs` row was explicitly deleted in `009_betting_games.sql` when the feature was shelved — it needs to be re-seeded.

## 2. Scope decisions (locked in during brainstorming)

- **Variant**: Points Rummy only. One deal per game, first valid declare wins. Pool Rummy / Deals Rummy are explicitly out of scope — possible fast-follows, not part of this build.
- **Table size**: 2–6 players, matching `games/registry.json`'s existing `minPlayers`/`maxPlayers`.
- **Stakes/payout**: fixed entry fee per player, winner takes the pot minus rake — the same model as Teen Patti/Ludo, **not** the real-world rupee-per-point payout. This means no per-player point scoring is needed for settlement; only a binary win/loss per game.
- **Bots**: yes, same difficulty-tiered fill-and-play convention as Ludo/Teen Patti.
- **Out of scope for this build**: Pool/Deals variants, rupee-per-point payout math, bot-training telemetry table (the `ludo_move_decisions` → churn/bot-learning ML pipeline equivalent) and any personalized-difficulty integration, `resources/game-configs/rummy.json` (Ludo doesn't have one either; config lives in the DB, not a static file).

## 3. Data model

New migration `infra/db/migrations/20260730_rummy_config.sql` (filename date bumped to the actual implementation date if it lands later):

```sql
INSERT INTO game_configs
  (game_type, is_active, min_players, max_players, stake_options, rake_percent,
   bot_fill_enabled, bot_fill_delay_seconds, max_bot_ratio, bot_difficulty, special_rules)
VALUES
  ('rummy', false, 2, 6, '{10,50,100,500}', 5.00,
   true, 8, 0.75, 'medium',
   jsonb_build_object(
     'deck_count', 2,
     'wild_joker_enabled', true,
     'first_drop_allowed', true,
     'turn_timeout_seconds', 30
   ))
ON CONFLICT (game_type) DO NOTHING;
```

`is_active=false` by default — admin flips it on via the existing generic `PATCH /api/admin/game-configs/rummy` route once the build is verified live, same rollout pattern as any other game.

No new tables. `game_rooms` / `game_participants` are reused unchanged (already generic across Teen Patti/Ludo — room id, players, stake, pot_amount, platform_fee_collected, status, started_at/ended_at).

## 4. Game engine (`services/game-engines/rummy`)

New standalone Node/TS + Fastify service, directly mirroring `services/game-engines/ludo`'s shape and conventions:

- `src/index.ts` — HTTP layer: `POST /start`, `POST /action`, `POST /bot-turn`, `POST /leave`, `GET /state`, `GET /health`. Redis-backed state (`rummy:game:<roomId>`, 2h TTL), per-room lock (`withRoomLock`, same 5s TTL / 100ms retry / 3s max-wait pattern as Ludo) to serialize concurrent `/action`/`/bot-turn` calls. Postgres `saveCompletedGame()` writes `game_rooms.status/pot_amount/platform_fee_collected/ended_at` with the same 3-attempt-retry + Redis dead-letter-list fallback (`rummy:reconcile:failed`) Ludo uses for durability.
- `src/rules.ts` — pure game logic, unit-testable in isolation (mirrors `ludo/src/rules.ts` + `rules.test.ts`):
  - **Deck**: 2×52 + 2 printed jokers = 106 cards. One card flipped face-up at deal start as the wild-joker indicator; all 4 cards of that rank (both decks) plus the 2 printed jokers are wild.
  - **Deal**: 13 cards/player; remaining cards form the closed (face-down) pile; next card starts the open (discard) pile face-up.
  - **Turn**: draw from closed pile or top of open pile → discard, or declare. If the closed pile empties, reshuffle the open pile (except its current top card) into a new closed pile.
  - **Meld validation** (`isValidDeclare`): all 13 cards must partition into sequences/sets with at least 2 sequences, at least 1 of which is a **pure sequence** (3+ consecutive same-suit cards, zero jokers). Remaining groups are sequences (may include jokers) or sets (3–4 cards, same rank, distinct suits, may include jokers, no duplicate suit). This runs server-side only — the client's own grouping UI is a convenience, never trusted.
  - **Declare resolution**: valid → that player wins, game ends, pot settles. Invalid ("wrong show") → that player is eliminated from the round (forfeits), remaining players' turn order continues; if only one player remains, they win by default.
  - **First Drop**: a player may drop before their first draw of the game; removed from turn order, forfeits any win, no other penalty (consistent with the fixed-entry/pot payout model — there's no point penalty to compute).
- `src/coordination.ts` — bot decision logic (mirrors `ludo/src/coordination.ts`): difficulty-tiered (`easy`/`medium`/`hard` from `game_configs.bot_difficulty`), heuristic (not search-based) — prioritize completing the pure sequence, discard highest-deadwood-value unmatched cards first, weighted chance of picking a useful discard vs. drawing blind, difficulty scales hand-value evaluation accuracy and declare-timing aggressiveness.
- Config: `PORT=3012` (next free after Ludo's 3011), `RUMMY_ENGINE_URL` env var for the gateway to reach it, `ecosystem.config.js` gets a new `teen-rummy` PM2 entry following the existing per-engine block shape.

## 5. `game-gateway` integration

No generic per-game plugin system exists in this codebase — Teen Patti and Ludo are wired via hardcoded `if (gameType === '...')` branches scattered through `matchmaking.ts` and `index.ts`. Rummy follows the same convention (confirmed as the deliberate, lower-risk choice over refactoring the shared dispatch model, which stays out of scope):

- `matchmaking.ts`: queueing/matchmaking key handling, bot-fill sizing (2–6 seat logic, closer to Teen Patti's variable-size fill than Ludo's fixed-4), `startGame` engine `/start` call, `driveRummyBots()` (mirrors `driveLudoBots`), `scheduleRummyAfkTimer`/`autoPlayIdleRummyTurn` (mirrors the Ludo AFK pair — reads `special_rules.turn_timeout_seconds` from the config **from day one**, not hardcoded, learning directly from the Ludo turn-timeout bug fixed earlier this branch).
- `index.ts`: `game:action` routing to the Rummy engine's `/action`, reconnect state hydration (`room:joined` replay from Redis state), socket broadcast shaping for `game:state_update`.
- New env var `RUMMY_ENGINE_URL` (default `http://127.0.0.1:3012`), consumed the same way `LUDO_ENGINE_URL`/`TEEN_PATTI_ENGINE_URL` are.

## 6. Mobile (`mobile/lib/features/games/rummy/`)

Mirrors `ludo_game_page.dart`'s structure:

- `rummy_engine.dart` — local pure-Dart engine for **offline practice mode** (`offline: true`), same role as `ludo_engine.dart`.
- `rummy_game_page.dart` — one widget serving both offline practice and online (socket-driven via `initialData`/`room:joined`, `game:action` emits, `game:state_update` listens), same dual-mode pattern as Ludo.
- Reuses existing shared chrome: seat/avatar layout, turn-timer countdown ring (`_turnSecondsLeft`/`_turnTimerSeconds` pattern — covering both draw and discard phases from the start, again applying the Ludo AFK-coverage lesson), banners, emoji reactions, dealer-tip flow.
- Rummy-specific widgets: fanned 13-card hand, tap/drag to reorder and discard, tap-to-visually-group melds (client-side grouping is a convenience overlay only — the Declare button sends the player's current 13 cards as-is; the engine does the authoritative grouping/validation), draw-pile and discard-pile tap targets, Declare button.

## 7. Admin panel

- `admin-panel/src/pages/games/Rummy.tsx` — same shape as `Matka.tsx`/`Lottery.tsx`: config card (`is_active`, `rake_percent` via the existing generic `PATCH /game-configs/rummy` route) + a room history table backed by the generic `GET /game-rooms?status=` endpoint (the same one `GameRooms.tsx` uses), filtered client-side to `game_type=rummy` — no new backend route needed.
- No bespoke live-spectator/force-action UI needed — `GameRooms.tsx` (already routed at `/admin/game-rooms` as of this branch's earlier bug-fix pass) generically covers live state, force-action, kick, and terminate for every `game_type`, Rummy included, with zero extra work.
- Route (`admin-panel/src/main.tsx`) + menu entry (`menuConfig.ts`, under the existing "Games" group) added the same way every other per-game page is wired; `menuConfig.test.ts`'s `EXPECTED_KEYS` gets `/admin/games/rummy`.

## 8. Registry

`games/registry.json`: flip the `rummy` entry's `"status"` from `"planned"` to `"live"` once deployed and verified. No `resources/game-configs/rummy.json` created (matches actual current practice — Ludo has none either; the registry schema implies static config files but the DB is the real source of truth).

## 9. Testing

- `rules.test.ts` (Rummy engine): deck/deal correctness, wild-joker assignment, meld validation (pure sequence detection, set validation with/without jokers, invalid-declare rejection), first-drop handling, deck-reshuffle-on-empty.
- `coordination.test.ts`: bot difficulty produces materially different discard/declare-timing behavior across tiers (mirrors `ludo/coordination.test.ts`'s structure).
- Manual verification: full game via offline practice mode in the Flutter app; full online game via `/admin/games/rummy` (or DB) toggling `is_active` on a test config, playing a real room with bot fill.

## 10. Rollout

Deployed with `is_active=false`. After typecheck/build/test verification (same gate as every other change on this branch), admin flips `is_active=true` via the panel once a manual smoke test on the live VPS confirms a bot-filled game completes and settles correctly — no separate feature-flag mechanism needed, this reuses the existing `is_active` gate every other game already has.
