# Lottery Redesign — Instant Lottery (Scratch Card) + Per-Type Navigation

Status: Approved design. Second of three planned lottery modes (Dedicated Number shipped, this one next, Daily/Bingo-Card to follow as a separate future cycle).

## Context

The lottery product now has four sections — Daily, Instant, Weekly, Monthly — shipped as a flat 6-tab mobile layout (Daily/Instant/Weekly/Monthly/My Tickets/Results) in the prior four-section reorganization. Weekly and Monthly reuse the already-shipped Dedicated Number mechanic (4-digit pick, admin prize tiers, manual/random draw). Daily and Instant were placeholders ("Coming Soon") with no mechanic built yet.

This spec covers two coupled changes:

1. **Navigation restructuring**: replace the flat 6-tab layout with a menu of 4 type cards. Tapping a type opens a dedicated page for that type with its own local sub-tabs (Browse/My Tickets/History), scoped only to that type — not shared across types as before.
2. **Instant Lottery (Scratch Card) mechanic**: an admin-configurable catalog of scratch card products (price + probability-based payout table), bought and resolved instantly with no draw or waiting period, revealed via a scratch gesture on mobile.

Daily Lottery (Bingo/Card-style, matched against a called sequence) remains a separate future spec — its page will continue to show the existing "Coming Soon" placeholder inside the new per-type navigation.

## Goals

- Mobile Lottery page becomes a top-level menu of 4 type cards; each type opens its own page with local Browse/My Tickets/History sub-tabs.
- A standing (non-time-boxed) catalog of scratch card products, admin-created with a price and a payout table.
- Instant, no-admin-action settlement: buying a card immediately rolls an outcome and settles it (cash credit, coupon grant, or no-win) — no separate "declare" step.
- Coupon wins reuse the existing `promo_codes` system (used today for deposit bonuses) rather than building a new reward mechanism.
- Mobile reveal uses a real scratch gesture (drag-to-reveal), not a tap-to-flip.

## Non-goals

- Daily Lottery (Bingo/Card) mechanic — separate future spec, not built here.
- A fixed/finite pool of pre-generated outcomes ("exactly N winners out of 1000 cards") — this uses independent probability rolls per purchase instead, unlimited supply.
- Time-boxed or expiring scratch products — they're a standing catalog, toggled active/inactive by admin, not scheduled.
- New coupon/promo infrastructure — winning a coupon outcome grants an existing, admin-linked `promo_codes` row; no new code-generation or grant-tracking system.

## Data Model

### `lottery_scratch_products` (new)

| column | type | notes |
|---|---|---|
| `id` | UUID | PK |
| `name` | VARCHAR | e.g. "₹10 Lucky Scratch" |
| `price` | NUMERIC | ticket price |
| `payouts` | JSONB | array of `{ outcome: 'cash' \| 'coupon' \| 'no_win', amount?: number, promo_code_id?: uuid, probability: number }` — probabilities across one product's payouts must sum to 100 |
| `is_active` | BOOLEAN | admin toggles to retire a product; no draw_time/expiry |
| `created_at` | TIMESTAMPTZ | |

`amount` is required when `outcome = 'cash'`. `promo_code_id` (FK to the existing `promo_codes` table) is required when `outcome = 'coupon'`.

### `lottery_scratch_tickets` (new)

| column | type | notes |
|---|---|---|
| `id` | UUID | PK |
| `product_id` | UUID | FK to `lottery_scratch_products` |
| `user_id` | UUID | purchaser |
| `outcome` | VARCHAR | `'cash' \| 'coupon' \| 'no_win'` — the rolled result, recorded at purchase time |
| `amount` | NUMERIC | payout amount if `cash`, else 0 |
| `promo_code_id` | UUID, nullable | FK to `promo_codes`, set if `coupon` |
| `created_at` | TIMESTAMPTZ | |

One row per purchase — purchase and result are the same event, unlike Dedicated Number's separate buy/declare split.

## Purchase & Settlement Flow

- `POST /lottery/scratch/buy { product_id }`:
  1. Debit the product's `price` from the player's wallet (same `debitStake` pattern as Dedicated Number).
  2. Roll a random outcome against the product's `payouts` array via cumulative probability.
  3. Settle immediately based on the rolled outcome:
     - `cash` → credit `amount` via the existing `creditPrize` wallet flow (same idempotency-key pattern as Weekly/Monthly wins).
     - `coupon` → look up the linked `promo_codes` row; return its `code` to the player. No new usage-tracking — the existing `/wallet/promo/validate` and deposit-flow usage-limit enforcement apply exactly as they do today when the player later applies it.
     - `no_win` → record the ticket, no payout.
  4. Insert one `lottery_scratch_tickets` row recording the outcome, return the fully-resolved result to the client in one response.
- The mobile scratch gesture is purely presentational: the result is already fully determined by the time the buy response returns. Dragging to "scratch" progressively reveals a result the server already decided — the client is never waiting on a pending outcome.

## Admin Panel

- A new "Instant Lottery" section (a tab within the existing Lottery admin page, alongside Weekly/Monthly draws):
  - **Create Product** form: `name`, `price`, and a repeatable Payouts list (`Form.List`, same pattern as Weekly/Monthly's Prize Tiers) — each row has an Outcome select (Cash/Coupon/No Win), an Amount input (shown only for Cash), a Promo Code select populated from active `promo_codes` (shown only for Coupon), and a Probability % input. Submission validates all payout probabilities for one product sum to exactly 100.
  - **Products table**: name, price, payout summary as tags, active/inactive toggle, and stats (tickets sold, revenue, total paid out, breakdown by outcome).
  - No "Declare Result" step exists for this mechanic — settlement is instant per-purchase, so there's no equivalent admin action.

## Mobile App

### Navigation restructuring

- The Lottery page's top level becomes a menu of 4 type cards: Daily, Instant, Weekly, Monthly.
- Tapping a type opens a dedicated page for that type with local sub-tabs: **Browse / My Tickets / History**, scoped to only that type's activity.
- Weekly/Monthly pages keep the existing Dedicated Number draw-browsing UI (4-digit picker, Quick Pick) inside this new per-type container, with their own local My Tickets/History (no longer shared across all four types as in the just-shipped flat-tab version).
- Daily's page shows the existing "Coming Soon" placeholder.

### Instant Lottery page

- **Browse**: catalog of active scratch products, grouped/sorted by price, each card showing name, price, and a "top prize" teaser (the highest configured `cash` amount in its payout table).
- Tapping a product buys it immediately (`POST /lottery/scratch/buy`), then transitions to a scratch-reveal screen: a custom-painted scratch-off overlay, drag-to-reveal, showing the pre-determined result underneath (cash amount, coupon code, or a "better luck next time" message), with a small celebratory animation on a win.
- **My Tickets**: past scratch purchases for this type only (product name, price, outcome, amount/coupon code, timestamp). Since every purchase resolves immediately, there's no pending/settled distinction to show separately — **History is folded into My Tickets for Instant specifically** (no separate History sub-tab for this type). Weekly/Monthly keep both My Tickets and History as separate sub-tabs, since those retain a meaningful pending-vs-settled distinction.

## Migration

Purely additive: two new tables (`lottery_scratch_products`, `lottery_scratch_tickets`), no changes to `lottery_draws`/`lottery_tickets`/`lottery_draws.category`.

## Open Questions / Deferred

- Daily Lottery's Bingo/Card mechanic — separate future spec, unaffected by this one beyond living in the same new per-type navigation shell.
- Whether an RTP/house-edge sanity check (e.g., warning an admin if a product's expected payout exceeds its price) should be added to the Create Product form — not raised during design; admin is trusted to configure sensible probabilities, same as today's prize-tier configuration for Weekly/Monthly.
- Per-user purchase limits or cooldowns on scratch products — not requested, defaulting to no cap (same as today's lottery/betting features generally).
