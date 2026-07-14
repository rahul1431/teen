-- Seed England fantasy players — India/Australia already have a full XI
-- (migration 039), England only had its flag/country row, no players.
-- 'gb' / England already exists in cricket_countries from migration 039.

INSERT INTO cricket_fantasy_players (id, name, role, credits, team_name, avatar_url) VALUES
  ('44c8c7db-115f-4d37-88f5-46ff85aa0023', 'Joe Root', 'batsman', 10.0, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Root'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0024', 'Harry Brook', 'batsman', 9.0, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Brook'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0025', 'Dawid Malan', 'batsman', 8.5, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Malan'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0026', 'Jos Buttler', 'wicket_keeper', 9.5, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Buttler'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0027', 'Jonny Bairstow', 'wicket_keeper', 8.5, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Bairstow'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0028', 'Ben Stokes', 'all_rounder', 10.0, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Stokes'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0029', 'Moeen Ali', 'all_rounder', 8.5, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Moeen'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0030', 'Liam Livingstone', 'all_rounder', 8.0, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Livingstone'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0031', 'Jofra Archer', 'bowler', 9.0, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Archer'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0032', 'Mark Wood', 'bowler', 8.5, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Wood'),
  ('44c8c7db-115f-4d37-88f5-46ff85aa0033', 'Adil Rashid', 'bowler', 8.5, 'England', 'https://api.dicebear.com/7.x/adventurer/svg?seed=Rashid')
ON CONFLICT (id) DO NOTHING;
