-- Migration 109: Ensure all 7 games have complete baseline bot profiles and game config support
-- Games: teen_patti, ludo, rummy, aviator, color_prediction, matka, lottery

-- 1. Ensure game_configs has all 7 games and personalization_canary_pct enabled
INSERT INTO game_configs (game_type, is_active, min_players, max_players, rake_percent, personalization_canary_pct, bot_fill_enabled)
VALUES
  ('teen_patti', true, 2, 6, 5.00, 0, true),
  ('ludo', true, 2, 4, 10.00, 0, true),
  ('rummy', true, 2, 6, 8.00, 0, true),
  ('aviator', true, 1, 100, 5.00, 0, true),
  ('color_prediction', true, 1, 1000, 2.00, 0, true),
  ('matka', true, 1, 1000, 5.00, 0, true),
  ('lottery', true, 1, 10000, 10.00, 0, true)
ON CONFLICT (game_type) DO UPDATE SET
  is_active = true;

-- 2. Ensure all 7 games have easy, medium, hard profiles in bot_profiles
INSERT INTO bot_profiles (game_type, difficulty, win_rate_target, avg_decision_delay_ms, aggression_score, sample_size, created_at, last_rebuild_at)
VALUES
  -- Teen Patti
  ('teen_patti', 'easy', 35.00, 2500, 0.40, 50, now(), now()),
  ('teen_patti', 'medium', 50.00, 1800, 1.20, 100, now(), now()),
  ('teen_patti', 'hard', 65.00, 1200, 2.50, 200, now(), now()),
  -- Ludo
  ('ludo', 'easy', 30.00, 2000, 0.30, 50, now(), now()),
  ('ludo', 'medium', 50.00, 1500, 1.00, 100, now(), now()),
  ('ludo', 'hard', 70.00, 1000, 2.20, 200, now(), now()),
  -- Rummy
  ('rummy', 'easy', 25.00, 2500, 0.50, 50, now(), now()),
  ('rummy', 'medium', 48.00, 1800, 1.80, 120, now(), now()),
  ('rummy', 'hard', 72.00, 1200, 3.20, 240, now(), now()),
  -- Aviator
  ('aviator', 'easy', 30.00, 2000, 0.40, 50, now(), now()),
  ('aviator', 'medium', 50.00, 1500, 1.20, 100, now(), now()),
  ('aviator', 'hard', 65.00, 1000, 2.50, 200, now(), now()),
  -- Color Prediction
  ('color_prediction', 'easy', 35.00, 1500, 0.50, 50, now(), now()),
  ('color_prediction', 'medium', 50.00, 1200, 1.30, 100, now(), now()),
  ('color_prediction', 'hard', 65.00, 800, 2.40, 200, now(), now()),
  -- Matka
  ('matka', 'easy', 20.00, 2500, 0.30, 50, now(), now()),
  ('matka', 'medium', 45.00, 1800, 1.10, 100, now(), now()),
  ('matka', 'hard', 65.00, 1200, 2.20, 200, now(), now()),
  -- Lottery
  ('lottery', 'easy', 15.00, 3000, 0.20, 50, now(), now()),
  ('lottery', 'medium', 35.00, 2000, 0.90, 100, now(), now()),
  ('lottery', 'hard', 55.00, 1500, 1.80, 200, now(), now())
ON CONFLICT (game_type, difficulty) DO UPDATE SET
  win_rate_target = EXCLUDED.win_rate_target,
  avg_decision_delay_ms = EXCLUDED.avg_decision_delay_ms,
  aggression_score = EXCLUDED.aggression_score;
