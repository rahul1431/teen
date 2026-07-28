# Matka Betting — Backend

All Matka logic lives in two files inside `core-api-service`: `services/core-api-service/src/plugins/betting.ts:28-71,290-293` (routes) and `services/core-api-service/src/helpers/matka.ts` (109 lines — validation, panna classification, settlement). No other service touches Matka data directly except `admin-service` (proxy routes, see `admin.md`) and `wallet-service` (money movement, via `helpers/wallet-client.ts`). There is no automated test coverage for any of this — no `*.test.ts` file references `matka` anywhere in `services/core-api-service`.

## Routes

All under the `bettingPlugin` registered by `core-api-service`'s index; player routes require `app.authenticate`, the one internal route requires `x-internal-key === INTERNAL_SERVICE_KEY` (a locally-defined check, `betting.ts:13-16`, independent from the equivalent checks in `leaderboard.ts`/`notifications.ts`).

| Route | Auth | Purpose |
|---|---|---|
| `GET /matka/markets` | player | Active markets + today's draw state + `MATKA_MULTIPLIERS` |
| `POST /matka/bet` | player | Place a bet |
| `GET /matka/my-bets` | player | Caller's last 100 bets |
| `POST /internal/matka/declare` | internal key | Declare a session's result and settle bets |

There is **no `GET /matka/markets/:id/chart` route** — the mobile panel-chart dialog (`matka_page.dart:600-611`) calls it and always renders "No historical results found." Already filed: `docs/Bugs/betting-mobile-routes-missing-on-backend.md`.

### `GET /matka/markets` (`betting.ts:29-37`)

For every row in `matka_markets WHERE is_active = true`, calls `todayDraw(marketId)` (`betting.ts:20-26`), which does a `SELECT ... WHERE market_id = $1 AND draw_date = $2` (today, server-local `Date` — **not explicitly IST-normalized**, unlike the bet-placement cutoff check below) and lazily `INSERT`s a fresh `matka_draws` row (`status: 'open'`) if none exists yet. So the very first request of the day for any market creates that day's draw row as a side effect of a `GET`. Returns each market's `open_time`/`close_time`, the draw's declared panna/digit/jodi fields (all `null` until declared), and the static multiplier table.

### `POST /matka/bet` (`betting.ts:39-66`)

1. Zod-parses `{ market_id: uuid, bet_type: string, session: 'open'|'close' (default 'open'), number: string, amount: number (positive) }`.
2. `validateMatkaBet(bet_type, number)` (`matka.ts:20-31`):
   - Rejects any `bet_type` not in `MATKA_BET_TYPES` (`['single','jodi','single_panna','double_panna','triple_panna']`, `matka.ts:7`) with `'Invalid bet type'`. **Sangam bet types are not in this list at all** — see the bug below.
   - `single`: exactly one digit. `jodi`: exactly two digits. Panna types: exactly three digits, and `pannaKind(number)` (`matka.ts:13-18`, classifies by repeated-digit pattern) must match the claimed `bet_type` — so submitting `123` as `bet_type: 'double_panna'` is rejected even though the format is 3 digits, because `123` classifies as `single_panna`.
3. `todayDraw()` again (idempotent — reuses today's row).
4. Rejects if `draw.status === 'settled'` (`'Market closed for today'`), or if the bet's own session is already declared (`draw.open_panna`/`draw.close_panna` non-null → `'Open/Close session already declared'`).
5. Enforces the time cutoff: `(NOW() AT TIME ZONE 'Asia/Kolkata')::time` compared against `matka_markets.open_time`/`close_time` depending on `body.session` (`betting.ts:49-58`) — this check is correctly IST-aware, unlike `todayDraw()`'s bare `Date` above (a latent day-rollover mismatch around midnight IST vs. server-local midnight, though low-impact since Matka markets all run in daytime/evening IST windows well clear of that boundary).
6. Computes `potential = round(amount * MATKA_MULTIPLIERS[bet_type] * 100) / 100`, generates a `betId` (`crypto.randomUUID()`), calls `debitStake({ idempotencyKey: 'matka_stake_<betId>', ... })`. If the debit fails (insufficient balance, wallet-service down/rejects), returns 400 with the wallet's error message and the bet is never created.
7. Inserts the `matka_bets` row. **If this insert throws after a successful debit, there is no refund/rollback path** — unlike Lottery's `/lottery/buy`, which explicitly refunds via `creditPrize()` on a `23505` unique-constraint race (see `docs/backend-services/core-api-service/backend.md`). In practice nothing in the `matka_bets` schema can plausibly conflict on insert (no unique constraint on the bet itself), so this is a theoretical rather than observed gap — noted for completeness, not filed as a standalone bug.

Nothing in this route reads `game_configs` for `game_type = 'matka'` — no rake is deducted, `stake_options` (`{10,50,100}` seeded) is not enforced (`amount` only needs to be `> 0`), and the `is_active` flag on that row is never checked. See "Dead admin configuration" below.

### `GET /matka/my-bets` (`betting.ts:68-71`)

Caller's last 100 bets joined to `matka_draws`/`matka_markets` for the market name, ordered newest-first. No pagination beyond the hard `LIMIT 100`.

### `POST /internal/matka/declare` → `settleMatkaSession()` (`matka.ts:33-109`)

Called only by `admin-service`'s `POST /api/admin/betting/matka/declare` (see `admin.md`) with `{ draw_id, session: 'open'|'close', panna }`.

1. Opens a transaction, `SELECT ... FOR UPDATE` on the `matka_draws` row (locks it for the duration).
2. **Open branch**: computes `digit = pannaToDigit(panna)` (sum of the three digits mod 10, `matka.ts:9-11`), writes `open_panna`/`open_digit`/`status='open_declared'`, then `UPDATE matka_bets SET status='won', payout=potential_payout WHERE draw_id=$1 AND status='pending' AND session='open' AND ((bet_type='single' AND number=digit) OR (bet_type IN panna-types AND number=panna))`, then marks every other still-pending open-session bet `'lost'`. `jodi` bets are untouched here (correctly — they can't resolve until close).
3. **Close branch**: computes `digit` the same way, then `jodi = "${draw.open_digit ?? 0}${digit}"` — **this silently defaults the first digit to `0` if `open_digit` is `null`**, i.e. if close is declared before open was ever declared for that draw. There is no check anywhere (route, helper, or admin UI) that open must be declared first. If this happens, the computed jodi is wrong (looks like open digit was `0` rather than "not yet known"), and any pending jodi bets get evaluated against that wrong/fabricated jodi — winners could be paid on a jodi that never actually happened, and legitimate winners (once the real open digit is later declared, if anyone re-runs close — which nothing prevents or even signals as necessary) are never revisited since their bets are already marked `lost`/`won` and excluded by the `status='pending'` filter. This is a real money-moving correctness bug reachable purely by an admin using the "Close" option in the declare modal before "Open" — see `docs/Bugs/matka-close-declared-before-open-corrupts-jodi.md`.
4. The close branch's winning query covers three independent conditions in one `UPDATE`: `bet_type='jodi' AND number=jodi` (session-agnostic — a jodi bet always resolves here regardless of its own stored `session` value, since `settleMatkaSession`'s open branch never touches jodi bets at all), plus close-session `single`/panna bets matching the close digit/panna. All remaining pending bets for the draw are then marked `'lost'`.
5. Outside the transaction, winners are paid via `Promise.all(winnerPayouts.map(w => creditPrize({ idempotencyKey: 'matka_payout_<betId>', ... })))` — **the resolved `boolean[]` from `Promise.all` is never inspected**, not even to log a failure. `creditPrize()` (`services/core-api-service/src/helpers/wallet-client.ts:23-37`) itself swallows network errors and returns `false` rather than throwing, so a wallet-service outage during a payout run produces **zero visible failure anywhere** — no exception, no log line, no admin-facing error — while every affected bet's `matka_bets.status` is already durably `'won'` in Postgres. Reconciliation is possible in principle (compare `won` bets against `wallet_transactions` for the `matka_payout_<id>` idempotency keys) but nothing in this codebase automates it. This inherits the same shape as the already-filed `docs/Bugs/daily-bonus-claim-reports-success-even-if-wallet-credit-fails.md` and `docs/Bugs/leaderboard-top3-reward-never-paid.md` (fire-and-forget wallet call, no retry, no reconciliation job), but is worth calling out here as a Matka-specific instance since it's real money, not a bonus/reward credit.

Re-declaring an already-declared session (calling `/internal/matka/declare` twice for the same `draw_id`+`session`) does **not** double-pay: the settlement `UPDATE`s are scoped to `status='pending'`, so a second call finds nothing left to update for that session and simply re-writes the draw's panna/digit/jodi columns (overwriting the officially recorded result with whatever was passed the second time, silently, with no version/audit trail) — a data-integrity footgun for admin typos, but not a financial one, so not filed as a standalone bug.

## Payout multiplier structure

Flat multipliers per bet type, not computed from odds or pool size (`matka.ts:4-6`): `single: 9.5`, `jodi: 95`, `single_panna: 142`, `double_panna: 285`, `triple_panna: 950`. These already bake in the house edge below the "fair" multiples (10x/100x/etc.) traditional to Matka — there is no additional rake deducted on top (see below), so the multiplier table alone is the entire house-edge mechanism.

## Bug: Sangam bet type is fully built client-side but rejected by the backend

The mobile bet slip has a fourth top-level tab, "Sangam" (`matka_page.dart:805-810`), with three subtypes — `half_sangam_a` (open panna + close ank), `half_sangam_b` (open ank + close panna), `full_sangam` (open panna + close panna) — each with its own number-picker UI (`matka_page.dart:1229-1247, 1407-1543`) and its own `bet_type` string submitted in the `POST /api/betting/matka/bet` body (`matka_page.dart:852-855, 869-875`). None of `half_sangam_a`, `half_sangam_b`, `full_sangam` appear in `MATKA_BET_TYPES` (`matka.ts:7`, derived from `MATKA_MULTIPLIERS`'s five keys) — `validateMatkaBet()` rejects all three with `400 { error: 'Invalid bet type' }` before any other logic runs. Even setting that aside, the `number` values Sangam submits (a 3-digit panna + 1-digit ank = 4 characters for half-sangam, or 3+3 = 6 characters for full-sangam) don't match any of `validateMatkaBet`'s format branches (1/2/3-digit only) — so the feature is broken at two independent layers, not one. The client-side error handling (`_submit`'s `catch`, `matka_page.dart:883-894`) does surface the server's `'Invalid bet type'` message as a snackbar/inline error, so this doesn't fail silently like the swallowed-`catch(_)` pattern elsewhere in this codebase — but the entire Sangam tab is nonetheless permanently unusable in production. See `docs/Bugs/matka-sangam-bet-type-not-supported-by-backend.md`.

## Bug: admin's Matka config panel is entirely dead configuration

`admin-panel/src/pages/games/Matka.tsx`'s "Matka Rules & Config" card (`Matka.tsx:117-154`) reads/writes the `game_configs` row for `game_type = 'matka'` (`GET /game-configs` filtered client-side, `PATCH /game-configs/matka`) and exposes: **Game Active** (`is_active`), **Rake %** (`rake_percent`). It used to also expose a full "Bot Settings" section (`bot_fill_enabled`, `bot_fill_delay_seconds`, `max_bot_ratio`, `bot_difficulty`) — removed (fixed 2026-07-28): conceptually inapplicable to Matka, which has no opponents to fill with bots (`game_configs` seeds Matka with `min_players: 1, max_players: 1`, `001_initial.sql:236`); it's a bet-against-a-declared-result game, not a seated multiplayer table. Those fields existed purely because `Matka.tsx` reused the same generic config-card layout as the seated multiplayer games' admin pages, without removing the parts that don't apply.

The remaining `is_active`/`rake_percent` fields are still dead configuration. Grepping `betting.ts` and `matka.ts` for `game_configs`/`rake`/`special_rules`/`is_active` turns up **zero references** in either file — the only place in the entire betting plugin that reads `game_configs.special_rules` is the Cricket section (for the cricapi.com API key, `betting.ts:389,419,435`). Concretely:
- Toggling **Game Active** off does not stop `POST /matka/bet` or `GET /matka/markets` from working — the only `is_active` check in the Matka bet-placement path is on `matka_markets.is_active` (a separate, per-market row, `betting.ts:30`), not this game-level flag. An admin who flips this switch believing it's an emergency stop for Matka betting platform-wide has done nothing.
- **Rake %** is saved but never subtracted from any payout — `potential = amount * MATKA_MULTIPLIERS[bet_type]` (`betting.ts:60`) is the only place a payout is computed, and it has no rake term.

See `docs/Bugs/matka-game-config-rake-and-active-toggle-not-enforced.md`.
