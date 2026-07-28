# Matka Betting — Admin Panel

**Routed page**: `admin-panel/src/pages/games/Matka.tsx` (263 lines), mounted at `/admin/games/matka` (`admin-panel/src/main.tsx:22,58`) with a sidebar entry "🎯 Satta Matka" (`admin-panel/src/pages/Layout.tsx:28`). This is the only reachable Matka admin UI.

**Not routed** (context, not new functionality to document in depth): `admin-panel/src/pages/BettingManagement.tsx` has a near-duplicate Matka tab calling the same `/betting/matka/*` endpoints, but the whole file is dead/unrouted — already filed as `docs/Bugs/orphaned-admin-pages.md`. `admin-panel/src/pages/GameConfig.tsx` also has a generic per-game config card that would apply to Matka (`GAME_LABELS.matka = '🎯 Matka'`, `GameConfig.tsx:9`), but that file likewise has no `<Route>` or menu entry anywhere — a third orphaned admin page in the same family, not previously catalogued in `orphaned-admin-pages.md`.

## Backend routes this page calls

All in `services/admin-service/src/index.ts`, all requiring `authenticate`; write routes additionally require a role:

| Route | Role | Purpose |
|---|---|---|
| `GET /api/admin/game-configs` (filtered client-side to `game_type==='matka'`) | any admin | Load the config card |
| `PATCH /api/admin/game-configs/matka` | superadmin (generic route, not role-checked per-game-type) | Save the config card |
| `GET /api/admin/betting/matka/draws` | any admin | Today's draws table |
| `GET /api/admin/betting/matka/markets` | any admin | Markets table |
| `POST /api/admin/betting/matka/markets` | superadmin | Create a market |
| `DELETE /api/admin/betting/matka/markets/:id` | superadmin | Delete a market (cascades) |
| `POST /api/admin/betting/matka/declare` | **finance** | Declare a session result |

## Matka Rules & Config card (`Matka.tsx:117-154`)

Loads via `loadConfig()` (`Matka.tsx:28-36`) which fetches the whole `/game-configs` list and finds the `matka` row client-side (no dedicated single-row endpoint). Fields: **Game Active** switch (`is_active`), **Rake %** (0-20, step 0.5). Saving calls `PATCH /game-configs/matka` with the whole form's values.

A **Bot Settings** divider (Bot Fill Enabled/Delay/Ratio/Difficulty) used to render here too — removed (fixed 2026-07-28): Matka has no bots to fill (`min_players: 1, max_players: 1` per its `game_configs` seed row, `infra/db/migrations/001_initial.sql:236`), unlike Teen Patti/Ludo where the identical-looking card on their own admin pages genuinely drives bot-fill behavior in `game-gateway`.

**The remaining `is_active`/`rake_percent` fields still don't do anything to live Matka behavior.** Per `backend.md`, `betting.ts`/`matka.ts` never read `game_configs` for Matka at all (the only in-code reader of that table's `special_rules` column is the Cricket section, for an API key). Concretely, for an admin operating this page:
- Flipping **Game Active** off is the natural "pause this game" action any admin would reach for during an incident — it does not pause anything. `POST /matka/bet` has no gate on this flag.
- **Rake %** looks like the platform's cut on Matka payouts. There is no rake subtraction anywhere in the payout math (`potential = amount * MATKA_MULTIPLIERS[bet_type]`, no further deduction).

See `docs/Bugs/matka-game-config-rake-and-active-toggle-not-enforced.md`.

## Matka Markets card (`Matka.tsx:160-198`)

A plain CRUD table over `matka_markets`: **name**, **open time**, **close time**, **sort order**, and a per-row **Delete** button (with a `Popconfirm` warning that it cascades to draws/bets). "+ New Market" opens a modal (`Matka.tsx:224-246`) taking name + `open_time`/`close_time` as free-text `HH:MM:SS` strings (no time-picker widget, no client-side format validation beyond `required` — a malformed string reaches `POST /api/admin/betting/matka/markets`, which only validates via Zod's `z.string()`, i.e. accepts any string; a bad value would fail at the Postgres `TIME` column level with a raw 500, not a friendly validation error). Delete removes the market plus every draw and bet ever placed against it (`services/admin-service/src/index.ts:1617-1627`) — there is no soft-delete/archive option, so deleting a market an admin created by mistake also destroys historical bet records for audit purposes.

Note: `deleteMarket` in `Matka.tsx:81` is typed `(id: number)` even though `matka_markets.id` is a `UUID` string — harmless at runtime (JS/TS don't enforce this at the call site, and the value just gets interpolated into the URL), but a sign the type was copy-pasted from a different admin table without adjustment.

## Today's Matka Draws card (`Matka.tsx:200-217`) — the actual result-declaration workflow

Lists each active market's draw for the current date (server `CURRENT_DATE`, `services/admin-service/src/index.ts:1479` — **not IST-normalized**, a potential mismatch against the player-facing route's IST-aware `todayDraw()` around midnight, though low-impact since markets run in daytime/evening IST windows): market name, status tag (green unless `settled`), open/close panna-digit pairs (`—` until declared), jodi, bet count, and total staked. Each row has a **Declare** button (disabled once `status === 'settled'`) opening a modal (`Matka.tsx:248-260`):

- **Session** select — Open or Close, defaulting to **Open**.
- **Panna** input — exactly 3 digits (client-side regex `^[0-9]{3}$`).
- Submits `POST /api/admin/betting/matka/declare` → `services/admin-service/src/index.ts:1483-1486` → proxies via `callBetting()` to `core-api-service`'s `/internal/matka/declare` → `settleMatkaSession()` (see `backend.md`).

**Nothing in this modal or its backend prevents declaring "Close" before "Open" has ever been declared for that draw.** The select defaults to Open, but an admin can pick Close first with no warning — and per `backend.md`, doing so computes the jodi's first digit as `0` (silently, via `draw.open_digit ?? 0`) rather than as the real (not-yet-known) open digit, corrupting the jodi outcome and any pending jodi-bet settlements for that draw. See `docs/Bugs/matka-close-declared-before-open-corrupts-jodi.md` — this is the single highest-impact admin-workflow gap found in this pass, since it's reachable by a single wrong click in the routed, in-use admin page (not a dead/orphaned one).

There is also no confirmation step or "are you sure — this cannot be undone" prompt on Declare (unlike Delete Market's `Popconfirm`), despite Declare being the action that actually moves real money to winners.

The admin write path (declare, market create, market delete) was further affected by a now-fixed issue: `callBetting()`'s `BETTING_URL` fallback (`services/admin-service/src/index.ts`) used to default to `http://127.0.0.1:3012`, the old pre-merge standalone `betting-service`'s port, which nothing listens on since Matka/Lottery/Cricket were folded into `core-api-service` (port 3001) — and `services/admin-service/.env`'s explicit `BETTING_SERVICE_URL` setting matched that same wrong port. This meant **declaring a Matka result from the admin panel failed with a 500** independent of any of the correctness issues documented above; fixed 2026-07-28 (both now point at 3001). Market create/delete/list read routes query Postgres directly from `admin-service` and were never affected, since they don't go through `callBetting()`.
