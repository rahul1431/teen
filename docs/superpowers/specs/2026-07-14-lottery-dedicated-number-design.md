# Lottery Redesign — Dedicated Number Mode

Status: Approved design, first of three planned lottery modes (Dedicated Number, Card, Scratch Card — built and shipped one at a time).

## Context

The lottery system was requested for a full redesign around how players pick their number. Three distinct game modes were identified:

1. **Dedicated Number** (this spec) — a classic numbers-lottery pick.
2. **Card** — Bingo-style grid ticket, matched against a called sequence. Future spec.
3. **Scratch Card** — instant-win, tap-to-reveal mechanic. Future spec.

Each mode has a different enough data model and win mechanic (wait-for-draw vs instant) that they're being designed and built as separate spec → plan → implementation cycles rather than one combined effort. This document covers Dedicated Number only.

### Current state (being replaced)

- `lottery_draws`: admin sets a per-draw `digits` count (1–8) and a flat `prize_multiplier`, neither of which is actually used by settlement.
- `lottery_tickets.ticket_number`: free-text alphanumeric string (e.g. "LUCKY7"), chosen by the player, 1–`digits` characters, unique per draw.
- Settlement (`settleLottery`) is **fully manual**: the admin types out every winning ticket_number string and its exact prize amount by hand. No RNG, no digit-matching, no tiers.
- Confirmed via production DB: only 6 test draws / 6 test tickets exist, no real user activity — safe to do a clean-slate replacement, no migration/back-compat concerns.

## Goals

- Replace free-text tickets with a proper 4-digit numeric lottery.
- Real automatic settlement: one winning number, digit-match prize tiers, no manual per-ticket typing.
- Keep the admin flexible on how a draw result is produced (manual entry for draws tied to a real-world source, or instant random generation for purely internal draws).

## Non-goals

- Card and Scratch Card modes (separate specs).
- Preserving the old free-text ticket system in any form — it is fully replaced, not deprecated-alongside.
- Configurable digit count — always fixed at 4 digits going forward.

## Data Model

### `lottery_draws` (altered)

| column | change |
|---|---|
| `digits` | **dropped** — always 4 |
| `prize_multiplier` | **dropped** — superseded by `prize_tiers` |
| `prize_tiers` | **new**, `JSONB NOT NULL DEFAULT '[]'` — array of `{ match_type: 'exact' \| 'last_3' \| 'last_2' \| 'last_1', multiplier: number }` |
| `winning_number` | now `VARCHAR(4)`, a single number (was a comma-joined list of winning ticket strings) |
| `ticket_price`, `draw_time`, `status` (`open`/`settled`/`cancelled`) | unchanged |

### `lottery_tickets` (altered)

| column | change |
|---|---|
| `ticket_number` | now `CHAR(4)`, `CHECK (ticket_number ~ '^[0-9]{4}$')` — digits only |
| `UNIQUE(draw_id, ticket_number)` | unchanged — numbers stay exclusive per draw (first-come-first-served) |
| `is_winner`, `prize` | unchanged in shape, now always computed by automatic settlement, never hand-entered |

### Prize tier matching rule

For a 4-digit winning number, a ticket qualifies for the **highest** tier it satisfies, checked in this order (not cumulative — a ticket that matches all 4 digits wins only the exact tier, not every lower tier too):

1. `exact` — all 4 digits match.
2. `last_3` — last 3 digits match (position-sensitive, right-aligned).
3. `last_2` — last 2 digits match.
4. `last_1` — last digit matches.

Payout = `ticket_price × tier.multiplier`. A draw's `prize_tiers` array can omit any tier the admin doesn't want to offer (e.g. no `last_1` tier at all).

## Purchase Flow (Mobile)

Replaces the free-text bottom-sheet `TextField` with:

- A 4-box numeric display (OTP-style) — tapping opens the numeric keypad, one digit per box, auto-advance to the next box.
- A **"Quick Pick 🎲"** button that randomly fills all 4 boxes. Rerolls silently (client or server-checked) if the random number happens to already be taken for this draw, so the player never sees a "taken" collision from Quick Pick.
- Manual entry still checked against exclusivity before submit (server is the source of truth; client can pre-check via the existing reserved-numbers list).
- Because the number space is large (10,000 possibilities) compared to today's small alphanumeric space, the "taken numbers" UI becomes a compact counter ("1,204 / 10,000 numbers taken") rather than a list of chips.
- Purchase endpoint unchanged in shape (`POST /lottery/buy` with `{draw_id, ticket_number}`), server-side validation now requires exactly 4 numeric digits.
- "My Tickets" and "Results" tabs keep their existing layout, rendering a 4-digit number instead of an alphanumeric string.

## Draw & Settlement Flow

- Draw creation requires `prize_tiers` up front (players should see the payout structure before buying).
- Declaring a result offers two paths in one modal:
  - **Manual entry** — admin types the 4-digit winning number (for draws mirroring a real-world source).
  - **Generate Random Number 🎲** — server picks a random 4-digit number instantly.
- Either path feeds into one shared automatic settlement routine: every ticket in the draw is checked against the winning number using the match-tier rule above, `is_winner`/`prize` set automatically, and winners are paid via the existing `creditPrize` wallet flow (same idempotency-key and notification pattern as today's `settleLottery`).
- No manual per-ticket winner typing remains anywhere in the flow.

## Admin Panel

- **Create Draw** modal: `name`, `ticket_price`, `draw_time`, plus a repeatable **Prize Tiers** list (match-type dropdown + multiplier input) — same list-editing pattern already used for cricket contest prize distribution.
- **Declare Result** modal: toggle between manual entry and random generation, single "Declare" action, same irreversible-action warning styling used elsewhere in the admin panel.
- Ticket list drawer, KPI stats, cancel/refund, delete draw: unchanged, just render numeric tickets.
- Old free-text winner-list `Form.List` UI and regex validation are removed entirely.

## Migration

Since production only has test data (6 draws, 6 tickets, no real users):

- Truncate/clear existing `lottery_draws` and `lottery_tickets` rows.
- Alter both tables per the schema changes above in a single migration.
- No backward-compatibility shims in mobile, admin, or backend — the old free-text code paths are deleted, not deprecated alongside the new ones.

## Open Questions / Deferred

- Whether a single user should be capped on how many distinct numbers they can buy in one draw — not raised during design, defaulting to no cap (same as today's implicit behavior).
- Card and Scratch Card modes are separate future specs; this spec does not attempt to share code with them preemptively (YAGNI — share code later if a real duplication emerges once those are built).
