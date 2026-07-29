# Ludo's client-side AFK countdown disappears during the phase where the server timeout still applies

**Severity:** Low-Medium (downgraded 2026-07-29 — the duration itself matches; only the phase-coverage gap remains)
**Found:** 2026-07-28, games documentation pass (ludo)
**Files:** `mobile/lib/features/games/ludo/ludo_game_page.dart:56-87` (`_turnTimerSeconds = 30`, only active while `awaiting == 'roll'`), `services/game-gateway/src/matchmaking.ts` (`LUDO_TURN_TIMEOUT_MS = 30000`, re-armed via `driveLudoBots()` for both the roll and move phases)

## What's wrong

**Correction (2026-07-29):** this doc originally also claimed a 30s-shown-vs-25s-enforced duration mismatch. That's stale — `LUDO_TURN_TIMEOUT_MS` was already raised from 25000 to 30000 on 2026-07-09 (commit `4811bfd`, "Raise LUDO_TURN_TIMEOUT_MS 25s -> 30s to match the client turn timer"), before this doc was even written. The client and server timeouts have matched (30s each) since before this bug was filed.

The remaining, still-real issue: the mobile client renders its 30-second visual countdown ring only while the player is awaiting a dice roll (`awaiting == 'roll'`). The server's AFK enforcement (`scheduleLudoAfkTimer`/`autoPlayIdleLudoTurn`, `docs/backend-services/game-gateway/backend.md`) applies across both the roll phase and the subsequent token-move-selection phase — armed the moment it's a human's turn and re-armed via `driveLudoBots()` after the roll transitions `awaiting` to `'move'`.

## Impact

Players get no visual warning at all during the "choose which token to move" phase, even though the server's 30s timeout is still ticking and can auto-play their move at any moment during that window. This produces a jarring, unexplained auto-play experience on a real-money table during that specific phase — the roll phase itself has an accurate, correctly-durationed countdown.

## Fix

Extend the visible countdown to cover the `'move'` awaiting phase as well, not just `'roll'` — the duration constant itself needs no change.
