# Lottery ticket numbers have no database uniqueness constraint, letting a race sell the same number twice — and a matched winner pays out every duplicate

**Severity:** High
**Found:** 2026-07-28, games documentation pass (lottery)
**Files:** `infra/db/migrations/009_betting_games.sql:78-89` (`lottery_tickets` schema, no `UNIQUE(draw_id, ticket_number)`), `services/core-api-service/src/plugins/betting.ts:96-111` (`/lottery/buy`'s pre-check-then-insert), `services/core-api-service/src/helpers/lottery.ts:42-47` (`settleLottery`'s unscoped winner `UPDATE`)

## What's wrong

`/lottery/buy` guards against selling the same `(draw_id, ticket_number)` pair twice using only an application-level `SELECT` pre-check followed by an `INSERT` — there is no unique constraint in the schema. The route's `catch` block does handle a Postgres `23505` unique-violation error, but that code path can never actually fire, because nothing in the schema can raise that error in the first place. Two concurrent buy requests for the same number (two users racing a "quick pick," or a client/proxy retry after a dropped response) can both pass the pre-check, both debit the buyer's wallet, and both insert successfully. Compounding this, `settleLottery`'s winner-marking query is `UPDATE ... WHERE draw_id=$2 AND ticket_number=$3` with no `LIMIT 1` and no assumption that the pair is unique. The idempotency key attached to the buy request (`lottery_buy_<ticketId>`) provides no real protection either, since `ticketId` is a fresh server-generated UUID on every request — the same structural gap the dealer-tip flow had (fixed there 2026-07-28 with a Redis debounce lock + deterministic key; this lottery path is separate code and wasn't touched by that fix).

## Impact

If a duplicated ticket number is later declared a winner, `settleLottery`'s unscoped `UPDATE` matches and pays out every row sharing that number — a silent double (or N-fold, if raced more than twice) real-money payout, with no error thrown and no admin-visible signal that anything unusual happened.

## Fix

Add `ALTER TABLE lottery_tickets ADD CONSTRAINT uq_lottery_ticket UNIQUE (draw_id, ticket_number)` so the existing (currently-dead) `23505` handling in `/lottery/buy` actually does its job, and have the client supply — or have the server derive deterministically — a stable idempotency key for the buy request rather than a fresh UUID each time.
