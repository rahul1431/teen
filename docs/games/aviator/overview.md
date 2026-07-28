# Aviator — Overview

Aviator is the platform's solo crash-multiplier game: `games/registry.json` lists it as `"type": "solo-crash"`, `"minPlayers": 1, "maxPlayers": 1`, `"supportsBots": false`, `"status": "live"`. Structurally it has nothing in common with Teen Patti/Ludo's room-and-matchmaking model — there is no room, no opponent, and no bot-fill. Every authenticated player who connects is watching and betting on the **same single global round** run by one process; "solo" describes each player's wager (you only ever play against the house/multiplier curve, never another player), not isolation between players.

## Process/service topology

- **Engine**: `services/game-engines/aviator` (Node/TypeScript, Fastify + a raw `ws` `WebSocketServer`, PM2 process `teen-aviator`). The entire engine is one file, `src/index.ts` (608 lines) — no framework beyond Fastify for the HTTP `/health` route and JWT verification; the actual game loop, round state, and WebSocket handling are hand-rolled.
- **PM2 entry** (`ecosystem.config.js:62-72`):
  ```js
  {
    name: 'teen-aviator',
    cwd: `${BASE}/game-engines/aviator`,
    script: 'dist/index.js',
    env_file: ENV_FILE('game-engines/aviator'),
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '200M',
    env: NODE_OPTS,
  }
  ```
  Unlike the Go Teen Patti engine, this is a normal Node service — PM2's `env_file` mechanism works natively here (no `LOAD_ENV` hack needed), so a `.env` edit takes effect on a normal `pm2 restart teen-aviator --update-env`.
- **Port**: `services/game-engines/aviator/.env:1` sets `PORT=3016`. The source itself falls back to `parseInt(process.env.PORT || '3005')` (`src/index.ts:594`) if `PORT` is ever unset — 3005 happens to be `monitoring-service`'s port, not this engine's. In today's deployment `PORT` is always supplied (both `.env` and `ecosystem.config.js`'s merge), so this fallback is dormant, but it's a second, independent piece of evidence (alongside the Nginx config itself) that "3005" and "Aviator" have gotten confused in this codebase before — see `docs/Bugs/aviator-websocket-misrouted-to-monitoring-service-port.md`, which documents that Nginx's public `/ws/aviator` location is in fact wired to port 3005 today, not 3016.
- **Instances**: exactly one (`instances: 1, exec_mode: 'fork'`). This is not incidental the way it is for the Go Teen Patti engine (which is stateless via Redis and could in principle scale out) — Aviator's entire round state (`currentRound`, including the never-persisted `serverSeed`/`crashAt`) lives **only** in this process's memory (see `backend.md`). Running more than one instance would not just be wasteful, it would be actively broken: each instance would run its own independent round with its own crash point, and whichever instance a given WebSocket connection landed on would determine which "reality" that player saw — there is no shared/broadcast round state across processes the way `game-gateway`'s `RealtimeHub` has a Redis pub/sub bridge for exactly that multi-instance scenario.

## Tech stack

- **Fastify** — only used for `@fastify/jwt` (WS token verification) and `@fastify/cors`; the only Fastify HTTP route registered is `GET /health`.
- **`ws`** (raw WebSocket, not Socket.IO) — mounted directly on the same HTTP server Fastify listens on, at `path: '/ws/aviator'` (`src/index.ts:452`). This is the exact path the mobile client's `AviatorSocketService` connects to directly (`mobile/lib/core/socket/socket_service.dart:349`) — it does **not** go through `game-gateway`'s WebSocket hub at `/ws` at all. Aviator is the only game in this codebase where the mobile client talks to a game engine's socket directly instead of routing through the gateway.
- **`ioredis`** — one client (`pubClient`), used only for: the 50-item public crash-history list (`aviator:history`, pushed/trimmed at `src/index.ts:416-417`), a lightweight crash-recovery snapshot (`aviator:active_round`, `roundId` + bets only — see `backend.md`), and a durable retry queue for wallet calls (`aviator:pending_wallet_ops`). Redis is not the source of truth for the live round the way it is for Teen Patti/Ludo — it's a recovery/persistence aid only.
- **`pg`** — reads `game_configs` (`is_active`, `rake_percent`, `special_rules`) once per round to pick up live admin edits, and writes one row per bet to `aviator_bets` at settlement (best-effort, not blocking).
- **`crypto`** (Node stdlib) — `crypto.randomBytes(32)` for the per-round server seed and `crypto.createHmac('sha256', ...)` for the crash-point derivation (see `backend.md` for the provable-fairness scheme).

## Where the code lives

| Concern | Location |
|---|---|
| Engine (round loop, RNG, WS server, wallet calls) | `services/game-engines/aviator/src/index.ts` |
| PM2 process definition | `ecosystem.config.js:62-72` (`teen-aviator`) |
| Reference config (not authoritative — see below) | `resources/game-configs/aviator.json` |
| Live/authoritative config | Postgres `game_configs` row where `game_type='aviator'` (`is_active`, `rake_percent`, `special_rules` JSON) |
| Per-bet history table | `aviator_bets` (`infra/db/migrations/033_aviator_bets.sql`) |
| Registry entry | `games/registry.json` (`id: "aviator"`) |
| Admin UI (dedicated page) | `admin-panel/src/pages/games/Aviator.tsx` (route `/admin/games/aviator`) |
| Admin UI (generic page, same config row) | `admin-panel/src/pages/GameConfig.tsx` |
| Mobile screen | `mobile/lib/features/games/aviator/aviator_page.dart` |
| Mobile socket client | `AviatorSocketService` in `mobile/lib/core/socket/socket_service.dart:316-397` |
| Mobile socket event names | `mobile/lib/core/constants/socket_events.dart:25-38` |
| Leaderboard read path | `services/core-api-service/src/plugins/leaderboard.ts:33-48` |

## Relationship to game-gateway and wallet-service

**game-gateway plays no role in Aviator at all.** A repo-wide search of `services/game-gateway/src` for `aviator`/`Aviator` turns up exactly one hit — a dead `FALLBACK_PROFILES.aviator` entry in `bot-profile.ts:24-28` that is never reached because its only caller, `scheduleBotTurn`, is gated to `gameType === 'teen_patti'` (`matchmaking.ts:535`; see `docs/Bugs/bot-learning-service-builds-dead-aviator-bot-profiles.md` for the full analysis). There is no `matchmaking:aviator:*` Redis queue, no `game_rooms`/`game_participants` rows written for it, no bot-fill, and no watchdog coverage — `watchdog.ts`'s idle-room reaper only ever queries `game_rooms`, a table Aviator never writes to. Aviator is architecturally standalone: its own WebSocket server, its own wallet integration, its own crash-recovery mechanism, entirely independent of the gateway's connection lifecycle, `RealtimeHub`, and `GameWatchdog` (see `docs/backend-services/game-gateway/backend.md` for all of that machinery, none of which applies here).

**wallet-service** is called directly by the Aviator engine itself (not proxied through the gateway), using the same internal endpoints Teen Patti/Ludo use via the gateway: `/internal/wallet/lock` (bet placed), `/internal/wallet/unlock` (bet rejected after a late wallet-lock race, or crash-recovery refund), `/internal/wallet/consume` (every settled bet, win or lose), and `/internal/wallet/credit` (winners only). See `backend.md` for the exact call sites and the idempotency-key scheme that makes this safe under retry.

## Deployment

Built like every other Node/TS service per CLAUDE.md: `npm install && npm run build` (tsc → `dist/`), started via PM2 as `node dist/index.js`. `infra/deploy/deploy-services.sh` builds it alongside the other Node services. There is no separate migration step beyond the generic `infra/db/migrate.sh`, which picks up `033_aviator_bets.sql` in sequence.

## Config file(s)

Two places define Aviator's economics, and they are **not** the same thing:
- `resources/game-configs/aviator.json` — explicitly marked `"_note": "REFERENCE ONLY — the engine reads live values from the game_configs DB table (special_rules JSON). Keep this file in sync with the engine defaults..."`. It documents `houseEdgePercent: 3`, `rakePercent: 5`, `rakeAppliesTo: "profit"`, `bettingWindowSeconds: 5`, `tickIntervalMs: 100`, `minBet: 10`, `maxBet: 5000`, `maxWin: 0`, `maxAutoCashoutMultiplier: 100`, and a `provablyFair` block. This file is never read by any process — it exists purely as a human-readable snapshot of what the live defaults are supposed to be. Notably, `tickIntervalMs` documents a value (`100`) that the engine hardcodes as a literal in its `setInterval(..., 100)` call (`src/index.ts:370`) rather than sourcing from any config — there is no live-configurable tick rate, only a config-file comment describing the hardcoded one.
- Postgres `game_configs` (`game_type = 'aviator'`) — the actual source of truth, re-read from the DB at the start of **every single round** via `loadConfig()` (`src/index.ts:94-113`, called from `startBettingPhase()`). This is a genuine, working live-reload: an admin edit via either `admin-panel/src/pages/games/Aviator.tsx` or `admin-panel/src/pages/GameConfig.tsx` takes effect on the very next round with no restart — in contrast to the dead-config-reload pattern seen elsewhere in this codebase (`docs/Bugs/config-reload-dead-feature.md`), Aviator's config reload actually works as designed.

The seed row (`infra/db/migrations/001_initial.sql:230-233`) sets `is_active=true, min_players=1, max_players=1, rake_percent=5.00, bot_fill_enabled=false` for `aviator` — the `bot_fill_enabled=false` default was notable because the dedicated admin page used to expose a full "Bot Settings" card (Bot Fill Enabled/Delay/Ratio/Difficulty) that an operator could toggle on even though nothing in this engine or in `game-gateway` ever read those columns for `game_type='aviator'`. That dead card was removed from `Aviator.tsx` (fixed 2026-07-28) — see `admin.md`.

See `admin.md` for exactly which admin controls map to which `game_configs`/`special_rules` fields (and which admin controls, on this particular game, do nothing).
