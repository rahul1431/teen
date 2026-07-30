-- Re-seed the rummy game_configs row. It existed in 001_initial.sql but was
-- deleted in 009_betting_games.sql back when the feature was shelved;
-- game_type_enum already contains 'rummy' so no enum change is needed.
INSERT INTO game_configs
  (game_type, is_active, min_players, max_players, stake_options, rake_percent,
   bot_fill_enabled, bot_fill_delay_seconds, max_bot_ratio, bot_difficulty, special_rules)
VALUES
  ('rummy', false, 2, 6, '{10,50,100,500}', 5.00,
   true, 8, 0.75, 'medium',
   jsonb_build_object(
     'deck_count', 2,
     'wild_joker_enabled', true,
     'first_drop_allowed', true,
     'turn_timeout_seconds', 30
   ))
ON CONFLICT (game_type) DO NOTHING;
