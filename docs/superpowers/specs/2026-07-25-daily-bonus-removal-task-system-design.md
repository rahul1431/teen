# Remove Daily Login Bonus + Add Task System

Date: 2026-07-25

## Summary

Two changes:
1. Fully remove the Daily Login Bonus feature (app + admin panel + backend + DB tables).
2. Replace it with a configurable Task System (Weekly / Monthly / One-time tasks) that admins fully manage — tasks reward players for actions like joining a Telegram group, sharing a win, inviting friends, depositing, and playing specific games.

## Part 1 — Remove Daily Login Bonus (full removal)

Delete entirely, no data preserved beyond what's already recorded in the shared `bonuses` table (untouched, historical only):

- `admin-panel/src/pages/DailyBonus.tsx` + its `menuConfig.ts` entry (`/admin/daily-bonus`)
- `mobile/lib/features/daily_bonus/` (whole directory) + its route in `app.dart` (`/daily-bonus`) + the "🎯 Daily Bonus" hero badge in `home_page.dart`
- Backend: `/users/daily-bonus/status` and `/users/daily-bonus/claim` in `services/core-api-service/src/plugins/users.ts`; admin routes `bonus/login-config` and `bonus/stats` in `services/admin-service/src/index.ts`
- New migration: `DROP TABLE login_bonus_config, user_login_streaks`

Rows already in `bonuses` with `type = 'daily_login'` are left alone — that table is shared/historical ledger, not part of the live feature.

## Part 2 — Task System

### Data model (new migration)

**`tasks`** — admin-authored task definitions:
- `id UUID PK`
- `title TEXT`, `description TEXT`, `emoji VARCHAR(10)`
- `category VARCHAR(10)` — `weekly` | `monthly` | `one_time` (defines the reset period)
- `metric_type VARCHAR(20)` — `deposit_amount` | `referral_count` | `game_played` | `telegram_join` | `manual_proof`
- `game_type VARCHAR(20)` nullable — required when `metric_type = 'game_played'` (e.g. `teen_patti`, `ludo`)
- `min_stake NUMERIC(15,2)` nullable — optional stake filter for `game_played` (e.g. Ludo match ≥ ₹50)
- `target_value NUMERIC(15,2)` — threshold (e.g. `1000` deposit, `1` game, `100` referrals)
- `reward_amount NUMERIC(15,2)`, `reward_wallet_type VARCHAR(10)` (`real`|`bonus`)
- `max_completions_per_period INT` nullable — null = unlimited (e.g. invite-a-friend); default `1` (e.g. play-1-game, deposit-1000)
- `verification_type VARCHAR(15)` — `auto` | `telegram_bot` | `manual_review`
- `is_active BOOLEAN`, `sort_order INT`, `created_at`, `updated_at`

**`user_task_completions`** — one row per reward actually claimed:
- `id UUID PK`, `user_id UUID`, `task_id UUID`
- `period_key VARCHAR(10)` — `2026-W30` for weekly, `2026-07` for monthly, `lifetime` for one_time
- `completion_number INT` — 1, 2, 3… within the period (supports repeatable tasks)
- `reward_amount NUMERIC(15,2)`, `status VARCHAR(15)` — `completed` | `pending_review` | `rejected`
- `proof_url TEXT` nullable, `reviewed_by UUID` nullable, `reviewed_at TIMESTAMPTZ` nullable
- `created_at`
- `UNIQUE (user_id, task_id, period_key, completion_number)` — prevents double-claim races

**`user_telegram_links`** — `user_id UUID PK`, `telegram_user_id BIGINT UNIQUE`, `telegram_username TEXT`, `linked_at TIMESTAMPTZ`

### Progress engine

For `auto` tasks, progress is always computed live from the real source table for the current period — never duplicated into a counter:
- `deposit_amount` → sum of wallet deposit transactions in period
- `referral_count` → count of `referrals` rows with `status IN ('qualified','rewarded')` created in period, for that referrer
- `game_played` → count of `game_participants` rows matching `game_type`/`min_stake` in period

```
completions_available = floor(metric_value_in_period / target_value) - already_claimed_this_period
                         (capped at max_completions_per_period if set)
```

This one formula covers every auto example: "play 1 Teen Patti game" (target=1, cap=1), "invite a friend" (target=1, cap=null, reward per referral), "100 referrals → ₹1000" (target=100, cap=1).

### Verification flows

- **`auto`** — no extra plumbing; progress engine above handles it end-to-end.
- **`telegram_bot`** (e.g. Join Telegram Group) — new routes added to `core-api-service` (not a separate microservice): `GET /telegram/deep-link` issues a signed one-time token; `POST /telegram/webhook` receives Telegram's `/start <token>` update, resolves the user, stores `user_telegram_links`, then calls Telegram's `getChatMember` against `TELEGRAM_GROUP_CHAT_ID` to confirm membership. Once confirmed, the task becomes claimable. Requires `TELEGRAM_BOT_TOKEN` / `TELEGRAM_GROUP_CHAT_ID` env vars (already available, to be supplied at deploy time).
- **`manual_review`** (e.g. Share Winning to Telegram, or any task without a reliable auto signal) — user submits via `POST /users/tasks/:id/submit` with an optional proof image (reuses existing avatar/KYC upload plumbing); row inserted as `pending_review`. Admin approves/rejects via the Review Queue; approval triggers the wallet credit and existing reward flow.

### Reward crediting

On claim (auto/telegram tasks) or admin approval (manual tasks): insert the `user_task_completions` row first (unique constraint guards against double-credit), then call `wallet-service`'s existing `/internal/wallet/credit` endpoint with `idempotency_key = task:{task_id}:{user_id}:{period_key}:{completion_number}` — same pattern the old daily-bonus code used. Task rewards do **not** get inserted into the shared `bonuses` ledger table (that table's `bonus_type_enum` is a fixed Postgres enum meant for wagering-requirement bonuses like welcome/deposit-match; extending it isn't worth it — `user_task_completions` is the ledger for this feature).

### API surface

- `GET /users/tasks` — returns active tasks grouped by category with the caller's live progress/status for the current period
- `POST /users/tasks/:id/claim` — claims an `auto` or `telegram_bot`-verified task once `completions_available > 0`
- `POST /users/tasks/:id/submit` — submits a `manual_review` task (with optional proof)
- `GET /telegram/deep-link`, `POST /telegram/webhook` — Telegram linking (see above)
- Admin (`admin-service`): `GET/POST/PUT/DELETE /admin/tasks`, `GET /admin/tasks/review-queue`, `POST /admin/tasks/review-queue/:id/approve|reject`, `GET /admin/tasks/stats`

### Admin panel

New **Tasks** page (`admin-panel/src/pages/Tasks.tsx`), replacing the Daily Bonus nav entry:
1. **Task Config tab** — CRUD table for the fields above (title, category, metric, target, reward, wallet type, verification type, max completions, active toggle), styled like the table-editing UX of the removed `DailyBonus.tsx`.
2. **Review Queue tab** — pending `manual_review` submissions with proof image, approve/reject actions, plus a stats strip (completions today, amount distributed today, pending count).

### Mobile app

Replaces the Daily Bonus page/route/hero-badge with a **Tasks** page (`mobile/lib/features/tasks/`), tabs for Weekly / Monthly (one-time tasks surface inline, e.g. under Weekly, until completed). Each task card shows progress (`3/5 games played`), and one of: **Claim** button (auto/telegram, ready), **Connect Telegram** (telegram_bot, not linked yet), **Submit Proof** (manual_review, not yet submitted), or **Pending Review** (manual_review, submitted).

### Out of scope

- Real-time push notifications when a task becomes claimable (future enhancement)
- Task ordering/personalization per user segment
- Localized task copy beyond what the existing i18n system already supports
