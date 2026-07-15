CREATE TABLE lottery_daily_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id UUID NOT NULL REFERENCES lottery_daily_draws(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ticket_number CHAR(4) NOT NULL CHECK (ticket_number ~ '^[0-9]{4}$'),
  match_type VARCHAR(50),
  outcome_type VARCHAR(50) NOT NULL DEFAULT 'none' CHECK (outcome_type IN ('cash', 'coupon', 'none')),
  prize NUMERIC,
  coupon_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(draw_id, ticket_number),
  CHECK ((outcome_type = 'cash' AND prize IS NOT NULL) OR (outcome_type != 'cash'))
);

CREATE INDEX idx_lottery_daily_tickets_draw_id ON lottery_daily_tickets(draw_id);
CREATE INDEX idx_lottery_daily_tickets_user_id ON lottery_daily_tickets(user_id);
CREATE INDEX idx_lottery_daily_tickets_outcome_type ON lottery_daily_tickets(outcome_type);
