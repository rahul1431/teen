-- United Arab Emirates: country row + curated squad, the fifteenth team. Same
-- shape as 20260802c_cricket_australia_squad.sql — see that file (and the
-- India seed it derives from) for why roster membership, role, credits and
-- batting/bowling style are committed rather than fetched. Photo, DOB and
-- Wikidata ID are filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team United Arab Emirates in the admin panel
-- after migrating.
--
-- This squad needed more correction than any other so far — worth reading in
-- full before trusting the pattern on a future team with a similarly
-- international roster (UAE's squad is majority South Asian-born players
-- naturalised through residency, which both scrambles Wikidata's citizenship
-- tagging and makes wrong-country name collisions much more likely).

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q878 is the UAE; confirmed against two
-- players' own citizenship claims (Matiullah Khan, Ethan D'Souza) rather than
-- assumed, since most of this squad's players carry no P27 claim at all.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'ae', 'United Arab Emirates',
       'https://upload.wikimedia.org/wikipedia/commons/c/cb/Flag_of_the_United_Arab_Emirates.svg',
       'Q878'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'united arab emirates');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q878'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/c/cb/Flag_of_the_United_Arab_Emirates.svg')
WHERE lower(name) = 'united arab emirates';

-- ── Curated UAE squad ──
-- Every name below was checked against Wikidata AND, for anything ambiguous
-- or suspicious, cross-referenced against ESPNcricinfo/ICC before being
-- committed. Six needed pinning:
--
--   Muhammad Waseem (captain)  Q108803714 — labelled "Waseem Muhammad"
--                              (reversed); the bare article "Muhammad Waseem"
--                              is a Pakistani BOXER, not the cricketer
--   Asif Khan                  Q21621679  — shared by name with a Pakistani-
--                              domestic cricketer, an Indian cricketer and a
--                              German cricketer; this is the Pakistani-born
--                              UAE batter (moved 2017, ODI debut 2022)
--   Junaid Siddique             Q70912138  — shared with a Bangladeshi
--                              cricketer, whom the bare article defaults to
--   Karthik Meiyappan            Q77411512  — labelled "Palaniapan Meiyappan"
--   Zahoor Khan                  Q28341374  — labelled "Zahoor Farooqi"
--   Haider Ali                   Q60734173  — shared with three Pakistan-only
--                              cricketers and an Omani; this is the
--                              Pakistani-born UAE international (T20I debut
--                              May 2025, in the 2026 T20 World Cup squad).
--                              Its own Wikidata description still reads
--                              "Pakistani cricketer" — not yet updated for his
--                              switch, the same lag pattern as Max O'Dowd/
--                              Murray Commins in earlier seeds
--   Ethan D'Souza                Q123705556 — labelled "Ethan Carl D'Souza";
--                              citizenship (Q878) matches this country row
--                              directly
--   Sohaib Khan                  Q138325575 — shared with a Pakistani
--                              cricketer (Q21642664); this is the one
--                              described "indian-Emirati", born 1998
--
-- Simranjeet Singh, Muhammad Farazuddin and Muhammad Zohaib have no Wikidata
-- entity at all yet (all three are real — a 2024/2025-era international
-- debut in each case, confirmed via ESPNcricinfo/web search — just not on
-- Wikidata yet, the same as a handful of emerging players in earlier seeds).
-- Warning for the bare name "Simranjeet Singh" specifically: its Wikipedia
-- article is about an Indian FIELD HOCKEY player, not any cricketer.
--
-- Four names in the working draft did not survive verification at all, the
-- worst rate of any squad so far:
--   "Aayan Khan"      turned out to be the same person as "Aayan Afzal Khan"
--                      (already listed below) under a shortened name — a
--                      duplicate, not a distinct player
--   "Omid Rahman"      matched no real UAE cricketer anywhere
--   "Abdul Baseer"     resolved to a real, single, unambiguous Wikidata
--                      entity — a domestic Indian cricketer from Hyderabad
--                      with no UAE connection at all
--   "Waseem Ahmed"     does not exist as a UAE player; likely a garbled
--                      duplicate of the captain, Muhammad Waseem
-- All four are the same class of drafting mistake as "Kavindu Kandambi"
-- (Sri Lanka), "Shahidullah Kamawal" (Afghanistan) and "Darshan Nalkande" /
-- "Sagar Patel" (Netherlands) — a real single Wikidata match is not proof of
-- being the right person, or a real person at all.
--
-- Replaced with five players independently confirmed via ESPNcricinfo's
-- report of the actual T20 World Cup 2026 squad announcement before being
-- added — Muhammad Farooq and Sohaib Khan resolve on Wikidata (pinned above);
-- Harshit Kaushik, Mayank Kumar, Rohid Khan and Muhammad Arfan do not, the
-- same "real but not yet on Wikidata" case as Simranjeet Singh above.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_ae;
CREATE TEMP TABLE curated_squad_ae (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_ae (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Muhammad Waseem',       'batsman',       9.0, 'United Arab Emirates', 'Right-handed', NULL,                      'Q108803714'),
  ('Alishan Sharafu',       'wicket_keeper', 8.0, 'United Arab Emirates', 'Left-handed',  NULL,                      NULL),
  ('Vriitya Aravind',       'wicket_keeper', 7.5, 'United Arab Emirates', 'Right-handed', NULL,                      NULL),
  ('Aryansh Sharma',        'batsman',       7.5, 'United Arab Emirates', 'Right-handed', NULL,                      NULL),
  ('Rahul Chopra',          'batsman',       7.5, 'United Arab Emirates', 'Right-handed', NULL,                      NULL),
  ('Aayan Afzal Khan',      'all_rounder',   8.0, 'United Arab Emirates', 'Right-handed', 'Slow left-arm orthodox',  NULL),
  ('Basil Hameed',          'batsman',       7.5, 'United Arab Emirates', 'Left-handed',  NULL,                      NULL),
  ('Dhruv Parashar',        'batsman',       7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm off break',     NULL),
  ('Ansh Tandon',           'batsman',       7.5, 'United Arab Emirates', 'Right-handed', NULL,                      NULL),
  ('Ali Naseer',            'batsman',       7.5, 'United Arab Emirates', 'Right-handed', NULL,                      NULL),
  ('Sanchit Sharma',        'all_rounder',   7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm medium',        NULL),
  ('Asif Khan',             'all_rounder',   8.0, 'United Arab Emirates', 'Right-handed', 'Right-arm off break',    'Q21621679'),
  ('Rohan Mustafa',         'all_rounder',   7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm off break',    NULL),
  ('Karthik Meiyappan',     'all_rounder',   7.5, 'United Arab Emirates', 'Left-handed',  'Slow left-arm orthodox',  'Q77411512'),
  ('Simranjeet Singh',      'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Slow left-arm orthodox',  NULL),
  ('Muhammad Jawadullah',   'bowler',        8.0, 'United Arab Emirates', 'Right-handed', 'Left-arm fast-medium',    NULL),
  ('Junaid Siddique',       'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   'Q70912138'),
  ('Zawar Farid',           'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Matiullah Khan',        'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Haider Ali',            'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   'Q60734173'),
  ('Muhammad Farazuddin',   'all_rounder',   7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm off break',     NULL),
  ('Fahad Nawaz',           'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Ethan D''Souza',        'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   'Q123705556'),
  ('Muhammad Zohaib',       'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Muhammad Farooq',       'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   'Q138528442'),
  ('Sohaib Khan',           'batsman',       7.5, 'United Arab Emirates', 'Right-handed', NULL,                      'Q138325575'),
  ('Harshit Kaushik',       'batsman',       7.5, 'United Arab Emirates', 'Right-handed', NULL,                      NULL),
  ('Mayank Kumar',          'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm medium',        NULL),
  ('Rohid Khan',            'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Muhammad Arfan',        'bowler',        7.5, 'United Arab Emirates', 'Right-handed', 'Right-arm fast-medium',   NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'united arab emirates' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_ae v
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
FROM curated_squad_ae v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every UAE player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'united arab emirates' LIMIT 1)
WHERE team_name = 'United Arab Emirates' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_ae;
