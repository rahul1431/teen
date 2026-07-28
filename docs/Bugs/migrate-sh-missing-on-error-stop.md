# The migration runner never sets `ON_ERROR_STOP`, so a failing migration is recorded as successfully applied

**Severity:** High
**Found:** 2026-07-28, infra documentation pass (db-migrations)
**Files:** `infra/db/migrate.sh:37`, `infra/db/migrations/012_game_events_monitoring.sql` (the confirmed prior incident), `infra/db/migrations/027_game_events_fixed.sql` (its own header comment documenting the fix)

## What's wrong

`migrate.sh:37` applies each migration with `docker exec -i teen_postgres psql -U teen -d teen_db < "$mig"` — no `-v ON_ERROR_STOP=1` (or `--set ON_ERROR_STOP=on`). Per `psql`'s documented exit-status semantics, a SQL error partway through a piped script does not, by itself, produce a non-zero exit code unless `ON_ERROR_STOP` is explicitly set — `psql` just prints the error to stderr and keeps going (or stops the script but still exits 0), and `migrate.sh` has no logic checking output content either. The file still gets recorded as applied in `schema_migrations` regardless of whether it actually succeeded.

This isn't theoretical: `012_game_events_monitoring.sql` used MySQL-style inline `INDEX` clauses inside a `CREATE TABLE` statement — invalid Postgres DDL — which silently failed and was nonetheless marked applied. The fix had to ship as an entirely new file, `027_game_events_fixed.sql` (whose own header comment documents this exact history), rather than editing `012` in place — which also demonstrates that the runner's filename-only tracking can't detect content changes to an already-applied file, compounding the risk.

## Impact

Any future migration with a syntax error, a typo'd identifier, or a dependency-ordering mistake gets silently recorded as successfully applied even when it partially or wholly failed. This produces schema drift between what operators believe is deployed and what the database actually contains, with no error surfaced anywhere in the deploy pipeline. Confirmed live: `005_risk_status.sql` (typo'd `user_status` instead of `user_status_enum`) was recorded as applied on 2026-06-30 despite its only statement failing outright — the enum value it was supposed to add was never actually present until a corrective migration shipped 2026-07-28.

## Fix

Add `-v ON_ERROR_STOP=1` to the `psql` invocation in `migrate.sh` so a failing statement both halts the script and propagates a non-zero exit code, and have `migrate.sh` treat that exit code as a hard failure (don't record the file as applied, abort the run). Consider also wrapping each migration file's execution in an explicit `BEGIN`/`COMMIT` at the runner level, rather than relying on individual migration authors to do so themselves (currently only 4 of 34 files self-wrap).
