-- Migration: 099_rummy_bot_training.sql
-- Description: Create rummy_bot_profiles table and initialize baseline AI difficulty parameters

CREATE TABLE IF NOT EXISTS rummy_bot_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  difficulty character varying(10) NOT NULL UNIQUE CHECK (difficulty IN ('easy', 'medium', 'hard')),
  win_rate_target numeric(5,2),
  drop_probability numeric(5,4),
  open_draw_probability numeric(5,4),
  declare_speed_factor numeric(5,4),
  avg_decision_delay_ms integer,
  avg_stake_preference numeric(10,2),
  aggression_score numeric(4,2),
  sample_size integer DEFAULT 0,
  last_rebuilt_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

INSERT INTO rummy_bot_profiles (difficulty, win_rate_target, drop_probability, open_draw_probability, declare_speed_factor, avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size, last_rebuilt_at)
VALUES
  ('easy', 25.00, 0.4000, 0.3500, 0.4000, 2500, 20.00, 0.50, 50, now()),
  ('medium', 48.00, 0.2500, 0.6000, 0.7000, 1800, 50.00, 1.80, 120, now()),
  ('hard', 72.00, 0.1000, 0.8500, 0.9500, 1200, 100.00, 3.20, 240, now())
ON CONFLICT (difficulty) DO UPDATE SET
  win_rate_target = EXCLUDED.win_rate_target,
  drop_probability = EXCLUDED.drop_probability,
  open_draw_probability = EXCLUDED.open_draw_probability,
  declare_speed_factor = EXCLUDED.declare_speed_factor,
  avg_decision_delay_ms = EXCLUDED.avg_decision_delay_ms;
