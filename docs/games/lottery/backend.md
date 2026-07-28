# Lottery Betting — Backend

All routes live in `services/core-api-service/src/plugins/betting.ts` under the `// ══ LOTTERY ══` section (`:73-135`) plus the `/internal/lottery/*` block (`:296-325`); settlement logic is factored out into `services/core-api-service/src/helpers/lottery.ts`. Every player route requires `app.authenticate`; every `/internal/*` route requires `x-internal-key === INTERNAL_SERVICE_KEY` via the locally-defined `internal` hook (`betting.ts:13-16` — a hook independently re-implemented per plugin file rather than shared, per `docs/backend-services/core-api-service/backend.md`).

## Schema (`infra/db/migrations/009_betting_games.sql:65-89`)

```sql
CREATE TABLE lottery_draws (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(80) NOT NULL,
  ticket_price NUMERIC(10,2) NOT NULL,
  draw_time TIMESTAMPTZ NOT NULL,
  digits SMALLINT NOT NULL DEFAULT 4,        -- ticket number length (e.g. 4 → 0000-9999)
  prize_multiplier NUMERIC(10,2) NOT NULL DEFAULT 1000,  -- exact-match payout multiple
  winning_number VARCHAR(8),
  status VARCHAR(12) NOT NULL DEFAULT 'open', -- open | drawn | settled
  ...
);
CREATE TABLE lottery_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  draw_id UUID NOT NULL REFERENCES lottery_draws(id),
  user_id UUID NOT NULL REFERENCES users(id),
  ticket_number VARCHAR(8) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  prize NUMERIC(14,2) NOT NULL DEFAULT 0,
  ...
);
-- only two indexes exist: idx_lottery_tickets_user, idx_lottery_tickets_draw
```

Two columns are worth flagging before anything else because the rest of this doc depends on them: **there is no unique constraint anywhere on `(draw_id, ticket_number)`**, and **`prize_multiplier` is never read by any settlement code** — see the two findings below.

## Player routes

- **`GET /lottery/draws`** (`:74-86`) — open draws with `draw_time > NOW()`, each annotated with a `reserved_tickets` array (`json_agg` of every `ticket_number` already sold for that draw) and a `ticket_count`. This is how the mobile client renders "X numbers taken" and blocks a client-picked number that's already reserved — but only as a client-side hint (see below for why it isn't a real guarantee).
- **`POST /lottery/buy`** (`:88-113`) — validates `ticket_number` against `/^[a-zA-Z0-9]{1,8}$/` (`:94`), confirms the draw is `status = 'open'`, pre-checks for an existing row with the same `(draw_id, ticket_number)` (`:96`), debits `draw.ticket_price` (idempotency key `lottery_buy_<ticketId>`, `:100`), then inserts the ticket. If the insert throws a Postgres `23505` unique-violation, it refunds the debit and returns `409`. **This defensive path can never actually run** — see "No unique constraint" below.
- **`GET /lottery/my-tickets`** (`:115-118`) — caller's last 100 tickets, joined with the draw's `name`/`winning_number`/`draw_time`/`status`.
- **`GET /lottery/results`** (`:120-135`) — last 20 `settled` draws, each with a `json_agg` of `{ticket_number, prize}` for every winning ticket, plus `total_tickets`/`winner_count`/`total_paid` aggregates.

## Settlement (`helpers/lottery.ts`, `settleLottery`)

Runs inside a single transaction: row-locks the draw (`SELECT ... FOR UPDATE`), sets `winning_number` to a comma-joined string of every winning `ticket_number` supplied by the caller (`winnersList.map(w => w.ticket_number).join(', ')`, `helpers/lottery.ts:21`) and `status = 'settled'`, resets **every** ticket in the draw to `is_winner=false, prize=0` (`:35-38`), then for each entry in `winnersList` runs `UPDATE lottery_tickets SET is_winner=true, prize=$1 WHERE draw_id=$2 AND ticket_number=$3` (`:42-47`). This `UPDATE` has no `LIMIT 1` and no uniqueness assumption baked in — if more than one ticket row shares the same `(draw_id, ticket_number)` (a state the schema does not prevent — see below), **all of them** get marked as winners and **all of them** get paid the declared prize, silently multiplying the payout for what the admin believed was a single ticket. After `COMMIT`, payouts run outside the transaction via `Promise.all(winnerPayouts.map(w => creditPrize(...)))` (`:66-68`) — the same fire-and-forget-after-commit pattern already described generically for matka in `docs/backend-services/core-api-service/backend.md` (a partial wallet-service failure here pays some winners and silently skips others, with no retry; each ticket's `is_winner`/`prize` is already durably committed, so manual reconciliation from `lottery_tickets` is possible, but nothing surfaces the discrepancy automatically).

`prize_multiplier` (the field an admin sets at draw-creation time, surfaced in the admin table as "Multiplier") is **never read anywhere in this settlement path or in `betting.ts`**. The admin must manually type an exact rupee `prize` for every winning ticket in the "Declare winners" form (`admin-panel/src/pages/games/Lottery.tsx:218-250`) — `ticket_price * prize_multiplier` is not auto-computed and not enforced as a ceiling or default. The multiplier shown to players (both in the admin table and, per `mobile.md`, in the mobile "jackpot" display) is therefore purely advisory; the actual payout is whatever number an admin types into a free-text `InputNumber` at settlement time, which can be any positive value regardless of what `prize_multiplier` implied.

`/internal/lottery/cancel` (`betting.ts:315-325`) refunds every ticket for an `open` draw and marks it `cancelled`; same unchecked `Promise.all(creditPrize(...))` pattern.

## New finding — no DB constraint enforces "one ticket number per draw"

**Severity: High.** `lottery_tickets` has no `UNIQUE(draw_id, ticket_number)` constraint or index (`infra/db/migrations/009_betting_games.sql:78-89` — confirmed by grepping every migration file for `lottery_tickets`/`lottery_draws`; no `ALTER TABLE ... ADD CONSTRAINT` for either table exists anywhere in `infra/db/migrations/`). `/lottery/buy`'s protection against double-selling a number is a plain `SELECT` pre-check (`betting.ts:96`) followed by an `INSERT`, with a `catch` block specifically written to handle a `23505` unique-violation (`:106-111`) that **cannot be thrown by this schema** — there is nothing to violate. Two requests for the same `draw_id`+`ticket_number` that race past the pre-check within the same window (two different users tapping "Buy" on the same quick-picked number at nearly the same instant, or a single client's request being retried by a proxy/timeout after the first attempt already committed) both debit successfully and both insert successfully — the app now has two `lottery_tickets` rows with the same number for the same draw, each belonging to (possibly) a different `user_id`. If that number is later declared a winner, `settleLottery`'s unscoped `UPDATE ... WHERE draw_id=$2 AND ticket_number=$3` (`helpers/lottery.ts:42-47`) marks and pays **both** rows the full declared prize — a real, unrecoverable double (or N-fold) payout on a real-money feature, silently, with no error or admin-visible signal (the settlement response's `winners`/`paid` counts simply reflect the extra row as if it were a distinct legitimate winner). See `docs/Bugs/lottery-ticket-number-race-no-unique-constraint.md`.

## New finding — mobile schema mismatch makes Daily/Weekly/Monthly browsing permanently empty

**Severity: High.** Fully covered in `mobile.md` with the client-side evidence; summarized here because the root cause is a backend response-shape gap. `GET /lottery/draws` (`betting.ts:74-86`) returns `d.*` from `lottery_draws` plus `reserved_tickets`/`ticket_count` — it never returns a `category` field (the table has no `category` column at all) or a `prize_tiers` array (the table has only a single scalar `prize_multiplier`, never an array of tiered `{match_type, multiplier}` objects). `mobile/lib/features/games/betting/lottery_draws_page.dart:64` filters the fetched draws with `all.where((d) => d['category'] == widget.category)` for every one of the three lottery categories the app exposes (Daily/Weekly/Monthly, `lottery_page.dart:70-114`) — since the field is always absent (`null`), this comparison is `null == 'daily'`/`'weekly'`/`'monthly'`, always `false`, so `_draws` is **always empty** regardless of how many draws actually exist and are open. The same page's jackpot header and per-draw "JACKPOT" stat chip (`_totalJackpot`, `:110-119`; `_drawCard`'s `maxPrize`, `:404-412`) read `d['prize_tiers']` looking for a `match_type: 'exact'` entry — also always absent, so `mult` is always `0` and the advertised jackpot is always `₹0`/"No Active Draws" even when draws do carry a real `prize_multiplier`. Net effect: every draw an admin creates and every ticket a player could buy through this screen is functionally unreachable — the Browse tab shows "No draws open right now" unconditionally, for all three lottery categories, regardless of backend state. See `docs/Bugs/lottery-mobile-category-tiers-schema-mismatch.md`.

## New finding — the `digits` column is stored but never enforced

**Severity: Low.** `lottery_draws.digits` is admin-configurable per draw ("Number Length (digits limit)", `admin-panel/src/pages/games/Lottery.tsx:204`) and documented in the schema comment as "ticket number length (e.g. 4 → 0000-9999)" (`009_betting_games.sql:71`), but `/lottery/buy`'s only validation is the fixed regex `/^[a-zA-Z0-9]{1,8}$/` (`betting.ts:94`) — it never reads `draw.digits` to bound the ticket length to what the admin configured, and it accepts letters as well as digits despite the field's name and the mobile client's 4-digit-numeric-only picker UI (`lottery_draws_page.dart:1108`, `RegExp(r'^[0-9]{4}$')`). A draw configured for `digits: 4` will silently accept a purchased ticket number of, say, `"AB"` (2 alphanumeric characters) via any client that calls `/lottery/buy` directly (or a future client that doesn't hardcode 4-digit-numeric input the way the current mobile picker does) — the `digits` value is decorative, read only for display in the admin draws table. See `docs/Bugs/lottery-ticket-digits-limit-not-enforced.md`.

## New finding — lottery's `game_configs` row is entirely disconnected from gameplay

**Severity: Medium.** `admin-panel/src/pages/games/Lottery.tsx`'s "Lottery Rules & Config" card (`:118-155`) reads/writes `is_active` and `rake_percent` against the generic `game_configs` table (`game_type = 'lottery'`) through `admin-service`'s generic `PATCH /api/admin/game-configs/:gameType` (`services/admin-service/src/index.ts:1030-1044`), and the write genuinely persists. It used to also read/write `bot_fill_enabled`/`bot_fill_delay_seconds`/`max_bot_ratio`/`bot_difficulty` — removed (fixed 2026-07-28), since lottery has no concept of a bot "filling" a ticket the way there is a bot filling a game-room seat. But grepping `services/core-api-service/src` for `game_configs` shows the lottery routes and `settleLottery` **never read the remaining fields either** — the only `game_configs` reads in `betting.ts` are three cricket `special_rules` lookups (`:389,419,435`). Concretely: toggling `is_active` off does not stop `/lottery/buy` from accepting new tickets (no route checks it); `rake_percent` is never subtracted from anything (`settleLottery` pays the admin-typed `prize` in full, no rake deduction anywhere in the lottery path, unlike Teen Patti's `loadRakePct`). The config card is a fully-functional-looking UI wired to database columns with zero downstream effect — the same shape of gap as `docs/Bugs/teen-patti-dda-admin-control-gap.md`, but total rather than partial (that one has a real DDA lever partially reachable; here nothing at all is reachable). See `docs/Bugs/lottery-admin-config-panel-not-wired-to-gameplay.md`.

## Idempotency keys are not actually idempotent (cross-cutting, not filed as a new standalone bug here)

Every idempotency key on this feature — `lottery_buy_<ticketId>` (`betting.ts:100`), `lottery_payout_<ticketId>` (`helpers/lottery.ts:67`), `lottery_refund_<ticketId>` (`betting.ts:322`) — is built from a UUID minted server-side inside the handler (`crypto.randomUUID()`, `betting.ts:99`), not something the caller supplies and can echo back on a retry. A dropped response after a successful debit-and-insert, followed by a client or proxy retry of the exact same "buy ticket 1234" request, produces a **second**, differently-keyed debit and (in the absence of the unique constraint noted above) a second ticket row — i.e. this feature has the identical structural flaw Teen Patti's dealer-tip flow had (a key that can never collide provides no real replay protection; fixed there 2026-07-28, this lottery path is separate code and unaffected by that fix). It is folded into `docs/Bugs/lottery-ticket-number-race-no-unique-constraint.md` above rather than filed separately, since the fix (a real `UNIQUE(draw_id, ticket_number)` constraint, which the 23505-handling code already assumes exists) closes both the concurrent-different-user race and the same-user-retry case at once.

## Test coverage

None. `services/core-api-service` has no test script (per CLAUDE.md, only `app-monitor-service` has automated tests in this codebase) and no test files reference `lottery` or `betting.ts` — every behavior described above (the settlement transaction, the refund-on-conflict path, the debit/credit calls) is unverified by any automated test.
