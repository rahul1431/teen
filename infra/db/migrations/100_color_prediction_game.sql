-- Migration 100: Color Prediction (Wingo / Fast Parity) Game Engine & Tables

ALTER TYPE game_type_enum ADD VALUE IF NOT EXISTS 'color_prediction';

INSERT INTO game_configs (game_type, is_active, min_players, max_players, stake_options, rake_percent, bot_fill_enabled, special_rules)
VALUES (
  'color_prediction',
  true,
  1,
  10000,
  '{10,50,100,500,1000,5000}',
  5.00,
  false,
  '{"interval_seconds": 30, "min_bet": 10, "max_bet": 50000, "house_mode": "fair"}'::jsonb
)
ON CONFLICT (game_type) DO UPDATE SET
  is_active = true,
  rake_percent = 5.00,
  special_rules = EXCLUDED.special_rules;

CREATE TABLE IF NOT EXISTS color_prediction_rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_id VARCHAR(32) NOT NULL UNIQUE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open', -- 'open' | 'locked' | 'settled' | 'cancelled'
  winning_number INT, -- 0 to 9
  winning_color VARCHAR(20), -- 'green' | 'red' | 'violet_green' | 'violet_red'
  winning_size VARCHAR(10), -- 'small' | 'big'
  total_bet_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  total_payout_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  house_profit NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  manual_override_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cp_rounds_status ON color_prediction_rounds(status);
CREATE INDEX IF NOT EXISTS idx_cp_rounds_end_time ON color_prediction_rounds(end_time DESC);
CREATE INDEX IF NOT EXISTS idx_cp_rounds_period ON color_prediction_rounds(period_id);

CREATE TABLE IF NOT EXISTS color_prediction_bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES color_prediction_rounds(id) ON DELETE CASCADE,
  period_id VARCHAR(32) NOT NULL,
  bet_type VARCHAR(20) NOT NULL, -- 'color' | 'number' | 'size'
  bet_value VARCHAR(20) NOT NULL, -- 'green'/'red'/'violet' | '0'..'9' | 'big'/'small'
  amount NUMERIC(12,2) NOT NULL,
  multiplier NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'won' | 'lost' | 'refunded'
  payout NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cp_bets_round ON color_prediction_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_cp_bets_user ON color_prediction_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_cp_bets_status ON color_prediction_bets(status);
