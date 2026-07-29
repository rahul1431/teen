# Teen Patti — Mobile (Flutter)

Files: `mobile/lib/features/games/teen_patti/lobby_page.dart` (stake/variant selection), `game_page.dart` (3,874 lines — the largest single screen in the mobile app), `friends_lobby_page.dart` (private "friends" tables), `history_page.dart`. Shared transport: `mobile/lib/core/socket/socket_service.dart` (`SocketService`, one singleton reused by every game — connection lifecycle, JWT refresh, reconnect/backoff are documented in full in `../../backend-services/game-gateway/frontend.md` and not repeated here) and `mobile/lib/core/constants/socket_events.dart`.

The client never talks to the Go engine directly — every payload it consumes originates from the engine's `GameState`/`GameResult` structs, relayed unchanged through `game-gateway`'s WebSocket.

## Lobby (`lobby_page.dart`) — variant/stake selection happens entirely client-side

`TeenPattiLobbyPage` takes a `variation` constructor parameter (`classic` default, or `ak47`/`muflis`/`joker`/`no_limit`) — one per lobby entry point in the game-select grid. Per-variation identity (`_variationLabel`/`_variationRule`/`_variationIcon`/`_variationGradient`, `:27-88`) is a static client-side lookup keyed by the string — the engine and gateway have no say in which variants exist; the chosen string flows through unchanged in the `join_matchmaking` payload (`:178-182`) to the engine's `StartGameReq.Variation`.

- **Stakes**: fixed list `[10, 50, 100, 500, 1000]` (`:25`), identical across all variants.
- **Pot-limit preview**: `_potLimitFor()` (`:92-99`) re-implements the engine's `potLimitFor()` tiers client-side purely for display (`pot ₹<limit>` under each stake chip) — verified against `main.go:712-724` in this pass and currently in sync (₹10→500, ₹50→1000, ₹100→1500, ₹500→10000, else 20000), but it's a second, independently-maintained copy of the same table with no shared source, so a future engine-side tier change wouldn't automatically show up here.
- **Fee display is hardcoded, not fetched** (new finding): the stat row always shows `Fee: 5%` (`_statTile(Icons.percent_rounded, 'Fee', '5%')`, `lobby_page.dart:494`) regardless of the table's actual configured rake. The real value lives in Postgres `game_configs.rake_percent`, admin-editable 0-20% from three different admin-panel surfaces (`admin.md`) and read live by the engine on every showdown — but the lobby never fetches it, so a rake change away from the seeded 5% default silently goes unreflected in the UI players see before joining. See `../../Bugs/teen-patti-lobby-fee-percent-hardcoded.md`.
- **Balance gate**: `_joinMatchmaking()` (`:160-183`) blocks the join client-side if `_balanceValue < _selectedStake`, showing a "Low Balance" dialog with a direct link to `/wallet` rather than letting a doomed join reach the server. This is a UX nicety, not a security boundary — the real check is wallet-service's lock call inside the gateway's room-creation transaction.
- **Reconnect handling**: `_socket.onReconnect(...)` (`:116-123`) re-emits `join_matchmaking` with the same `stake`/`variation` after a socket reconnect, so a dropped connection while searching doesn't silently drop the player out of the queue. Separately, the server-side gap where a connection close never dequeued the entry (leaving a phantom queue member if the client never reconnected at all) was fixed 2026-07-28.
- **Friends tables**: "Create Table" / "Join with Code" (`:376-409`) push to `friends_lobby_page.dart`, which drives `private:create`/`private:join`/`private:start`/`private:leave` and listens on `private:lobby`/`private:closed` (bare string literals, no `socket_events.dart` constants) — the private-table TTL/rematch mechanics themselves live in the gateway (`../../backend-services/game-gateway/backend.md`'s "Private (\"friends\") tables" section), not in this screen.

## Gameplay screen (`game_page.dart`)

### Consuming engine state (`room:joined` / `game:state_update`)

`_applyRoomJoinedData` (`:250-283`) and the `game:state_update` listener (`:323-355`) both normalize the engine's `GameState` JSON as emitted by Go's `json` tags (`current_turn`, `min_bet`, `is_seen`, `joker_value`, `pot_limit`, etc.) — `_mapPlayers` (`:227-233`) defensively backfills `user_id`/`userId` even though the engine only ever emits `user_id`.

- **`current_turn`** drives `_myTurnNotifier` (whether the action bar is interactive) and whether `_startTurnTimer()` fires.
- **`min_bet`** feeds `_actionCost()` for a client-side "guarded action" balance pre-check (`_guardedAction`, `:699-707`) and the default raise amount.
- **`variation` + `joker_value`** render a persistent on-table pill (`_buildVariantChip`, `:2088-2106`) — the only client-side indication of which rank is wild in Joker mode, read straight off `GameState.JokerValue` (the display string, e.g. `"K"`), not the numeric `joker_rank`.
- **`my_cards`** — a gateway-added, per-recipient field, not part of `GameState` itself; the client has no defense of its own against a card leak, it depends entirely on the gateway's per-recipient filtering (the engine's own `/state` endpoint, if ever reached directly, has no such filtering — `backend.md`).

### The client-side turn timer is redundant with — and shorter than — the server's own AFK backstop

`_startTurnTimer()` (`:658-677`) runs a 30-second `Timer.periodic` the moment state marks it the local player's turn, auto-folding at zero. This roughly matches the *dead* `resources/game-configs/teen-patti.json`'s `table.turnTimeoutSeconds: 30` (see `overview.md`) and is client-side best-effort UX — it only fires if the app is foregrounded, the timer survives, and the socket can still emit. But unlike what an earlier pass of this doc claimed, there **is** a server-side equivalent: `game-gateway`'s `scheduleTeenPattiAfkTimer`/`autoFoldIdleTeenPattiTurn` (`docs/backend-services/game-gateway/backend.md`) arms a 30s Redis-authoritative deadline on every human turn and auto-folds on expiry regardless of whether the client is foregrounded, backgrounded, or gone — so a backgrounded/force-quit/disconnected app is still unstuck by the server within 30s, it just doesn't get the client's own countdown UI first.

### Sending actions (`_sendAction`, `:773+`)

Emits `game:action` with `{room_id, action, amount, sequence_num}` — the engine decodes `sequence_num` but never uses it (`backend.md`), so it has no server-side effect. `_actionCost()` (`:680-695`) mirrors the engine's own cost rules purely for the client pre-flight balance check and must be kept manually in sync with `main.go`'s `processAction` arithmetic — there's no shared source. The mobile UI still imposes no ceiling on a raise client-side (`_actionCost`'s `raise` case just echoes back whatever the bet slider produced, `:686-687`), but the engine now rejects an oversized raise server-side as of 2026-07-29 (`maxRaiseFor`, `backend.md`) — the exploit this used to enable (`../../Bugs/teen-patti-unbounded-raise-forces-bot-fold.md`) is fixed.

### Sideshow flow

`game:sideshow_prompt` / `game:sideshow_reveal` / `game:sideshow_result` (handled by string literal, no constants in `socket_events.dart`) map directly to the engine's `PendingSideshow` sub-state machine (`backend.md`): a `sideshow` action's `sideshow_request` response becomes `sideshow_prompt` to the target only; `sideshow_accept`'s `sideshow_reveal` (both players' actual cards) goes to the two involved players only; `sideshow_reject` becomes a card-free `sideshow_result` to the room. `_sideshowPromptTimer` (`:529-582`) runs a client-side countdown on the prompt dialog — if the local player doesn't respond in time, nothing in the client auto-answers on their behalf (an additional, narrower gap alongside the general turn-timer one above).

### Reactions, chat, and tips

- **Emoji reactions** (`_sendEmoji`, `:811-817`) — emits `room:chat` with `{room_id, message: <emoji>, type: 'emoji'}`; the gateway validates and relays `type` unchanged (`services/game-gateway/src/index.ts:225-238`, `msgType` restricted to `text`/`emoji`), then `_spawnReaction` (`:827-838`) renders a floating bubble over the sender's seat, with per-emoji animation variants (`:1589-1622`). The default 8-emoji tray (`_quickEmojis`, `:145`) is overwritten at load time by `GET /api/admin/config/emojis` (`_loadConfig`, `:285-292`) — the admin-managed list covered in `admin.md`, which this pass found is also shared with Ludo's reaction tray. `_buildEmojiOrImage` (`:3848-3874`) additionally supports admin-uploaded animated emoji (`/uploads/emojis/*.gif`/`.json` Lottie), not just unicode glyphs.
- **Dealer tips** — a separate `room:tip` emit (not covered by the emoji path above); handled server-side by the gateway's direct-Postgres tip transaction (`backend.md`), not wallet-service. `TIP_AMOUNTS = [5,10,20,50]` must match the gateway's hardcoded list by hand.

### Result screen (`game:result`)

`_gameResultSub` (`:380-429`) reads the engine's `GameResult`, pulling `hand_rank` and displaying it with the prize amount. `all_hands` (every non-folded player's cards, sent unconditionally by the engine in every result) powers the post-hand reveal of opponents' cards — no filtering needed at this stage since the hand is already over.

## Cosmetic-only vs. server-enforced, summarized

| Behavior | Enforced where |
|---|---|
| Turn timer / auto-fold at 30s | Client only (`_startTurnTimer`) — no server equivalent |
| Raise amount ceiling | Nowhere — neither client nor engine caps it |
| Balance check before joining/acting | Client pre-flight UX (`_guardedAction`, lobby balance gate) **and** the real wallet-service lock upstream — the client check is a courtesy, the wallet lock is the actual boundary |
| Turn order / out-of-turn allow-list (`see`/`sideshow_accept`/`sideshow_reject`) | Gateway (`index.ts:541`) — **not** the engine itself (`backend.md`) |
| Card privacy (opponents' hole cards) | Gateway's per-recipient filtering on broadcast — the client has no independent defense |
| Rake/fee percentage shown pre-join | Hardcoded client string, not the live configured value (new finding, see lobby section) |
| Pot-limit tier shown pre-join | Client-side copy of the engine's table, currently in sync but independently maintained |

## Bug references

New from this pass: `../../Bugs/teen-patti-lobby-fee-percent-hardcoded.md` (see the lobby section above; full writeup in the final report of this pass).
