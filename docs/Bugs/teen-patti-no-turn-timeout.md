# Teen Patti has no per-turn AFK/disconnect timeout — a stuck human stalls the whole real-money table for up to 15 minutes

**Severity:** High (frequent trigger, blocks other real players' money for an extended period, no in-app recovery)
**Found:** 2026-07-28, backend-services documentation pass (game-gateway)
**Files:** `services/game-gateway/src/matchmaking.ts:542-694` (Teen Patti bot-turn scheduling — bots only), compare `:740-808` (`scheduleLudoAfkTimer`/`autoPlayIdleLudoTurn`, Ludo only), `services/game-gateway/src/watchdog.ts` (the only fallback that exists)

## What's wrong

`MatchmakingService` has a per-turn timeout mechanism, but it is Ludo-only. `scheduleLudoAfkTimer()` arms a 25-second (`LUDO_TURN_TIMEOUT_MS = 25000`) timer every time a human's turn begins; if it fires, `autoPlayIdleLudoTurn()` plays the minimum legal action on their behalf so the table keeps moving (`matchmaking.ts:740-808`).

Teen Patti's equivalent mechanism, `scheduleBotTurn()` (`matchmaking.ts:542-694`), only schedules a timer **when the current turn belongs to a bot** (`const isBot = bots.some(...); if (!isBot) return`, `:560-561`). When the current turn belongs to a real, human player — connected or not, actively playing or AFK or fully disconnected — nothing is armed at all. There is no fold-on-timeout, no auto-check, no notification to other players that anyone is being idle.

The only thing that eventually unsticks such a table is `GameWatchdog`'s room-level 15-minute idle sweep (`watchdog.ts`), which cancels the **entire room** and refunds **every** participant — not just the stuck player.

## Impact

Any human holding the current turn who goes idle — network drop, app crash, or backgrounding without playing — freezes the table for the other real players (who may well still be actively trying to play) for up to 15 minutes before the watchdog forcibly cancels the whole hand. During that window there is no in-app way for the other players to skip the stuck player, and (per `docs/Bugs/orphaned-admin-pages.md`) the one admin tool that could force-fold them (`GameRooms.tsx`'s "Force Fold" button, wired to the `force-action` internal endpoint documented in `backend.md`) is not reachable through the admin panel UI either — so today there is genuinely no faster recovery path than "wait up to 15 minutes."

## Fix

Add a Teen-Patti equivalent of `scheduleLudoAfkTimer`: when a turn begins and the current player is human, arm a bounded timeout (a similar ~20-30s window would match the Ludo precedent); on expiry, either auto-fold the idle player (simplest, matches "minimum legal action" already used for Ludo) or auto-check/call if that's a legal option, then advance the turn and notify the room. This should re-use the existing `TEEN_PATTI_ENGINE_URL` `/action` call path already used for bots, just gated on turn-timeout instead of bot-decision-delay.
