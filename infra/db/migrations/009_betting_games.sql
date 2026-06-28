-- Matka, Lottery and Cricket betting games.
-- These are "place a bet → scheduled/declared result → settle" games, unlike
-- the realtime table games. They are served by the betting-service and settled
-- either by a schedule or by an admin declaring the result.

-- Postgres can't ALTER TYPE ... ADD VALUE inside a transaction block in older
-- versions; run this statement on its own.
ALTER TYPE game_type_enum ADD VALUE IF NOT EXISTS 'cricket';

-- ── Rummy: retired ─────────────────────────────────────────────────────────
-- The enum value can't be dropped safely, so deactivate and remove its config.
DELETE FROM game_configs WHERE game_type = 'rummy';

-- ── Activate Matka / Lottery, and seed Cricket config ──────────────────────
UPDATE game_configs SET is_active = true WHERE game_type IN ('matka', 'lottery');

INSERT INTO game_configs (game_type, is_active, min_players, max_players, stake_options, rake_percent, bot_fill_enabled)
VALUES ('cricket', true, 1, 1, '{10,50,100,500,1000}', 8.00, false)
ON CONFLICT (game_type) DO UPDATE SET is_active = true;

-- ── MATKA ──────────────────────────────────────────────────────────────────
-- Markets (Kalyan, Milan, etc.) each run a daily draw with open/close windows.
CREATE TABLE IF NOT EXISTS matka_markets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(80) NOT NULL,
  open_time TIME NOT NULL,          -- daily open-bet cutoff
  close_time TIME NOT NULL,         -- daily close-bet cutoff
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One draw per market per day. open_* settles "open" bets, close_* + jodi settle the rest.
CREATE TABLE IF NOT EXISTS matka_draws (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id UUID NOT NULL REFERENCES matka_markets(id),
  draw_date DATE NOT NULL,
  open_panna VARCHAR(3),            -- e.g. '123'
  open_digit SMALLINT,             -- 0-9 (sum of open panna, mod 10)
  close_panna VARCHAR(3),
  close_digit SMALLINT,
  jodi VARCHAR(2),                 -- open_digit followed by close_digit
  status VARCHAR(16) NOT NULL DEFAULT 'open', -- open | closed | open_declared | settled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, draw_date)
);

CREATE TABLE IF NOT EXISTS matka_bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  draw_id UUID NOT NULL REFERENCES matka_draws(id),
  bet_type VARCHAR(16) NOT NULL,   -- single | jodi | single_panna | double_panna | triple_panna
  session VARCHAR(8) NOT NULL DEFAULT 'open', -- open | close (which half it settles on)
  number VARCHAR(3) NOT NULL,      -- the chosen number/panna
  amount NUMERIC(12,2) NOT NULL,
  multiplier NUMERIC(8,2) NOT NULL,-- payout multiple for this bet type
  potential_payout NUMERIC(14,2) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | won | lost
  payout NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_matka_bets_user ON matka_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_matka_bets_draw ON matka_bets(draw_id);

-- ── LOTTERY ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lottery_draws (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(80) NOT NULL,
  ticket_price NUMERIC(10,2) NOT NULL,
  draw_time TIMESTAMPTZ NOT NULL,
  digits SMALLINT NOT NULL DEFAULT 4,   -- ticket number length (e.g. 4 → 0000-9999)
  prize_multiplier NUMERIC(10,2) NOT NULL DEFAULT 1000, -- exact-match payout multiple
  winning_number VARCHAR(8),
  status VARCHAR(12) NOT NULL DEFAULT 'open', -- open | drawn | settled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lottery_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  draw_id UUID NOT NULL REFERENCES lottery_draws(id),
  user_id UUID NOT NULL REFERENCES users(id),
  ticket_number VARCHAR(8) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  prize NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user ON lottery_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_draw ON lottery_tickets(draw_id);

-- ── CRICKET ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cricket_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  series VARCHAR(80) NOT NULL,      -- 'IPL 2026', 'ICC T20 World Cup', ...
  format VARCHAR(16) NOT NULL,      -- t20 | odi | test | ipl
  team_a VARCHAR(60) NOT NULL,
  team_b VARCHAR(60) NOT NULL,
  team_a_short VARCHAR(8),
  team_b_short VARCHAR(8),
  start_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'upcoming', -- upcoming | live | closed | settled
  result_winner VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cricket_matches_status ON cricket_matches(status);

-- A market is one question on a match (match winner, top batsman, ...). Options
-- and their decimal odds live in JSONB: [{ "key":"a", "label":"India", "odds":1.8 }].
CREATE TABLE IF NOT EXISTS cricket_markets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES cricket_matches(id),
  market_type VARCHAR(32) NOT NULL, -- match_winner | top_batsman | total_runs | toss_winner
  label VARCHAR(120) NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(12) NOT NULL DEFAULT 'open', -- open | suspended | settled
  result_key VARCHAR(40),           -- winning option key once settled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cricket_markets_match ON cricket_markets(match_id);

CREATE TABLE IF NOT EXISTS cricket_bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  match_id UUID NOT NULL REFERENCES cricket_matches(id),
  market_id UUID NOT NULL REFERENCES cricket_markets(id),
  option_key VARCHAR(40) NOT NULL,
  option_label VARCHAR(120) NOT NULL,
  odds NUMERIC(8,2) NOT NULL,       -- locked at bet time
  amount NUMERIC(12,2) NOT NULL,
  potential_payout NUMERIC(14,2) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | won | lost | void
  payout NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cricket_bets_user ON cricket_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_cricket_bets_match ON cricket_bets(match_id);

-- Seed a couple of Matka markets so the screen isn't empty.
INSERT INTO matka_markets (name, open_time, close_time, sort_order) VALUES
  ('Kalyan',       '10:00', '12:00', 1),
  ('Milan Day',    '13:00', '15:00', 2),
  ('Rajdhani Night','21:00','23:00', 3)
ON CONFLICT DO NOTHING;
