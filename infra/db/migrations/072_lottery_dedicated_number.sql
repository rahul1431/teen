-- Lottery redesign: Dedicated Number mode. Replaces the free-text
-- alphanumeric ticket system with a fixed 4-digit numeric pick and real
-- digit-match prize tiers, replacing the old fully-manual winner-list
-- settlement. Clean-slate migration — confirmed only test data exists
-- (6 draws, 6 tickets, no real users) as of 2026-07-14.

DELETE FROM lottery_tickets;
DELETE FROM lottery_draws;

ALTER TABLE lottery_draws DROP COLUMN IF EXISTS digits;
ALTER TABLE lottery_draws DROP COLUMN IF EXISTS prize_multiplier;
ALTER TABLE lottery_draws ADD COLUMN IF NOT EXISTS prize_tiers JSONB NOT NULL DEFAULT '[]';
ALTER TABLE lottery_draws ALTER COLUMN winning_number TYPE VARCHAR(4);

ALTER TABLE lottery_tickets ALTER COLUMN ticket_number TYPE VARCHAR(4);
ALTER TABLE lottery_tickets ADD CONSTRAINT lottery_tickets_ticket_number_numeric CHECK (ticket_number ~ '^[0-9]{4}$');
