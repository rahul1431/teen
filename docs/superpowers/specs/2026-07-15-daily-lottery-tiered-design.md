# Lottery Redesign — Daily Lottery (Tier-Based Pick 4-Digit)

Status: Approved design. Replaces Bingo-style Daily Lottery with tier-based pick-4-digit format.

## Context

Daily Lottery currently uses 90-ball Bingo (scheduled draws, live calling). Player engagement is low due to:
- Waiting for scheduled draws (friction vs instant play)
- Complex participation flow (live watching, pattern matching)
- Volatile payouts (some draws no winners, some all-winners)

Weekly/Monthly Lotteries (pick 4-digit number) perform well. This spec adapts that proven format to Daily with:
- **Multiple price tiers** (10rs, 50rs, 100rs, etc.) for accessibility and revenue
- **Hybrid outcomes** (Cash + Coupon) matching Instant Lottery's engagement model
- **Configurable draw time per tier** (not fixed to 8 PM)
- **Automatic settlement** like Weekly/Monthly

## Goals

- Replace Bingo with a proven, simpler mechanic (4-digit number pick)
- Daily frequency + multiple tiers = higher engagement than current single-tier Weekly/Monthly
- Mixed outcomes (cash/coupon) = retention even on no-win tiers
- Admin-configurable tier structure = easy profitability tuning per tier

## Non-goals

- Player choice of card or live calling (Weekly/Monthly proved pick-a-number works)
- Real-world draw integration (random generation is default, manual override available)
- Recurring automatic tier creation (admins create tiers once, reuse for daily draws)

## Data Model

### `lottery_daily_tiers` (new)

Defines available price points and their draw schedule. Admin creates these once; daily draws reference them.

| column | type | notes |
|---|---|---|
| `id` | UUID | PK |
| `amount` | INTEGER | ticket price in rupees (10, 50, 100, etc.) |
| `draw_time` | TIME | time of day for draws (e.g., '20:00:00' for 8 PM); all draws on this tier happen at this time daily |
| `default_prize_tiers` | JSONB | default prize tiers config, copied to new draws when auto-created; same schema as `lottery_daily_draws.prize_tiers` |
| `status` | VARCHAR | 'active' \| 'paused' \| 'archived' |
| `created_at` | TIMESTAMPTZ | |

### `lottery_daily_draws` (new)

One row per tier per day. Auto-created by scheduler at start of day, or manually created by admin for backdated draws.

| column | type | notes |
|---|---|---|
| `id` | UUID | PK |
| `tier_id` | UUID | FK to lottery_daily_tiers |
| `draw_date` | DATE | date of the draw (YYYY-MM-DD); uniqueness enforced per tier per day |
| `draw_time` | TIMESTAMPTZ | exact timestamp when draw occurs (computed from tier.draw_time + draw_date) |
| `status` | VARCHAR | 'open' \| 'calling' \| 'settled' \| 'cancelled' |
| `winning_number` | CHAR(4) | the drawn 4-digit number; null until draw is settled |
| `prize_tiers` | JSONB | array of `{ match_type: 'last_1' \| 'last_2' \| 'last_3' \| 'exact', outcome_type: 'cash' \| 'coupon', multiplier?: number, coupon_code?: string }` |
| `created_at` | TIMESTAMPTZ | |

### `lottery_daily_tickets` (new)

| column | type | notes |
|---|---|---|
| `id` | UUID | PK |
| `draw_id` | UUID | FK to lottery_daily_draws |
| `user_id` | UUID | FK |
| `ticket_number` | CHAR(4) | player's chosen 4-digit number, `CHECK (ticket_number ~ '^[0-9]{4}$')` |
| `match_type` | VARCHAR | tier matched: 'last_1' \| 'last_2' \| 'last_3' \| 'exact' \| null (no match) |
| `outcome_type` | VARCHAR | 'cash' \| 'coupon' \| 'none' |
| `prize` | NUMERIC | amount won (if outcome_type='cash'); null for coupon/none |
| `coupon_id` | UUID | FK to coupons table if outcome is coupon; null otherwise |
| `created_at` | TIMESTAMPTZ | |

**Constraints:**
- `UNIQUE(draw_id, ticket_number)` — first-come-first-served number registration per draw
- `CHECK ((outcome_type = 'cash' AND prize IS NOT NULL) OR (outcome_type != 'cash'))` — cash wins must have a prize value

## Purchase, Draw & Settlement Flow

### Purchase (Mobile)

- Player taps "Daily Lottery" on Lottery landing
- Sees Browse tab: list of active tiers (10rs, 50rs, 100rs), next draw time for each, prize structure
- Picks a tier, taps "Buy Ticket"
- 4-box OTP-style input (or Quick Pick 🎲 for random number) — same UX as Weekly/Monthly
- Server validates: exactly 4 digits, not already taken for this draw, sufficient wallet balance
- Debit `tier.amount`, insert ticket row, return ticket_number immediately
- Player can buy multiple tickets in same draw (same number restrictions)

### Scheduled Draw (Backend)

Each day, for each active tier:
1. **At start of day (00:00):** Scheduler creates `lottery_daily_draws` row for today if it doesn't exist
   - `draw_date = today`, `draw_time = today at tier.draw_time`, `status = 'open'`
   - `prize_tiers` copied from tier's current config (if admin changes tier config later, new draws use new config; existing draws unchanged)

2. **At tier.draw_time:** Scheduler flips draw to `status: 'calling'`
   - Generates random 4-digit number (or admin has pre-declared it via admin panel)
   - Stores as `winning_number`

3. **Settlement (immediate):** For every ticket in the draw:
   - Compare `ticket_number` against `winning_number` using match-tier logic:
     - **Exact:** all 4 digits match → check if `exact` tier exists in `prize_tiers`
     - **Last 3:** last 3 digits match → check if `last_3` tier exists
     - **Last 2:** last 2 digits match → check if `last_2` tier exists
     - **Last 1:** last digit matches → check if `last_1` tier exists
     - **No match:** set `match_type = null`, `outcome_type = 'none'`
   - Use **highest matching tier only** (if exact matches, don't also apply last_3; one outcome per ticket)
   - For matched tier: read `outcome_type` from `prize_tiers` config
     - If `'cash'`: set `prize = ticket_price × tier.multiplier`, `outcome_type = 'cash'`
     - If `'coupon'`: set `coupon_id`, `outcome_type = 'coupon'` (no prize)
   - Flips draw to `status: 'settled'`

4. **Payouts (immediate):**
   - Cash winners: credit via existing `creditPrize` wallet flow (same idempotency-key pattern as Weekly/Monthly), send notification
   - Coupon winners: add coupon to user account via coupon system, send notification
   - No-win tickets: no action (may send "better luck tomorrow" message, optional)

### Admin-Declared Result (Optional)

For draws tied to external events, admin can override random generation:
- Opens "Declare Result" modal for a draw (before or at draw_time)
- Enters 4-digit winning number manually
- Draws settlement proceeds normally

## Admin Panel

### Tier Management

- **Daily Lottery > Tiers** tab
- Table showing active/paused/archived tiers (amount, draw_time, status)
- **Create Tier** button: modal with fields:
  - `amount` (numeric input, rupees)
  - `draw_time` (time picker, e.g., "20:00")
  - **Default Prize Tiers** (repeatable list):
    - Match Type dropdown (Last 1 / Last 2 / Last 3 / Exact)
    - Outcome Type toggle (Cash / Coupon)
    - Multiplier input (if Cash)
    - Coupon Code selector (if Coupon)
  - `status` (toggle: Active/Paused)
- **Edit Tier** button: same fields, draw_time or status changes apply to future draws only
- **Delete Tier:** archive only (soft delete), keeps historical data intact

### Create Daily Draw

- **Daily Lottery > Draws** tab
- Button: **"Create Draw"** (rarely used — scheduler auto-creates; admin uses this for backdated/makeup draws)
- Modal:
  - Tier selector (dropdown of active tiers)
  - Draw date (date picker, defaults to today)
  - Prize Tiers section: repeatable list with:
    - Match Type dropdown (Last 1 / Last 2 / Last 3 / Exact)
    - Outcome Type toggle (Cash / Coupon)
    - Multiplier input (if Cash)
    - Coupon Code selector (if Coupon) — or create new coupon inline
    - Pre-filled with tier's `default_prize_tiers`; admin can edit before creating
  - Submit creates draw with status='open', ready for settlement at scheduled time

### Draws Table

- Columns: Tier Amount, Draw Date, Draw Time, Status, Tickets Sold, Revenue, Prizes Paid, Actions
- **Actions:** 
  - View Tickets (drawer showing all tickets, their numbers, and outcomes post-settlement)
  - Declare Result (if status='open' and draw_time has passed, allows manual override before settlement)
  - Cancel (refunds all tickets, flips status to 'cancelled')
  - Delete (soft-delete historical draws, optional)
- Filters: tier, date range, status

### KPI Dashboard (Summary)

- Total tiers active
- Today's draws (upcoming, in-progress, settled)
- Revenue today (sum across all tiers)
- Tickets sold today (sum across all tiers)
- Prizes paid today (sum across all tiers)
- Tier breakdown (small table: 10rs — tickets, revenue, prizes; 50rs — tickets, revenue, prizes; etc.)

## Mobile App

### Daily Lottery Landing

Replaces "Daily Lottery: Coming Soon" with three tabs: **Browse** / **My Tickets** / **History**

#### Browse Tab

- List of all active tiers, each as a card:
  - Tier amount (e.g., "10rs")
  - Next draw time (e.g., "8:00 PM today" or "8:00 PM tomorrow")
  - Countdown timer to next draw
  - Prize structure: tiers shown as badges (e.g., "Exact: 50x", "Last 3: 10x", "Last 1: Coupon")
  - "Buy Ticket" button
- Tap "Buy Ticket" → **Buy Flow**:
  - Show tier name, ticket price, next draw time, available tickets count
  - 4-box OTP input or "Quick Pick 🎲" button
  - "Buy" button (deducts balance, shows confirmation)
  - Returns to Browse, ticket appears in "My Tickets"

#### My Tickets Tab

- List of tickets from open/in-progress draws (grouped by tier)
- Each ticket shows: tier, number, draw countdown, status (pending/won/lost)
- Tap ticket → drawer showing full details: number, all prize tiers, potential winnings breakdown

#### History Tab

- List of settled draws (grouped by tier and date)
- Each draw shows: tier, date, winning number, your tickets and outcomes (won cash/coupon/lost)
- Tap draw → drawer showing all results, your prize breakdown

### Live Settlement (Optional)

- If user is viewing an open draw at the moment it settles (draw_time arrives), app receives settlement event (via push notification or polling)
- Ticket updates live to show outcome
- Celebratory toast/notification if won

## Scheduler Implementation

**Timezone:** Use server's configured timezone for all `draw_time` comparisons and daily 00:00 tick.

**Create Draws Daily:**
- At 00:00 UTC (or server TZ), for each active tier, create `lottery_daily_draws` row if not already present:
  ```
  INSERT INTO lottery_daily_draws (tier_id, draw_date, draw_time, status, prize_tiers)
  SELECT id, CURRENT_DATE, CURRENT_TIMESTAMP + (draw_time AT TIME ZONE 'UTC'), 'open', default_prize_tiers
  FROM lottery_daily_tiers WHERE status = 'active'
  ON CONFLICT (tier_id, draw_date) DO NOTHING
  ```
  (Copies tier's `default_prize_tiers` to the new draw; admin can edit before settlement if needed)

**Settle Draws:**
- Every tier has its own draw_time. At that moment (checked every 30–60 seconds or via cron), for any draws in 'calling' status:
  1. If `winning_number` is null, generate random 4-digit number
  2. Check all tickets, set match_type/outcome_type/prize/coupon_id
  3. Flip status to 'settled'
  4. Credit winners (wallet + coupon system)

## Data Migration

Additive only: three new tables (`lottery_daily_tiers`, `lottery_daily_draws`, `lottery_daily_tickets`). No changes to existing lottery tables.

**Removal of Bingo:**
- Drop `lottery_bingo_draws`, `lottery_bingo_tickets` tables
- Remove `lottery_bingo_page.dart` from mobile
- Remove `LotteryBingo.tsx` from admin panel
- Remove `/ws/bingo` WebSocket channel and bingo-engine service
- Update lottery landing page to show Daily Lottery as tiered pick-4-digit (not Bingo)

## Open Questions / Deferred

- Should there be a player cap per tier (max tickets per user per draw)? Default: no cap (same as Weekly/Monthly today).
- Should coupons have an expiration? Default: follow existing coupon system (configurable per coupon, no special rules here).
- Should admin be able to pause a tier mid-day? Default: only pause applies to future draws, today's draw proceeds if already open.
- Should we auto-archive tiers after X days of no tickets? Default: no (manual admin decision).
