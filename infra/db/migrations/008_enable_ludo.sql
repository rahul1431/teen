-- Enable the Ludo multiplayer game and tune its matchmaking/economy config.
-- The Ludo engine (services/game-engines/ludo) is server-authoritative for
-- rolls, moves, captures and payouts; these values drive the gateway's
-- matchmaking + bot-fill behaviour.

UPDATE game_configs
SET
  is_active = true,
  min_players = 2,
  max_players = 4,
  stake_options = '{10,50,100,500}',
  rake_percent = 5.00,
  bot_fill_enabled = true,
  bot_fill_delay_seconds = 8,
  max_bot_ratio = 0.75,
  bot_difficulty = 'medium',
  special_rules = jsonb_build_object(
    'tokens_per_player', 4,
    'safe_cells', jsonb_build_array(0, 8, 13, 21, 26, 34, 39, 47),
    'extra_turn_on_six', true,
    'extra_turn_on_capture', true,
    'three_sixes_forfeit', true,
    'turn_timeout_seconds', 20
  ),
  updated_at = NOW()
WHERE game_type = 'ludo';
