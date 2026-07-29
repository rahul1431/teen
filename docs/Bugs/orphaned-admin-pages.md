# Orphaned admin-panel pages: GameRooms.tsx, BettingManagement.tsx, and GameConfig.tsx

**Severity:** High (GameRooms), Low (BettingManagement, GameConfig — dead code only)
**Found:** 2026-07-28, during admin-panel documentation pass; `GameConfig.tsx` added 2026-07-28 during the games documentation pass (matka)
**Files:** `admin-panel/src/pages/GameRooms.tsx`, `admin-panel/src/pages/BettingManagement.tsx`, `admin-panel/src/pages/GameConfig.tsx`

## What's wrong

Neither file is imported in `admin-panel/src/main.tsx` (no `React.lazy` import, no `<Route>`), and neither has an entry in the nav menu in `admin-panel/src/pages/Layout.tsx`. They are dead — unreachable through the UI — while their backend endpoints are fully implemented and live.

## GameRooms.tsx — real operational gap

`GameRooms.tsx` is the **only** frontend that calls:
- `GET /api/admin/game-rooms/:id/live-state` — real-time in-memory room state (pot, current turn, per-seat cards/tokens)
- `POST /api/admin/game-rooms/:id/force-action` — force a stuck player's turn (fold / roll dice / move token)
- `POST /api/admin/game-rooms/:id/kick` — kick a player and replace with a bot
- `POST /api/admin/game-rooms/:id/terminate` — force-terminate a room and refund all real players

All four routes exist and work in `services/admin-service/src/index.ts` (lines ~490-600), proxying to `game-gateway`'s `/internal/game-rooms/...` internal API. But because this page is never routed:

- The per-game admin pages that *are* routed (`games/Ludo.tsx`, `games/TeenPatti.tsx`) only call `GET /game-rooms` and filter client-side to their own `game_type` for a read-only table — they have no live-state view, no force-action, no kick, no terminate button.
- `games/Aviator.tsx`, `games/Cricket.tsx`, `games/Matka.tsx`, `games/Lottery.tsx` have no room-monitoring UI at all.

**Net effect: there is currently no way, through the admin panel UI, for an admin to kick a stuck/AFK player or force-terminate a hung game room for any game** — despite the backend fully supporting it and a finished frontend component (`GameRooms.tsx`) already existing for it. Given past incidents with stuck Teen Patti/Ludo games (AFK races, cross-instance bugs), this is exactly the manual-override tool that would have been useful during an incident and isn't reachable.

**Fix:** add the route/menu entry for `GameRooms.tsx` (e.g. `/admin/game-rooms`), or fold its live-spectator/force-action/kick/terminate controls into the existing per-game room tables in `games/Ludo.tsx` / `games/TeenPatti.tsx` / others.

## BettingManagement.tsx — superseded duplicate

Every endpoint `BettingManagement.tsx` calls (`/betting/matka/*`, `/betting/lottery/*`, `/betting/cricket/*`) is already called by the routed, more feature-complete per-game pages:
- `games/Cricket.tsx` (983 lines) — superset of `BettingManagement`'s Cricket tab, plus fantasy leagues, series sync, squad sync, live score updates.
- `games/Matka.tsx` (263 lines) — same market/draw/declare flow as `BettingManagement`'s Matka tab.
- `games/Lottery.tsx` (282 lines) — same create/draw/delete flow, plus ticket listing and cancel.

`BettingManagement.tsx` (516 lines) is dead duplicate code from before the per-game pages existed. No missing functionality here — just stale code that risks someone editing the wrong file.

**Fix:** delete `admin-panel/src/pages/BettingManagement.tsx`.

## GameConfig.tsx — third orphaned page, same shape as BettingManagement.tsx

Confirmed not imported in `admin-panel/src/main.tsx` and not present in `admin-panel/src/pages/Layout.tsx`'s nav — unreachable through the UI, same as the two pages above. It's a generic all-games config form (one card per `game_type` from `GET /game-configs`, saved via the same generic `PATCH /api/admin/game-configs/:gameType` the routed pages also use): `is_active`, `rake_percent`, an Aviator-specific "Economics" block, and an unconditional "Bot Settings" block for every game type including ones with no matchmaking concept. The equivalent Bot Settings block was removed from the live, routed Aviator/Matka/Lottery pages (fixed 2026-07-28) since it had no effect for those games — this orphaned page still has the stale version, but since it's unreachable through the UI it doesn't matter in practice.

Every field it exposes is also exposed by the newer, routed per-game pages (`games/Aviator.tsx`, `games/TeenPatti.tsx`, `games/Ludo.tsx`, `games/Cricket.tsx`, `games/Matka.tsx`, `games/Lottery.tsx`), so — like `BettingManagement.tsx` — this is superseded dead code rather than a functionality gap: nothing is reachable only through `GameConfig.tsx`.

**Fix:** delete `admin-panel/src/pages/GameConfig.tsx`, or route it as a lower-priority fallback/global view if a single-page overview of every game's config is still wanted — but not both this and the six per-game pages maintaining the same fields independently.
