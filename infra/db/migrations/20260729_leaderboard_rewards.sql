-- Tracks daily top-3 leaderboard reward payouts (per game type/date/rank) so
-- the payout job has an audit trail. The wallet ledger's own idempotency key
-- (leaderboard_reward:<gameType>:<date>:<rank>) is what actually prevents
-- double-payment; this table is the human-readable record of who won what.
CREATE TABLE IF NOT EXISTS leaderboard_rewards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type   VARCHAR(20) NOT NULL,
  period_date DATE NOT NULL,
  rank        INT NOT NULL CHECK (rank BETWEEN 1 AND 3),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_type, period_date, rank)
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_rewards_user ON leaderboard_rewards(user_id);
