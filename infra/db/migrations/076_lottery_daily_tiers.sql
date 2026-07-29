CREATE TABLE lottery_daily_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount INTEGER NOT NULL,
  draw_time TIME NOT NULL,
  default_prize_tiers JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lottery_daily_tiers_status ON lottery_daily_tiers(status);
CREATE INDEX idx_lottery_daily_tiers_amount ON lottery_daily_tiers(amount);
