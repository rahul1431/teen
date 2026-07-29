# Ludo — Backend

This covers the engine itself (`services/game-engines/ludo`). The gateway-side matchmaking, bot-driving, AFK timer, and settlement code is already documented in detail in `docs/backend-services/game-gateway/backend.md` — quoted/summarized here only where needed for context; read that doc for the exact call sequencing.

## State model (`src/rules.ts:1-51`)

Standard 4-player Ludo board encoded as pure numbers, no coordinate geometry (the mobile client owns pixel layout — see `mobile.md`):

- One shared 52-cell main track, `absoluteCell(seatIndex, progress) = (START_OFFSETS[seatIndex % 4] + progress) % 52`, `START_OFFSETS = [0, 13, 26, 39]`.
- Per-token `progress`: `-1` = in base (needs a 6 to enter), `0..50` = on the main track, `51..56` = the 6-cell private home column, `57` (`HOME_PROGRESS`) = finished (exact roll required — `movableTokens` at `rules.ts:110` excludes any move where `prog + dice > HOME_PROGRESS`).
- `SAFE_CELLS = {0, 8, 13, 21, 26, 34, 39, 47}` — every seat start plus the four star squares; no capture happens here.
- `LudoState` is a single flat JSON object (`room_id, players[], status, current_turn, dice, movable_tokens, awaiting, consecutive_sixes, winner_id, round, bot_difficulty`) — this is the entire wire format the gateway relays and the mobile client deserializes (`ludo_engine.dart`'s `LudoState.fromJson` is a byte-for-byte mirror).

**Seat numbering note**: `LudoPlayer.seat` is documented in its own comment as "1-based seat number from the gateway," but the actual board math (`absoluteCell`, `captureAt`, color assignment) never reads `seat` — it always uses the player's **array index** in `state.players[]`. This only stays correct because the gateway's `startGame()` always assigns `seat: i + 1` in the same order it builds the `players` array (`matchmaking.ts:352-358`), so index and `seat - 1` are always identical in practice. If that invariant were ever broken (e.g. a future reseat/reorder feature), the engine's actual gameplay would silently start using the wrong seat's start offset/color while the `seat` field kept reporting the old number.

## HTTP surface (`src/index.ts`)

Four Fastify routes, all JSON:

| Route | Behavior |
|---|---|
| `POST /start` | Builds a fresh `LudoState` via `createInitialState()`, validates/defaults `bot_difficulty` to `'medium'` if not one of `easy/medium/hard`, persists it, returns it. No auth check on this or any other route — see the "No auth" section below. |
| `POST /action` | `{ room_id, user_id, action: 'roll_dice'|'move_token', token_index? }`. Validates turn ownership (`idx !== state.current_turn` → 409), validates `awaiting` matches the action (rolling when a move is owed, or vice versa, → 409), validates `token_index` is actually in `movable_tokens` (→ 409 `'Illegal move'`) before calling into `rules.ts`. |
| `POST /bot-turn` | Convenience endpoint the gateway uses to drive both scheduled bot turns and AFK auto-plays: rolls, and if a move is owed, picks one via `chooseBotToken()` and plays it, in one round trip. |
| `GET /state` | Read-only state fetch by `room_id` (used for debugging/admin, not by the gateway's normal action path). |
| `GET /health` | `{ status: 'ok', service: 'ludo-engine' }`. |

### No authentication or ownership check beyond `user_id` matching current_turn

Every route trusts whatever `user_id` the caller sends — there is no JWT verification, no shared-secret header, no IP allowlist. The Teen Patti Go engine had the identical gap and got it fixed 2026-07-29 (`requireInternalKey()`, `docs/backend-services/teen-patti-engine/overview.md`) — this engine has not received the equivalent fix, so it remains open here even though the sibling engine's version of the same finding is now closed. In production this is mitigated by the fact that only `game-gateway` is expected to call this engine, and the engine does at least check `idx !== state.current_turn` before honoring an action (Teen Patti's own turn check, missing before its 2026-07-29 fix, is now also present). Ludo's per-action turn check is real defense-in-depth; it just doesn't defend against a caller lying about `user_id` for the player who legitimately holds the turn, and there's still no auth stopping a non-gateway caller from reaching it at all.

## Concurrency: `withRoomLock()` (`src/index.ts:34-67`)

Every state mutation (`/action`, `/bot-turn`) is wrapped:
```ts
async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T>
```
Redis `SET NX PX 5000` on `ludo:lock:<roomId>`, polling every 100ms up to a 3s max wait; on acquisition failure throws `RoomBusyError`, mapped to HTTP 409 `{ error: 'Room busy, try again' }`. Release is compare-and-delete (only deletes if `redis.get(lockKey) === token`) so a slow caller whose lock already expired can't delete a different caller's lock that has since acquired it. The in-file comment explains exactly why this exists: "`/action` and `/bot-turn` both do load → mutate → save with no atomicity of their own... a double-tap racing the network, or the gateway's bot driver overlapping a human action... can otherwise both load the same state and the second save silently clobbers the first."

This is the mechanism the Teen Patti engine conspicuously lacked until 2026-07-29 — that engine's `/action` handler did the identical load→mutate→save pattern with no lock at all, until it got its own `withRoomLock()` mirroring this one. Ludo's version was added reactively: commit `872d073 fix(ludo): fix stall bug, state races, seat colors, dice display, AFK handling` is the commit that introduced this exact fix pattern (per its message, "state races" is this class of bug), meaning Ludo shipped once already exposed to it before the fix landed — worth remembering as a general pattern risk for any new game engine cloned from either template.

## Rules / state machine (`src/rules.ts`)

`applyRoll(state, dice)`:
1. Three consecutive 6es forfeit the turn (`consecutive_sixes >= 3` → reset counter, `passTurn()`, return) — the standard anti-stalling Ludo rule.
2. `movableTokens()` computed for the roll; if empty (no token in base and a non-6, or every on-board token would overshoot `HOME_PROGRESS`), the turn passes immediately and `dice`/`consecutive_sixes` are cleared.
3. Otherwise `awaiting` flips to `'move'` and `movable_tokens` is populated for the client to render as tappable.

`applyMove(state, tokenIndex)`:
1. Re-validates `tokenIndex` is in `movable_tokens` (belt-and-braces on top of the HTTP handler's own check).
2. Entering from base (`prog === -1`) lands on progress `0` (the seat's own start cell — always safe, can never be captured the instant it enters).
3. Reaching `HOME_PROGRESS` increments `finished`; if all four tokens are home, `player.status = 'finished'` and the hand ends immediately via `buildResult()` — **the win condition is first-to-finish-all-four, not last-player-standing**; other players' unfinished tokens simply don't matter for who wins, only for the `rankings` array's ordering (sorted by `finished` count) used for the mobile client's post-game standings display.
4. Otherwise checks `captureAt()`: if the landed cell is not a `SAFE_CELLS` member and holds **exactly one** opponent token, that token is sent to `-1` (a 2+ token "blockade" is explicitly not capturable — `rules.test.ts` has a dedicated test for this).
5. `extraTurn = dice === 6 || capturedSomething || reachedHome` — any of the three grants an immediate re-roll for the same player (`awaiting` resets to `'roll'`, turn does not pass).
6. If no extra turn, `passTurn()` advances `current_turn` to the next player whose `status !== 'finished'`, wrapping and incrementing `round` when it wraps past the start.

`chooseBotToken()` (bot AI, difficulty-aware — `rules.ts:276-334`):
- **easy**: 80% of the time picks a uniformly random legal move regardless of merit ("so newer players have room to win against easy bots" per the comment); the remaining 20% falls through to the same capture-seeking logic as medium.
- **medium**: prefers any move that captures an exposed opponent token; otherwise advances the most-progressed movable token.
- **hard**: same capture preference, but when no capture is available, filters to moves that don't leave the token within 1-6 cells of an opponent on an unsafe cell (i.e. not immediately capturable back), preferring the most-progressed *safe* move; only falls back to the exposed move if literally no safe move exists.

This is the same AI invoked for the AFK auto-play path (below) — the gateway docs note the AFK auto-play "no strategy needed" comment undersells that it actually runs this full difficulty-aware chooser, not a naive first-legal-move pick, whenever the timed-out player was mid-move.

## Concurrency + settlement write-back (`saveCompletedGame`, `src/index.ts:208-238`)

On a hand ending, the engine itself (not just the gateway) writes the result to Postgres — `UPDATE game_rooms SET status='completed', winner_id=$1, prize_pool=$2, platform_fee=$3, ended_at=NOW()`. This is a **second**, independent write path from the gateway's own wallet-service settlement call (`handleLudoEnd` in `matchmaking.ts`) — the two are not transactional with each other. `saveCompletedGame` retries up to 3 times with linear backoff (1s, 2s) on failure; if all three attempts fail, it pushes a durable record onto `ludo:reconcile:failed` (the same Redis list `handleLudoEnd`'s own settle-call failure path uses — see `docs/backend-services/game-gateway/backend.md`), with a distinguishing `reason` field (`'saveCompletedGame: game_rooms UPDATE failed after retries'`) so the two failure sources can be told apart during reconciliation. If even the Redis `rpush` fails, it logs a `[RECONCILE-NEEDED]` line as the last resort — there is no further durability tier below that.

Net effect: a Ludo hand's `game_rooms` row and the wallet ledger are updated by **two separate fire-and-forget calls** (this engine's DB write, and the gateway's wallet-service settle call) that can independently succeed or fail. It's possible for the wallet to be correctly settled while `game_rooms.status` never flips to `'completed'` (if only this engine's write fails), or vice versa — each failure mode has its own retry/reconcile record, but there's no single transaction or admin view that reconciles "did both sides agree" for a given room.

## The AFK timer: constant is hardcoded, not read from config

`MatchmakingService.LUDO_TURN_TIMEOUT_MS = 25000` (`services/game-gateway/src/matchmaking.ts:19`) is a compile-time constant. Separately, `infra/db/migrations/008_enable_ludo.sql` seeds `game_configs.special_rules.turn_timeout_seconds = 20` for Ludo — a value that reads exactly like it's meant to configure this timer. Grepping the entire codebase (every service, the admin panel, mobile) for `turn_timeout_seconds`/`turnTimeoutSeconds` turns up **only** the migration's `INSERT`/`UPDATE` — nothing ever selects or reads that field back out of `special_rules`. The actual enforced timeout is 25 seconds, unconditionally, for every Ludo room regardless of what the DB config says or how an admin might try to tune it. See `docs/Bugs/ludo-turn-timeout-config-not-wired.md`.

This compounds with a mobile-side inconsistency: the client's own visual AFK countdown displays a fixed 30-second ring (`_turnTimerSeconds` in `ludo_game_page.dart`) that neither matches the server's real 25s nor the DB's aspirational 20s — see `mobile.md` for the full timer-mismatch writeup (`docs/Bugs/ludo-client-afk-countdown-mismatched-duration.md`).

## Test coverage

`src/rules.test.ts` (`node:test`) is the only automated test coverage for this engine — pure-function tests, no HTTP-handler-level or integration tests (mirroring the Teen Patti engine's `main_test.go`, which is also pure-function-only). Covered: `movableTokens` edge cases (base-token-needs-6, overshoot exclusion, finished-token exclusion), `applyRoll` (no-move pass, legal-move state transition, three-consecutive-sixes forfeit), `applyMove` (illegal-index rejection, base entry, single-token capture, blockade non-capture, win detection, extra-turn vs pass, `passTurn` skipping a finished player), `buildResult` (5% rake rounding to paise), and `chooseBotToken` across all three difficulties (including a hard-mode "avoid a striking-distance cell" scenario and a fuzz-style loop asserting every difficulty always returns a legal token). **Not covered by any test**: the HTTP handlers themselves (`/start`, `/action`, `/bot-turn` request validation and status codes), `withRoomLock()`'s actual concurrent-request behavior, and `saveCompletedGame`'s retry/reconcile path.

## Cross-references

- `docs/backend-services/game-gateway/backend.md` — matchmaking room creation (with the Ludo-specific retry-once-then-cleanup on `/start` failure), `driveLudoBots()`, `scheduleLudoAfkTimer`/`autoPlayIdleLudoTurn`, `handleLudoEnd`, and the exact bridge calls (`POST /start`, `POST /action`, `POST /bot-turn`) this document doesn't re-derive.
- `docs/Bugs/ludo-turn-timeout-config-not-wired.md` (new, this pass).
- `docs/Bugs/ludo-client-afk-countdown-mismatched-duration.md` (new, this pass — see `mobile.md`).
- `docs/Bugs/ludo-preferred-seat-color-selection-ignored-by-server.md` (new, this pass — see `mobile.md`).
