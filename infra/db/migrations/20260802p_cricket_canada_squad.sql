-- Canada: country row + curated squad, the sixteenth team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo and DOB are filled
-- afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Canada in the admin panel after migrating.
--
-- This squad had the worst hit rate of any drafted so far — roughly half the
-- initial 30 names either didn't exist, were a different real person, or
-- could not be independently confirmed. Rather than patch individual names
-- the way earlier squads did, this file's roster was rebuilt from two
-- verified sources instead of memory: (1) ESPNcricinfo's report of Canada's
-- actual T20 World Cup 2026 squad (14 names below, captained by Dilpreet
-- Bajwa), and (2) a direct Wikidata query for every entity with
-- "occupation: cricketer" AND "citizenship: Canada" (Q16), which is
-- authoritative by construction rather than dependent on a web search
-- summary being accurate. Every player below carries a pinned wikidata_id for
-- exactly that reason — this squad does not get the "single unambiguous
-- match" pass the resolver would normally rely on, because the failure mode
-- discovered here (a real, single Wikidata match that is still the wrong
-- person) makes trusting an unpinned lookup unsafe for this team specifically.
--
-- One name from the T20 World Cup squad, Shivam Sharma, is deliberately
-- EXCLUDED rather than included unpinned. He has no Wikidata entity of his
-- own, but the label "Shivam Sharma" does match two unrelated Indian
-- cricketers under the same "occupation: cricketer" filter — so an unpinned
-- lookup would not fail closed (as it does for a genuinely unmatched name
-- like Ajayveer Hundal below), it would silently attach a stranger's photo
-- and date of birth. There is no pin fix for a person with no entity, so he
-- is left out of this squad entirely rather than shipped with a live
-- mismatch risk.
--
-- Two names read as suspicious at first pass — Parth Desai and Junaid
-- Siddiqui both carry a Wikidata CITIZENSHIP claim of India/Pakistan despite
-- a "Canadian cricketer" description — but both were independently confirmed
-- via ESPNcricinfo/web search as genuine long-serving Canada internationals
-- (Junaid Siddiqui: Pakistani-born, moved to Toronto age 13, ODI/T20I debut
-- 2011; Parth Desai: Canada ODI debut 2010). Same citizenship-lag pattern as
-- Max O'Dowd (Netherlands) and Murray Commins (Ireland), not a wrong match.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q16 is Canada, used directly as the
-- citizenship filter in the SPARQL query this whole squad was built from.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'ca', 'Canada',
       'https://upload.wikimedia.org/wikipedia/commons/c/cf/Flag_of_Canada.svg',
       'Q16'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'canada');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q16'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/c/cf/Flag_of_Canada.svg')
WHERE lower(name) = 'canada';

-- ── Curated Canada squad ──
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_ca;
CREATE TEMP TABLE curated_squad_ca (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_ca (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  -- From the actual T20 World Cup 2026 squad (13 of 14 non-goalkeeper-role
  -- players; Shivam Sharma excluded, see note above)
  ('Dilpreet Bajwa',        'wicket_keeper', 8.0, 'Canada', 'Left-handed',  NULL,                      'Q125946497'),
  ('Shreyas Movva',         'wicket_keeper', 7.5, 'Canada', 'Right-handed', NULL,                      'Q74225421'),
  ('Kanwarpal Tathgur',     'wicket_keeper', 7.5, 'Canada', 'Right-handed', NULL,                      'Q74225456'),
  ('Navneet Dhaliwal',      'batsman',       8.0, 'Canada', 'Right-handed', NULL,                      'Q18811026'),
  ('Yuvraj Samra',          'batsman',       7.5, 'Canada', 'Right-handed', NULL,                      'Q137785244'),
  ('Ravinderpal Singh',     'batsman',       7.5, 'Canada', 'Right-handed', NULL,                      'Q63294247'),
  ('Ansh Patel',            'batsman',       7.5, 'Canada', 'Right-handed', NULL,                      NULL),
  ('Nicholas Kirton',       'all_rounder',   8.0, 'Canada', 'Right-handed', 'Right-arm off break',     'Q48075023'),
  ('Saad Bin Zafar',        'all_rounder',   8.0, 'Canada', 'Left-handed',  'Slow left-arm orthodox',  'Q7395551'),
  ('Ajayveer Hundal',       'all_rounder',   7.5, 'Canada', 'Right-handed', 'Right-arm medium',        NULL),
  ('Jaskarandeep Singh',    'all_rounder',   7.5, 'Canada', 'Right-handed', 'Right-arm medium',        NULL),
  ('Harsh Thaker',          'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm fast-medium',   'Q56877149'),
  ('Kaleem Sana',           'bowler',        8.0, 'Canada', 'Right-handed', 'Right-arm fast-medium',   'Q86815253'),
  ('Dillon Heyliger',       'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm fast-medium',   'Q48075022'),
  -- Confirmed via web search as genuine Canada internationals, not in the
  -- 15-man T20 World Cup squad but part of the broader recent player pool
  ('Rayyan Pathan',         'all_rounder',   7.5, 'Canada', 'Right-handed', 'Right-arm fast-medium',   'Q23762055'),
  ('Nikhil Dutta',          'all_rounder',   7.5, 'Canada', 'Right-handed', 'Right-arm off break',     'Q16228152'),
  ('Jeremy Gordon',         'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm fast',          'Q16228278'),
  ('Aaron Johnson',         'all_rounder',   7.5, 'Canada', 'Right-handed', 'Right-arm medium',        'Q120735001'),
  ('Parth Desai',           'bowler',        7.5, 'Canada', 'Right-handed', 'Slow left-arm orthodox',  'Q16233094'),
  ('Junaid Siddiqui',       'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm leg break',     'Q15974434'),
  -- Confirmed real and Canadian by direct Wikidata query (occupation
  -- cricketer + citizenship Q16), not by name-based search
  ('Nitish Kumar',          'batsman',       7.5, 'Canada', 'Right-handed', NULL,                      'Q7041330'),
  ('Farhan Malik',          'batsman',       7.5, 'Canada', 'Right-handed', NULL,                      'Q21621915'),
  ('Darren Ramsammy',       'batsman',       7.5, 'Canada', 'Right-handed', NULL,                      'Q23762051'),
  ('Manny Aulakh',          'batsman',       7.5, 'Canada', 'Right-handed', NULL,                      'Q16197501'),
  ('Hiral Patel',           'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm medium',        'Q16225113'),
  ('Salman Nazar',          'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm medium',        'Q16224997'),
  ('Satsimranjit Dhindsa',  'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm medium',        'Q18811028'),
  ('Usman Limbada',         'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm fast-medium',   'Q15974344'),
  ('Umar Nawaz',            'bowler',        7.5, 'Canada', 'Right-handed', 'Right-arm fast-medium',   'Q19520022'),
  ('Srimantha Wijeratne',   'bowler',        7.5, 'Canada', 'Right-handed', 'Slow left-arm orthodox',  'Q19539032');

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'canada' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_ca v
WHERE NOT EXISTS (
  SELECT 1 FROM cricket_fantasy_players p
  WHERE lower(p.name) = lower(v.name) AND p.team_name = v.team_name
);

-- 2. Backfill onto players a squad sync already created. COALESCE only, so an
--    admin's correction survives. Role and credits are deliberately untouched:
--    those may have been tuned in the admin panel and overwriting them would
--    silently change every player's draft cost.
UPDATE cricket_fantasy_players p
SET batting_style = COALESCE(p.batting_style, v.batting_style),
    bowling_style = COALESCE(p.bowling_style, v.bowling_style),
    wikidata_id   = COALESCE(p.wikidata_id, v.wikidata_id)
FROM curated_squad_ca v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Canada player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'canada' LIMIT 1)
WHERE team_name = 'Canada' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_ca;
