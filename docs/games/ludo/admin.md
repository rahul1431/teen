# Ludo — Admin panel

## `games/ludo` — the routed, Ludo-specific management page

`admin-panel/src/pages/games/Ludo.tsx`, registered at `main.tsx:20,56` (`<Route path="games/ludo" element={<Ludo />} />`) and linked from the nav (`Layout.tsx:26`, `{ key: '/admin/games/ludo', label: '🎲 Ludo' }`) — unlike the generic `GameRooms.tsx` (below), this page is actually reachable in the deployed admin panel.

Two independent panels on one page:

**Config card** (`Ludo.tsx:19-40, 83-120`): `GET /api/admin/game-configs`, client-filters to the `game_type === 'ludo'` row, and on save `PATCH /api/admin/game-configs/ludo` with `{ is_active, rake_percent, bot_fill_enabled, bot_fill_delay_seconds, max_bot_ratio, bot_difficulty }`. Server-side, `admin-service`'s handler (`services/admin-service/src/index.ts:1030-1046`, gated `requireRole('superadmin')`) does a single `UPDATE game_configs SET is_active=$1, rake_percent=$2, bot_fill_enabled=$3, bot_fill_delay_seconds=$4, max_bot_ratio=$5, bot_difficulty=$6, special_rules=$7, bot_fill_table_size=$8 ... WHERE game_type=$10`, merging any `body.special_rules` into the existing JSONB rather than overwriting it wholesale. Because this form's own `is_active` field is an explicit bound `Switch` (`Ludo.tsx:90-92`), a save from *this* page never risked nulling it out — that failure mode was specific to `Bots.tsx`'s save path, a different page hitting the same endpoint with a payload that omitted `is_active` entirely; fixed 2026-07-28 by making the endpoint itself fall back to the current value for any omitted field, regardless of which page calls it.

Note: none of `min_players`, `max_players`, or `stake_options` are editable here — those were one-time values set by `infra/db/migrations/008_enable_ludo.sql` and have no admin UI at all; changing Ludo's player-count cap or stake ladder requires a direct DB write or a new migration.

**Rooms table** (`Ludo.tsx:42-51, 123-138`): `GET /api/admin/game-rooms?status=<active|completed|waiting>`, client-filtered to `game_type === 'ludo'` (the endpoint itself returns all games' rooms — filtering by game happens in the browser, not the query). Columns: room ID (truncated), player count, real/bot split, entry fee, pot, status badge, started-at, and a "View" action opening a `Drawer` with per-participant seat number, username, bot flag, and prize won (`selectedRoom.participants`). This is **read-only** — there is no live board state, no force-roll/force-move, no kick, no terminate button on this page. For all of that, see the orphaned page below.

## `GameConfig.tsx` — the shared per-game economics card

`admin-panel/src/pages/GameConfig.tsx:224-228` hardcodes the set of games shown as `['teen_patti', 'ludo', 'aviator']` (a plain array literal, not sourced from `games/registry.json` or any API-driven list) and renders one economics card per entry, labeled `'🎲 Ludo'` for the Ludo row. This is the same `is_active`/rake/bot-fill data as `Ludo.tsx`'s config card, just presented alongside the other two live games in one screen instead of Ludo's own dedicated tab — see `docs/admin-panel/game-config/overview.md` for the general shape of this page and its own already-filed issue (bot config saves from `Bots.tsx` nulling `is_active`).

The fact that this hardcoded array already includes `'ludo'` — displayed as a normal, fully-editable, live game card, no different from Teen Patti or Aviator — is itself further evidence (beyond the DB migration and the mobile app) that `games/registry.json`'s `"status": "planned"` for Ludo has no bearing on how any part of this system actually treats the game; see `overview.md`.

## `GameRooms.tsx` — Ludo-aware, but not reachable

`admin-panel/src/pages/GameRooms.tsx` is a more capable, cross-game live-room console (live board/token state, force-roll/force-move, kick, terminate) that is **not wired into routing or the nav menu** — this is already tracked as `docs/Bugs/orphaned-admin-pages.md` and fully documented in `docs/backend-services/game-gateway/admin.md`, which this doc defers to rather than repeating. The Ludo-specific parts of that unreachable page, for reference: it detects `liveState.gameType === 'ludo'` (`GameRooms.tsx:181`) and, when true, swaps the action button from "Force Fold" to "Force Roll"/"Force Move" depending on `liveState.awaiting` (`:201-210`), and renders `p.tokens` per seat instead of Teen Patti's `p.cards` (`:240-245`). If this page were ever routed, it would be the only admin surface capable of forcing a stuck human's roll/move without waiting for the 25s AFK timer or reaching for a direct DB/Redis edit, and the only way to see a live Ludo board's actual token positions rather than the DB snapshot the routed `Ludo.tsx` rooms table shows.

## `Leaderboard.tsx` and `BotLearningSection.tsx` — generic per-game plumbing

Both list Ludo as one of the game-type options in a `Select`/label map (`Leaderboard.tsx` game-type filter dropdown; `BotLearningSection.tsx`'s `{ ludo: 'Ludo' }` label map for the AI Control Center's bot-learning UI) — neither has Ludo-specific logic beyond being one more entry in an otherwise-generic, game-agnostic component. Nothing here is broken; it's the same "Ludo is just another game in a shared list" treatment these components give Teen Patti and Aviator too.

## Watchdog visibility

The idle-room reaper (`GameWatchdog`, `docs/backend-services/game-gateway/backend.md`) treats Ludo identically to every other game type — `game_rooms.game_type` is just a column value, not special-cased. `AIControlCenter.tsx`'s Watchdog tab (`docs/backend-services/game-gateway/admin.md`) will show a reaped Ludo room the same way it shows a reaped Teen Patti one; there's no Ludo-specific carve-out to check.

## What's missing

- No admin UI to change Ludo's `min_players`/`max_players`/`stake_options` (one-time migration values only).
- No admin UI to change the AFK turn-timeout — moot anyway, since `docs/Bugs/ludo-turn-timeout-config-not-wired.md` means there's currently no config field that would do anything even if exposed.
- No live-board visibility or force-action capability while `GameRooms.tsx` remains unrouted (`docs/Bugs/orphaned-admin-pages.md`).
- No visibility into the Ludo matchmaking queue depth or the `ludo:reconcile:failed` Redis list (the durable record of failed settlement/DB write-backs described in `backend.md`) — an admin has no way to see "these N Ludo hands need manual reconciliation" from the UI at all; the only way to inspect that list today is a direct Redis query.
