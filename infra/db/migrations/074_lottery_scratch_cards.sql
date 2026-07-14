-- Instant Lottery (Scratch Card) mechanic: a standing, non-time-boxed
-- catalog of scratch card products. Each purchase is settled instantly
-- via an independent probability roll against the product's payout
-- table (cash, an existing promo_codes coupon, or no-win) — no draw
-- time, no admin declare step, unlike the Dedicated Number mechanic.
BEGIN;

CREATE TABLE lottery_scratch_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  price       NUMERIC(10,2) NOT NULL CHECK (price > 0),
  payouts     JSONB NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lottery_scratch_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES lottery_scratch_products(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  outcome        VARCHAR(16) NOT NULL CHECK (outcome IN ('cash', 'coupon', 'no_win')),
  amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  promo_code_id  UUID REFERENCES promo_codes(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_scratch_tickets_user ON lottery_scratch_tickets(user_id);
CREATE INDEX idx_lottery_scratch_tickets_product ON lottery_scratch_tickets(product_id);

COMMIT;
