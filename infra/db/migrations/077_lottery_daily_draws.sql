CREATE TABLE lottery_daily_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID NOT NULL REFERENCES lottery_daily_tiers(id) ON DELETE RESTRICT,
  draw_date DATE NOT NULL,
  draw_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'calling', 'settled', 'cancelled')),
  winning_number CHAR(4),
  prize_tiers JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tier_id, draw_date)
);

CREATE INDEX idx_lottery_daily_draws_tier_id ON lottery_daily_draws(tier_id);
CREATE INDEX idx_lottery_daily_draws_status ON lottery_daily_draws(status);
CREATE INDEX idx_lottery_daily_draws_draw_time ON lottery_daily_draws(draw_time);
CREATE INDEX idx_lottery_daily_draws_draw_date ON lottery_daily_draws(draw_date);
