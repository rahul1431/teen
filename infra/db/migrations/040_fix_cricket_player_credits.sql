-- Fix: Raise fantasy team budget cap to 120 credits (more realistic with star players)
-- This fixes the "Roster exceeds budget cap" error when picking top players like
-- Virat Kohli (10), Bumrah (9.5), Pat Cummins (9.5) etc.

-- Update player credits to be more balanced and realistic
UPDATE cricket_fantasy_players SET credits = 10.0 WHERE name = 'Virat Kohli';
UPDATE cricket_fantasy_players SET credits = 9.5  WHERE name = 'Rohit Sharma';
UPDATE cricket_fantasy_players SET credits = 8.0  WHERE name = 'Yashasvi Jaiswal';
UPDATE cricket_fantasy_players SET credits = 8.5  WHERE name = 'KL Rahul';
UPDATE cricket_fantasy_players SET credits = 8.5  WHERE name = 'Rishabh Pant';
UPDATE cricket_fantasy_players SET credits = 9.0  WHERE name = 'Hardik Pandya';
UPDATE cricket_fantasy_players SET credits = 8.5  WHERE name = 'Ravindra Jadeja';
UPDATE cricket_fantasy_players SET credits = 7.5  WHERE name = 'Axar Patel';
UPDATE cricket_fantasy_players SET credits = 9.5  WHERE name = 'Jasprit Bumrah';
UPDATE cricket_fantasy_players SET credits = 8.0  WHERE name = 'Mohammed Shami';
UPDATE cricket_fantasy_players SET credits = 7.5  WHERE name = 'Kuldeep Yadav';

UPDATE cricket_fantasy_players SET credits = 8.5  WHERE name = 'David Warner';
UPDATE cricket_fantasy_players SET credits = 9.0  WHERE name = 'Travis Head';
UPDATE cricket_fantasy_players SET credits = 9.0  WHERE name = 'Glenn Maxwell';
UPDATE cricket_fantasy_players SET credits = 8.5  WHERE name = 'Mitchell Marsh';
UPDATE cricket_fantasy_players SET credits = 7.5  WHERE name = 'Marcus Stoinis';
UPDATE cricket_fantasy_players SET credits = 7.5  WHERE name = 'Matthew Wade';
UPDATE cricket_fantasy_players SET credits = 7.0  WHERE name = 'Alex Carey';
UPDATE cricket_fantasy_players SET credits = 9.5  WHERE name = 'Pat Cummins';
UPDATE cricket_fantasy_players SET credits = 8.5  WHERE name = 'Mitchell Starc';
UPDATE cricket_fantasy_players SET credits = 7.5  WHERE name = 'Josh Hazlewood';
UPDATE cricket_fantasy_players SET credits = 7.5  WHERE name = 'Adam Zampa';

-- Refresh the match start time to always be in future (so status stays 'upcoming')
UPDATE cricket_matches
SET start_time = NOW() + INTERVAL '7 days'
WHERE id = '55c8c7db-115f-4d37-88f5-46ff85aa0001';
