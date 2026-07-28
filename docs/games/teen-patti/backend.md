# Teen Patti — Backend (engine + gateway, money paths, concurrency)

This is the game-perspective backend doc: the engine's rules/state machine (adapted from `../../backend-services/teen-patti-engine/backend.md`, spot-checked against current `main.go` for this pass — no drift found) plus the Teen-Patti-specific slices of `game-gateway`'s matchmaking/bot-turn/watchdog logic (from `../../backend-services/game-gateway/backend.md`), combined because in this game neither half makes sense without the other: the engine has no auth, no wallet awareness, and no timers, so almost every safety property a player experiences is actually enforced (or not enforced) by the gateway sitting in front of it.

## Room lifecycle, end to end

1. **Queueing** — `game-gateway`'s `MatchmakingService.joinQueue()` (`matchmaking.ts:45-74`) does `ZADD matchmaking:teen_patti[:<variation>]:<stake> <joinTime> <entry>`. A No Limit table only ever matches other No Limit players at the same stake (`queueKey`, `:39-43`) — variant and stake together partition the queue.
2. **Bot fill** — if `game_configs.bot_fill_enabled`, one `setTimeout(bot_fill_delay_seconds * 1000)` is armed per `<variation>:<stake>` tier (`:58-67`); a Teen-Patti-specific guard forces `bot_fill_table_size` to `4` in memory if the admin-configured value is `NULL` (`:58-60`). Later joiners into an already-armed tier do **not** reset the timer.
3. **Room creation** (`startGame`, `matchmaking.ts:255-540`) — one Postgres transaction inserts `game_rooms` (`status='waiting'`), locks every real player's stake via `wallet-service` `/internal/wallet/lock` (skipped if stake is 0), inserts `game_participants`, then flips `game_rooms.status='active'`. Any failure rolls back and unlocks every wallet already locked in that attempt.
4. **Engine `/start` call** (`matchmaking.ts:378-398`) — a single `POST <TEEN_PATTI_ENGINE_URL>/start` with a 5s abort timeout. **This is the one step with no retry and no cleanup on failure** — see the new finding below.
5. **Card privacy on join** — `room:joined` is sent via `hub.sendToUser`, not `sendToRoom`, specifically so each player only receives their own `my_cards`; opponents' `cards` fields are stripped before broadcast (`:494-517`). The one deliberate bypass is `admin-service`'s live-state route (`../teen-patti/admin.md`).
6. **Bot turns** (`scheduleBotTurn`, `matchmaking.ts:542-694`) drive the table forward whenever a bot holds the current turn; humans act via `game:action` socket events, validated for turn order and out-of-turn allow-listing (`see`/`sideshow_accept`/`sideshow_reject`) by the gateway, **not** by the engine (see "No auth, no turn enforcement" below).
7. **Settlement** (`handleGameEnd`, `matchmaking.ts:900-969`) — calls `wallet-service` `/internal/wallet/settle-game` with `idempotency_key: 'settle_<roomId>'`, emits `monitorEmitter('game_result', ...)`, broadcasts `game:result`. Unlike Ludo's `handleLudoEnd`, there is **no retry-once-then-reconcile-list fallback** if this settle call fails — it's logged and left as-is with no recovery record.

## Engine HTTP surface (`services/game-engines/teen-patti/main.go:860-866`)

Four plain `net/http.ServeMux` routes, no auth middleware, no JWT, no `x-internal-key` check of any kind — unlike every other inter-service call in this codebase:

| Route | Handler | Purpose |
|---|---|---|
| `POST /start` | `startGame` (`:311-445`) | Shuffles, deals 3 cards/player, runs DDA, writes initial `GameState` to `tp:game:<roomId>` (2h Redis TTL). |
| `POST /action` | `processAction` (`:447-698`) | The entire betting state machine — every fold/call/raise/show/see/sideshow* action. |
| `GET /state?room_id=` | `getState` (`:821-831`) | Returns the raw `GameState` JSON straight from Redis, **including every seat's cards**, unfiltered. |
| `GET /health` | inline | Static `{"status":"ok",...}`, no DB/Redis ping. |

`ActionReq.SequenceNum` (`:292`) is decoded and never read again anywhere in the file — despite its name, it provides no replay/ordering protection.

## State machine

`GameState.Status` is only ever `"betting"` (set at deal time, `:424`) or `"completed"` (set at hand resolution, `:675`) — no separate waiting/showdown phase inside the engine. `Player.Status` is documented as `active, folded, all_in` (`:41`) but **`"all_in"` is never assigned anywhere in the file** — there is no all-in mechanic; a player who can't cover a bet just has their wallet lock fail upstream in the gateway, surfacing as a generic "insufficient balance" error with fold as the only option.

**Turn advancement** (`:641-686`): after every action, if `activePlayers <= 1`, the action was `"show"`, or the pot has hit its limit, the hand ends (`determineWinner` runs, `saveCompletedGame` fires in a detached goroutine whose Postgres errors are only `log.Printf`'d, never retried or surfaced). Otherwise, unless the action is one of `see`/`sideshow`/`sideshow_accept`/`sideshow_reject` (which hold the turn), `CurrentTurn` advances to the next `active` player.

**Sideshow sub-state machine** (`PendingSideshow`, `:546-590`): a seen player can ask the previous active player for a private card comparison (costs `MinBet*2`, needs 3+ active players). While pending, `processAction`'s top-of-function gate (`:481-489`) only allows the target's accept/reject or the requester's fold — this is the **one** action (`sideshow`, `:550-552`) that checks `state.CurrentTurn == playerIdx` at the engine level.

**Pot limits** (`potLimitFor`, `startPotLimit`, `:700-725`): ₹10 stake→₹500 cap, ₹50→₹1000, ₹100→₹1500, ₹500→₹10000, ₹1000+→₹20000; uncapped for `no_limit`. Once `state.Pot >= potLimit`, the *next* action forces a showdown. **The cap is checked only after an action is applied, not before** — `raise` has no upper bound at all (only a minimum, `:509-524`), so a single raise can blow past the tier cap in one action; see `../../Bugs/teen-patti-unbounded-raise-forces-bot-fold.md`.

## Hand evaluation and variants

`evaluateHand` (`:122-169`): `HighCard(1) < Pair(2) < Color(3) < Sequence(4) < PureSequence(5) < Trail(6)`, with A-2-3 treated as the *highest* sequence (`Score=1600`, deliberately above A-K-Q's 1542) — an Indian house-rule choice, not a bug. `compareHands` (`:171-185`) is a pure rank-then-score comparator.

`determineWinner` (`:744-798`) layers house tiebreak rules on top when `compareHandsVariant` returns equal: (1) blind beats seen, (2) among equally-blind/seen hands, whoever did **not** request the show wins ("the defender wins," using `state.Players[state.CurrentTurn]` as the requester). Only rule 1 has a test (`TestDetermineWinnerTiebreaker`); rule 2 is untested. This tiebreak logic is **not** shared with `findBestHandIndex` (used by DDA at deal time), which only compares rank+score — a latent inconsistency if DDA's "best hand" logic is ever reused elsewhere.

AK47/Muflis/Joker (`wildRanks`, `evaluateHandVariant`, `compareHandsVariant`, `:187-255`): AK47 fixes wilds to `{A,K,4,7}`; Joker draws one wild rank per hand via `crypto/rand` (`:326-333`); Muflis simply negates the classic comparator (worst hand wins). Wild substitution brute-forces every possible card (52 substitutions per wild slot, recursively) — worst case (3 simultaneous wilds) is `52^3 = 140,608` synchronous hand evaluations run inline inside the HTTP request, untested and unbenchmarked.

## DDA — the card-swap mechanism (`startGame:384-417`)

Runs once per hand, only if the room has ≥1 bot and ≥1 human. Looks up `winRateTarget` from `bot_profiles.win_rate_target` for the room's `bot_difficulty` (`easy`/`medium`/`hard`); on any DB error, falls back to hardcoded `easy=35%, medium=50%, hard=100%` (`:364-371`). Finds whoever holds the best hand (`findBestHandIndex`); if that's a human, rolls `[0,100)` via `crypto/rand`, and if `roll < winRateTarget`, swaps that human's cards with the **first bot by seat position**. The seeded DB defaults are `easy=35%, medium=50%, hard=65%` (`infra/db/migrations/016_bot_learning.sql:32-34`) — i.e. "hard" bots are designed to take the best hand from a human ~2 hands in 3 by card distribution alone, not decision quality. The bug is the *fallback*: any transient `bot_profiles` read error on a `hard` table silently jumps the swap rate from the seeded 65% to a hardcoded **100%** — see `../../Bugs/teen-patti-dda-hard-fallback-100-percent.md`. The only audit trail is a `log.Printf("[DDAS] ...")` line — no DB row, no admin-visible record (`admin.md`).

## Rake

`loadRakePct` (`:730-742`) reads `game_configs.rake_percent` fresh from Postgres on **every** showdown (no caching) — falls back to 5% if the query errors or the value is outside `[0,50]`. All arithmetic is `float64` end-to-end (no integer paise or `decimal` type) — no concrete rounding-drift bug was demonstrated in this pass, but it's worth periodic scrutiny for a real-money path.

## Money-moving paths

- **Stake lock** — `wallet-service` `/internal/wallet/lock`, called once per real player inside the room-creation transaction, *before* the engine's `/start` is ever called.
- **Per-action lock** — for bot turns, the gateway computes `extraBet` (call/raise/show/sideshow all charge different amounts; sideshow always charges "seen chaal" = `minBet*2`) and locks it via `wallet-service` before calling the engine's `/action`; a lock failure **forces the bot to fold** rather than erroring the table.
- **Settlement** — `wallet-service` `/internal/wallet/settle-game`, idempotency-keyed `settle_<roomId>` (safe to retry, but the gateway never retries it for Teen Patti — see above).
- **Dealer tips** (`room:tip`, `index.ts:240-287`) — the **only** money-moving path that does **not** go through wallet-service: the gateway opens its own Postgres transaction directly against `wallets`/`wallet_transactions` (`SELECT ... FOR UPDATE`, balance check, insert `tip_dealer` row, decrement balance). `TIP_AMOUNTS = [5,10,20,50]` must be kept in sync with the mobile tip tray by hand, no shared config. See `../../Bugs/dealer-tip-idempotency-key-is-not-actually-idempotent.md`.

## Concurrency / locking

**No lock in the engine.** `/action`'s Redis read-modify-write (`main.go:455-462, 687-689`) has no mutex, no `WATCH`, no `SET NX`. Compare to the Ludo engine's explicit `withRoomLock()` (Redis `SET NX PX` mutex). Two calls for the same room close together — e.g. a scheduled bot-turn timer firing at the same moment a human sends an out-of-turn `see`/`sideshow_accept` (both explicitly allowed out-of-turn by the gateway) — can silently clobber each other. See `../../Bugs/teen-patti-engine-no-room-lock.md`.

**Bot-turn retry-once-then-abort** (`matchmaking.ts:678-690`): if a scheduled bot action throws (engine unreachable, lock exception, etc.), it's retried once after 2s; if that also throws, the game is force-ended via `handleGameEnd(roomId, {winner_id: null, prize: 0}, ...)` — no winner, zero prize, purely to unblock the table. A genuinely stuck bot turn forfeits the pot rather than refunding it.

**No per-turn timeout anywhere server-side.** The engine stores no per-turn timestamp (`CreatedAt` is the only time field, set once at deal). The gateway has a 25s AFK auto-play timer for Ludo (`LUDO_TURN_TIMEOUT_MS`) but **no equivalent for Teen Patti** — a stuck human's turn is only ever unstuck by the room-level 15-minute `GameWatchdog` (which refunds *everyone* at the table, not just the stuck player) or an admin's `force-action` call. See `../../Bugs/teen-patti-no-turn-timeout.md`.

## No authentication, no server-side turn enforcement

Every engine action handler except `sideshow` mutates state for whatever `user_id` the caller supplies, with no check that the caller *is* the gateway (no header, no JWT, nothing) and no independent verification of `state.CurrentTurn`. The gateway's turn-order/allow-list checks (`index.ts:541`) are enforced by a cooperating caller, not by the source of truth. The engine also binds `:3010` on all interfaces, not `127.0.0.1`. See `../../Bugs/teen-patti-engine-no-auth-or-turn-enforcement.md`.

## New finding: engine-start failure has no retry or room cleanup (unlike Ludo)

`matchmaking.ts:378-398` calls the Teen Patti engine's `/start` exactly once, with a 5s timeout, inside a `try/catch` that only logs `'Teen Patti engine unavailable, using fallback state'` on any failure — no retry, no room teardown. Compare directly to the Ludo branch immediately below it (`:400-437`): Ludo retries the same call once after a 1.5s sleep, and if it *still* fails, the room is torn down immediately (stakes unlocked, `game_rooms.status='cancelled'`, players notified) — the inline comment at `:424-427` explicitly documents this was a reproduced-live bug ("the player is left staring at a dead, unresponsive board... until the 15-min idle watchdog eventually refunds them") that got fixed for Ludo specifically. Teen Patti never received the equivalent fix: on any `/start` failure or timeout, the room proceeds on `fallbackState` (`:360-373`), which has no cards and no corresponding engine-side Redis key, so every subsequent `/action` call 404s with `"game not found"` (`main.go:455-459`). By the time this branch runs, every real player's stake is already locked (the wallet-lock loop runs earlier in the same room-creation transaction, `matchmaking.ts`'s `startGame` step 3), so the practical effect is a table that can never be played, with everyone's stake frozen for up to 15 minutes until `GameWatchdog` reaps and refunds the room. See `../../Bugs/teen-patti-engine-start-failure-strands-locked-funds.md`.

## Test suite summary (`main_test.go`, 236 lines — the only automated test coverage in this service)

| Test | Covers |
|---|---|
| `TestEvaluateHand` | Pair kicker tiebreak |
| `TestDetermineWinnerTiebreaker` | Blind-beats-seen tiebreak only (not defender-wins) |
| `TestDDASCardSwapping` | DDA swap mechanics, reimplemented inline — not via `startGame`, doesn't exercise the real `winRateTarget` lookup/fallback |
| `TestMuflisInvertsRanking` | Muflis inversion, pure + end-to-end |
| `TestJokerWildSubstitution` / `TestAK47WildSubstitution` | Single wild-card substitution only |
| `TestPotLimitFor` / `TestStartPotLimit` | All stake tiers + no-limit |

Not covered by any test: the HTTP handlers themselves (no `httptest` usage anywhere), the DB-backed `winRateTarget` lookup/fallback path, the sideshow flow, raise's missing upper bound, `loadRakePct`'s DB read, `saveCompletedGame`'s write-back, any concurrency scenario, and 2-3 simultaneous wild cards.

## Bug references

Already filed (not re-filed here): `../../Bugs/teen-patti-engine-no-auth-or-turn-enforcement.md`, `../../Bugs/teen-patti-unbounded-raise-forces-bot-fold.md`, `../../Bugs/teen-patti-dda-hard-fallback-100-percent.md`, `../../Bugs/teen-patti-dda-admin-control-gap.md`, `../../Bugs/teen-patti-engine-no-room-lock.md`, `../../Bugs/teen-patti-no-turn-timeout.md`, `../../Bugs/teen-patti-engine-url-env-example-broken.md`, `../../Bugs/dealer-tip-idempotency-key-is-not-actually-idempotent.md`, `../../Bugs/matchmaking-queue-orphaned-on-disconnect.md`.

New from this pass: `../../Bugs/teen-patti-engine-start-failure-strands-locked-funds.md` (see the "New finding" section above; full writeup in the final report of this pass).
