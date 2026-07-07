-- Aviator per-user bet history. One row per bet per round, written at round
-- settlement (crash). payout = 0 means the bet lost (no cashout before crash).
CREATE TABLE IF NOT EXISTS aviator_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  bet_index INT NOT NULL DEFAULT 1,
  amount NUMERIC(12,2) NOT NULL,
  cashout_multiplier NUMERIC(10,2),
  payout NUMERIC(12,2) NOT NULL DEFAULT 0,
  crash_at NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aviator_bets_user_created
  ON aviator_bets (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aviator_bets_round_user_bet
  ON aviator_bets (round_id, user_id, bet_index);
