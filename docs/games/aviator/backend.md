# Aviator — Backend

All line references are to `services/game-engines/aviator/src/index.ts` unless stated otherwise.

## Shape of the state

There is exactly one live round at a time, held in a single module-level variable:

```ts
let currentRound: RoundState | null = null
let flyingInterval: NodeJS.Timeout | null = null
```

`RoundState` (`:56-66`): `roundId`, `serverSeed`, `seedHash`, `status: 'betting'|'flying'|'crashed'`, `crashAt`, `currentMultiplier`, `bets: Record<string, AvBet>` (keyed `"${userId}_${betIndex}"`), `history: number[]`, `startedAt?`. There is no per-user room and no concept of a "table" — every connected client sees the same `currentRound` object; the only per-user data is which entries of `bets` belong to them.

`AvBet` (`:44-54`): `userId, username, amount, cashedOut, betIndex, cashoutMultiplier?, autoCashout?, payout, settled`. `betIndex` is either `1` or `2` — a player can hold **two independent simultaneous bets** in the same round (the mobile UI's "Panel 1"/"Panel 2"), each with its own stake and its own optional auto-cashout target, keyed as separate `bets` entries.

## Round lifecycle

Three phases, driven entirely by `setTimeout`/`setInterval`, no external scheduler:

1. **`startBettingPhase()`** (`:240-286`) — `await loadConfig()` (re-reads `game_configs` from Postgres every round, so admin edits apply immediately, see `overview.md`). If `!aviatorConfig.isActive` (admin kill-switch), broadcasts `aviator:maintenance` and retries in 15s without ever creating a round. Otherwise: generates a new `roundId` (`uuid()`), a fresh 32-byte `serverSeed`, its SHA-256 `seedHash`, and the round's `crashAt` (see "Crash-point generation" below) — **all four are fixed before a single bet is accepted or broadcast.** `currentRound` is assigned, `persistRound()` snapshots `{roundId, bets}` to Redis (not the seed/crash point — see "Crash recovery" below), and `aviator:round_start` is broadcast with `seed_hash` (the fairness commitment), `history`, `betting_time_ms`, `min_bet`, `max_bet`. A `setTimeout(bettingTimeMs)` schedules the flight phase. Any thrown error resets `currentRound = null` and retries the whole betting phase in 5s.
2. **`startFlyingPhase()`** (`:314-371`) — sets `status = 'flying'`, broadcasts `aviator:flying_start`, then a **100ms `setInterval`** grows `rawMultiplier += 0.012 * rawMultiplier` (a fixed ~12.7%/second compounding curve — not admin-configurable despite the reference config documenting a `tickIntervalMs`; see `overview.md`) and rounds to 2 decimals for `multiplier`. Each tick: updates `currentRound.currentMultiplier`, executes any bet whose `autoCashout` target has now been reached (see below), broadcasts `aviator:multiplier_tick {round_id, multiplier}`, and once `multiplier >= crashAt`, stops the interval and calls `crashRound(crashAt)`.
3. **`crashRound(crashAt)`** (`:373-433`) — settles every bet (see "Settlement" below), best-effort writes `aviator_bets` rows, pushes `crashAt` onto the `aviator:history` Redis list (`LPUSH` + `LTRIM 0 49`, capping it at 50), deletes the crash-recovery snapshot, broadcasts `aviator:crashed` **including the revealed `server_seed`** (the other half of the fairness commitment — see below), sets `currentRound = null`, and schedules the next `startBettingPhase()` 3 seconds later.

There is no "waiting for players" state and no minimum-player gate — the loop runs continuously and unconditionally as long as the process is alive and `isActive` is true, whether zero or a thousand clients are connected. This is a direct structural consequence of "solo-crash": there's nothing to wait for since nobody plays against anybody else.

## Crash-point generation and provable fairness

`generateCrashPoint(serverSeed, roundId)` (`:207-216`):
```ts
const hash = crypto.createHmac('sha256', serverSeed).update(roundId).digest('hex')
const h = parseInt(hash.slice(0, 8), 16)
const e = Math.pow(2, 32)
const instantCrashCutoff = Math.floor((e * aviatorConfig.houseEdgePercent) / 100)
if (h < instantCrashCutoff) return 1.00
const crash = Math.floor((100 * e - h) / (e - h)) / 100
return Math.max(1.00, crash)
```
This is the standard "Bustabit-style" provably-fair crash formula: the first 32 bits of `HMAC-SHA256(serverSeed, roundId)` are treated as a uniform random draw over `[0, 2^32)`; a fixed fraction of draws (sized exactly to `houseEdgePercent`) map to an instant `1.00x` bust, and everything else maps through `(100e - h)/(e - h)` to a Pareto-tailed multiplier with no fixed upper bound (only the admin-configured `maxWin` payout cap limits what a player can actually collect — see "Settlement"). Both `serverSeed` and `roundId` are fixed *before* `aviator:round_start` is broadcast and before any bet is accepted, and only `seedHash = sha256(serverSeed)` is published at round start (`:275`) — the actual `serverSeed` is only revealed in `aviator:crashed` after the round is over (`:423`), so a client (or the operator, publicly) can verify after the fact that `sha256(revealed_seed) === seed_hash_shown_before_betting_closed` and that re-running `generateCrashPoint` with the revealed seed reproduces the announced `crash_at`. This is a real, verifiable provable-fairness scheme, not just a UI label — **conditioned on trusting that `houseEdgePercent` itself (an admin-configured, un-published number) is what the server claims it is**, since the cutoff band depends on it and nothing in the reveal lets a client recover what `houseEdgePercent` was for that specific round.

There is no dedicated test file for this engine at all (see "Test coverage" below), so none of this formula's statistical properties (e.g., that the realized long-run RTP matches `houseEdgePercent`, or that `rakePercent`'s effect on payouts is as expected) are verified by anything beyond manual inspection.

## Cash-out mechanics

**Manual cash-out** (`aviator:cashout` WS event, `:546-559`): only legal while `currentRound.status === 'flying'`; looks up the caller's bet by `"${userId}_${betIndex}"`, rejects if missing or already cashed out, then calls `cashOutBet(bet, currentRound.currentMultiplier)` (`:300-312`) using the **engine's own authoritative `currentMultiplier`** at the moment the message is processed — not any value the client sends. A client cannot claim a better multiplier than what the server tick has actually reached; the worst a network-lag disadvantaged player can do is cash out slightly later (lower) than they intended, never earlier/higher.

**Server-side auto-cashout** (`:332-354`, inside the flying-phase tick): for every bet with an `autoCashout` target, once `bet.autoCashout <= multiplier && bet.autoCashout < crashAt`, the engine cashes it out itself on that exact tick — this executes on the **authoritative 100ms server tick**, immune to client-side network latency, and happens even if the client's WebSocket has disconnected. `autoCashout` is set at bet-placement time (`:511-515`): the raw client-supplied `auto_cashout` value is clamped to `[1.01, aviatorConfig.maxAutoCashout]` server-side, so a client cannot request an auto-cashout target below the minimum or above the admin-configured ceiling (`maxAutoCashoutMultiplier`, default 100). The mobile client (`mobile/lib/features/games/aviator/aviator_page.dart:206-231`) also runs a client-side fallback check against the raw server tick value for the case where a player enables auto-cashout mid-flight (after the bet was already placed without a server-known target) — this fallback still only fires a normal `aviator:cashout` event that goes through the same server-side validation, so it carries no additional trust.

**Payout formula**, `computePayout(amount, multiplier)` (`:221-227`):
```ts
const prize = amount * multiplier
const profit = Math.max(0, prize - amount)
let payout = amount + profit * (1 - rakePercent / 100)
if (maxWin > 0) payout = Math.min(payout, maxWin)
return Math.round(payout * 100) / 100
```
Rake is taken only from **profit**, not the whole prize (matches `resources/game-configs/aviator.json`'s `"rakeAppliesTo": "profit"` documentation) — a player always gets at least their stake back on any cash-out above `1.00x`, and the platform's cut only bites into what they actually won. `maxWin` (0 = unlimited by default) caps the absolute payout per bet regardless of how high the multiplier climbed, which is what bounds the otherwise-unbounded Pareto tail from "Crash-point generation" above. Payout is computed and shown to the player (in the `aviator:cashed_out` push) at the moment of cash-out — the number displayed is exactly what lands in the wallet at settlement, there is no re-computation later that could show the player a different number than what they were promised.

## Betting: validation and the wallet-lock race

`aviator:place_bet` (`:487-544`) validates, in order: `betIndex` is `1` or `2`; `isActive`; round exists and `status === 'betting'`; `amount >= minBet`; `amount <= maxBet`; no existing bet already on that panel for this user. It then calls `wallet-service` `/internal/wallet/lock` **synchronously** (awaited) before accepting the bet. Because locking is a network round-trip, the round can advance past betting (or even roll over into an entirely new round with a new `roundId`) while the lock call is in flight — the handler re-checks `currentRound.roundId === lockedRoundId && status === 'betting'` immediately after the lock resolves (`:534`), and if that's no longer true, durably unlocks the just-locked stake and tells the client "Betting phase ended — stake refunded" rather than silently accepting a late bet into the wrong (or a nonexistent) round. This is the one piece of explicit race-handling in the file; note it protects against the round itself moving, not against two concurrent messages for the *same* bet slot (see "Concurrency" below).

The wallet `lock_id` sent is `aviator_${roundId}_${betIndex}_${userId}` — unique per user+round+panel, so retries are idempotent and a same-round double-bet attempt on an already-filled panel is caught earlier by the `currentRound.bets[betKey]` existence check, not by the wallet layer.

## Settlement (`crashRound`, `:373-433`) and money-moving paths

For every bet in the round, regardless of outcome:
1. `walletCallDurable('/internal/wallet/consume', { user_id, amount, room_id: "${roundId}_${betIndex}" })` — the stake is consumed from the locked balance whether the player won or lost (a winner's stake is consumed here and their profit is credited separately below; this is the same "consume-then-credit" pattern used by Teen Patti/Ludo's settlement).
2. If `bet.cashedOut && bet.payout > 0`: `walletCallDurable('/internal/wallet/credit', { user_id, amount: payout, type: 'game_credit', reference_id: roundId, idempotency_key: "aviator_cashout_${userId}_${roundId}_${betIndex}" })`.
3. `bet.settled = true`, `persistRound()` — the recovery snapshot is updated after every single bet's settlement completes, not just once at the end, so a mid-settlement crash doesn't lose track of which bets in this round have already been paid.

**`walletCallDurable`** (`:135-146`) is the retry wrapper used for every wallet call in this file (lock excepted — that one is a plain `fetch` with no retry, by design, since a failed lock should surface to the bettor immediately rather than be retried transparently): 3 attempts with linear backoff (500ms, 1000ms, 1500ms), and on final failure, `RPUSH`es the call onto `aviator:pending_wallet_ops` in Redis rather than dropping it. `drainPendingWalletOps()` (`:148-162`) runs once at startup (after `recoverOrphanedRound`) and then every 60 seconds thereafter, replaying every queued op and re-queueing (to the back of the list) whatever still fails. Combined with `lock`/`unlock`/`consume` all being idempotent by construction (unique idempotency keys keyed by round+user+panel — verified against `services/wallet-service/src/wallet.service.ts:149-279`, whose `lockForGame`/`unlockFunds`/`consumeLockedFunds` all derive their `wallet_transactions.idempotency_key` from the caller-supplied `lockId`/`roomId`+`userId`), this means a `wallet-service` outage delays a payout but the comment's claim ("a payout is never just lost") holds for the steady-state retry path. It does **not** hold across a process restart mid-round — see below.

Bet history writes to `aviator_bets` (`:401-413`) are wrapped in their own try/catch and are explicitly non-blocking/best-effort — a Postgres failure here is logged and does not affect wallet settlement, round progression, or anything player-visible beyond the "My History" sheet being incomplete for that round.

## Crash recovery — and where it under-delivers

`persistRound()` (`:170-176`) snapshots **only** `{roundId, bets}` to `aviator:active_round` (10-minute TTL) on every state change (bet placed, cash-out, auto-cashout, each settlement step). Deliberately excluded: `serverSeed` and `crashAt` — the code comment states this is so "nothing outside this process can read the outcome before the reveal," i.e. even a full Redis dump during a live round can't leak the crash point in advance.

`recoverOrphanedRound()` (`:181-203`), run once 2 seconds after the HTTP server starts listening: if an `aviator:active_round` snapshot exists (meaning the previous process instance died mid-round — crash, `pm2 restart`, or a deploy), every **unsettled** bet (`!bet.settled`) is refunded via `/internal/wallet/unlock` for its full stake — including bets where `bet.cashedOut === true`. The code is explicit about this tradeoff in a `console.warn`: *"had cashed out (payout ₹X) but was not settled — refunding stake ₹Y instead."* Because `serverSeed`/`crashAt` were never persisted, there is no way for the recovered process to know what a cashed-out bet's payout *should have been* — only the original stake is recoverable, so the difference between "confirmed win amount the player was shown in `aviator:cashed_out`" and "what they actually receive after a restart" is silently the player's own money, forfeited to a deploy/restart timing accident.

**Impact**: `teen-aviator` restarts on every backend deploy (`infra/deploy/deploy-services.sh` restarts all built Node services) and on any crash. Any round in its `flying` phase at that moment — which, given the round cadence (5s betting + a variable flight duration + 3s gap), is a non-trivial fraction of the engine's total uptime — will have every cashed-out-but-not-yet-crashed bet's winnings replaced by a stake-only refund on restart. This is a real, if narrow-window, way for a player to be shown a winning `aviator:cashed_out` push and a `+₹X` animation, and then simply not receive it. See `docs/Bugs/aviator-restart-recovery-discards-confirmed-cashout-winnings.md`.

## Concurrency

Unlike Teen Patti's Go engine (multi-process-unsafe by omission — see `docs/backend-services/teen-patti-engine/backend.md`), Aviator's round state genuinely only ever exists in one process (`instances: 1`), and all mutation happens synchronously within the Node event loop between `await` points — there is no analogous "two processes racing to write the same Redis key" hazard here, because there's only ever one process and the live state isn't stored in Redis at all. The closest thing to a race is the wallet-lock-vs-round-rollover case described above under "Betting," which is explicitly handled.

One latent structural risk, not currently triggered: because `currentRound` is pure in-process memory (not reconstructable from Redis mid-flight), scaling this service to `instances > 1` — which nothing today prevents someone from doing by editing `ecosystem.config.js` — would silently produce multiple independent, diverging rounds with no error or warning; see `overview.md`.

## Error handling

Every phase transition (`startBettingPhase`, `startFlyingPhase` via `startBettingPhaseNext`, `crashRound`) is wrapped so a thrown error resets `currentRound = null` and retries the whole cycle after a fixed delay (5s) rather than leaving the process wedged in a broken phase forever — there is no unbounded retry loop or crash-the-process-on-error path in the normal round flow. Wallet calls fail closed relative to gameplay but open relative to eventual consistency: `walletPost` swallows network errors and returns `false` rather than throwing, `walletCallDurable` retries then queues, and nothing in the round loop blocks or aborts because a wallet call is slow or failing — the round always proceeds to crash on schedule regardless of wallet-service health, and any unpaid amounts (short of the recovery gap above) are drained on the 60-second interval once wallet-service recovers.

## Test coverage

**None.** There is no test file, no `test` script in `package.json`, and no CI reference to running tests for this service — contrast with the Go Teen Patti engine's `main_test.go` (236 lines covering hand evaluation, DDA, variant rules) or `app-monitor-service`'s `vitest` suite (the only other tested service per CLAUDE.md). Nothing here — the crash-point formula, the payout/rake math, the auto-cashout clamp, the wallet-lock race-recheck, or the crash-recovery refund path — has any automated regression coverage; all of the above was verified by direct code reading only.

## New findings from this pass

- `docs/Bugs/aviator-restart-recovery-discards-confirmed-cashout-winnings.md` — Medium-High: a restart mid-flight (routine on every backend deploy) refunds a cashed-out player's original stake instead of their confirmed winnings, because the crash-recovery snapshot never stores the payout amount or the crash point.
- `docs/Bugs/aviator-mobile-betting-progress-bar-hardcoded-5s.md` — Low: the mobile betting-countdown progress bar assumes a fixed 5-second window regardless of the admin-configurable `betting_time_ms`. See `mobile.md`.

Also relevant, already filed by an earlier pass and not repeated in full here: `docs/Bugs/bot-learning-service-builds-dead-aviator-bot-profiles.md` (a permanently-inert nightly job and dead bot-profile fallback for a game with no bots). The dead Bot Settings admin controls for Aviator were removed (fixed 2026-07-28, see `admin.md`), and the previously-documented `/ws/aviator` "misrouting" turned out to be based on inaccurate port assumptions rather than a real Nginx bug (fixed 2026-07-28, see `overview.md`).
