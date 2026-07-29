-- /lottery/buy only guarded against selling the same (draw_id, ticket_number)
-- twice with an application-level SELECT-then-INSERT — no unique constraint
-- existed, so two concurrent buy requests for the same number could both
-- pass the pre-check and both insert successfully. The route's existing
-- catch block already handles a Postgres 23505 unique-violation by refunding
-- the losing attempt's debit, but that code path could never fire without
-- this constraint. See
-- docs/Bugs/lottery-ticket-number-race-no-unique-constraint.md.
ALTER TABLE lottery_tickets ADD CONSTRAINT uq_lottery_ticket UNIQUE (draw_id, ticket_number);
