# Teen Patti Engine — Overview

`services/game-engines/teen-patti` (Go, PM2 process `teen-tp-engine`, port `3010` by default) is the authoritative rules engine for Teen Patti: it deals cards, evaluates hands, runs the betting state machine, resolves showdowns, and persists per-room game state to Redis. It is a single ~874-line file (`main.go`) plus its test file — no framework, no internal package structure.

## Correction to CLAUDE.md

CLAUDE.md describes this engine as dealing "over its own WS/RPC to the gateway." That is wrong for the current source — there is no WebSocket or RPC server here at all. `main.go:860-866` mounts a plain `net/http.ServeMux` with four routes (`/start`, `/action`, `/state`, `/health`) and `game-gateway` calls them with ordinary JSON `POST`/`GET` (`fetch(`${TEEN_PATTI_ENGINE_URL}/start`)`, etc.) — see `docs/backend-services/game-gateway/overview.md` (which already documents and corrects this) and `backend.md` for the exact calls. `.env.example`'s `# Teen Patti Engine (Go gRPC)` comment and `TEEN_PATTI_ENGINE_URL=localhost:50051` default are stale (`docs/Bugs/teen-patti-engine-url-env-example-broken.md`); the live default the gateway actually uses is `http://127.0.0.1:3010`.

## Process model

One process, not one per room and not one per table. All room state lives in Redis under `tp:game:<roomId>` (a full JSON-serialized `GameState` blob, 2h TTL) — the Go process itself holds no in-memory per-room state between requests; every handler does a fresh `redis.Get` → mutate → `redis.Set` round trip. This makes the process trivially horizontally-scalable in principle (any instance can serve any room, since nothing is pinned in memory) — `ecosystem.config.js` still runs exactly one instance (`instances: 1, exec_mode: 'fork'`), but `processAction` is now wrapped in a Redis `SET NX PX` per-room lock (fixed 2026-07-29, see `backend.md`), so a second instance would no longer be actively dangerous the way it used to be.

The engine has no concept of elapsed time between actions and no background timers — it's purely request-driven. Idle-room detection and turn timeouts are entirely the gateway's/watchdog's job, not this engine's — the gateway's `scheduleTeenPattiAfkTimer` auto-folds a stuck human's turn after 30s (since 2026-07-12), independent of anything in this engine — see `backend.md`.

## Tech stack

- **Go 1.22** (`go.mod`), standard library `net/http` only — no Gin/Echo/Fiber, no middleware chain, no router beyond `http.ServeMux`.
- **`github.com/redis/go-redis/v9`** — a single `*redis.Client`, the only place game state (`GameState`) lives during a hand.
- **`github.com/jackc/pgx/v5/pgxpool`** — a single `*pgxpool.Pool`, used only for reads of admin-configured values (`bot_profiles.win_rate_target`, `game_configs.rake_percent`) and a fire-and-forget write-back of the final result (`game_rooms`, `game_participants`).
- **`github.com/google/uuid`** — imported but effectively unused: `main()` does `_ = uuid.New() // ensure import used` (`main.go:834`), i.e. the import exists with no real call site. Dead code, harmless, but a sign this dependency can likely be dropped.
- **`crypto/rand`** (stdlib, aliased `cryptoRand`) — used for the Fisher-Yates shuffle (`newDeck`, `main.go:110-118`), the DDA swap-roll (`main.go:399`), and the Joker-mode wild-rank draw (`main.go:326`). All three are cryptographically-seeded, not `math/rand` — a deliberate, correct choice for a real-money shuffle/roll.

## File-by-file structure

| File | Contents |
|---|---|
| `main.go` (874 lines) | Everything: card/deck types, hand evaluator (`evaluateHand`, `compareHands`), variant-aware evaluator (`evaluateHandVariant`, `wildRanks`, `compareHandsVariant`) for AK47/Muflis/Joker, the DDA card-swap logic (inline in `startGame`), the `Server` struct and its three HTTP handlers (`startGame`, `processAction`, `getState`), showdown resolution (`determineWinner`), pot-limit tiers (`potLimitFor`, `startPotLimit`), rake lookup (`loadRakePct`), DB write-back (`saveCompletedGame`), and `main()` (env parsing, DB/Redis connect, route registration). |
| `main_test.go` (236 lines) | The only automated test coverage in this service — pure-function tests for hand evaluation, tiebreakers, DDA swapping, Muflis inversion, Joker/AK47 wild substitution, and pot-limit tiers. No HTTP-handler-level or integration tests. See `backend.md` for exactly what is and isn't covered. |
| `go.mod` / `go.sum` | Module `teen-patti-engine`, Go 1.22, the three direct dependencies above plus their transitive deps (`pgpassfile`, `puddle`, `xxhash`, `go-rendezvous`, etc.). |

## Deployment

PM2 app `teen-tp-engine` (`ecosystem.config.js:84-94`):
```js
{
  name: 'teen-tp-engine',
  cwd: `${BASE}/game-engines/teen-patti`,
  script: './teen-patti-engine',
  interpreter: 'none',
  instances: 1,
  exec_mode: 'fork',
  watch: false,
  max_memory_restart: '200M',
  env: { PORT: '3010', ...LOAD_ENV('game-engines/teen-patti') },
}
```
`script: './teen-patti-engine'` with `interpreter: 'none'` — this runs the pre-built Go binary directly (`go build -o teen-patti-engine .`, per CLAUDE.md's build command), not `node dist/index.js` like the TypeScript services in this same file.

Per CLAUDE.md, PM2's own `env_file` mechanism (used by every Node service here) doesn't apply — a Go binary can't parse dotenv itself, so `ecosystem.config.js` defines its own `LOAD_ENV(svc)` helper (`ecosystem.config.js:8-17`) that reads `services/game-engines/teen-patti/.env` line-by-line with a regex, skips comments, and merges the result into PM2's `env:` object at process-start time. Two consequences worth remembering when operating this service:
- **`pm2 restart teen-tp-engine --update-env` does not re-read `.env`.** `--update-env` only re-applies the `env:` object that's already baked into `ecosystem.config.js` as loaded at PM2's *own* startup/reload time — since `LOAD_ENV()` runs once when `ecosystem.config.js` itself is evaluated (i.e., at `pm2 start`/`pm2 reload ecosystem.config.js`), a plain `.env` file edit needs a full `pm2 reload ecosystem.config.js` (or `pm2 delete` + `pm2 start`) to actually take effect, not just `pm2 restart --update-env`.
- If `services/game-engines/teen-patti/.env` doesn't exist or fails to parse, `LOAD_ENV` swallows the error and returns `{}` (`ecosystem.config.js:15`) — the binary then falls back to its own hardcoded defaults in `main()` (`main.go:836-844`: `DATABASE_URL` defaults to `postgresql://teen:teen_secret_2024@localhost:5432/teen_db`, `REDIS_URL` to `redis://:teen_redis_2024@localhost:6379`), which are real-looking credentials baked into the binary rather than a hard failure — worth knowing if this engine is ever debugged against "why is it connecting with the wrong DB user."

`PORT` defaults to `3010` if unset; the process used to bind all interfaces rather than `127.0.0.1`, which mattered given there was no request authentication anywhere in this file — both fixed together 2026-07-29 (see `backend.md`): it now binds `127.0.0.1:<port>` and requires `x-internal-key` on its state-mutating routes.

## Place in the system

- **Inbound**: only `game-gateway` calls this engine in normal operation — `POST /start` (room creation, called once from `MatchmakingService.startGame`) and `POST /action` (every player/bot turn, called from `handleGameAction` and the bot-turn scheduler). See `docs/backend-services/game-gateway/backend.md` ("Bridge to the engines — exact calls") for the caller side. Nothing else in the codebase (admin-service, other engines) calls this engine directly in the normal path, though `admin-service`'s `/api/admin/game-rooms/:id/live-state` route reads this engine's `tp:game:<roomId>` Redis key straight out of Redis, bypassing both the gateway and this engine's own process (`docs/backend-services/game-gateway/admin.md`) — see `admin.md`.
- **Outbound**: Postgres (`game_configs.rake_percent`, `bot_profiles.win_rate_target`, and a fire-and-forget `UPDATE game_rooms`/`UPDATE game_participants` on hand completion) and Redis (`tp:game:<roomId>`, the sole store of live game state — no other cache or DB copy exists while a hand is in progress).
- **Games registry**: `games/registry.json` lists `teen-patti` with `"engine": "services/game-engines/teen-patti"`, `minPlayers: 2`, `maxPlayers: 6`, `"config": "resources/game-configs/teen-patti.json"`, `"supportsBots": true`. See `admin.md` for why that `config` path is misleading — this engine never reads that file.

## Behavioral characteristics carried over from already-filed issues

This engine has no notion of "how long has this player been idle" itself — that's entirely the gateway's job, via `scheduleTeenPattiAfkTimer` (see `backend.md`) rather than anything here, which is expected given this engine is purely request-driven (above).

(`/action`'s Redis read-modify-write having no lock/mutex/`WATCH` was a real gap here — fixed 2026-07-29 via `withRoomLock()`, see `backend.md`.)

This pass adds several new findings on top of that — see the bug list at the end of `backend.md`.
