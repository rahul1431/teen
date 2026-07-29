-- Seed famous international cricket countries, players, matches, and fantasy contests

-- 1. Insert/Update Countries and Flags
INSERT INTO cricket_countries (id, name, flag_url) VALUES
  ('in', 'India', 'https://flagcdn.com/w80/in.png'),
  ('au', 'Australia', 'https://flagcdn.com/w80/au.png'),
  ('gb', 'England', 'https://flagcdn.com/w80/gb.png'),
  ('pk', 'Pakistan', 'https://flagcdn.com/w80/pk.png'),
  ('za', 'South Africa', 'https://flagcdn.com/w80/za.png'),
  ('nz', 'New Zealand', 'https://flagcdn.com/w80/nz.png')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, flag_url = EXCLUDED.flag_url;

-- 2. Insert Famous Players
-- Indian Players
INSERT INTO cricket_fantasy_players (id, name, role, credits, team_name, avatar_url) VALUES
  ('44c8c7db-115f-4d37-88f5-46ff85aa0001', 'Virat Kohli', 'batsman', 10.0, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Virat'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0002', 'Rohit Sharma', 'batsman', 9.5, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Rohit'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0003', 'Yashasvi Jaiswal', 'batsman', 8.5, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Yashasvi'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0004', 'KL Rahul', 'wicket_keeper', 9.0, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=KL_Rahul'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0005', 'Rishabh Pant', 'wicket_keeper', 9.0, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Rishabh'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0006', 'Hardik Pandya', 'all_rounder', 9.5, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Hardik'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0007', 'Ravindra Jadeja', 'all_rounder', 9.0, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Ravindra'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0008', 'Axar Patel', 'all_rounder', 8.0, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Axar'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0009', 'Jasprit Bumrah', 'bowler', 9.5, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Bumrah'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0010', 'Mohammed Shami', 'bowler', 8.5, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Shami'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0011', 'Kuldeep Yadav', 'bowler', 8.5, 'India', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Kuldeep')
ON CONFLICT (id) DO NOTHING;

-- Australian Players
INSERT INTO cricket_fantasy_players (id, name, role, credits, team_name, avatar_url) VALUES
  ('44c8c7db-115f-4d37-88f5-46ff85aa0012', 'David Warner', 'batsman', 9.0, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Warner'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0013', 'Travis Head', 'batsman', 9.5, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Travis'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0014', 'Glenn Maxwell', 'all_rounder', 9.5, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Maxwell'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0015', 'Mitchell Marsh', 'all_rounder', 9.0, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Marsh'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0016', 'Marcus Stoinis', 'all_rounder', 8.5, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Stoinis'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0017', 'Matthew Wade', 'wicket_keeper', 8.5, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Wade'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0018', 'Alex Carey', 'wicket_keeper', 8.0, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Carey'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0019', 'Pat Cummins', 'bowler', 9.5, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Cummins'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0020', 'Mitchell Starc', 'bowler', 9.0, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Starc'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0021', 'Josh Hazlewood', 'bowler', 8.5, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Hazlewood'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0022', 'Adam Zampa', 'bowler', 8.5, 'Australia', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Zampa')
ON CONFLICT (id) DO NOTHING;

-- 3. Seed Mock Upcoming Match (India vs Australia)
INSERT INTO cricket_matches (id, series, format, team_a, team_b, team_a_short, team_b_short, start_time, status, team_a_flag, team_b_flag) VALUES
  ('55c8c7db-115f-4d37-88f5-46ff85aa0001', 'ICC T20 World Cup', 't20', 'India', 'Australia', 'IND', 'AUS', NOW() + INTERVAL '1 day', 'upcoming', 'https://flagcdn.com/w80/in.png', 'https://flagcdn.com/w80/au.png')
ON CONFLICT (id) DO UPDATE SET status = 'upcoming', start_time = NOW() + INTERVAL '1 day';

-- 4. Map Mock Players to the Match Squad
INSERT INTO cricket_match_players (match_id, player_id, fantasy_points)
SELECT '55c8c7db-115f-4d37-88f5-46ff85aa0001', id, 0.0
FROM cricket_fantasy_players
WHERE team_name IN ('India', 'Australia')
ON CONFLICT (match_id, player_id) DO NOTHING;

-- 5. Seed Mock Fantasy Contests (Leagues) for the Match
INSERT INTO cricket_fantasy_leagues (id, match_id, name, entry_fee, prize_pool, max_entries, current_entries, status, prize_distribution) VALUES
  ('66c8c7db-115f-4d37-88f5-46ff85aa0001', '55c8c7db-115f-4d37-88f5-46ff85aa0001', 'Mega Contest 🏆', 49.00, 10000.00, 250, 0, 'open', '[{"rank_start":1,"rank_end":1,"payout":5000},{"rank_start":2,"rank_end":2,"payout":2000},{"rank_start":3,"rank_end":5,"payout":1000}]'::jsonb),
  ('66c8c7db-115f-4d37-88f5-46ff85aa0002', '55c8c7db-115f-4d37-88f5-46ff85aa0001', 'Head-to-Head 🤝', 250.00, 450.00, 2, 0, 'open', '[{"rank_start":1,"rank_end":1,"payout":450}]'::jsonb),
  ('66c8c7db-115f-4d37-88f5-46ff85aa0003', '55c8c7db-115f-4d37-88f5-46ff85aa0001', 'Practice Contest 🆓', 0.00, 0.00, 100, 0, 'open', '[]'::jsonb)
ON CONFLICT (id) DO UPDATE SET status = 'open';
