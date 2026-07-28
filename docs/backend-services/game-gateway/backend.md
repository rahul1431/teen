# Game Gateway — Backend

## Connection lifecycle (`src/index.ts:60-117`)

`WebSocketServer` mounts at path `/ws` on the shared Fastify HTTP server. On `connection`:
1. Token is read from `?token=` query param or the `Authorization` header (`index.ts:66-67`), verified with `app.jwt.verify()` (secret `JWT_SECRET`). Failure closes with code **4001** (`No token` / `Invalid token`, `index.ts:69,75`) — the mobile client specifically matches on 4001 to force a token refresh before reconnecting (see `frontend.md`).
2. A `Conn` (`{ ws, userId, username, rooms: Set<string>, isAlive }`, `realtime.ts:6-12`) is built from the JWT's `sub`/`username` claims and registered via `hub.add(conn)`.
3. Every inbound frame is `JSON.parse`'d into `{ event, data }` and dispatched through `handleEvent()` (`index.ts:87-98`); a throwing handler is caught and turned into an `error` event back to that connection only, so one bad handler can't crash the process or the socket.
4. On `close`, only `hub.remove(conn)` runs (`index.ts:100-103`) — **the connection is not removed from any matchmaking queue it may be sitting in.** See `docs/Bugs/matchmaking-queue-orphaned-on-disconnect.md`.

**Heartbeat** (`index.ts:108-117`): a 30s `setInterval` walks `wss.clients`, terminates any socket whose `isAlive` flag is still `false` from the previous sweep, otherwise flips it to `false` and sends a WS ping. `ws.on('pong', ...)` flips it back to `true`. Note this `isAlive` flag lives on the raw `ws` object (`(ws as any).isAlive`), not on `Conn.isAlive` — the `isAlive` field on the `Conn` interface itself is set once at connect time and never updated again; it's effectively dead.

## `realtime.ts` — `RealtimeHub`

The shared broadcast primitive used by every event handler in `index.ts` and every code path in `matchmaking.ts`/`watchdog.ts`. Two in-memory indexes:
- `byUser: Map<string, Set<Conn>>` — all live connections for a user (a user can have >1, e.g. two devices or a stale reconnecting tab).
- `byRoom: Map<string, Set<Conn>>` — all live connections currently joined to a room.

Membership:
- `add(conn)` / `remove(conn)` — `remove` cleans a connection out of `byUser` **and** every room in `conn.rooms`, deleting the outer Set entries once empty (no unbounded Map growth from churn).
- `joinRoom(userId, roomId)` — joins **every** live connection of a user to a room (used when a match is found, before `room:joined` is sent, so the broadcast that follows reaches all the player's devices).
- `joinConn(conn, roomId)` — joins one specific connection (used by the `join_room` event handler when a client explicitly re-syncs, e.g. after a reconnect).

Broadcast:
- `send(conn, event, data)` — direct reply to one connection, `{event,data}` JSON.
- `sendToUser(userId, event, data, senderId?)` / `sendToRoom(roomId, event, data, senderId?)` — deliver to local connections in that index, **and**, only if `senderId` is omitted, `redisPub.publish('gateway:broadcast', { type, target, event, data, sender: processId })`. The `redisSub` handler in `index.ts:38-52` re-invokes `sendToRoom`/`sendToUser` with `senderId = msg.sender` for messages from other processes, which both (a) delivers locally and (b) short-circuits the republish (since `senderId` is now set) — this is what prevents an infinite publish loop across instances. As noted in `overview.md`, this whole path is currently unexercised in production because PM2 runs a single `instances: 1` gateway process.
- `rawSend(ws, msg)` (private) — only sends if `ws.readyState === WebSocket.OPEN`, and swallows any synchronous throw from `ws.send()` ("connection went away mid-send"). This is the only place a dead/closing socket is defended against on the write path.

There is no room/namespace concept beyond these two flat maps — "joining a room" is purely local bookkeeping, there's no server-authoritative membership check on `sendToRoom` (any code path can broadcast to any `roomId` string whether or not it corresponds to a real `game_rooms` row).

## `watchdog.ts` — `GameWatchdog` (the idle-room reaper)

Exact constants (`watchdog.ts:14-15`):
- `IDLE_MS = 15 * 60 * 1000` (15 minutes)
- `SWEEP_MS = 5 * 60 * 1000` (5 minutes) — `start()` arms a `setInterval(sweep, SWEEP_MS)`.

**Liveness signal**: Redis key `game:lastaction:<roomId>`, value = `Date.now()` string, `EX 7200` (2h TTL). `GameWatchdog.touch(redis, roomId)` is a static, fire-and-forget helper (errors swallowed — "liveness marker only, never block gameplay") called from:
- `index.ts:155` — every `game:action` event, before dispatch.
- `matchmaking.ts:257` — `startGame()`, right when a room is created.
- `matchmaking.ts:573` — every scheduled Teen Patti bot turn, when it fires.
- `matchmaking.ts:701` — every iteration of the Ludo bot-driving loop (`driveLudoBots`).

**Sweep** (`watchdog.ts:32-43`): `SELECT id, game_type FROM game_rooms WHERE status IN ('waiting','active') AND created_at < NOW() - INTERVAL '15 minutes'`. For each candidate, reads `game:lastaction:<roomId>`; if present and `Date.now() - Number(last) < IDLE_MS`, skips it (still alive). Otherwise reaps it. Note "waiting" is close to a dead branch in practice: `startGame()` inserts a room as `'waiting'` and updates it to `'active'` in the *same* Postgres transaction (`matchmaking.ts:280,309`), so a room only stays `'waiting'` if that transaction crashed mid-flight without rolling back — the sweep's `'waiting'` clause is defensive, not something normal traffic hits.

**Reap** (`watchdog.ts:45-96`), what "abandoned" means and the refund logic:
1. Fetches every `game_participants` row for the room, joined to `users` for the username.
2. For each participant with `entry_fee_deducted > 0`: skips if a `wallet_transactions` row already exists with `idempotency_key = 'consume:<roomId>:<userId>'` (i.e. the game already settled and consumed that lock — don't double-refund a resolved game that just hasn't had its `game_rooms.status` flipped yet for some reason).
3. Otherwise calls `wallet-service` `POST /internal/wallet/unlock` for that user/amount. A non-2xx or thrown error is logged and that participant is simply skipped (**not retried** — see failure-mode note below).
4. `UPDATE game_rooms SET status = 'cancelled'`, then deletes `game:room:<roomId>`, `game:lastaction:<roomId>`, `private:room:<roomId>` from Redis.
5. Broadcasts `hub.sendToRoom(roomId, 'error', { message: 'Game cancelled due to inactivity — entry fee refunded' })` — only reaches anyone still connected; most reaped rooms have zero live connections by definition (that's usually *why* they went idle).
6. Inserts one row into `watchdog_events` (`room_id, game_type, action='reaped', refunds (jsonb), total_refunded`) — this is what powers the admin panel's Watchdog tab (`admin.md`).

**Failure modes**:
- If the `wallet-service` unlock call fails for one participant (step 3), that participant's lock is silently left in place forever — no retry, no error record beyond a `console.error` line, no `watchdog_events` entry for the individual failure (only the participants that *did* refund appear in the event's `refunds` array). The room is still marked `cancelled` and deleted from Redis regardless, so there is no future sweep that will retry that specific unlock — this is a real path to a permanently stuck locked balance for one player. Compare to `matchmaking.ts`'s Ludo settlement path, which pushes failures onto a `ludo:reconcile:failed` Redis list for exactly this reason; the watchdog has no equivalent reconciliation record.
- The whole reaper depends on `game:lastaction:<roomId>` surviving in Redis. Since gameplay state (`game:room:<roomId>`) is *also* only in Redis with no durability requirement, a Redis restart that loses the liveness key would already have lost the room's playable state too — so this isn't an incremental fragility specific to the watchdog.

## `matchmaking.ts` — `MatchmakingService`

### Queueing

`queueKey(gameType, stake, variation)` (`matchmaking.ts:39-43`): `matchmaking:<gameType>:<stake>` for `variation === 'classic'`, else `matchmaking:<gameType>:<variation>:<stake>` — so e.g. a No Limit Teen Patti table only ever matches other No Limit players at that stake.

`joinQueue()` (`:45-74`):
1. `ZADD <key> <Date.now()> <JSON entry>` — score is join time, used for FIFO ordering by later `ZRANGE`.
2. Reads `game_configs` for `min_players, max_players, bot_fill_enabled, bot_fill_delay_seconds, max_bot_ratio, bot_fill_table_size`. Teen Patti has a special-case guard: if `bot_fill_enabled` is true but `bot_fill_table_size` is `NULL` in the DB, it's forced to `4` in memory (`:58-60`) — originally a defense against an admin save blanking the field via the same missing-fallback bug that hit `is_active` (fixed 2026-07-28 for every field on this route, `bot_fill_table_size` included), so this in-memory guard is now a second line of defense rather than the only one.
3. Calls `tryCreateRoom()` immediately (in case enough players are already queued).
4. If `bot_fill_enabled`, arms **one** `setTimeout(..., bot_fill_delay_seconds * 1000)` per `<gameType>:<variation>:<stake>` tier (keyed in `this.timers`, guarded by `!this.timers.has(timerKey)`) that calls `botFillRoom()`. Later joiners into an already-armed tier do **not** reset this timer — the wait is bounded by the first joiner's arrival, not each individual joiner's.

`tryCreateRoom()` (`:87-130`) pops players from the queue **atomically** via a Lua `EVAL`: `ZRANGE 0 max_players-1`, and only if `#members >= no_bot_threshold` does it `ZREM` them and return the list; otherwise returns empty and nothing is popped. `no_bot_threshold` is `bot_fill_table_size || min_players` when bot-fill is on (so Teen Patti won't instant-start a 2-real-player game when it's aiming for a 4-seat table — it waits for either 4 real players or the bot-fill timer), else `min_players` when bot-fill is off (so real players aren't stranded forever with no timer to top them up).

`botFillRoom()` (`:132-188`): pops **all** currently-queued members for that tier (separate Lua `EVAL`), computes `botsNeeded` (fixed target size minus real players, or `min(max_players - real, max(maxBots, minBotsNeeded))` when there's no fixed size), fetches bots via `getBots()`. If real+bots still can't reach `min_players` (e.g. no eligible bots in the DB), the real players are **re-queued** (`ZADD` back in) with an `error` event ("No opponents available yet. Still searching…") and a fresh timer is armed to retry.

`getBots()` / `autoRefillBots()` (`:201-253`): bots are real `users` rows with `is_bot = true`; `autoRefillBots()` tops any bot under the current stake back up to a flat `real_balance = 10000` (direct `wallet_transactions`/`wallets` write in its own transaction, not via wallet-service) before selecting `count` random eligible bots with `ORDER BY RANDOM()`.

### Room creation (`startGame`, `:255-540`)

1. New `roomId` (`uuid()`), immediately `GameWatchdog.touch()`'d.
2. Looks up `bot_difficulty` from `game_configs` (defaults `'medium'` on any failure).
3. One Postgres transaction: insert `game_rooms` (`status='waiting'`), then for every player (real + bot) call `wallet-service` `/internal/wallet/lock` (skipped entirely if `stake === 0`) and insert a `game_participants` row; update `game_rooms.status = 'active'`. Any failure rolls back the transaction, **unlocks every wallet that was successfully locked before the failure** (loop over `lockedUserIds`), and emits an `error` to each real player so they aren't left waiting silently.
4. Emits `monitorEmitter.emit('room_joined', ...)` once per real player (fraud pipeline).
5. Builds `fallbackState` (a locally-constructed room-state object) in case the engine call fails.
6. **Teen Patti**: `POST <TEEN_PATTI_ENGINE_URL>/start` with a 5s `AbortSignal.timeout`. On success, `engineState` becomes the source of truth (dealt cards, dealer, pot, etc.); on failure the room still starts on `fallbackState` (no cards — effectively a broken room the players can't act in until the 15-min watchdog eventually reaps it, since `fallbackState.currentTurn = 0` but there's no valid engine-side game for `/action` to operate on). There is only ever **one** attempt for Teen Patti — no retry, unlike Ludo below.
7. **Ludo** is a fully separate branch (`:402-487`) with its own state shape and no cards: calls `<LUDO_ENGINE_URL>/start`, and if that fails, **retries once** after a 1.5s sleep. If it *still* fails, the room is torn down immediately — stakes unlocked, `game_rooms.status = 'cancelled'`, real players notified — rather than left to rot for 15 minutes; the comment at `:424-427` explicitly documents this was a reproduced-live bug before the retry/cleanup was added. Teen Patti has no equivalent immediate-cleanup path for an engine-start failure — it silently falls back to `fallbackState` instead (see the Bugs list below for why this is asymmetric and how it can strand players).
8. On success (either game), private card data (`my_cards`) is filtered per-recipient — `room:joined` is sent via `hub.sendToUser`, not `sendToRoom`, specifically so each player only receives their own cards; shared/opponent views always have `cards: undefined` stripped before broadcast (`:196,517,626`, etc.) — the one place this protection is bypassed is the admin's `/internal/game-rooms/:id/live-state` route in `admin-service`, which reads the raw Redis state directly and *does* include all seats' cards, by design, for the admin "Live Spectator" view (`admin.md`).
9. If the opening turn belongs to a bot, `scheduleBotTurn()` (Teen Patti) or `driveLudoBots()` (Ludo) is kicked off immediately so the table doesn't sit idle waiting for a human to trigger it.

### Teen Patti bot turns (`scheduleBotTurn`, `:542-694`)

Re-entrancy guard: `botTimers: Map<roomId, {timer, turnIdx}>` — if a timer is already armed for the *same* `turnIdx`, a second call is a no-op; if the turn has moved on, the stale timer is cleared first. Delay and action come from `bot-profile.ts` (`getBotProfile` → cached/HTTP/fallback decision weights, `pickBotAction`/`pickBotDelay`, ±30% jitter on delay).

When the timer fires: computes `extraBet` per action (call/raise/show/sideshow — sideshow always charges a "seen chaal", i.e. `minBet * 2`), locks that amount via wallet-service (on lock failure, **forces the bot to fold** rather than erroring — a bot with insufficient balance never breaks the table), calls the Teen Patti engine's `/action`, broadcasts `game:state_update` to all real players, and either reschedules the next bot turn or calls `handleGameEnd()`.

**Retry-once-then-abort pattern** (`:678-690`): if the whole `doAction()` closure throws (engine unreachable, lock failure exception, etc.), it's retried once after a 2s sleep; if the retry also throws, the game is force-ended via `handleGameEnd(roomId, { winner_id: null, prize: 0 }, ...)` — i.e. **no winner, zero prize**, purely to unblock the table. Whatever wallet locks are outstanding for the other (non-bot) players at that point are handled by `handleGameEnd`'s settlement call to `wallet-service` `/settle-game`, not refunded individually — a genuinely stuck bot turn effectively forfeits the pot rather than cancelling/refunding the hand.

### Ludo bot driving and the human AFK timer

`driveLudoBots()` (`:698-738`) loops (bounded to 400 iterations as a runaway guard) calling `<LUDO_ENGINE_URL>/bot-turn` with a fixed 1200ms pacing sleep between calls, for as long as the current turn belongs to a bot. The moment it finds a human's turn, it calls `scheduleLudoAfkTimer(roomId)` (`:745-755`) and returns.

`LUDO_TURN_TIMEOUT_MS = 25000` (25s, `:19`). This timer **only exists for Ludo.** If it fires, `autoPlayIdleLudoTurn()` (`:762-808`) re-checks state (the human may have just acted), and if still their turn, plays the *minimum* legal action for them: `move_token` with the first entry in `movable_tokens` if a move is owed, otherwise a full `/bot-turn` call (which rolls **and** auto-picks/plays a token via the engine's own bot AI if a move follows the roll — the inline comment describing this as "no strategy needed" undersells that the auto-played move, when one happens, actually goes through the same `chooseBotToken()` difficulty-aware logic real bots use, not a naive first-legal-move pick). The player is told `'You took too long — your turn was played automatically.'` via a direct `error`-channel message to just that user.

**Teen Patti has no equivalent per-turn timer.** A connected-but-unresponsive (or silently disconnected — see below) human holding the current Teen Patti turn simply stalls the table until the room-level 15-minute `GameWatchdog` reaps the whole room (refunding *everyone*, not just the stuck player), or until an admin intervenes via the internal `force-action` endpoint. See `docs/Bugs/teen-patti-no-turn-timeout.md`.

### Game end / settlement

`handleGameEnd()` (Teen Patti, `:900-969`) and `handleLudoEnd()` (Ludo, `:811-898`) both: cancel any pending bot timer, fetch `game_participants` for `entry_fee`, call `wallet-service` `/internal/wallet/settle-game` with `idempotency_key: 'settle_<roomId>'` (safe to retry), emit `monitorEmitter('game_result', ...)`, and broadcast `game:result` to every real player. `handleLudoEnd` additionally **retries the settle call once** and, if it still fails, pushes the full settlement payload onto a `ludo:reconcile:failed` Redis list for out-of-band reconciliation — `handleGameEnd` (Teen Patti) does **not** have this retry/reconcile fallback; a failed Teen Patti settle call is logged and left as-is with no recovery record. `onGameEnd` (set by `index.ts`) is invoked from both paths afterward to re-open a private table's lobby if the room was a friends table.

## Bridge to the engines — exact calls

**Teen Patti** (`TEEN_PATTI_ENGINE_URL`, default `http://127.0.0.1:3010`):
- `POST /start` — room/player/stake/variation/bot-difficulty, returns dealt state.
- `POST /action` — `{ room_id, user_id, action, amount, sequence_num }`, returns `{ state, result? }`.

The engine itself (`services/game-engines/teen-patti/main.go`) has **no per-room lock or mutex** around its `/action` handler: it does a plain `redis.Get` → unmarshal → mutate → `redis.Set` (`main.go:455-462, 687`) with nothing serializing two concurrent calls for the same `room_id`. This matters because the gateway *can* issue two calls for the same room close together — e.g. a scheduled bot-turn timer firing at the same moment a human sends an out-of-turn `see`/`sideshow_accept`/`sideshow_reject` (both are explicitly allowed out-of-turn, `index.ts:541`). Compare to the Ludo engine, which has an explicit `withRoomLock()` (Redis `SET NX PX` mutex, `services/game-engines/ludo/src/index.ts:34-67`) added specifically to prevent this exact "second save silently clobbers the first" race — the Go engine has no equivalent. See `docs/Bugs/teen-patti-engine-no-room-lock.md`.

**Ludo** (`LUDO_ENGINE_URL`, default `http://127.0.0.1:3011`):
- `POST /start`, `POST /action` (`roll_dice`/`move_token`), `POST /bot-turn` (rolls and, if a move follows, plays it via the engine's bot AI in one call) — all guarded by the engine's `withRoomLock()`.

## Dealer tips (`room:tip`, `index.ts:240-287`)

Unlike every other money-moving path in this service, tipping the dealer is **not** routed through `wallet-service`. The gateway opens its own Postgres transaction directly against `wallets`/`wallet_transactions`: locks the row (`SELECT ... FOR UPDATE`), checks `real_balance >= tip`, inserts a `tip_dealer` transaction, decrements `real_balance`. `TIP_AMOUNTS = [5, 10, 20, 50]` (`index.ts:25`) — must be kept in sync with the mobile tip tray by hand (no shared config). The error message on insufficient balance is deliberately **not** the phrase "insufficient balance" (comment at `:258-259`) because the mobile client's generic error handler pattern-matches that exact phrase to pop a low-balance dialog, which would be wrong context here.

## Internal admin endpoints (`index.ts:728-895`)

All three require header `x-internal-key === INTERNAL_SERVICE_KEY`; see `admin.md` for the admin-panel/admin-service side.
- `POST /internal/game-rooms/:roomId/force-action` — builds a synthetic `Conn` with a pre-closed `ws` (`readyState: 3`) so `rawSend` no-ops, then replays `handleGameAction`/`handleLudoAction` as if that user had sent it.
- `POST /internal/game-rooms/:roomId/kick` — flips `is_bot = true` for that participant in both Postgres and the cached Redis state (Ludo's `game:room:<roomId>` and, for Teen Patti, both `tp:game:<roomId>` and the shared `game:room:<roomId>` copy), broadcasts the updated state, drives a bot turn if it was that player's turn, and sends `game:kicked` to force the client to leave.
- `POST /internal/game-rooms/:roomId/terminate` — unlocks every real (non-bot) participant's `entry_fee_deducted` via wallet-service, marks `game_rooms` `completed`, deletes both Redis state keys, broadcasts `game:terminated`.

## Private ("friends") tables (`index.ts:294-480`)

`PRIVATE_TABLE_TTL = 15 * 60` seconds — both `private:table:<code>` and `private:room:<roomId>` are `SETEX`'d with this TTL on every write, so an unused lobby or an untracked room mapping expires after 15 minutes of inactivity. Codes are 6 characters from a 33-char unambiguous alphabet (no `0/O`, `1/I`), generated with `crypto.randomInt`, retried up to 8 times against a Redis `EXISTS` check for collisions.

`REMATCH_DELAY_MS = 12_000` — `matchmaking.onGameEnd` (wired in `index.ts:431-466`) re-opens the table to `'lobby'` after a settled hand and, 12 seconds later, auto-restarts the next hand if ≥2 players remain and nobody else already started it (checked by re-reading `table.state !== 'lobby'`). The mobile result overlay shows a "Same Table (10s)" countdown — the server intentionally fires 2 seconds after that UI countdown ends so players who tap "leave" during the visible countdown have time for their `private:leave` to land before the auto-restart claims them.
