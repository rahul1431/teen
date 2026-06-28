-- infra/db/migrations/016_bot_learning.sql
-- Phase 3: Bot Learning — difficulty-tier profiles and config

CREATE TABLE IF NOT EXISTS bot_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type             VARCHAR(30) NOT NULL,
  difficulty            VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  win_rate_target       NUMERIC(5,2),
  fold_probability      NUMERIC(5,4),
  call_probability      NUMERIC(5,4),
  raise_probability     NUMERIC(5,4),
  avg_decision_delay_ms INTEGER,
  avg_stake_preference  NUMERIC(10,2),
  aggression_score      NUMERIC(4,2),
  sample_size           INTEGER DEFAULT 0,
  last_rebuilt_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_bot_profiles_game_difficulty UNIQUE (game_type, difficulty)
);

CREATE INDEX IF NOT EXISTS idx_bot_profiles_game_type  ON bot_profiles(game_type);
CREATE INDEX IF NOT EXISTS idx_bot_profiles_difficulty ON bot_profiles(difficulty);

-- Seed fallback profiles for all 3 games × 3 difficulties
-- These are used until real player data accumulates (sample_size=0 = fallback)
INSERT INTO bot_profiles
  (game_type, difficulty, win_rate_target, fold_probability, call_probability, raise_probability,
   avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size)
VALUES
  ('teen_patti', 'easy',   35.0, 0.4500, 0.4500, 0.1000, 2800, 10.0, 1.8, 0),
  ('teen_patti', 'medium', 50.0, 0.3000, 0.4700, 0.2300, 2000, 50.0, 3.5, 0),
  ('teen_patti', 'hard',   65.0, 0.1800, 0.4200, 0.4000, 1400, 100.0, 6.2, 0),
  ('ludo',       'easy',   30.0, 0.4500, 0.4500, 0.1000, 3000, 10.0, 1.5, 0),
  ('ludo',       'medium', 50.0, 0.3000, 0.5000, 0.2000, 2200, 50.0, 3.0, 0),
  ('ludo',       'hard',   70.0, 0.1500, 0.4500, 0.4000, 1200, 100.0, 6.5, 0),
  ('aviator',    'easy',   30.0, 0.5000, 0.4000, 0.1000, 3500, 10.0, 1.2, 0),
  ('aviator',    'medium', 50.0, 0.3500, 0.4500, 0.2000, 2500, 50.0, 2.8, 0),
  ('aviator',    'hard',   65.0, 0.2000, 0.4000, 0.4000, 1500, 100.0, 5.5, 0)
ON CONFLICT (game_type, difficulty) DO NOTHING;

CREATE TABLE IF NOT EXISTS bot_learning_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO bot_learning_config (key, value) VALUES
  ('rebuild_hour',            '2'),
  ('stream_lookback_days',    '7'),
  ('history_lookback_days',   '30'),
  ('min_sample_size',         '10'),
  ('easy_percentile_max',     '25'),
  ('medium_percentile_min',   '40'),
  ('medium_percentile_max',   '60'),
  ('hard_percentile_min',     '75')
ON CONFLICT (key) DO NOTHING;
