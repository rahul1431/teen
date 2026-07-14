# Lottery Redesign — Four-Section Reorganization

Status: Approved design. First of three planned pieces of the lottery expansion (this reorg, then the Daily/Card-Bingo mechanic, then the Instant/Scratch-Card mechanic — built and shipped one at a time).

## Context

The lottery system currently has one shipped mechanic — "Dedicated Number" (4-digit pick-a-number, admin-configured prize tiers, manual or random winning-number generation) — with a flat, uncategorized list of draws on both the admin panel and mobile app.

The product is expanding into four named sections, each pairing a cadence with a mechanic:

1. **Daily Lottery** — Card/Bingo-style mechanic. *Mechanic not yet built* (future spec).
2. **Instant Lottery** — Scratch-Card instant-win mechanic. *Mechanic not yet built* (future spec).
3. **Weekly Lottery** — Dedicated Number mechanic (already built), configured by admin with larger prize tiers and a weekly cadence.
4. **Monthly Lottery** — Dedicated Number mechanic (already built), configured by admin with even larger prize tiers and a monthly cadence.

This document covers only the reorganization: introducing the four-section structure and categorizing draws, so Weekly and Monthly can ship immediately using the existing mechanic while Daily and Instant remain placeholders until their own spec → plan → implementation cycles.

## Goals

- Add a `category` to every lottery draw: `daily | instant | weekly | monthly`.
- Reorganize the mobile Lottery page into four category sections for browsing/buying draws.
- Let admins tag a draw's category when creating it, but only allow creating `weekly`/`monthly` draws until Daily/Instant mechanics exist.
- No new game mechanic, no new settlement logic, no scheduling automation — purely a categorization and UI layer on top of what's already built.

## Non-goals

- Building the Card/Bingo (Daily) or Scratch Card (Instant) mechanics themselves — separate future specs.
- Auto-recurring draw creation (e.g., automatically spawning a new Weekly draw the moment the last one settles) — admin creates each draw manually, as today, just tagged with a category. May be revisited later.
- Splitting "My Tickets" or "Results" into four lists — they stay as single flat lists across all categories (each row can show its category as a small tag).
- Any change to ticket price, prize tier configuration, buy flow, or settlement — all unchanged from the shipped Dedicated Number mode.

## Data Model

### `lottery_draws` (altered)

| column | change |
|---|---|
| `category` | **new**, `VARCHAR(16) NOT NULL`, `CHECK (category IN ('daily','instant','weekly','monthly'))` — no default; every draw must be explicitly categorized at creation. |

No other columns change. Since production currently has zero real lottery draws (prior clean-slate migration + this session's test draws already removed), this is a pure additive migration — no backfill needed.

## Admin Panel

- **Create Draw modal**: new required "Category" field — a `Radio.Group` or `Select` with all four options (`Daily`, `Instant`, `Weekly`, `Monthly`). `Daily` and `Instant` are rendered disabled with a "Coming Soon" tag; only `Weekly` and `Monthly` are selectable. Submits `category` alongside the existing `name`, `ticket_price`, `draw_time`, `prize_tiers`.
- **Draws table**: new "Category" column rendering the draw's category as a colored `Tag` (e.g. Weekly = blue, Monthly = gold).
- Everything else (Declare Result modal, ticket drawer, KPI stats, cancel/refund, delete draw) is unchanged.

## Mobile App

- The Lottery page's top-level tabs change from `Active Draws / My Tickets / Results` to five tabs: **Daily / Instant / Weekly / Monthly / My Tickets / Results** (or a nested structure — top-level `Draws` tab containing four category sub-tabs, plus separate `My Tickets`/`Results` tabs; exact tab layout is an implementation detail for the plan to decide, following existing app navigation patterns).
- Each of the four draw-browsing sections shows only that category's open draws, using the same draw card and 4-digit ticket picker UI already built (no visual changes to the picker itself).
- `Daily` and `Instant` sections show a "Coming Soon" empty-state placeholder (illustration + short copy) since no draws can exist in those categories yet.
- `My Tickets` and `Results` remain single flat lists spanning all categories; each row displays a small category tag so a player can tell which section a ticket/result belongs to.
- The header's total-jackpot figure and next-draw countdown are scoped to the currently active category section (so the numbers shown match what the player is browsing), rather than aggregating across all four categories.

## Migration

- Additive migration: `ALTER TABLE lottery_draws ADD COLUMN category VARCHAR(16) NOT NULL CHECK (category IN ('daily','instant','weekly','monthly'))` — since the table has zero rows in production at this point, no default value or backfill statement is needed. If any rows exist by the time this runs, the plan must add a backfill (e.g. default existing rows to `'weekly'`) before adding the `NOT NULL` constraint.
- No other schema changes. No changes to `lottery_tickets`.

## Open Questions / Deferred

- Whether `Daily`/`Instant` categories should be entirely hidden from the admin Create Draw form (rather than shown-but-disabled) until their mechanics ship — left as an implementation-detail choice for the plan, either is consistent with this spec's intent.
- Exact mobile tab/navigation layout (five flat tabs vs. nested draws-with-sub-tabs) — left to the plan, per note above.
- Auto-recurring draw creation for Weekly/Monthly — explicitly deferred, not part of this spec.
