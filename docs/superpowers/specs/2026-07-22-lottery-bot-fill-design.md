# Lottery Bot Fill & Throttle

Status: Approved design.

## Context

Daily, Weekly, and Monthly lottery draws (the shared "pick a number, admin-defined prize tiers" mechanic) currently sell tickets with no cap and no artificial urgency — a draw sits open until its scheduled draw time regardless of how many real tickets sell. The user wants bot accounts to buy tickets to create sold-out pressure, while always leaving room for a real user to be able to buy in.

Instant Lottery (scratch cards) is explicitly out of scope — it has no shared ticket pool (unlimited independent probability rolls per purchase), so a "% of tickets sold" mechanic doesn't apply there.

Lottery was previously locked (2026-07-18, no changes without re-authorization). Re-authorized 2026-07-22 specifically for this feature.

## Goals

- Bot accounts buy real tickets (real wallet debit) on Daily/Weekly/Monthly draws, filling toward 60% of a configurable ticket pool.
- Whenever total sold (bots + real) reaches 99% of the pool, delete 1% worth of bot-owned tickets (with a real wallet refund) to free room for a real buyer.
- After releasing, bots refill back toward the 60% ceiling if room remains — an ongoing throttle for the life of the draw, not a one-time event.
- All thresholds (fill/trigger/release %) and the default pool size are admin-configurable without a redeploy.

## Non-goals

- Instant Lottery — no pool concept exists there; unaffected by this spec.
- Excluding bot tickets from winning at settlement — bots are treated identically to real tickets when a draw settles (explicit product decision: simpler logic, net-neutral house money).
- Automatic bot wallet funding — admin tops up lottery bot wallets manually via the existing Bots management UI, same as any bot account today.

## Data Model

### `lottery_bot_config` (new, single row)

| column | type | notes |
|---|---|---|
| `id` | UUID | PK, single row |
| `enabled` | BOOLEAN | master on/off switch |
| `default_max_tickets` | INT | pool size applied to newly created draws |
| `fill_pct` | NUMERIC | bots buy up to this % of the pool (default 60) |
| `trigger_pct` | NUMERIC | releasing 1% triggers once sold reaches this % (default 99) |
| `release_pct` | NUMERIC | % of pool released (as bot ticket deletions) per trigger (default 1) |
| `updated_at` | TIMESTAMPTZ | |

### `lottery_draws` / `lottery_daily_draws` (altered)

| column | change |
|---|---|
| `max_tickets` | **new**, `INT NOT NULL`, populated from `lottery_bot_config.default_max_tickets` at draw creation time |

### `users` (altered, if not already present)

| column | change |
|---|---|
| `preferred_game_type` | **new** (or reused if already added by the in-flight bot-pool-separation work), `VARCHAR(30)` — lottery bot accounts are tagged `'lottery'`, a pool kept separate from Teen Patti/Ludo bot pools |

## Bot Fill & Throttle Logic

A single function, `rebalanceBotTickets(drawId)`, runs synchronously immediately after every ticket purchase (bot or real) on an `open` draw:

1. Compute `sold_pct = tickets_sold / max_tickets` for the draw.
2. **If `sold_pct >= trigger_pct`**: select `release_pct * max_tickets` bot-owned tickets at random, delete them, and refund each bot's wallet for the ticket price (a stake reversal, not a prize win).
3. **Else if `sold_pct < fill_pct` and current bot-owned tickets are below `fill_pct * max_tickets`**: bots buy tickets one at a time (real `debitStake` + ticket insert, using a lottery-tagged bot account with sufficient wallet balance) until either the 60% bot ceiling or the 99% trigger threshold is reached, whichever comes first.
4. No action otherwise.

This causes the pool to oscillate near the 99%→98% band under sustained real demand, and to hold near 60% when real demand is low, for as long as the draw remains `open`. No bot activity occurs once a draw transitions to `calling` or `settled`.

Daily's existing unique-ticket-number-per-draw constraint applies to bot purchases the same as real ones — a bot picks a random unused 4-digit number, retrying on collision.

## Settlement

No changes to `settleLottery` / Daily settlement — bot tickets are ordinary rows and are checked against the winning number like any other ticket. A bot ticket that matches pays out to the bot's wallet through the existing `creditPrize` flow.

## Admin Panel

- **Bot Config panel** (new section on the existing Lottery admin page): enable/disable toggle, `default_max_tickets`, `fill_pct`, `trigger_pct`, `release_pct` — edits `lottery_bot_config`.
- **Draws table**: ticket-count column extended to show a bot/real breakdown, e.g. `142 / 200 (38 bot)`.
- **Bot wallet funding**: reuses the existing Bots management UI; admin manually deposits into lottery-tagged bot wallets exactly as they would for any bot account today. No new funding mechanism.

## Edge Cases

- Pool reaches 100% from real purchases alone (no bot tickets present): rebalance finds no bot tickets to release; no-op.
- A lottery bot's `debitStake` fails from insufficient balance: that purchase attempt is skipped (not an error) — rebalance tries another bot with balance, or stops if none qualify; logged for admin visibility via wallet top-up need.
- Draw cancellation: existing refund flow already covers all tickets including bot-owned ones — no special case.

## Migration

- Additive: new `lottery_bot_config` table (seeded with one disabled-by-default row), new `max_tickets` column on both draw tables (backfilled to `default_max_tickets` for any open draws at migration time), and `users.preferred_game_type` if not already present from other in-flight work — with a small number of existing bot accounts re-tagged `'lottery'` or new lottery-only bot accounts created.

## Open Questions / Deferred

- Exact number/selection of dedicated lottery bot accounts to seed — left to the implementation plan.
- Whether `fill_pct`/`trigger_pct`/`release_pct` should be enforced as a percentage of ticket count vs. ticket value — this spec uses ticket **count**, matching the plain reading of "60% of tickets."
