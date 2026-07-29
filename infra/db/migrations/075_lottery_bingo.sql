-- Daily Lottery: 90-ball bingo. Admin schedules a draw (draw_time); players
-- buy tickets (server-generated 3x9 cards) beforehand; the bingo-engine
-- service calls all 90 numbers live over /ws/bingo starting at draw_time,
-- and every ticket that completes a pattern (one_line/two_lines/full_house)
-- wins that tier automatically and cumulatively once calling finishes.
BEGIN;

CREATE TABLE lottery_bingo_draws (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  ticket_price    NUMERIC(10,2) NOT NULL CHECK (ticket_price > 0),
  draw_time       TIMESTAMPTZ NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'calling', 'settled', 'cancelled')),
  prize_tiers     JSONB NOT NULL,
  called_numbers  JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_bingo_draws_status_time ON lottery_bingo_draws(status, draw_time);

CREATE TABLE lottery_bingo_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id     UUID NOT NULL REFERENCES lottery_bingo_draws(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  card        JSONB NOT NULL,
  tiers_won   JSONB NOT NULL DEFAULT '[]',
  prize       NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_bingo_tickets_draw ON lottery_bingo_tickets(draw_id);
CREATE INDEX idx_lottery_bingo_tickets_user ON lottery_bingo_tickets(user_id);

COMMIT;
