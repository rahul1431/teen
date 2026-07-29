# Teen Patti Engine — Backend

## HTTP surface (`main.go:860-866`)

Three of the four routes (`/start`, `/action`, `/state`) now require an `x-internal-key` header matching `INTERNAL_SERVICE_KEY` (fixed 2026-07-29, `requireInternalKey()` — matches the pattern used by every other inter-service call in this codebase). `/health` remains open, matching the convention elsewhere (health checks don't carry credentials).

| Route | Handler | Purpose |
|---|---|---|
| `POST /start` | `startGame` (`:311-445`) | Deals a new hand: shuffles, deals 3 cards/player, runs DDA (below), writes initial `GameState` to `tp:game:<roomId>`. |
| `POST /action` | `processAction` (`:447-698`) | The entire betting state machine — every fold/call/raise/show/see/sideshow* action goes through this one handler. |
| `GET /state?room_id=` | `getState` (`:821-831`) | Returns the raw `GameState` JSON straight from Redis — **including every seat's cards**, no filtering. |
| `GET /health` | inline closure | Static `{"status":"ok","service":"teen-patti-engine"}`, no DB/Redis ping. |

### Request/response shapes

- `StartGameReq` (`:278-285`): `room_id`, `players []Player`, `stake`, `bot_difficulty`, `no_limit`, `variation`. The gateway supplies fully-formed `Player` entries (`user_id`, `username`, `seat`, `is_bot`) before any cards exist; this handler fills in `Cards`, `Status`, `IsSeen`, `Bet`.
- `ActionReq` (`:287-293`): `room_id`, `user_id`, `action`, `amount`, `sequence_num`. **`sequence_num` is decoded and never read again anywhere in the file** — despite the name suggesting replay/ordering protection, it provides none; nothing rejects an out-of-order or duplicate `sequence_num`. This reinforces why the no-lock race (below) is real: there's no idempotency key or sequence check that could even partially mitigate two overlapping `/action` calls for the same room.
- `GameResult` (`:295-301`): `winner_id`, `prize`, `rake_fee`, `hand_rank`, `all_hands` (every non-folded player's cards + rank name — sent back to the gateway, which is responsible for stripping cards from the broadcast to non-participants per `docs/backend-services/game-gateway/backend.md`).

## Game state machine

`GameState.Status` has exactly two values in practice: `"betting"` (set once, at deal time in `startGame:424`) and `"completed"` (set once, in `processAction:675`, when a hand resolves). There is no separate "waiting"/"showdown"/"settled" phase inside the engine itself — from the engine's point of view a hand is either still being bet on or it's over. (The room-level `"waiting"`/`"active"`/`"completed"`/`"cancelled"` states you'll see elsewhere are `game_rooms` Postgres statuses owned by the gateway, a different state machine layered on top — see `docs/backend-services/game-gateway/backend.md`.)

`Player.Status` is documented in the struct comment as `active, folded, all_in` (`main.go:41`) but **`"all_in"` is never assigned anywhere in `main.go`** — there is no all-in mechanic. A player who wants to bet more than they can cover simply has their wallet lock fail on the gateway side (`docs/backend-services/game-gateway/backend.md`'s `handleGameAction`), which surfaces as a generic "Insufficient balance" error with no partial-call/all-in path — they can only fold or not act. Worth knowing if "all-in" is ever assumed to exist by someone reading the struct tags alone.

### Turn advancement (`processAction:641-686`)

After every action, the engine counts `activePlayers` (`Status == "active"`), then:
1. If `activePlayers <= 1`, or the action was `"show"`, or the pot has hit its limit (`potLimitHit`, below) — the hand ends: `determineWinner` runs, `Status = "completed"`, and `saveCompletedGame` is fired off in a **detached goroutine** (`go s.saveCompletedGame(...)`, `:678`) — the HTTP response is written before that DB write necessarily completes; a Postgres error here is only ever `log.Printf`'d (`:807,816`), never retried, never surfaced to the gateway or any admin-visible record (contrast with the gateway's Ludo settlement path, which pushes failed settles onto a `ludo:reconcile:failed` Redis list — this engine's DB write-back has no equivalent).
2. Otherwise, unless the action is one that intentionally **holds the turn** (`holdsTurn = {"see", "sideshow", "sideshow_accept", "sideshow_reject"}`, `:654-656`), `CurrentTurn` advances to the next player whose `Status == "active"`, wrapping around with a `for ... % len(state.Players)` loop.

### Sideshow sub-state machine (`PendingSideshow`)

A seen player on their turn can ask the previous active player for a private card comparison (`"sideshow"`, `:546-590`): costs `MinBet * 2`, requires 3+ active players (with 2 you use `"show"` instead), and sets `state.PendingSideshow = &SideshowState{RequesterID, TargetID, RequestedAt}`. While `PendingSideshow != nil`, the handler enforces a hard gate at the very top of `processAction` (`:481-489`): the **only** legal actions are `sideshow_accept`/`sideshow_reject` from the target, or `fold` from the requester (e.g. a turn-timer-driven auto-fold elsewhere) — everything else, including the target trying to act on their own actual turn, is rejected with `400 "waiting for sideshow response"`. Accept reveals both hands to each other (`IsSeen = true` for both, cards included in the response payload) and clears `PendingSideshow`; reject or a requester-fold just clears it. This is the one action (`"sideshow"`, `:550-552`) that **does** check `state.CurrentTurn == playerIdx` at the engine level — see "No turn enforcement" below for why that makes it the exception, not the rule.

### Pot limits (`potLimitFor`, `startPotLimit`, `:700-725`)

Tiered by stake, uncapped for `no_limit` tables: ₹10 stake → ₹500 cap, ₹50 → ₹1000, ₹100 → ₹1500, ₹500 → ₹10000, ₹1000+ → ₹20000 (`potLimitFor`, tested exhaustively by `TestPotLimitFor` including the between-tier and above-top-tier cases). Once `state.Pot >= potLimit`, the *next* qualifying action forces a showdown among remaining unfolded players (`potLimitHit`, `:666-672`) rather than continuing to bet. Games dealt before `PotLimit`/`NoLimit` existed on the struct fall back to deriving the limit from `stake` (`:662-665`).

A `raise`'s `Amount` is now capped before it's applied (fixed 2026-07-29, `maxRaiseFor`): the smaller of `maxChaalMultiplier`(4) `* state.Stake` and the pot's remaining headroom under `potLimit` (unbounded on `no_limit` tables). Previously the engine only validated a *minimum* (`raiseAmount < state.MinBet` for a blind player, `< state.MinBet*2` for seen, `:509-524`) — a single raise could blow the pot far past its configured tier cap in one action, and since bots are refilled to a flat ₹10,000 balance, any raise above that forced every bot at the table to auto-fold regardless of hand strength (`docs/Bugs/teen-patti-unbounded-raise-forces-bot-fold.md`, now fixed — see below).

## Hand evaluation

`evaluateHand(cards []Card) HandResult` (`:122-169`) — ranks (low to high): `HighCard(1) < Pair(2) < Color(3) < Sequence(4) < PureSequence(5) < Trail(6)`. Logic:
1. Sort the three ranks descending.
2. **Trail** (three of a kind): all three ranks equal → `Score = rank*1000`.
3. **Sequence**: consecutive ranks, or the special-cased `A-2-3` (`ranks == [14,3,2]`) which is treated as a sequence with `Score = 1600` — deliberately higher than `A-K-Q` (`14*100+13*10+12 = 1542`), i.e. **A-2-3 is the highest sequence**, a specific Indian Teen Patti house-rule choice. Same-suit sequence → `PureSequence`; otherwise `Sequence`.
4. **Color** (flush, non-sequential, same suit): `Score = ranks[0]*100 + ranks[1]*10 + ranks[2]`.
5. **Pair**: `Score = pairRank*100 + kickerRank`.
6. **HighCard**: `Score = ranks[0]*100 + ranks[1]*10 + ranks[2]`.

`compareHands(a, b)` (`:171-185`) compares `Rank` first, then `Score` — a pure `-1/0/1` comparator. `TestEvaluateHand` covers exactly one thing: that a same-rank Pair (AA-K vs AA-Q) breaks correctly on kicker score (`res1.Score > res2.Score`) — the commit message/test name ("kicker tiebreaker bug") implies this was once broken and is now regression-tested.

### Showdown tiebreak (`determineWinner`, `:744-798`) — a second, separate tiebreak layer

`compareHands`/`compareHandsVariant` only resolve rank+score ties as "equal" (`return 0`). When `determineWinner` finds two hands that compare equal, it applies house rules the pure comparator doesn't know about (`:768-782`):
1. A **blind** player beats a **seen** player.
2. If both are the same seen/blind state, the player who is **not** `state.Players[state.CurrentTurn]` (i.e., not the one who triggered the show) wins — "the defender wins."

`TestDetermineWinnerTiebreaker` covers only rule 1 (blind beats seen) with two otherwise-identical pairs of Aces. **Rule 2 (defender-wins-among-equals) has no test.** Also worth noting: this tiebreak logic lives *only* inside `determineWinner`, not inside `compareHands`/`compareHandsVariant` — so the DDA swap decision at deal time (`findBestHandIndex`, which also calls `compareHandsVariant`) never applies this seen/blind/requester tiebreak, only raw rank+score. In practice this doesn't matter today (no one has "seen" cards or requested a show before the deal-time DDA swap runs), but it means the two "best hand" computations in this file (DDA's `findBestHandIndex` and showdown's `determineWinner`) are not actually using identical tiebreak rules, which is a latent inconsistency if either is ever reused in a different context.

## Variant rule engine (AK47 / Muflis / Joker)

`wildRanks(variation, jokerRank)` (`:187-199`) — AK47 fixes wilds to ranks `{A, K, 4, 7}` regardless of hand; Joker mode makes whatever rank was drawn for this hand (`state.JokerRank`, 2–14, drawn once per hand in `startGame:322-333` via `crypto/rand`) wild. Classic and No-Limit have no wilds.

`evaluateHandVariant(variation, jokerRank, cards)` (`:211-255`) — for hands with wild cards, **brute-forces every possible substitution**: for each wild card in the hand, try all 52 cards (13 values × 4 suits, including re-using a card that's already elsewhere in play — the substitution search has no concept of "cards already dealt," it's a pure combinatorial search over the full deck) via a recursive `trySubstitutions`, evaluate the resulting 3-card hand with the classic `evaluateHand`, and keep the best result under `compareHandsVariant`. Both `TestJokerWildSubstitution` and `TestAK47WildSubstitution` confirm a pair-plus-wild correctly upgrades to Trail. **No test exercises 2 or 3 simultaneous wild cards in one hand** — worst case (all three cards match the wild rank, most likely in Joker mode) is `52^3 = 140,608` synchronous `evaluateHand` calls for that one hand, run inline inside the HTTP request (both at deal time, if DDA needs to rank hands, and at showdown, once per active player) — not covered by any test or benchmark, so its real-world latency under that edge case is unverified.

`compareHandsVariant(variation, a, b)` (`:201-209`) — **Muflis** simply negates the classic comparator's result (`-c`), i.e. the worst classic hand wins the pot. `TestMuflisInvertsRanking` verifies this both at the pure-comparator level and end-to-end through `determineWinner` (a 2-3-5 high card beats a trail of Aces). No test combines Muflis with a wild-card variant (Muflis + Joker/AK47 is a legal `variation` string as far as the type system is concerned, but the actual game only offers Muflis, Joker, and AK47 as mutually-exclusive lobby choices per `mobile/lib/features/games/teen_patti/lobby_page.dart` — see `frontend.md` — so this combination likely can't be reached from the client today; worth confirming if that ever changes).

## DDA — the card-swap mechanism (`startGame:384-417`)

This is the part of the engine that most directly affects real-money outcomes, so it's worth reading closely.

**What triggers it**: runs once per hand, after dealing, before anything is sent to players. Only fires if the room has at least one bot (`botIndices`) **and** at least one human (`hasHuman`).

**The algorithm**:
1. Determine `winRateTarget` for this hand's `bot_difficulty` (`easy`/`medium`/`hard`): query `SELECT win_rate_target FROM bot_profiles WHERE game_type='teen_patti' AND difficulty=$1` (`:358-360`). If that query succeeds, use the DB value; **if it errors for any reason** (most commonly "no row", but also any transient connection/timeout error), fall back to a hardcoded table: `easy=35.0, medium=50.0, hard=100.0` (`:364-371`, and again at `:373-382` if `s.db == nil`, which in practice never happens since `main()` calls `log.Fatalf` on DB connect failure).
2. Find whichever active player currently holds the best hand (`findBestHandIndex`, variant-aware).
3. **If that player is human**: draw a uniform random number `roll` in `[0, 100)` via `crypto/rand` (`:399-405`). If `roll < winRateTarget`, swap that human's cards with `botIndices[0]` — always the **first bot by seat position**, not randomly chosen among multiple bots. This is a single, one-shot swap: cards are exchanged in place, no re-evaluation or repeated attempts.
4. A `log.Printf("[DDAS] Swapped best hand from human player %s ...")` line records every swap, including the roll and target — the only audit trail for this happening, and it's a server log line, not a database row or anything admin-visible (see `admin.md`).

**How fair this actually is**: the DB-seeded defaults (`infra/db/migrations/016_bot_learning.sql:32-34`) target `easy=35%`, `medium=50%`, **`hard=65%`** — i.e., by design, a "hard" table is configured to hand the best hand to a bot roughly 2 hands in 3 whenever a human currently has it and a bot is present, not the 50/50 a naive reading of "difficulty" might suggest. That's a deliberate, documented business rule, not a bug in itself, but it means "hard difficulty" bots win by rigged card distribution as much as (or more than) by better decision-making — `bot-learning-service`'s decision-weight fields (`fold_probability`/`call_probability`/`aggression_score`) are a completely separate, additive mechanism on top of this.

What **is** a bug is the fallback path: on any transient error reading `bot_profiles` for a `hard` table, `winRateTarget` jumps from the seeded **65%** to a hardcoded **100%** (`:370`) — i.e., every hand where a human holds the best hand gets unconditionally swapped to the bot, not "roughly two-thirds" of them. See `docs/Bugs/teen-patti-dda-hard-fallback-100-percent.md`.

`TestDDASCardSwapping` verifies the swap mechanics work (a human dealt Trail-of-Aces vs. a bot dealt High-Card-9 ends up with the bot holding the Trail) and that no card is duplicated afterward, but it **re-implements the swap logic inline in the test** rather than calling `startGame` — it does not exercise the real `winRateTarget` lookup/fallback path, the `crypto/rand` roll, or the DB round-trip at all. There is no test anywhere that starts a real game via HTTP and observes the DDA swap probabilistically over many hands, and no test of the `hard`-tier fallback-to-100% behavior specifically.

## Rake (`loadRakePct`, `:727-742`)

Reads `game_configs.rake_percent` (a plain percentage column, e.g. `5` = 5%) fresh from Postgres on **every** showdown (no caching) — falls back to `5%` if the query errors or the value is outside `[0, 50]`. `determineWinner` computes `rake := state.Pot * rakePct` and `prize := state.Pot - rake` in `float64` throughout — see the note in `docs/Bugs/` risk register below for why real-money arithmetic staying in `float64` end-to-end (rather than integer paise/cents or `decimal`) is worth periodic scrutiny, though no concrete rounding-drift bug was demonstrated in this pass.

## Authentication and server-side turn enforcement (fixed 2026-07-29)

Every action handler except `"sideshow"` used to mutate state for whichever `user_id` the caller supplied, without checking `state.CurrentTurn == playerIdx` at all — that check was only ever enforced by `game-gateway`'s `handleGameAction` (`index.ts:542`) before it called this engine, with the engine itself having no way to verify the caller was actually the gateway (no credential check on any endpoint, listening on all interfaces). `processAction` now enforces `state.CurrentTurn == playerIdx` for every action except the same out-of-turn allowlist the gateway uses (`"see"`/`"sideshow_accept"`/`"sideshow_reject"`), and the engine binds `127.0.0.1` with `requireInternalKey()` on its state-mutating routes (see above) — the source of truth now enforces its own rules instead of trusting a cooperating caller.

## Concurrency (cross-reference)

The missing lock around `/action`'s Redis read-modify-write is fixed 2026-07-29 — `processAction` is now wrapped in `withRoomLock()`, a Redis `SET NX PX` mutex keyed `tp:lock:<roomId>` (see `docs/backend-services/game-gateway/backend.md`). The dead `sequence_num` field noted above (request-decoded, never used) is still true — no idempotency/ordering protection beyond the new per-room lock.

## Turn timeout (cross-reference)

`docs/Bugs/teen-patti-no-turn-timeout.md` covers the gateway-side gap (Teen Patti has no AFK timer, unlike Ludo's `scheduleLudoAfkTimer`). From this engine's side, the underlying reason that gap can't easily be closed *here* is structural: `GameState` stores no per-player or per-turn timestamp at all — `CreatedAt` is the only time field on the whole struct, set once at deal time. The engine has no data from which "how long has the current turn been waiting" could even be computed without the caller (gateway) tracking it externally, which is exactly what `docs/Bugs/teen-patti-no-turn-timeout.md` says doesn't happen for humans today.

## Test suite summary (`main_test.go`)

| Test | Covers |
|---|---|
| `TestEvaluateHand` | Pair kicker tiebreak (`evaluateHand` only) |
| `TestDetermineWinnerTiebreaker` | Blind-beats-seen tiebreak in `determineWinner` (not the defender-wins sub-rule) |
| `TestDDASCardSwapping` | DDA swap mechanics, reimplemented inline — not via `startGame` |
| `TestMuflisInvertsRanking` | Muflis comparator inversion, pure + end-to-end via `determineWinner` |
| `TestJokerWildSubstitution` | Single wild-card substitution upgrades Pair→Trail; a non-matching rank stays Pair |
| `TestAK47WildSubstitution` | Fixed AK47 wild set upgrades Pair→Trail; classic evaluation of the same cards stays Pair |
| `TestPotLimitFor` | All stake tiers, including between-tier and above-top-tier cases |
| `TestStartPotLimit` | No-limit table returns uncapped (`0`) |
| `TestMaxRaiseFor` | Chaal-multiplier cap, pot-headroom cap (whichever is smaller), no-limit tables, and zero headroom once the pot is already at its cap |

**Not covered by any test**: the HTTP handlers themselves (`startGame`/`processAction`/`getState` are never invoked via `httptest` or otherwise — every test calls the underlying pure functions directly with hand-built `GameState`/`Player` values); the real `winRateTarget` DB-lookup-with-fallback path (including the `hard`→100% fallback); the sideshow request/accept/reject/freeze flow; `loadRakePct`'s DB read or bounds-clamping; `saveCompletedGame`'s DB write-back; any concurrency/race scenario; and multi-wild-card (2–3 simultaneous wilds) evaluation performance or correctness.

## Bug references

The no-request-authentication / no-server-side-turn-order-check finding from this pass was fixed 2026-07-29 — see the section above. The unbounded-raise finding was also fixed 2026-07-29 — see "Pot limits" above.
- `docs/Bugs/teen-patti-dda-hard-fallback-100-percent.md` — Medium-High: transient `bot_profiles` read errors silently jump the `hard`-difficulty DDA swap target from the seeded 65% to a hardcoded 100%.
- `docs/Bugs/teen-patti-dda-admin-control-gap.md` — Medium: no admin-panel control actually reaches `win_rate_target`, the real DDA lever, despite two UI surfaces that look like they should.
