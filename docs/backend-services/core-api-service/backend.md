# core-api-service — Backend (service-level index)

Six plugins registered in `services/core-api-service/src/index.ts`. Five have dedicated feature docs elsewhere in this project — this file summarizes those and links out, then covers `betting.ts` (matka/lottery/cricket) in full, since no `docs/games/{cricket,lottery,matka}/backend.md` exists yet (all three are empty placeholders as of this pass).

## Auth — `plugins/auth.ts` + `helpers/otp.ts`

Phone+OTP register/login, refresh/logout, OTP-gated password reset. Full detail: `docs/app/auth/backend.md`. Headline risk already filed: `docs/Bugs/otp-dev-mode-master-code-bypass.md` (the `MASTER_OTP` '123456' bypass, live whenever `OTP_PROVIDER !== 'msg91'`).

## Users / Profile — `plugins/users.ts`

Profile CRUD, avatar upload, bank details, KYC submission are covered in `docs/app/profile/backend.md`; referral stats (`GET /users/referrals/my-stats`) in `docs/app/referral/backend.md`; the public banners feed (`GET /users/banners`) in `docs/app/home/backend.md`. Not covered elsewhere, so detailed here:

- **`GET /users/:id/profile`** (no auth) — public profile card for any non-bot user: username, avatar, non-bot `total_games`/`total_winnings`. Used for viewing another player's profile (e.g. from a leaderboard entry or friend list).
- **`GET /users/search`** (auth) — `?q=` must be ≥2 chars, `ILIKE '%q%'` against `username`, excludes bots, `LIMIT 20`. No rate limiting beyond the process-wide 200 req/min, so it's a cheap enumeration vector for usernames but returns no PII beyond avatar.
- **`GET /users/daily-bonus/status`** / **`POST /users/daily-bonus/claim`** (auth) — login-streak bonus, config-driven from `login_bonus_config` (admin-managed, see `docs/admin-panel/daily-bonus/backend.md` for the admin side). `status` computes `can_claim` from whether `last_claimed_date` (from `user_login_streaks`) equals today, and resets `current_streak` to 0 if the last claim was before yesterday (streak broken). `claim` row-locks the streak row (`FOR UPDATE`), re-derives the same "broken" logic, upserts the streak, inserts a `bonuses` row (`type: 'daily_login'`, 30-day wagering expiry), and only then calls `wallet-service`'s `/internal/wallet/credit` with `wallet_type: 'bonus'` and idempotency key `daily_login:<userId>:<date>` — **the credit call's failure is swallowed** (`.catch(err => console.error(...))`, `users.ts:156`): if `wallet-service` is down or rejects the call, the route still returns `{ success: true, bonus_amount, ... }` to the client and the streak/bonus-row bookkeeping is already committed, but the player's wallet balance never actually increases. Same failure shape as `docs/Bugs/leaderboard-top3-reward-never-paid.md` — a fire-and-forget side effect not covered by the same transaction or a retry/reconciliation job (the withdrawal state machine had this exact shape of bug too, fixed 2026-07-28, but this daily-bonus path is separate code and wasn't part of that fix). Filed: `docs/Bugs/daily-bonus-claim-reports-success-even-if-wallet-credit-fails.md`.
- **`GET /users/me/transactions`** (auth) — paginated `wallet_transactions` read, optional `?type=` filter. **Dead code**: grepping the entire `mobile/lib` tree, the only transaction-history callers are `GET /api/wallet/transactions` (wallet-service, used by both `wallet_page.dart` and `transaction_history_page.dart` — see `docs/app/wallet-client/backend.md`). Nothing in the client calls `/api/users/me/transactions`. Harmless (correctly scoped, correctly authenticated), just unused.
- **`GET /admin/bank-details`** / **`PATCH /admin/bank-details/:userId/verify`** (`users.ts:295-313`) — byte-for-byte duplicate of the properly-secured `admin-service` routes, but with **zero auth** here. Currently unreachable via the documented Nginx ingress (no `location /admin/` without an `/api` prefix routes to this service), but live and unauthenticated the moment that changes. See `docs/Bugs/duplicate-unauthenticated-bank-details-routes.md` (already filed).

## Leaderboard — `plugins/leaderboard.ts`

`GET /leaderboard/:gameType` (live Postgres aggregate, accepts player JWT or `x-internal-key`) and a dead `POST /internal/leaderboard/update` (writes to Redis sorted sets nothing else reads). Full detail: `docs/app/leaderboard/backend.md`. No route anywhere pays out a top-3 reward — see `docs/Bugs/leaderboard-top3-reward-never-paid.md`.

## Notifications — `plugins/notifications.ts`

Player inbox (`GET /notifications/me`, unread count, mark-read, delete-all) plus internal-key-gated `send`/`broadcast` used by `admin-service` and `churn-service`, backed by Firebase Admin SDK (falls back to console-log dev mode if `FIREBASE_SERVICE_ACCOUNT_JSON` is unset). Full detail: `docs/app/notifications/backend.md`. Known gap: `docs/Bugs/push-notification-read-by-campaign-missing.md`. `admin-service`'s `.env` used to point `NOTIFICATION_SERVICE_URL` at a dead port instead of this service — fixed 2026-07-28.

## Support — `plugins/support.ts`

Player-scoped support ticket CRUD (`WHERE user_id = $1` on every route), reply always reopens a closed ticket. Full detail: `docs/app/support/backend.md`.

## Betting — `plugins/betting.ts` (matka / lottery / cricket)

No feature-level doc exists yet for any of the three games (`docs/games/{cricket,lottery,matka}/*.md` are all empty placeholders), so this is the primary reference. All player routes require `app.authenticate`; all `/internal/*` routes require `x-internal-key === INTERNAL_SERVICE_KEY` via a locally-defined `internal` hook (`betting.ts:13-16`) — note this is a **separate, independently-implemented** internal-key check from the one in `leaderboard.ts`/`notifications.ts`, not shared code, though all three check the same env var. Stakes are debited and prizes credited via `helpers/wallet-client.ts` (`debitStake`/`creditPrize`), which call `wallet-service`'s `/internal/wallet/{debit,credit}` — every stake/payout carries a unique idempotency key (`<game>_stake_<id>`, `<game>_payout_<id>`, `<game>_refund_<id>`) so retried settlement runs can't double-pay.

### Matka (`helpers/matka.ts`)

- **`GET /matka/markets`** — active markets, each showing today's draw (auto-created on first read via `todayDraw()`) and its `open_panna`/`close_panna`/`jodi` if declared, plus the static `MATKA_MULTIPLIERS` table (`single: 9.5`, `jodi: 95`, `single_panna: 142`, `double_panna: 285`, `triple_panna: 950`).
- **`POST /matka/bet`** — validates bet-type/number shape via `validateMatkaBet()` (single: 1 digit, jodi: 2 digits, panna types: 3 digits matching the panna-kind classifier `pannaKind()`), rejects if the relevant session (open/close) is already declared, and enforces the market's `open_time`/`close_time` cutoffs computed in Postgres in Asia/Kolkata time (`(NOW() AT TIME ZONE 'Asia/Kolkata')::time`). Debits stake, then inserts the bet row — **if the insert fails after a successful debit, there is no refund/rollback path** (unlike lottery's ticket-purchase route, which explicitly refunds on a unique-constraint conflict — see below). In practice the insert has nothing that plausibly conflicts (no unique constraint on the bet), so this is a theoretical rather than observed gap.
- **`GET /matka/my-bets`** — caller's last 100 bets, joined with market name.
- **`settleMatkaSession(db, drawId, session, panna)`** (`internal`-only, `POST /internal/matka/declare`) — row-locks the draw, marks it `open_declared` or `settled`, marks matching pending bets `won`/`lost` in one `UPDATE...WHERE` per session (jodi bets only settle on close, combining both digits), then credits winners outside the transaction via `Promise.all(creditPrize(...))` — so a partial credit failure here is possible (some winners get paid, others don't, no automatic retry) but each bet's `status` is already durably `won` in Postgres, making manual reconciliation possible.
- **No `GET /matka/markets/:id/chart` route exists** — the mobile app's Matka chart view (`matka_page.dart:602`) calls it and always shows an empty/loading state. See `docs/Bugs/betting-mobile-routes-missing-on-backend.md`.

### Lottery (`helpers/lottery.ts`)

- **`GET /lottery/draws`** — open draws with `draw_time > NOW()`, aggregated reserved-ticket-number list and count.
- **`POST /lottery/buy`** — validates ticket number format (`[a-zA-Z0-9]{1,8}`), pre-checks for an existing reservation, debits the stake, then inserts the ticket; **if the insert throws a unique-constraint violation (`23505`)** — i.e. another request reserved the same number in the race window between the pre-check and the insert — it explicitly refunds the debited stake via `creditPrize()` before returning 409. This is the one place in `betting.ts` that correctly handles the debit-then-fail race; matka and cricket bet placement do not have an equivalent unique-constraint scenario so they don't need it, but it's worth noting as the more defensive pattern of the three.
- **`GET /lottery/my-tickets`** — caller's last 100 tickets with draw name/winning number/status.
- **`GET /lottery/results`** — last 20 settled draws with per-ticket winner list and totals.
- **`settleLottery()`** (`internal`, `POST /internal/lottery/draw`) — takes an explicit winners list (`{ ticket_number, prize, rank? }`) from the caller (admin-service, presumably after an external/manual draw), resets every ticket for the draw to `is_winner=false, prize=0`, then applies the winners list, then credits.
- **`POST /internal/lottery/cancel`** — refunds every ticket's stake if the draw is still `open`.
- **No `GET /lottery/scratch/products`, `GET /lottery/scratch/my-tickets`, or `POST /lottery/scratch/buy` routes exist** — this entire "Instant Lottery / Scratch Card" sub-feature (`mobile/lib/features/games/betting/lottery_scratch_page.dart`) has zero backend, not even a database table (no `scratch` table in `infra/db/migrations/*.sql`). See `docs/Bugs/betting-mobile-routes-missing-on-backend.md`.

### Cricket (`helpers/cricket.ts`)

Four sub-features: match-winner markets, ball-by-ball "session" (over/runs) bets, fantasy team drafting, and live cricapi.com data sync.

- **`GET /cricket/matches`** / **`GET /cricket/matches/:id/live`** — upcoming/live matches with their open markets, or (for `/live`) full detail: markets, sessions, and per-player fantasy performance stats.
- **`POST /cricket/bet`** — market must be `open` and its match not `settled`/`closed`; potential payout = `amount * option.odds`.
- **`POST /cricket/session/bet`** — over/runs-bracket yes/no bet (e.g. "will team score ≥140 by over 15"); `odds_yes`/`odds_no` are per-session.
- **`GET /cricket/players`**, fantasy team building (`POST /cricket/fantasy/team` — 11 players, budget cap 100 credits, role-count bounds: 1-4 WK, 3-6 BAT, 1-4 AR, 3-6 BOWL), joining a paid fantasy league (`POST /cricket/fantasy/join` — row-locks the league's `current_entries`, refunds on a full/closed race), `GET /cricket/fantasy/my-teams`, `GET /cricket/fantasy/leagues`.
- **Missing routes the mobile client calls but that don't exist**: `GET /cricket/fantasy/leagues/:id/leaderboard` (contest leaderboard screen), `GET /cricket/fantasy/team/:teamId` (view a specific submitted team), `GET /cricket/session/my-bets` (session bet history tab). All three fail silently client-side (empty `catch` blocks) — see `docs/Bugs/betting-mobile-routes-missing-on-backend.md`.
- **`settleCricketMarket()` / `settleCricketSession()`** (internal) — straightforward win/lose/void-and-refund per bet, same pattern as matka/lottery.
- **`settleFantasyLeague()`** (internal) — writes `fantasy_points` per player, recomputes each submitted team's total (`base * 2.0` for captain, `* 1.5` for vice-captain, `* 1.0` otherwise), ranks entries within each open league (ties share a rank via a running "if lower than previous, advance to current index" scan), and pays out per the league's `prize_distribution` tiers.
- **`/internal/cricket/sync-api`**, **`/internal/cricket/sync-countries`**, **`/internal/cricket/sync-squad`** — pull-based sync against `https://api.cricapi.com/v1/*`, keyed by `game_configs.special_rules.api_key` (cricket row) if set, else a **hardcoded fallback key literal in source** (`dd511ce4-aeb7-4e1f-86f4-1160404b2776`, appears three times: `betting.ts:391,420,436`) — see `docs/Bugs/hardcoded-cricapi-fallback-key.md`.
- **`admin-service` calls two routes that don't exist here**: `/internal/cricket/sync-series` and `/internal/cricket/import-series-matches` (`services/admin-service/src/index.ts:1580-1588`, wired to `POST /api/admin/betting/cricket/sync-series` / `/import-series-matches`). Neither admin-service route has any caller in `admin-panel/src/pages/BettingManagement.tsx` either, so this particular gap is currently unreachable from the UI — noted for completeness, not filed as a standalone bug.
- There is also no admin-panel UI path to create `cricket_fantasy_players` or `cricket_fantasy_leagues` (`BettingManagement.tsx` has no `fantasy`-prefixed calls at all, despite `admin-service` exposing `POST /api/admin/betting/cricket/fantasy/{players,leagues}`) — fantasy data can only enter the system via a direct API/DB call today, not through any documented admin workflow.
