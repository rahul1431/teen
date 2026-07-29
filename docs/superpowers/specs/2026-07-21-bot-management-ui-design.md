# Bot Management UI — Design Spec

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

Sub-project #2 of the bot-management initiative, built on top of sub-project #1 (bot pool separation — `users.preferred_game_type`, already shipped). There is already a fully-built global bot admin page (`admin-panel/src/pages/Bots.tsx`): create/deactivate/delete/credit-wallet, plus a per-game "Bot Simulation Rules" panel (`game_configs.bot_difficulty` etc.). Its "Play Style" and "Skill Level" table columns are **decorative, not real** — `getBotPersonality()` derives them from a hash of the bot's UUID, with no backing data or effect on gameplay.

Investigation of the actual bot-decision code paths found:
- **Teen Patti**: bot fold/call/raise decisions are made entirely in `game-gateway`'s `matchmaking.ts` (`getBotProfile`/`pickBotAction`/`pickBotDelay`), using one room-wide `botDifficulty` value read from `game_configs` at room creation and stored in Redis room state (`state.botDifficulty`). The Teen Patti Go engine only stores `BotDifficulty` as room metadata — it never uses it for decisions.
- **Ludo**: bot move decisions are made inside the Ludo engine itself (`services/game-engines/ludo/src/index.ts`, calling `chooseBotToken(state, idx, dice, state.bot_difficulty)`). `state.bot_difficulty` is one room-wide value, set once at `/start` via `createInitialState`.

In both games, every bot in a room currently shares the exact same difficulty — there is no way to give an individual bot account its own skill level.

## Goal

- Give each bot account an optional individual difficulty override (`easy`/`medium`/`hard`), falling back to the existing game-wide `game_configs.bot_difficulty` when unset — and make both Teen Patti and Ludo actually use each bot's own difficulty during play, not just the room-wide value.
- Let an admin view, create, reassign (between games), tune (difficulty), and deactivate bots from **within** each game's own admin page (Teen Patti, Ludo), not only from the standalone global Bots.tsx page.
- Do this by extracting the existing bot-management logic into one reusable component, rather than duplicating it.

## Non-Goals

- No ML/learning-based training — this is static per-bot difficulty tagging, an admin control, not adaptive behavior. (That's sub-project #3, Ludo's move-by-move training pipeline.)
- No changes to Aviator/Matka (unaffected, as established in sub-project #1).
- No PnL dashboard work (sub-project #4).
- The fake `getBotPersonality()` "Play Style" (Aggressive/Conservative/Balanced) column is left as-is — only "Skill Level" is being replaced with real data. Play Style has no backing gameplay concept to wire it to; re-deriving it would be inventing scope not asked for.

## Design

### 1. Schema

```sql
ALTER TABLE users ADD COLUMN bot_difficulty VARCHAR(10) CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));
```

- `NULL` means "use the game-wide `game_configs.bot_difficulty` default" — the fallback behavior every existing bot gets automatically, zero migration risk to current gameplay.
- Unlike `preferred_game_type` (sub-project #1), this one has a `CHECK` constraint — difficulty is a closed, stable three-value set already hardcoded in both engines (`BotDifficulty = 'easy' | 'medium' | 'hard'`), unlike game types which may grow.

### 2. admin-service API

- Extend the existing `GET /api/admin/users` (already used by `Bots.tsx`) to: accept an optional `game_type` query param (filters on `preferred_game_type`, only meaningful combined with `is_bot=true`), and include `u.preferred_game_type, u.bot_difficulty` in the selected columns.
- New `PATCH /api/admin/bots/:id`: body `{ preferred_game_type?: string, bot_difficulty?: 'easy'|'medium'|'hard'|null }`, updates whichever fields are present, `requireRole('superadmin')` (matching the existing bot-creation/deletion routes), 400s if the target user isn't a bot (same guard style as the existing `DELETE /api/admin/bots/:id`).

### 3. game-gateway: per-bot difficulty resolution

In `matchmaking.ts`'s `startGame`, after computing the room-wide `botDifficulty` default (unchanged), look up each bot's individual `bot_difficulty` from `users` and attach it per-player when building `gatewayPlayers`/the state written to Redis — falling back to the room-wide value when a bot's own field is `NULL`. Real players don't have a meaningful `bot_difficulty` (irrelevant to them, always `NULL`).

For **Teen Patti**, the existing per-turn decision code (around `matchmaking.ts`'s bot-turn scheduling, currently `getBotProfile(this.redis, gameType, botDifficulty)` using the room-wide value) changes to look up the specific acting bot's own attached difficulty from state instead.

For **Ludo**, the `/start` payload's `players` array gains a per-player `bot_difficulty` field (bots only), passed through to the engine.

### 4. Ludo engine changes

- `LudoPlayer` (in `rules.ts`) gains an optional `bot_difficulty?: BotDifficulty` field.
- `createInitialState`'s `players` parameter type gains the same optional field, mapped onto each `LudoPlayer` — when absent, that bot simply doesn't get a per-player override (existing behavior, room-wide value used), so this is fully backward compatible with every existing caller and test.
- The bot-move handler in `services/game-engines/ludo/src/index.ts` (currently `chooseBotToken(state, idx, dice, state.bot_difficulty)`) changes to `chooseBotToken(state, idx, dice, state.players[idx].bot_difficulty ?? state.bot_difficulty)`.
- `StartReq.players` (in `index.ts`) gains the matching optional field.

### 5. Admin UI

- Extract the roster table + create/reassign/difficulty/deactivate/credit/delete actions from `Bots.tsx` into a new component, `admin-panel/src/components/BotManagementPanel.tsx`, taking an optional `gameType?: string` prop:
  - When `gameType` is provided, the roster query is scoped to that game (`GET /api/admin/users?is_bot=true&game_type=...`), and the create-bot form pre-fills/locks `preferred_game_type` to that game (still editable, since a game-scoped panel creating a bot for a *different* game would be surprising, but not forbidden — the field stays visible for clarity that this is what's happening).
  - When `gameType` is omitted, behavior is identical to today's global page (all bots, every game).
  - Replace the fake `getBotPersonality()`-derived "Skill Level" column with the real `bot_difficulty` field (showing "Default (game-wide)" when `NULL`), and make it editable inline (a `Select` writing to the new `PATCH` endpoint).
  - Add a "Reassign Game" action per row (a `Select` for `preferred_game_type`, writing to the same `PATCH` endpoint).
- `Bots.tsx` becomes a thin wrapper rendering `<BotManagementPanel />` with no `gameType` (all games) — the "Bot In-Game Simulation Rules" game-wide config panel stays on this page only (it's cross-game-config, not bot-roster; doesn't make sense duplicated per-game-page since each game page already implicitly is that one game).
- `TeenPatti.tsx` and `Ludo.tsx` each gain a new `Tabs` section (or an added tab, if a `Tabs` component doesn't already structure the page — confirmed in sub-project #1's exploration that `TeenPatti.tsx` currently has no `Tabs`, just stacked `Card` sections) titled "Bots", rendering `<BotManagementPanel gameType="teen_patti" />` / `<BotManagementPanel gameType="ludo" />` respectively.

### 6. Testing

- Ludo engine: extend `rules.test.ts` with cases proving `chooseBotToken` receives and uses a per-player difficulty distinct from the room-wide `bot_difficulty`, and that `createInitialState` correctly maps the optional per-player field (or omits it, preserving today's behavior) — this is real gameplay logic, tested with the same rigor as the rest of that file.
- game-gateway: extend the existing `MockPool`-based test approach (established in sub-project #1) to cover the per-bot difficulty resolution query.
- admin-service: the existing test suite has no coverage of the bot routes today (confirmed during sub-project #1's investigation) — this plan doesn't retroactively add full route test coverage for the pre-existing endpoints, only for the new/changed pieces this sub-project introduces (the `PATCH` endpoint's bot-only guard, and the `GET` endpoint's new `game_type` filter), consistent with not expanding scope beyond what's being built.
- Admin UI: manual verification only (per established preference in this session — no Chrome-based automated checks), confirmed live on the VPS.

## Risks / Open Questions

- Real players will always have `bot_difficulty = NULL`; nothing in this design lets `bot_difficulty` be set for a non-bot account (the `PATCH` endpoint's is-a-bot guard prevents it), so there's no risk of accidentally exposing a "difficulty" concept to real player accounts.
- The Teen Patti change is lower-risk (gateway-only, no engine deploy needed). The Ludo change requires rebuilding and restarting the Ludo engine process (`teen-ludo` in PM2) in addition to the gateway/admin-service — a live-money-game engine restart, same category of risk as any other Ludo engine change under the existing lockdown.
