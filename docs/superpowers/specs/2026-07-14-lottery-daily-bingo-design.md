# Lottery Redesign — Daily Lottery (90-Ball Bingo)

Status: Approved design. Third and final planned lottery mode (Dedicated Number and Instant/Scratch Card already shipped).

## Context

The lottery product has four sections — Daily, Instant, Weekly, Monthly. Weekly/Monthly reuse the Dedicated Number mechanic; Instant uses the Scratch Card mechanic (both shipped). Daily has been a "Coming Soon" placeholder since the four-section reorganization, reserved for a Bingo-style mechanic. This spec covers that mechanic.

## Goals

- A live-paced, 90-ball UK-bingo-style draw: admin creates a draw with a scheduled start time; players buy tickets (auto-generated cards) beforehand; at the scheduled time, numbers are called one at a time over a live WebSocket channel until any ticket completes Full House (or all 90 are called, whichever first); tickets that complete a pattern win automatically.
- Standard three-tier win structure (One Line, Two Lines, Full House), admin-configurable multipliers per draw, same `prize_tiers` shape convention as Weekly/Monthly.
- No racing/claiming: every ticket that completes a pattern by the time calling stops wins that tier, automatically, cumulatively (a Full House winner also collects the One Line and Two Lines prizes it passed through).
- A dedicated `/ws/bingo` WebSocket channel (mirroring the existing Aviator precedent: its own nginx location, its own mobile-side socket singleton) delivers live number calls.

## Non-goals

- Player choice of card — cards are always server-generated at purchase time (a valid 90-ball card has a fixed number distribution per row, not freely pickable like Dedicated Number's digits).
- First-to-complete "claim" mechanics — no racing, no tie-breaking logic; every qualifying ticket wins regardless of when during the draw it completed (multiple tickets can complete Full House on the same call).
- Sharing code with Weekly/Monthly's `settleLottery`/digit-tier-matching or Scratch Card's `rollOutcome` — this mechanic's win-checking (matching a card's numbers against a growing called-numbers list) is structurally different enough to warrant its own settlement logic.
- Auto-recurring daily draw creation — admin creates each day's draw manually, same as Weekly/Monthly today.

## Design Correction (post-launch verification, 2026-07-14)

The original design called ALL 90 numbers every draw with no early stop, reasoning it gave "every ticket a full, fair shot at Full House." Live end-to-end verification against production revealed this was a critical error: since every card's 15 numbers are necessarily a subset of the full 1-90 pool, calling all 90 numbers guarantees EVERY ticket eventually completes Full House, with 100% certainty — not a probability. Combined with cumulative tier payouts, this meant the house would pay out the full multiplier sum (e.g. 120x ticket price) to every single buyer, every single draw, with no exceptions — a guaranteed, unbounded loss, not a lottery.

Fixed: calling now stops the instant any ticket completes Full House (checked after every number call), with the 90-number mark remaining only as a fallback ceiling for the rare case where nobody ever completes one. This restores genuine chance/variance to the tier payouts — most tickets will not reach Full House, matching how real bingo halls actually work (calling stops the moment someone wins).

## Data Model

### `lottery_bingo_draws` (new)

| column | type | notes |
|---|---|---|
| `id` | UUID | PK |
| `name` | VARCHAR | |
| `ticket_price` | NUMERIC | |
| `draw_time` | TIMESTAMPTZ | when calling begins; ticket sales close at this point |
| `status` | VARCHAR | `'open' \| 'calling' \| 'settled' \| 'cancelled'` |
| `prize_tiers` | JSONB | `{ match_type: 'one_line' \| 'two_lines' \| 'full_house', multiplier: number }[]` |
| `called_numbers` | JSONB | array of numbers called so far, appended to live during calling; lets a reconnecting client catch up via REST before switching to the live WS stream |
| `created_at` | TIMESTAMPTZ | |

### `lottery_bingo_tickets` (new)

| column | type | notes |
|---|---|---|
| `id` | UUID | PK |
| `draw_id` | UUID | FK |
| `user_id` | UUID | FK |
| `card` | JSONB | the 3×9 grid (15 numbers + blanks), generated at purchase time |
| `tiers_won` | JSONB | array of match_types this ticket achieved, e.g. `['one_line', 'two_lines']` — appended to as calling progresses |
| `prize` | NUMERIC | sum of `ticket_price × multiplier` across every tier in `tiers_won`, computed at settlement |
| `created_at` | TIMESTAMPTZ | |

## Purchase, Live Calling & Settlement Flow

- Ticket purchase (any time before `draw_time`, multiple tickets per player allowed): debit `ticket_price`, generate a valid random 3×9 card server-side, insert the ticket row, return the card to the player immediately.
- At `draw_time`, a backend scheduler flips the draw to `status: 'calling'`, shuffles the numbers 1-90, and calls one every 3-4 seconds:
  - Each call appends the number to `called_numbers` in the DB and broadcasts it over `/ws/bingo` to every client connected to that draw.
  - After each call, the server checks every ticket in the draw for newly-completed tiers (comparing `card` against `called_numbers` so far) and appends any newly-reached match_type to that ticket's `tiers_won`.
- Once all 90 numbers are called, the draw flips to `status: 'settled'`: for every ticket, `prize = ticket_price × Σ(multiplier for each tier in tiers_won)`, credited via the existing `creditPrize` wallet flow (same idempotency-key pattern as Weekly/Monthly), then a final "draw complete" message broadcasts over `/ws/bingo`.

## Admin Panel

- New "Daily Lottery" tab alongside the existing "Weekly & Monthly Draws" and "Instant Lottery" tabs.
- **Create Draw** form: `name`, `ticket_price`, `draw_time`, and a repeatable Prize Tiers list (One Line / Two Lines / Full House, each with a multiplier) — same `Form.List` pattern as Weekly/Monthly.
- **Draws table**: status, tickets sold, revenue, prizes paid, called-numbers progress (e.g. "42/90 called").
- No "Declare Result" modal — settlement is fully automatic once `draw_time` arrives and all 90 numbers finish calling. The only manual admin lever is creating a draw (and cancelling/refunding one before it starts, mirroring the existing cancel-draw pattern used elsewhere).

## Mobile App

- Tapping "Daily Lottery" on the Lottery landing menu replaces the current "Coming Soon" placeholder with a dedicated page: local **Browse / My Tickets / History** sub-tabs, matching the Weekly/Monthly page's structure.
- **Browse**: shows the next open draw (name, price, prize tiers, countdown to `draw_time`); buying instantly shows the newly-generated card.
- **Live Draw screen**: opens automatically when `draw_time` arrives (or manually beforehand to wait). Connects to `/ws/bingo` for the draw, fetches `called_numbers` via REST first to catch up if joining mid-draw, then listens live. Shows all of the player's cards for that draw side-by-side, marks off matched numbers in real time, and celebrates newly-completed tiers.
- **My Tickets**: past tickets (card, tiers won, prize).
- **History**: past settled draws, matching the Weekly/Monthly History pattern.

## WebSocket Channel

- New dedicated endpoint `/ws/bingo`, following the existing Aviator precedent rather than the shared Teen Patti/Ludo `/ws` gateway (a scheduled, self-contained draw doesn't fit that gateway's matchmaking/room model).
- Requires: a new backend WS server (mirroring `services/game-engines/aviator`'s structure), a new nginx `location /ws/bingo` block with the same Upgrade/Connection header handling already used for `/ws/aviator` (known pitfall: must include `proxy_pass_header Upgrade`), and a new mobile-side `BingoSocketService` singleton mirroring `AviatorSocketService`.
- Messages: number-called events, tier-completed events (per-ticket), and a final draw-complete event. Auth at handshake via the same JWT-in-query-param pattern as existing WS channels.

## Migration

Purely additive: two new tables (`lottery_bingo_draws`, `lottery_bingo_tickets`), no changes to any existing lottery tables.

## Open Questions / Deferred

- Whether a draw with zero tickets sold should still run its full calling sequence or auto-cancel — not raised during design; default to running normally (matches "no special-casing" precedent from other mechanics), can revisit if it proves wasteful in practice.
- Whether admins should be able to pause/intervene mid-calling — not requested; the only admin lever is pre-draw creation/cancellation.
