# Database Migrations

`infra/db/migrate.sh` plus 34 files in `infra/db/migrations/*.sql` are the entire schema-evolution story for the platform's single Postgres database (`teen_db`). There is no ORM-managed migration tool (no Prisma/TypeORM/Knex/Alembic migrations directory) — every service reads/writes this schema with hand-written SQL, and this hand-rolled bash runner is the only thing that has ever applied DDL to it.

## How the runner works (`infra/db/migrate.sh`)

The whole script is 51 lines. Read literally, end to end:

1. **Tracking table** (`:12-17`): `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`. Applied-state is keyed **purely by filename**, nothing else.
2. **Ordering** (`:23`): `for mig in "$BASE"/infra/db/migrations/*.sql` — bash glob expansion, which sorts lexicographically (byte-order, `LC_COLLATE`-dependent, but effectively `C`-locale ASCII order on the deploy host). This is why the migration authors zero-pad numbers (`001`, `002`, ...) — the ordering guarantee is entirely an accident of filename string-sort, not anything the script enforces or validates. Nothing checks that a "dependent" migration's number is actually higher than what it depends on; it only works because the authors were careful.
3. **Skip check** (`:27-34`): `SELECT COUNT(*) FROM schema_migrations WHERE filename = '$name'` — if it returns `1`, skip. **This is a pure filename-presence check with no checksum, hash, or content comparison of any kind.** If a historical migration file's *contents* are edited after it has already been recorded as applied on a given database, `migrate.sh` will never notice or re-run it — the row in `schema_migrations` only ever stores the filename and a timestamp, nothing that could detect drift. This is not a hypothetical: see "012 vs. 027" below, where the actual fix for a broken migration required a brand-new filename (`027_game_events_fixed.sql`) rather than an edit to `012_game_events_monitoring.sql` in place, precisely because editing 012 in place would have had zero effect on any environment where it was already (wrongly) marked applied.
4. **Apply** (`:36-46`): `docker exec -i teen_postgres psql -U teen -d teen_db < "$mig"`. On success (`if` returns true), the filename is `INSERT`ed into `schema_migrations`; on failure the loop `exit 1`s with `FAIL … — aborting`, halting the rest of the batch.
5. Summary line at the end: counts of applied vs. skipped.

### Transactionality — no, not by the runner itself

`migrate.sh` does **not** wrap each file's execution in an explicit transaction. It streams the file straight to `psql`, which by default runs in autocommit mode — every top-level statement in the file commits independently as it succeeds, unless the file itself contains an explicit `BEGIN; ... COMMIT;` block. Only 4 of the 34 files bother to self-wrap: `016_bot_learning.sql`, `017_app_monitor.sql`, `027_game_events_fixed.sql`, `028_player_tracking.sql`. The other 30 rely on psql's per-statement autocommit, which means a migration that creates three tables and fails on the fourth statement leaves the first three permanently committed — a genuinely partial apply, not an all-or-nothing one. `009_betting_games.sql` and `029_tip_dealer_drop_gifts.sql` explicitly call this out in a comment (`009:6-7`, `029:2-3`): `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older Postgres versions, which is presumably *why* most files avoid `BEGIN`/`COMMIT` altogether (rather than each author individually deciding transactional safety wasn't needed) — but the practical effect is that only 4/34 files get atomic apply-or-nothing semantics, and it's incidental rather than a house rule.

### Error handling — the critical gap: `psql` is never told to stop on error

Nowhere does `migrate.sh` pass `-v ON_ERROR_STOP=1` (or `--set ON_ERROR_STOP=on`) to `psql`. Per `psql`'s own documented exit-status semantics, its process exit code reflects **connection-level** failure (`2`) or `psql`'s own fatal errors (`1`) — a SQL statement inside the script failing (syntax error, missing relation, permission denied, etc.) does **not** make `psql` exit non-zero unless `ON_ERROR_STOP` is set. `psql` prints the error to stderr and moves on to the next statement in the file, then exits `0` at end-of-input.

The consequence: `migrate.sh`'s `if docker exec -i teen_postgres psql ... < "$mig"; then` branch sees success even when every single statement in the file failed. The file gets `echo "  OK    $name"` and is recorded into `schema_migrations` as applied — permanently, per the filename-only tracking above — regardless of whether any of its DDL actually took effect.

**This is not a theoretical risk — it already happened once, and the fix is preserved in-repo as evidence:** `012_game_events_monitoring.sql` uses MySQL-style inline `INDEX idx_name (...)` clauses inside `CREATE TABLE` (`012_game_events_monitoring.sql:15-19`) — syntax Postgres rejects outright (`CREATE TABLE` has no `INDEX` sub-clause in Postgres DDL). The statement fails, the dependent `CREATE MATERIALIZED VIEW ... FROM game_events` fails because the table was never created, and the two `GRANT ... TO readonly_user`/`monitoring_user` statements fail because neither role exists anywhere in this codebase (confirmed — no `CREATE ROLE` for either name exists in any migration or elsewhere in the repo). All of that happened silently; `migrate.sh` still recorded `012_game_events_monitoring.sql` as applied. `027_game_events_fixed.sql`'s own header comment (`027:1-7`) states this explicitly: *"012 was written with MySQL-style inline INDEX clauses inside CREATE TABLE, which PostgreSQL rejects, so the table was never actually created and monitoring-service's event persistence failed silently."* The fix had to ship as a new file with standalone `CREATE INDEX` statements, dropping the (also-broken) materialized view and the grants to nonexistent roles entirely — because, per point 3 above, there was no way to make `012_game_events_monitoring.sql` re-run on hosts where it was already (wrongly) marked done.

`013_fraud_detection.sql` has the identical dead-`GRANT` problem (`013_fraud_detection.sql:117-124`, to the same nonexistent `readonly_user`/`monitoring_user`) — those eight `GRANT` statements have been silently failing since this migration first ran and nobody has needed to fix it because nothing depends on the grants actually taking effect (every service connects as the single `teen` superuser per `DATABASE_URL`, so role-based read/write separation was apparently planned but never wired up).

### Concurrency — no lock of any kind

There is no advisory lock (`pg_advisory_lock`), no lockfile, no PID check, nothing preventing two simultaneous `migrate.sh` invocations. Two overlapping runs (e.g., a manual operator run racing a CI/CD deploy script, both calling `bash infra/db/migrate.sh`) would both compute `IS_APPLIED` for the same pending file near-simultaneously, both see it unapplied, and both attempt to `psql < "$mig"`. For a file with no unique/idempotent guards this can mean double-execution of `INSERT`/`ALTER` statements racing each other; the final `INSERT INTO schema_migrations ... ON CONFLICT DO NOTHING` at least prevents a duplicate-key crash on the tracking row itself, but by then the underlying DDL/DML may already have run twice. In practice most files use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ON CONFLICT DO NOTHING`, which happens to make many (not all — see the `UPDATE`-based migrations below, which have no such guard) migrations idempotent-if-race-hit anyway, but that's a property of individual authors' care, not something the runner provides.

### Summary of runner guarantees

| Property | Guaranteed by `migrate.sh`? |
|---|---|
| Applied-once per filename | Yes, via `schema_migrations` |
| Detects edited content of an already-applied file | **No** — filename-only tracking |
| Ordering | Only via filename lexicographic sort — incidental, not enforced |
| All-or-nothing per file | **No**, unless the file wraps itself in `BEGIN`/`COMMIT` (4/34 do) |
| Halts batch on real failure | **No** — `psql` isn't run with `ON_ERROR_STOP`, so failing SQL inside a file is invisible to the runner |
| Concurrent-invocation safety | **No** — no lock/mutex of any kind |

## Chronological migration summary

Numbering has a gap (**025 does not exist** — silently skipped, presumably an abandoned/renamed migration before first deploy) and two duplicated numbers (**012** and **013** each have two files); ordering within a duplicated number is resolved only by the rest of the filename sorting alphabetically (`012_cricket_sessions_and_storage` before `012_game_events_monitoring`; `013_changelogs` before `013_fraud_detection`), which happens to be harmless here since the pairs are independent of each other, but nothing enforces that in general — CLAUDE.md's claim that these files "must stay in order" is aspirational, not mechanically true today.

| # | File | What it does | Notes |
|---|---|---|---|
| 001 | `001_initial.sql` | Baseline schema: 14 enum types, `users`, `admin_users`, `admin_audit_log`, `wallets`, `wallet_transactions`, `payment_orders`, `game_rooms`, `game_participants`, `kyc_documents`, `referrals`, `bonuses`, `game_configs` (seeded with 6 games incl. `rummy` inactive), one seed superadmin. | Foundational; every later FK target originates here. |
| 002 | `002_notifications.sql` | `notifications` table. | File's own trailing comment documents that a bot-seeding block was later removed from this file (2026-07-07) because re-running migrations during full deploys kept re-minting 20 bot users — a direct, self-documented illustration of why non-idempotent seed data in a migration is dangerous under this runner. |
| 003 | `003_user_notes.sql` | `user_notes` (admin notes/flags on users). | Partial index `WHERE is_flag = true` — appropriately narrow. |
| 004 | `004_admin_rbac.sql` | Adds `totp_secret`, `totp_enabled`, `created_by`, `updated_at` to `admin_users`; normalizes seed superadmin's role. | Purely additive. |
| 005 | `005_risk_status.sql` | Intends to add `'suspicious'` as a valid `users.status` value. | **Broken — see Notable Risks below.** Targets a type name (`user_status`) that was never created; the real type is `user_status_enum` (`001_initial.sql:6`). |
| 006 | `006_support_cms.sql` | `support_tickets`, `support_messages`, `cms_pages`, `cms_banners`; seeds 3 CMS pages. | Additive. |
| 007 | `007_payment_methods.sql` | `payment_methods` (admin-configured UPI/bank/QR deposit destinations); adds `reference_number`, `screenshot_url`, `payment_method_id` to `payment_orders`. | Additive. |
| 008 | `008_enable_ludo.sql` | `UPDATE game_configs SET is_active=true, ... WHERE game_type='ludo'` — activates Ludo and sets its full tunables (`special_rules` JSONB: safe cells, extra-turn rules, `turn_timeout_seconds`). | Data-changing `UPDATE`, not additive DDL — see risks below (no `WHERE`-matched-row check, no rollback). |
| 009 | `009_betting_games.sql` | `ALTER TYPE game_type_enum ADD VALUE 'cricket'`; `DELETE FROM game_configs WHERE game_type='rummy'`; activates matka/lottery; seeds `cricket` config + 3 Matka markets; creates `matka_markets`, `matka_draws`, `matka_bets`, `lottery_draws`, `lottery_tickets`, `cricket_matches`, `cricket_markets`, `cricket_bets`. | The Rummy retirement `DELETE` here — and the accompanying "enum value can't be dropped" comment (`:10-11`) — is already documented in full in `docs/games/rummy-planned/backend.md`; not re-derived here. Confirmed still accurate against current source: `rummy` remains a permanent, unremovable member of `game_type_enum` with no matching `game_configs` row from this point forward. |
| 010 | `010_cricket_fantasy_and_live.sql` | Adds `live_score`/`live_tv_url`/`match_api_id` to `cricket_matches`; creates fantasy tables: `cricket_fantasy_players`, `cricket_match_players`, `cricket_fantasy_leagues`, `user_fantasy_teams`, `cricket_fantasy_entries`. | Additive. `user_fantasy_teams.player_ids UUID[]` has no DB-level check that the array actually contains 11 elements — see `docs/Bugs/cricket-fantasy-roster-validation-mismatch.md` for the app-level version of this gap. |
| 011 | `011_cricket_team_flags.sql` | `cricket_countries` table; `team_a_flag`/`team_b_flag` on `cricket_matches`; `external_id` (unique) on `cricket_fantasy_players`. | Additive. |
| 012a | `012_cricket_sessions_and_storage.sql` | `cricket_teams` (API cache), `cricket_sessions` (fancy bets), `cricket_session_bets`, `cricket_match_cache`. | Additive, valid syntax. |
| 012b | `012_game_events_monitoring.sql` | **Intends** `game_events` + a minute-level materialized view + grants. | **Broken at the SQL-syntax level — see Notable Risks.** Superseded by 027. |
| 013a | `013_changelogs.sql` | `changelogs` (release notes), seeds 5 historical entries. | Additive/cosmetic. |
| 013b | `013_fraud_detection.sql` | `device_fingerprints`, `fraud_events` (+ daily-stats materialized view), `fraud_config_history`, `user_fraud_flags`; a **second, incompatible `CREATE TABLE IF NOT EXISTS referrals`** with different columns than 001's; 8 `GRANT`s to nonexistent roles; a shared `update_updated_at_column()` trigger function wired to 3 tables. | See Notable Risks — the redundant `referrals` redefinition is a no-op today only because `IF NOT EXISTS` silently skips it (001's table already exists), but it's misleading to read. |
| 014 | `014_widen_varchar_limits.sql` | 9 `ALTER COLUMN ... TYPE VARCHAR(N)` widenings on `cricket_matches`/`cricket_teams`/`cricket_fantasy_players` (all widening, e.g. 60→255, 8→50). | Safe direction (widening truncated-length columns never loses data); would have been destructive had any gone the other way. |
| 015 | `015_churn.sql` | `user_churn_scores`, `churn_config` (seeded with 7 tunables). | Additive. |
| 016 | `016_bot_learning.sql` | `bot_profiles` (seeded 9 rows: 3 games × 3 difficulties), `bot_learning_config` (8 tunables). Wrapped in `BEGIN`/`COMMIT`. | The seeded `win_rate_target` values (`:32-34`: `teen_patti` easy/medium/hard = 35/50/65) are exactly what `docs/Bugs/teen-patti-dda-hard-fallback-100-percent.md` cross-references — confirmed accurate against current source; not re-derived here. |
| 017 | `017_app_monitor.sql` | `app_sessions`, `app_events` (event_type/platform `CHECK` constraints). Wrapped in `BEGIN`/`COMMIT`. | Additive. |
| 018 | `018_game_emojis_gifts.sql` | `game_emojis` (seeded 8), `game_gifts` (seeded 6, with `price`). | `game_gifts` is later dropped whole by 029 — see below. |
| 019 | `019_admin_config.sql` | `admin_config` key/value JSONB store. | Additive. |
| 020 | `020_daily_login_bonus.sql` | `login_bonus_config` (`day_number` 1–30 `CHECK`, seeded 7 days), `user_login_streaks`. | Additive. |
| 021 | `021_banners_and_promo_codes.sql` | `home_banners`, `promo_codes`, `promo_code_usages`. | Additive. |
| 022 | `022_kyc_avatar_updates.sql` | Adds `selfie_path`, `submitted_at` to `kyc_documents`; 2 indexes. | Additive. |
| 023 | `023_app_versions.sql` | `app_versions` (`SERIAL` PK, unique `version_code`), default `download_url` pointing at `game.myonlinejoker.com/downloads/app-release.apk`. | See `docs/Bugs/app-update-version-history-downloads-wrong-apk.md` for the app-level bug this default URL is connected to (not re-derived here). |
| 024 | `024_wallet_idempotency_unique.sql` | Adds a real `UNIQUE` constraint on `wallet_transactions.idempotency_key` via a guarded `DO $$ ... IF NOT EXISTS (SELECT FROM pg_constraint) ... $$` block, plus a partial index. | The most defensively-written migration in the set — checks `pg_constraint` directly rather than relying on `ADD CONSTRAINT IF NOT EXISTS` (which Postgres doesn't support for constraints the way it does for columns). Comment explicitly states the prior idempotency check was a racy `SELECT`-then-insert; this migration is what makes `ON CONFLICT (idempotency_key) DO NOTHING` atomic. |
| **025** | **— missing —** | No file exists for this number. | Gap in the sequence; harmless (the runner doesn't care about numeric contiguity, only filename sort), but contradicts the "sequentially numbered" framing. |
| 026 | `026_bot_fill_table_size.sql` | Adds nullable `game_configs.bot_fill_table_size INT`; sets it to `4` for `teen_patti`. | Additive; nullable-by-design per its own comment (NULL = fall back to `max_bot_ratio` sizing). |
| 027 | `027_game_events_fixed.sql` | Re-creates `game_events` correctly (standalone `CREATE INDEX`s, no materialized view, no grants). Wrapped in `BEGIN`/`COMMIT`. | The self-documented fix for 012b — see Notable Risks. |
| 028 | `028_player_tracking.sql` | Adds 10 columns to `app_sessions` (device/geo/last-screen/last-game); `app_device_locations` (GPS history); widens `app_events`' `event_type` `CHECK` to add `'game_event'`/`'location'` (via `DROP CONSTRAINT IF EXISTS` + re-`ADD CONSTRAINT`). Wrapped in `BEGIN`/`COMMIT`. | Additive; the constraint drop-and-recreate pattern here is the correct way to widen a `CHECK` (contrast with the enum-`ALTER TYPE` pattern used elsewhere, which can't be done this way). |
| 029 | `029_tip_dealer_drop_gifts.sql` | `ALTER TYPE txn_type_enum ADD VALUE 'tip_dealer'`; **`DROP TABLE IF EXISTS game_gifts`**. | **Destructive** — see Notable Risks. `docs/Bugs/dealer-tip-idempotency-key-is-not-actually-idempotent.md` covers the feature this enum value enables; not re-derived here. |
| 030 | `030_watchdog_events.sql` | `watchdog_events` (idle-room reaper audit log — `refunds` JSONB array, `total_refunded`). | Additive; this is the admin-visible record of `game-gateway`'s watchdog reaper referenced in CLAUDE.md. |
| 031 | `031_monitor_alerts.sql` | `monitor_alerts` (app-monitor alerting engine). | Additive. |
| 032 | `032_remediation_actions.sql` | `remediation_actions` (self-healing/auto-remediation log — PM2 process restarts). | Additive. |
| 033 | `033_aviator_bets.sql` | `aviator_bets` (per-bet history), with a `UNIQUE (round_id, user_id, bet_index)` index. | Additive; the unique index is a sound guard against double-settlement of the same bet. |

34 files total (matching the task's count): 001–024, 026–033, plus the four duplicate-numbered pairs at 012/013 counted individually.

## Notable schema risks

### 1. `005_risk_status.sql` almost certainly never worked — live, unfixed (new finding)

```sql
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'suspicious';
```

`001_initial.sql:6` names the type `user_status_enum`, and `001_initial.sql:32` types the `users.status` column as `user_status_enum`. No type literally named `user_status` (without the `_enum` suffix) exists anywhere in this codebase's migrations — confirmed by grep across all 34 files. `ALTER TYPE user_status ...` would fail with Postgres error `type "user_status" does not exist`.

Per the runner analysis above, this failure would have been **silent**: `psql` prints the error and exits `0` (no `ON_ERROR_STOP`), so `migrate.sh` recorded `005_risk_status.sql` as applied regardless. No later migration corrects the type name (`user_status_enum` never gets an `ADD VALUE 'suspicious'` anywhere in the remaining 29 files).

Yet application code assumes `'suspicious'` is a live enum value:
- `services/admin-service/src/index.ts` — `POST /api/admin/risk/flag/:userId` runs `UPDATE users SET status = 'suspicious' WHERE id = $1` (per `docs/admin-panel/risk-center/backend.md`'s route table), and `GET /api/admin/risk/overview` runs `SELECT COUNT(*) FROM users WHERE status = 'suspicious' AND is_bot = false` for one of its 4 headline KPIs.

If the enum value was never actually added, both of these fail at the database with `invalid input value for enum user_status_enum: "suspicious"` — the Risk Center's entire "flag user as suspicious" action, and one of its dashboard KPI tiles, would error out rather than silently do nothing. This is a plausible root cause worth checking against the Risk Center overview/backend docs, which describe the *intended* behavior but don't independently verify this specific enum exists in a live database.

### 2. `012_game_events_monitoring.sql` — MySQL syntax shipped to a Postgres migration, silently no-op'd, fixed only by a new file (already self-documented, not new)

Covered in full under "Error handling" above. Notable for what it proves about the runner: this is a live, in-repo example of exactly the "edited-after-applied" scenario the runner can't detect (the authors had to route around it with `027_game_events_fixed.sql` rather than edit `012` in place). No action needed — already fixed — but it's the strongest evidence in this codebase that `migrate.sh`'s lack of `ON_ERROR_STOP` is a real operational hazard, not a theoretical one.

### 3. `013_fraud_detection.sql` redefines `referrals` with an incompatible, dead schema

```sql
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code VARCHAR(50),
  bonus_awarded DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

`001_initial.sql:182-191` already created `referrals` with a different shape (`status referral_status_enum`, `reward_amount`, `qualified_at`, `rewarded_at`, and `referee_id` unique-per-user rather than a composite `(referee_id, referrer_id)` unique pair). Since `001` always runs first, this second `CREATE TABLE IF NOT EXISTS` always no-ops. Grepping actual usage confirms every real caller (`services/wallet-service/src/index.ts:24,38,44`, `services/core-api-service/src/plugins/auth.ts:56`, `services/core-api-service/src/plugins/users.ts:85`, `services/risk-service/src/fraud-detector.ts:236`) reads/writes the **001 schema** (`status`, `reward_amount`, `qualified_at`/`rewarded_at`) — nothing in the codebase references `referral_code` or `bonus_awarded`. So this is currently harmless dead weight, not a live bug, but it is a trap: anyone reading `013_fraud_detection.sql` in isolation (or writing new fraud-detection code against it) would reasonably believe `referrals.bonus_awarded`/`referral_code` exist and are the source of truth, when they don't and never will unless someone runs `013` against a database that skipped `001` (which can't happen — `001` is always first). Worth a defensive comment in the source, at minimum.

### 4. `029_tip_dealer_drop_gifts.sql` — outright destructive, no guard

```sql
DROP TABLE IF EXISTS game_gifts;
```

`game_gifts` was created and seeded with 6 rows by `018_game_emojis_gifts.sql`. By the time `029` runs, any admin-added custom gifts (price, icon, sort order edited via the admin panel after initial seed) are unconditionally destroyed — there's no data migration, no archival table, no soft-delete. This is a legitimate, intentional feature removal per the migration's own comment ("Gift feature is fully removed"), so it's not a bug, but it's the one migration in the whole set that is unambiguously lossy on a populated table, and it has no rollback path — the table is simply gone. If the gift feature is ever reinstated, whatever configuration existed at drop time is unrecoverable from Postgres (would need a pre-drop backup/export, which this migration doesn't create).

### 5. No rollback / down-migrations exist anywhere in the tooling

Neither `migrate.sh` nor any of the 34 files has a corresponding "down" script — the tooling is forward-only by construction (no `xxx_name.down.sql` convention, no `migrate.sh rollback` verb). For the additive majority of migrations this is low-risk (a bad `ADD COLUMN` can be manually reversed), but for `009`'s `DELETE FROM game_configs WHERE game_type = 'rummy'` and `029`'s `DROP TABLE game_gifts`, there is no tooling-supported way back — recovery would require either a pre-migration `pg_dump` or hand-written reversal SQL run manually outside this system entirely.

### 6. Data-changing `UPDATE`s with no pre/post row-count check

`008_enable_ludo.sql` and part of `009_betting_games.sql` (`UPDATE game_configs SET is_active = true WHERE game_type IN ('matka','lottery')`) rely entirely on `WHERE game_type = '...'` matching exactly one seeded row from `001`. If `game_configs` were ever hand-edited or partially seeded differently in some environment, these `UPDATE`s would silently affect zero rows (no error, no warning) rather than failing loudly — there's no `RAISE EXCEPTION` guard checking `ROW_COUNT`, so a misconfigured environment could silently skip enabling Ludo/Matka/Lottery with no signal in the migration output.

### 7. Enum values that can never be removed

Two documented instances of the same underlying Postgres limitation (an enum value, once added via `ALTER TYPE ... ADD VALUE`, can never be dropped short of recreating the whole type and every column/index/default that references it):
- `game_type_enum` carries `rummy` forever (seeded in `001`, config deleted in `009`) — fully covered in `docs/games/rummy-planned/backend.md`, not re-derived here.
- `game_type_enum` also carries `cricket` (added in `009`) and will carry it forever even in the hypothetical case cricket betting is ever retired the same way rummy was.
- `txn_type_enum` carries `tip_dealer` (added in `029`) permanently, alongside the gift-feature removal in the same file — an odd pairing (one enum addition, one full table drop) but not a defect in itself.

None of these cause active bugs today; they're permanent, unshrinkable surface area on `game_type_enum`/`txn_type_enum` that any future "list all valid game/transaction types" code needs to filter (e.g., by joining against `game_configs.is_active` rather than enumerating the Postgres type directly) — exactly the pattern `009`'s own comment about Rummy already documents.

### 8. Missing constraints worth flagging (lower confidence, no demonstrated failure)

- Bet-amount columns across `matka_bets.amount`, `lottery_tickets.amount`, `cricket_bets.amount`, `cricket_session_bets.amount`, `aviator_bets.amount` are all `NOT NULL` but have no `CHECK (amount > 0)` — unlike `wallets.real_balance`/`bonus_balance`/`locked_balance`, which do have `CHECK (... >= 0)` in `001`. A zero or negative bet amount would be rejected only by application code, not the schema itself, across every betting-game table added from `009` onward.
- `fraud_events.user_id` (`013_fraud_detection.sql:23`) is `VARCHAR(255) NOT NULL` with **no foreign key** to `users(id)`, unlike almost every other user-referencing column in the schema (which are `UUID REFERENCES users(id)`). This is likely deliberate (fraud events may reference users by an external/string identifier before a UUID resolves), but it's inconsistent with the rest of the schema's FK discipline and means an orphaned or typo'd `user_id` in `fraud_events` is invisible to Postgres.

## Cross-references (verified, not re-derived)

- **`docs/Bugs/teen-patti-dda-hard-fallback-100-percent.md`** references `infra/db/migrations/016_bot_learning.sql:32-34`'s seeded `bot_profiles` values. Confirmed accurate against current source: `('teen_patti','hard', 65.0, ...)` is the seeded row; the engine's fallback-on-DB-error path uses a hardcoded `100.0` instead of this seeded `65.0`, exactly as that bug describes.
- **Rummy retirement** — `001_initial.sql:234` seeds `('rummy', false, ...)`; `009_betting_games.sql:10-12` deletes that row with the comment "The enum value can't be dropped safely, so deactivate and remove its config." Confirmed both statements are still present and unchanged in current source. Full analysis already lives in `docs/games/rummy-planned/backend.md` — not repeated here.

## New findings from this pass

1. `005_risk_status.sql` alters a type named `user_status` that doesn't exist (the real type is `user_status_enum`), so `'suspicious'` was never actually added as a valid `users.status` value; `migrate.sh`'s missing `ON_ERROR_STOP` means this failure was silent and the file was still marked applied. Confirmed against the live database and fixed 2026-07-28 via a corrective migration (`20260728_fix_user_status_suspicious_enum.sql`) targeting the correct type name.
2. `docs/Bugs/migrate-sh-missing-on-error-stop.md` — the runner-level root cause behind finding #1 and the already-fixed 012/027 incident: no migration file's mid-file SQL failure is ever detected by `migrate.sh`, so broken migrations get recorded as successfully applied. Still open — the corrective migration above works around it for this one case but doesn't fix the runner itself.
