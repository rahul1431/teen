# Lottery Betting — Mobile

## Screen structure

`mobile/lib/features/games/betting/lottery_page.dart` is a static top-level menu with four cards: **Daily Lottery**, **Instant Lottery** (scratch cards), **Weekly Lottery**, **Monthly Lottery**. Daily/Weekly/Monthly all navigate to the same widget, `LotteryDrawsPage(category: 'daily'|'weekly'|'monthly', title: ...)` (`lottery_page.dart:74-114`); Instant navigates to `LotteryScratchPage`.

## `LotteryDrawsPage` (`lottery_draws_page.dart`) — the real, connected draws/tickets/history UI

Three tabs (Browse / My Tickets / History) backed by:
- `GET /api/betting/lottery/draws` (Browse, `:60`)
- `GET /api/betting/lottery/my-tickets` (My Tickets, `:83`)
- `GET /api/betting/lottery/results` (History, `:98`)

These are the correct, real backend routes (`services/core-api-service/src/plugins/betting.ts:74-135`) — the plumbing is sound. What's broken is the response-shape assumption layered on top of it, described next.

### New finding — the category/prize_tiers mismatch makes every Browse tab permanently empty

**Severity: High.** Full backend-side evidence and the schema citation are in `backend.md`; this is the client-side half.

`_loadDraws()` (`:57-70`) fetches all open draws and then filters:
```dart
_draws = all.where((d) => d['category'] == widget.category).toList();
```
(`lottery_draws_page.dart:64`). But `GET /api/betting/lottery/draws` returns `lottery_draws.*` plus `reserved_tickets`/`ticket_count` (`betting.ts:74-86`) — there is no `category` column on `lottery_draws` at all (`infra/db/migrations/009_betting_games.sql:66-76`), so `d['category']` is always `null`, and `null == 'daily'` (or `'weekly'`/`'monthly'`) is always `false`. **Every draw, for every category, is filtered out of every Browse tab, unconditionally** — the screen falls through to its "No draws open right now" empty state (`:363-390`) regardless of how many open draws actually exist server-side. The same filter-by-nonexistent-field pattern repeats in `_loadMyTickets()` (`:87`, filters on `t['draw_category']`, also absent from the ticket-join response) and `_loadResults()` (`:102`, filters on `d['category']` again) — so **all three tabs**, for all three lottery categories, are permanently empty in the shipped app, independent of backend state. A player can still reach the ticket-purchase flow only via the bottom sheet triggered from a draw card (`_showTicketPicker`, `:634-651`) — but since `_draws` is always empty, no draw card is ever rendered, so **the purchase flow is unreachable through this screen for any category**.

The same root cause also breaks the jackpot header: `_totalJackpot` (`:110-119`) and each `_drawCard`'s `maxPrize` (`:404-412`) both look for `d['prize_tiers']` — an array of `{match_type, multiplier}` objects — and specifically an entry with `match_type == 'exact'`. The backend has no `prize_tiers` concept; `lottery_draws` has a single scalar `prize_multiplier` column, never returned as a tiered array under any key. `tiers` is therefore always `[]`, `exactTier` is always `{}`, `mult` is always `0`, and the advertised jackpot is always `₹0` / renders as "No Active Draws" (`:283`) even on a build where the category filter above is fixed and draws do come through.

Net effect: this is the single largest functional gap in the lottery feature as shipped — the primary "buy a numbered lottery ticket" flow that CLAUDE.md and the admin panel both treat as the core lottery product is not reachable by any player through the app in its current state, for any of the three category tabs. See `docs/Bugs/lottery-mobile-category-tiers-schema-mismatch.md`.

### Client-side validation on ticket purchase (`_TicketPickerSheet`, `:1042-1417`)

- Four separate single-digit `TextField`s, `digitsOnly` input formatter, auto-advance focus — hardcodes a **4-digit numeric-only** ticket format (`_submit`'s regex `^[0-9]{4}$`, `:1108`) regardless of what a given draw's `digits` column actually specifies (a draw created with `digits: 8` per the admin default, or any non-4 value, cannot be bought correctly through this picker — the UI only ever renders 4 boxes, `for (var i = 0; i < 4; i++)`, `:1306`). This mismatch is moot today only because the Browse tab never renders any draw to tap on the first place (see above); it becomes a live compatibility bug the moment that filtering issue is fixed and non-4-digit draws exist.
- "Quick Pick" (`:1094-1104`) draws a client-side `math.Random()` 4-digit number (not `crypto`-secure — a real-money-adjacent UX nicety with no fairness stake, since the player still explicitly buys whatever gets filled in, so this is not a fairness issue, just worth noting it's a different RNG source than anything server-side).
- Client-side dup check against `_reserved` (from `reserved_tickets` in the draw payload, `:1079-1085`) before submitting — a genuine UX nicety, but purely advisory: the authoritative check is the backend's pre-check-then-insert described in `backend.md`, which itself is racy (`docs/Bugs/lottery-ticket-number-race-no-unique-constraint.md`).
- Balance check against the locally-cached `_balance` (loaded once via `GET /api/wallet/balance`, `:72-78`, refreshed after purchase) before allowing submit — again advisory; the authoritative balance check happens server-side inside `debitStake`.
- The "Confirm Purchase" button is disabled the instant `_submit()` starts (`_submitting` flips to `true` synchronously before the `await`, `:1122-1125`), which does at least prevent an accidental double-tap causing two purchase requests from a single UI interaction — the Teen Patti tip flow lacked even this client-side guard until its idempotency fix (2026-07-28) added a server-side debounce lock; this lottery button-disable guard still doesn't protect against a dropped-response client/network retry duplicating the request underneath the same button state.

## `LotteryScratchPage` — no backend at all

`lottery_scratch_page.dart` calls `GET /api/betting/lottery/scratch/products` (`:49`) and `GET /api/betting/lottery/scratch/my-tickets` (`:68`) — neither route, nor any `scratch`-prefixed table, exists anywhere in `core-api-service` or the DB migrations. Both calls fail and are swallowed by an empty `catch`, leaving the screen permanently in its loading-then-empty state. Already filed: `docs/Bugs/betting-mobile-routes-missing-on-backend.md` (this file is one of the two cited entry points for that bug, alongside `matka_page.dart`'s chart route) — not re-filed here.

## Dead code — `LotteryDailyService`

`mobile/lib/shared/services/lottery_daily_service.dart` defines a `LotteryDailyService` class wrapping six calls: `GET /api/betting/lottery/daily/tiers`, `GET .../daily/draws`, `GET .../daily/draws/:id`, `POST .../daily/buy`, `GET .../daily/my-tickets`, `GET .../daily/history`. None of these `/daily/*` routes exist on the backend (the real routes are the unprefixed `/lottery/draws`, `/lottery/buy`, etc., described above) — but this is moot in practice because `LotteryDailyService` is never instantiated anywhere in `mobile/lib` (grepped for `LotteryDailyService` outside its own definition file: no matches). It reads as an abandoned first attempt at the Daily Lottery flow, superseded by `LotteryDrawsPage` calling the real endpoints directly, with the old service class left behind. Not user-facing (nothing constructs it), so not filed as a standalone bug — noted here only so a future reader doesn't mistake it for a second live code path.

## `BettingHistoryPage(type: BettingType.lottery)` — correctly wired, but unreachable

`betting_history_page.dart` supports a `BettingType.lottery` case (`_endpoint` → `/api/betting/lottery/my-tickets`, `_key` → `'tickets'`) that is implemented correctly and hits the right endpoint — but the only call site for `BettingHistoryPage` in the entire mobile app is `matka_page.dart:174`, always constructed with `BettingType.matka`. Nothing in the lottery flow ever pushes `BettingHistoryPage(type: BettingType.lottery)`; the "My Tickets" tab inside `LotteryDrawsPage` (see above) serves that purpose instead. Harmless dead branch, not filed as a bug.
