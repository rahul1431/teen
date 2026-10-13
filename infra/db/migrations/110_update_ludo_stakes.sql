-- Update Ludo stake options: remove 50, add 100, 500, 1000, 2000, 5000, 10000
UPDATE game_configs
SET
  stake_options = '{100,500,1000,2000,5000,10000}',
  updated_at = NOW()
WHERE game_type = 'ludo';

-- Ensure Rummy stake options match: 100, 500, 1000, 2000, 5000, 10000
UPDATE game_configs
SET
  stake_options = '{100,500,1000,2000,5000,10000}',
  updated_at = NOW()
WHERE game_type = 'rummy';

-- Ensure Teen Patti stake options match: 10, 50, 100, 500, 1000
UPDATE game_configs
SET
  stake_options = '{10,50,100,500,1000}',
  updated_at = NOW()
WHERE game_type = 'teen_patti';
