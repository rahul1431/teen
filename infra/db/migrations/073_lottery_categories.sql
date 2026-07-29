-- Lottery four-section reorganization: tag every draw with a category so
-- the mobile app can split draws into Daily/Instant/Weekly/Monthly
-- sections. Daily and Instant are modeled now (so this CHECK constraint
-- never needs to change again) but aren't creatable yet — those two
-- mechanics (Card/Bingo, Scratch Card) don't exist yet. Only Weekly and
-- Monthly reuse the already-shipped Dedicated Number mechanic.
--
-- Uses the add-nullable -> backfill -> set-not-null sequence rather than
-- a plain `ADD COLUMN ... NOT NULL` because it's safe regardless of
-- whether any draws already exist in the target database at run time.
BEGIN;

ALTER TABLE lottery_draws ADD COLUMN category VARCHAR(16);
UPDATE lottery_draws SET category = 'weekly' WHERE category IS NULL;
ALTER TABLE lottery_draws ALTER COLUMN category SET NOT NULL;
ALTER TABLE lottery_draws ADD CONSTRAINT lottery_draws_category_check
  CHECK (category IN ('daily', 'instant', 'weekly', 'monthly'));

COMMIT;
