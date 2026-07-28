# Teen Patti — Admin-panel touchpoints

Unlike most other games, Teen Patti has one dedicated, **routed and reachable** admin page (`admin-panel/src/pages/games/TeenPatti.tsx`, nav entry "Games → 🃏 Teen Patti", route `/admin/games/teen-patti` — wired in `main.tsx:19,55` and `Layout.tsx:25`). That's a meaningfully different starting point from `docs/backend-services/game-gateway/admin.md`'s `GameRooms.tsx`, which is fully built but **not** wired into routing (`../../Bugs/orphaned-admin-pages.md`) — Teen Patti's per-game admin page is not in that same boat. What follows adapts `../../backend-services/teen-patti-engine/admin.md` to a game-first structure and adds the one surface that doc didn't cover: emoji management.

## `TeenPatti.tsx` — what it actually does

Three independent panels on one page, all confirmed against the current source:

1. **"Teen Patti Rules & Bots" card** (`TeenPatti.tsx:205-243`) — a form bound to the same Postgres `game_configs` row every other config surface uses: `is_active`, `rake_percent` (0-20%, step 0.5), `bot_fill_enabled`, `bot_fill_delay_seconds` (5-60s), `max_bot_ratio` (0-1), `bot_difficulty` (easy/medium/hard). Loads via `GET /api/admin/game-configs` filtered client-side to `game_type === 'teen_patti'` (`:65-73`), saves via `PATCH /api/admin/game-configs/teen_patti` (`:75-86`, `superadmin`-gated on the admin-service side per `../../backend-services/teen-patti-engine/admin.md`). This is a **third** UI surface writing to the identical row `GameConfig.tsx` and `Bots.tsx` also write to — three independent forms with no cross-linking, so an admin editing one has no indication another page also edits the same values. Two of these fields reach the engine directly (`rake_percent` live on every showdown; `bot_difficulty` at room-creation time, indirectly driving the DDA lookup) — see `backend.md`.
2. **"Teen Patti Game Rooms" table** (`:245-261`) — `GET /game-rooms?status=<filter>` filtered client-side to `game_type === 'teen_patti'`; a room-detail `Drawer` (`:324-394`) additionally calls `GET /game-rooms/:id/live-state` **while the room is active**, which reads the engine's `tp:game:<roomId>` Redis key directly (bypassing gateway and engine HTTP surface) to show every seat's actual hole cards in a "🃏 Live Cards" card — an admin-only "god view," by design, since it's the same route `../../backend-services/game-gateway/admin.md` documents as otherwise-unreachable via the orphaned `GameRooms.tsx`. This table has no `variation` column and no way to force/kick/terminate a room from here (those controls exist only on the unrouted `GameRooms.tsx` — see `../../backend-services/game-gateway/admin.md`).
3. **"😀 Game Emojis" card** (`:264-322`, not mentioned in the prior engine-scoped admin doc) — full CRUD (add/toggle/delete, `sort_order`) against a `game_emojis` Postgres table via `GET/POST/PATCH/DELETE /api/admin/emojis` (`services/admin-service/src/index.ts:2079-2122`). A companion **unauthenticated** `GET /api/admin/config/emojis` (`:2126-2131`) returns just the active emoji glyphs/labels for game clients to render their reaction tray. See "Emoji management is cross-game, not Teen-Patti-scoped" below — this is a genuinely new finding from this pass.

## Emoji management is cross-game, not Teen-Patti-scoped (new finding)

The "😀 Game Emojis" card only exists on the Teen Patti admin page — grepping `admin-panel/src/pages/games/*.tsx` for `emoji`/`Emoji` turns up **only** `TeenPatti.tsx`; `Ludo.tsx`, `Aviator.tsx`, and `Matka.tsx` have no equivalent panel. But the `game_emojis` list it manages is consumed by more than one game's mobile client: `mobile/lib/features/games/teen_patti/game_page.dart:284-292` fetches `/api/admin/config/emojis` for its quick-reaction tray, and so does `mobile/lib/features/games/ludo/ludo_game_page.dart:153-161` (the comment there literally reads "Same admin-configurable emoji list already used on the Teen Patti table"). An admin working the "Teen Patti Management" page — reasonably assuming they're scoped to Teen Patti — who disables or deletes an emoji here silently changes what Ludo players can react with too, with no cross-game indication anywhere in the UI. See `../../Bugs/teen-patti-emoji-config-shared-across-games.md`.

## DDA win-rate target: two admin UI surfaces, neither actually controls it

The most consequential real-money lever this game has (`backend.md`'s DDA section), and admin control over it is effectively fictional in two different ways — both live under AI Control Center, not the Teen Patti page itself:

1. **`admin-panel/src/components/AI/MLConfigPanel.tsx`** ("Bot Settings" card) has a "Max Bot Win Rate (%)" slider whose save posts to `POST /api/admin/ml/config` (`services/admin-service/src/ml-routes.ts:60-75`) — written to Redis/Postgres and published on `ml:config:change`, but **nothing subscribes to the `botSettings` key** anywhere in the codebase (the only subscriber to that pub/sub channel, `risk-service`, only reads `config.fraudDetection`). An admin moving this slider believes they're capping bot win rate; nothing enforces that belief.
2. **`admin-panel/src/components/AI/BotLearningSection.tsx`** *does* read/write the real `bot_profiles` table the engine queries, via `bot-learning-service`'s `ProfileBuilder.overrideProfile()` — but its "Override" form only submits `fold_probability`/`call_probability`/`avg_decision_delay_ms`; **`win_rate_target` is never sent**, even though the backing allow-list includes it, and the UI doesn't even display the current value. The only thing that changes `win_rate_target` in practice is the nightly automatic rebuild, which recomputes it from observed real-player win rates in a percentile band — not from any admin-specified number.

See `../../Bugs/teen-patti-dda-admin-control-gap.md` (already filed).

## Live room state and force actions (via game-gateway, not the engine directly)

`force-action`/`kick`/`terminate` proxy through `game-gateway`'s internal endpoints (`x-internal-key` gated), which for `force-action` replay a synthetic call into the engine's own `/action` handler. The frontend for these three actions is fully built (`admin-panel/src/pages/GameRooms.tsx`) but **not** wired into routing or the nav menu (`../../Bugs/orphaned-admin-pages.md`) — this is the one gap Teen Patti shares with every other game, since `GameRooms.tsx` is generic across game types, not Teen-Patti-specific. `TeenPatti.tsx`'s own room table (above) is read-plus-live-cards only; it has no force/kick/terminate buttons of its own.

## Watchdog visibility

`AIControlCenter.tsx → WatchdogTab` (`admin-panel/src/components/AI/WatchdogTab.tsx`) is reachable and shows every room (any game, including Teen Patti) the 15-minute idle watchdog has reaped, with per-player refund amounts — the one place in the admin panel that surfaces this gateway behavior end-to-end. It shows what already happened, not live state.

## What's missing

- No admin visibility into DDA swaps as they happen — the only record is a `log.Printf("[DDAS] ...")` server log line, not a database row, not an admin-panel feed.
- No admin visibility into how often the `hard`-fallback-to-100% DDA path is being hit in production.
- No per-variant (AK47/Muflis/Joker/No Limit) enable/disable switch anywhere in the admin panel — variant availability is purely a function of which lobby entry points ship in the current mobile build (`mobile.md`).
- No indication in the "😀 Game Emojis" card that the list it manages is shared with Ludo (see above).

## Bug references

Already filed (not re-filed here): `../../Bugs/orphaned-admin-pages.md`, `../../Bugs/teen-patti-dda-admin-control-gap.md`.

New from this pass: `../../Bugs/teen-patti-emoji-config-shared-across-games.md` (see "Emoji management is cross-game" section above; full writeup in the final report of this pass).
