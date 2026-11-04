-- Migration 097: Seed Multi-Sport Fixtures & Odds Markets (Cricket, Football, Tennis, Basketball, Combat, NFL)
BEGIN;

-- Helper function or direct inserts for multi-sport matches with unique match_api_id
INSERT INTO cricket_matches (id, series, format, team_a, team_b, team_a_short, team_b_short, start_time, status, match_api_id, live_score, team_a_flag, team_b_flag)
VALUES
  -- 🏏 Cricket
  (
    'a1000000-0000-0000-0000-000000000001',
    'IPL 2026',
    'cricket_ipl',
    'Chennai Super Kings',
    'Mumbai Indians',
    'CSK',
    'MI',
    NOW() + INTERVAL '2 hours',
    'upcoming',
    'seed_cricket_csk_mi_2026',
    '{"description": "Toss at 7:00 PM IST", "runs": null}'::jsonb,
    'https://flagcdn.com/w80/in.png',
    'https://flagcdn.com/w80/in.png'
  ),
  (
    'a1000000-0000-0000-0000-000000000002',
    'ICC Men''s T20 World Cup',
    'cricket_t20',
    'India',
    'Australia',
    'IND',
    'AUS',
    NOW() - INTERVAL '30 minutes',
    'live',
    'seed_cricket_ind_aus_2026',
    '{"runs": 164, "wickets": 4, "overs": "17.2", "description": "India batting · Run Rate 9.46"}'::jsonb,
    'https://flagcdn.com/w80/in.png',
    'https://flagcdn.com/w80/au.png'
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    'IPL 2026',
    'cricket_ipl',
    'Royal Challengers Bengaluru',
    'Kolkata Knight Riders',
    'RCB',
    'KKR',
    NOW() + INTERVAL '1 day',
    'upcoming',
    'seed_cricket_rcb_kkr_2026',
    '{"description": "Chinnaswamy Stadium, Bengaluru"}'::jsonb,
    'https://flagcdn.com/w80/in.png',
    'https://flagcdn.com/w80/in.png'
  ),

  -- ⚽ Football / Soccer
  (
    'a2000000-0000-0000-0000-000000000001',
    'English Premier League',
    'soccer_epl',
    'Arsenal',
    'Chelsea',
    'ARS',
    'CHE',
    NOW() + INTERVAL '3 hours',
    'upcoming',
    'seed_soccer_arsenal_chelsea_2026',
    '{"description": "Emirates Stadium, London"}'::jsonb,
    'https://flagcdn.com/w80/gb-eng.png',
    'https://flagcdn.com/w80/gb-eng.png'
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'UEFA Champions League',
    'soccer_uefa_champs_league',
    'Real Madrid',
    'Bayern Munich',
    'RMA',
    'BAY',
    NOW() - INTERVAL '15 minutes',
    'live',
    'seed_soccer_rm_bayern_2026',
    '{"runs": 2, "wickets": 1, "overs": "65''", "description": "Real Madrid 2 - 1 Bayern Munich (65'')"}'::jsonb,
    'https://flagcdn.com/w80/es.png',
    'https://flagcdn.com/w80/de.png'
  ),
  (
    'a2000000-0000-0000-0000-000000000003',
    'English Premier League',
    'soccer_epl',
    'Manchester City',
    'Liverpool',
    'MCI',
    'LIV',
    NOW() + INTERVAL '18 hours',
    'upcoming',
    'seed_soccer_mancity_liverpool_2026',
    '{"description": "Etihad Stadium"}'::jsonb,
    'https://flagcdn.com/w80/gb-eng.png',
    'https://flagcdn.com/w80/gb-eng.png'
  ),
  (
    'a2000000-0000-0000-0000-000000000004',
    'Indian Super League',
    'soccer_isl',
    'Mohun Bagan SG',
    'Mumbai City FC',
    'MBSG',
    'MCFC',
    NOW() + INTERVAL '6 hours',
    'upcoming',
    'seed_soccer_mb_mcfc_2026',
    '{"description": "Salt Lake Stadium, Kolkata"}'::jsonb,
    'https://flagcdn.com/w80/in.png',
    'https://flagcdn.com/w80/in.png'
  ),

  -- 🎾 Tennis
  (
    'a3000000-0000-0000-0000-000000000001',
    'Wimbledon Championships',
    'tennis_atp',
    'Carlos Alcaraz',
    'Jannik Sinner',
    'ALC',
    'SIN',
    NOW() + INTERVAL '4 hours',
    'upcoming',
    'seed_tennis_alcaraz_sinner_2026',
    '{"description": "Centre Court · Men''s Singles Final"}'::jsonb,
    'https://flagcdn.com/w80/es.png',
    'https://flagcdn.com/w80/it.png'
  ),
  (
    'a3000000-0000-0000-0000-000000000002',
    'ATP Masters 1000',
    'tennis_atp',
    'Novak Djokovic',
    'Daniil Medvedev',
    'DJO',
    'MED',
    NOW() - INTERVAL '40 minutes',
    'live',
    'seed_tennis_djokovic_medvedev_2026',
    '{"runs": 6, "wickets": 4, "overs": "Set 2 (3-2)", "description": "Set 1: 6-4 | Set 2: 3-2 on serve"}'::jsonb,
    'https://flagcdn.com/w80/rs.png',
    'https://flagcdn.com/w80/mc.png'
  ),

  -- 🏀 Basketball
  (
    'a4000000-0000-0000-0000-000000000001',
    'NBA Championship',
    'basketball_nba',
    'Los Angeles Lakers',
    'Boston Celtics',
    'LAL',
    'BOS',
    NOW() + INTERVAL '5 hours',
    'upcoming',
    'seed_basketball_lal_bos_2026',
    '{"description": "Crypto.com Arena, Los Angeles"}'::jsonb,
    'https://flagcdn.com/w80/us.png',
    'https://flagcdn.com/w80/us.png'
  ),
  (
    'a4000000-0000-0000-0000-000000000002',
    'NBA Championship',
    'basketball_nba',
    'Golden State Warriors',
    'Chicago Bulls',
    'GSW',
    'CHI',
    NOW() - INTERVAL '20 minutes',
    'live',
    'seed_basketball_gsw_chi_2026',
    '{"runs": 58, "wickets": 52, "overs": "Q3 04:12", "description": "Warriors 58 - 52 Bulls (Q3)"}'::jsonb,
    'https://flagcdn.com/w80/us.png',
    'https://flagcdn.com/w80/us.png'
  ),

  -- 🥊 Combat Sports (UFC & Boxing)
  (
    'a5000000-0000-0000-0000-000000000001',
    'UFC 315 Main Event',
    'mma_ufc',
    'Islam Makhachev',
    'Arman Tsarukyan',
    'MAK',
    'TSA',
    NOW() + INTERVAL '8 hours',
    'upcoming',
    'seed_combat_makhachev_tsarukyan_2026',
    '{"description": "UFC Lightweight World Championship"}'::jsonb,
    'https://flagcdn.com/w80/ru.png',
    'https://flagcdn.com/w80/am.png'
  ),

  -- 🏈 American Football (NFL)
  (
    'a6000000-0000-0000-0000-000000000001',
    'NFL Championship',
    'americanfootball_nfl',
    'Kansas City Chiefs',
    'San Francisco 49ers',
    'KC',
    'SF',
    NOW() + INTERVAL '12 hours',
    'upcoming',
    'seed_nfl_chiefs_49ers_2026',
    '{"description": "Arrowhead Stadium"}'::jsonb,
    'https://flagcdn.com/w80/us.png',
    'https://flagcdn.com/w80/us.png'
  )
ON CONFLICT (match_api_id) DO UPDATE SET
  series = EXCLUDED.series,
  format = EXCLUDED.format,
  team_a = EXCLUDED.team_a,
  team_b = EXCLUDED.team_b,
  team_a_short = EXCLUDED.team_a_short,
  team_b_short = EXCLUDED.team_b_short,
  start_time = EXCLUDED.start_time,
  status = EXCLUDED.status,
  live_score = EXCLUDED.live_score,
  team_a_flag = EXCLUDED.team_a_flag,
  team_b_flag = EXCLUDED.team_b_flag;

-- Seed Decimal Odds Markets for all multi-sport matches
INSERT INTO cricket_markets (match_id, market_type, label, options, status)
VALUES
  -- CSK vs MI
  (
    'a1000000-0000-0000-0000-000000000001',
    'match_winner',
    'Match Winner',
    '[{"key": "team_a", "label": "Chennai Super Kings", "odds": 1.90}, {"key": "team_b", "label": "Mumbai Indians", "odds": 1.92}]'::jsonb,
    'open'
  ),
  -- IND vs AUS
  (
    'a1000000-0000-0000-0000-000000000002',
    'match_winner',
    'Match Winner',
    '[{"key": "team_a", "label": "India", "odds": 1.65}, {"key": "team_b", "label": "Australia", "odds": 2.25}]'::jsonb,
    'open'
  ),
  -- RCB vs KKR
  (
    'a1000000-0000-0000-0000-000000000003',
    'match_winner',
    'Match Winner',
    '[{"key": "team_a", "label": "RCB", "odds": 1.85}, {"key": "team_b", "label": "KKR", "odds": 1.95}]'::jsonb,
    'open'
  ),
  -- Arsenal vs Chelsea
  (
    'a2000000-0000-0000-0000-000000000001',
    'match_winner',
    'Full Time Result (1X2)',
    '[{"key": "team_a", "label": "Arsenal", "odds": 1.95}, {"key": "draw", "label": "Draw", "odds": 3.40}, {"key": "team_b", "label": "Chelsea", "odds": 3.75}]'::jsonb,
    'open'
  ),
  -- Real Madrid vs Bayern
  (
    'a2000000-0000-0000-0000-000000000002',
    'match_winner',
    'Full Time Result (1X2)',
    '[{"key": "team_a", "label": "Real Madrid", "odds": 1.80}, {"key": "draw", "label": "Draw", "odds": 3.60}, {"key": "team_b", "label": "Bayern Munich", "odds": 4.10}]'::jsonb,
    'open'
  ),
  -- Man City vs Liverpool
  (
    'a2000000-0000-0000-0000-000000000003',
    'match_winner',
    'Full Time Result (1X2)',
    '[{"key": "team_a", "label": "Manchester City", "odds": 2.05}, {"key": "draw", "label": "Draw", "odds": 3.50}, {"key": "team_b", "label": "Liverpool", "odds": 3.30}]'::jsonb,
    'open'
  ),
  -- Mohun Bagan vs Mumbai City
  (
    'a2000000-0000-0000-0000-000000000004',
    'match_winner',
    'Full Time Result (1X2)',
    '[{"key": "team_a", "label": "Mohun Bagan SG", "odds": 2.10}, {"key": "draw", "label": "Draw", "odds": 3.20}, {"key": "team_b", "label": "Mumbai City FC", "odds": 3.10}]'::jsonb,
    'open'
  ),
  -- Alcaraz vs Sinner
  (
    'a3000000-0000-0000-0000-000000000001',
    'match_winner',
    'Match Winner',
    '[{"key": "team_a", "label": "Carlos Alcaraz", "odds": 1.92}, {"key": "team_b", "label": "Jannik Sinner", "odds": 1.88}]'::jsonb,
    'open'
  ),
  -- Djokovic vs Medvedev
  (
    'a3000000-0000-0000-0000-000000000002',
    'match_winner',
    'Match Winner',
    '[{"key": "team_a", "label": "Novak Djokovic", "odds": 1.75}, {"key": "team_b", "label": "Daniil Medvedev", "odds": 2.15}]'::jsonb,
    'open'
  ),
  -- Lakers vs Celtics
  (
    'a4000000-0000-0000-0000-000000000001',
    'match_winner',
    'Moneyline (Winner)',
    '[{"key": "team_a", "label": "LA Lakers", "odds": 2.15}, {"key": "team_b", "label": "Boston Celtics", "odds": 1.72}]'::jsonb,
    'open'
  ),
  -- Warriors vs Bulls
  (
    'a4000000-0000-0000-0000-000000000002',
    'match_winner',
    'Moneyline (Winner)',
    '[{"key": "team_a", "label": "Golden State Warriors", "odds": 1.62}, {"key": "team_b", "label": "Chicago Bulls", "odds": 2.30}]'::jsonb,
    'open'
  ),
  -- Makhachev vs Tsarukyan
  (
    'a5000000-0000-0000-0000-000000000001',
    'match_winner',
    'Fight Winner',
    '[{"key": "team_a", "label": "Islam Makhachev", "odds": 1.45}, {"key": "team_b", "label": "Arman Tsarukyan", "odds": 2.80}]'::jsonb,
    'open'
  ),
  -- Chiefs vs 49ers
  (
    'a6000000-0000-0000-0000-000000000001',
    'match_winner',
    'Moneyline (Winner)',
    '[{"key": "team_a", "label": "Kansas City Chiefs", "odds": 1.82}, {"key": "team_b", "label": "San Francisco 49ers", "odds": 2.02}]'::jsonb,
    'open'
  )
ON CONFLICT (match_id, market_type) DO UPDATE SET
  label = EXCLUDED.label,
  options = EXCLUDED.options,
  status = EXCLUDED.status;

COMMIT;
