# PnL Dashboard — Design Spec

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

Sub-project #4 (final) of the bot-management initiative, built on top of #1 (bot pool separation), #2 (per-bot difficulty), and #3 (Ludo training pipeline). This is the "Complete Dashboard of PnL of Users, Bots, History" from the original request, scoped to Teen Patti and Ludo per the established sequence.

Existing relevant data: `game_participants` (`prize_won`, `entry_fee_deducted`, `is_bot`, `room_id`, `user_id`), `game_rooms` (`entry_fee`, `platform_fee_collected`, `game_type`, `started_at`), `wallet_transactions` (`type`, `amount`, `user_id`, `created_at` — `type IN ('deposit','withdrawal','game_credit','game_debit','bonus','referral','transfer','manual_credit','manual_debit')`), and `users` (`is_bot`, `preferred_game_type`).

A gap was found during design: a bot's initial wallet funding (`POST /api/admin/bots`) is written directly to `wallets.real_balance` and never logged as a `wallet_transactions` row — only later top-ups (auto-refill, manual "Allot Balance") are logged via `type = 'manual_credit'`. This makes "total capital invested in a bot" unreconstructable for the initial amount. Confirmed with the user: fix going forward (log initial funding too), accept that existing bots' true original investment isn't recoverable retroactively.

## Goal

A per-game "Analytics" tab (Teen Patti, Ludo) showing: house PnL summary, real-users-vs-bots PnL breakdown, a daily trend chart, a bot bankroll ROI view, a top winners/losers leaderboard, and a paginated game-history table — all filterable by date range.

## Non-Goals

- No changes to Aviator/Matka (out of scope, consistent with #1-#3).
- No changes to real-money wallet mechanics beyond the one additive logging fix described above.
- Not a general-purpose BI tool — scoped exactly to the six views below, no ad-hoc query builder.

## Design

### 1. Schema fix: log initial bot funding

In `services/admin-service/src/index.ts`'s `POST /api/admin/bots` (already modified in sub-project #1 to accept `preferred_game_type`), add a `wallet_transactions` insert alongside the existing `wallets` insert, in the same transaction:

```sql
INSERT INTO wallet_transactions
  (user_id, type, wallet_type, amount, balance_before, balance_after, idempotency_key, status, description)
VALUES ($1, 'manual_credit', 'real', $2, 0, $2, $3, 'completed', 'Initial bot funding')
```

(`$1` = new bot's id, `$2` = `initial_balance`, `$3` = an idempotency key derived from the bot id, e.g. `` `initial-fund:${botId}` ``.)

### 2. API: `GET /api/admin/games/:gameType/pnl-dashboard`

New admin-service route, `requireRole('finance')` (matching the existing Aviator PnL endpoint's role gate), `:gameType` restricted to `teen_patti`/`ludo` (400 otherwise). Query params: `from`, `to` (ISO dates, default last 7 days).

Returns one JSON payload combining all six views (a single round trip, since the admin panel will render them together on one tab):

```typescript
{
  summary: { total_wagered: number, total_paid_out: number, net_rake: number },
  breakdown: {
    real: { total_wagered: number, total_paid_out: number, net_pnl: number },
    bot:  { total_wagered: number, total_paid_out: number, net_pnl: number },
  },
  daily_trend: Array<{ date: string, wagered: number, paid_out: number, rake: number }>,
  bot_roi: { total_invested: number, current_balance: number, net_realized_pnl: number, roi_pct: number },
  leaderboard: Array<{ user_id: string, username: string, is_bot: boolean, net_pnl: number, games_played: number }>,
  history: { rows: Array<{ room_id: string, started_at: string, players: number, pot: number, rake: number }>, total: number },
}
```

**Query logic per section:**

- `summary`/`breakdown`: aggregate `game_participants.prize_won - game_participants.entry_fee_deducted` (per-participant net) joined to `game_rooms` filtered by `game_type` and `started_at` in range, grouped by nothing (summary) or by `is_bot` (breakdown). `net_rake` = `SUM(game_rooms.platform_fee_collected)` for rooms in range (deduplicated per room, not per participant).
- `daily_trend`: same join, `GROUP BY date_trunc('day', gr.started_at)`.
- `bot_roi`: `total_invested` = `SUM(wallet_transactions.amount) WHERE type = 'manual_credit' AND user_id IN (bots with preferred_game_type = :gameType)` (now complete going forward per the schema fix); `current_balance` = `SUM(wallets.real_balance)` for the same bot set; `net_realized_pnl` = the `bot` side of `breakdown` above, not date-range-limited (ROI is all-time by nature, independent of the dashboard's date filter — this section ignores `from`/`to`); `roi_pct` = `net_realized_pnl / total_invested * 100` (0 when `total_invested` is 0, avoiding divide-by-zero).
- `leaderboard`: same per-participant net PnL, `GROUP BY user_id`, `ORDER BY net_pnl` (top and bottom N, e.g. 10 each), within the date range.
- `history`: paginated `game_rooms` rows in range (`limit`/`offset` query params added alongside `from`/`to`), most recent first.

### 3. Admin panel UI

New third `Tabs` item (`key: 'analytics'`, label `'Analytics'`) on both `TeenPatti.tsx` and `Ludo.tsx`, alongside the existing `'overview'` and `'bots'` tabs added in sub-projects #1/#2. A new component, `admin-panel/src/components/GamePnlDashboard.tsx`, taking `gameType: string`, rendering:

- A date-range `Select`/`DatePicker.RangePicker` at the top (default last 7 days), driving a single re-fetch of the combined endpoint.
- 3 stat cards: House Net Rake, Real Users PnL, Bot PnL (colored per sign, reusing `tokens.color.success`/`error` from the admin-panel redesign's theme).
- A line chart (daily trend — wagered/paid-out/rake), using whatever charting library `Dashboard.tsx`'s existing `SVGLineChart` component already provides (reused, not reinvented, per the established pattern in that file).
- A bot ROI card: invested, current balance, realized PnL, ROI% (not affected by the date-range picker, per section 2's ROI semantics — labeled "All-Time" to avoid confusion with the date-scoped cards next to it).
- A leaderboard `Table` (top winners/losers, username + is_bot tag + net PnL + games played).
- A paginated history `Table` (room id, started at, players, pot, rake).

### 4. Testing

- `admin-service`: unit-style tests (following this codebase's `pool.query.mockImplementation` pattern used elsewhere in this session's work) for the combined endpoint's SQL construction — specifically the `bot_roi` divide-by-zero guard and the `breakdown`'s `is_bot` grouping.
- `admin-panel`: manual verification only (established preference this session), confirmed live on the VPS.
- The initial-funding logging fix: a small addition to whatever test coverage (if any) already exists for `POST /api/admin/bots` — confirmed at implementation time whether such coverage exists to extend, or whether this is verified manually like the rest of that route has been throughout this session.

## Risks / Open Questions

- `bot_roi`'s `total_invested` is incomplete for every bot created before this sub-project ships (their initial funding predates the logging fix) — the dashboard will visibly under-report invested capital for those bots, over-stating ROI%. This is disclosed in the UI via the "All-Time" label and is an accepted, known limitation rather than a bug to chase further.
- The combined single-endpoint design means one slow section (e.g. a large `history` page) delays the whole tab's render — acceptable at current data volumes (established earlier in this session: modest game counts), revisit if it becomes a real bottleneck.
