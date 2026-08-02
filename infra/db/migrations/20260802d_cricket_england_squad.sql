-- England: country row + curated squad, the third country after India and
-- Australia. Same shape as 20260802c_cricket_australia_squad.sql — see that
-- file (and the India seed it derives from) for why roster membership, role,
-- credits and batting/bowling style are committed rather than fetched.
-- Photo, DOB and Wikidata ID are filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team England in the admin panel after migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error.
--
-- Q21 is England-the-country. Note this does NOT buy the disambiguation it
-- does for India and Australia: the resolver's citizenship prefilter matches
-- P27, and England players are citizens of the United Kingdom (Q145), so the
-- prefilter finds nothing and falls back to the plain name lookup. Q145 would
-- be no better — Scottish, Welsh and some Irish cricketers share it. The
-- squad's ambiguous names are pinned by Wikidata ID below instead.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'eng', 'England',
       'https://upload.wikimedia.org/wikipedia/commons/b/be/Flag_of_England.svg',
       'Q21'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'england');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q21'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/b/be/Flag_of_England.svg')
WHERE lower(name) = 'england';

-- ── Curated England squad ──
-- Every name below was checked against Wikidata. wikidata_id is set only where
-- the resolver could not find the right player from the name alone:
--
--   Dan Lawrence   Q19875023 — Wikidata labels him "Daniel Lawrence"
--   Phil Salt      Q21030613 — labelled "Philip Salt"
--   Olly Stone     Q7086767  — labelled "Oli Stone"
--   Saqib Mahmood  Q21061963 — two English cricketers share the exact name
--                              (the other, Q7421226, was born in 1977)
--
-- The first three are pinned rather than renamed because the name column is
-- what the app and admin panel display, and players are known by these forms.
-- Every other name returns exactly one cricketer.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill styles onto any a CricAPI squad sync already created). No
-- ON COMMIT DROP — migrate.sh runs in autocommit, so the table would vanish
-- immediately; it is dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_eng;
CREATE TEMP TABLE curated_squad_eng (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_eng (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Joe Root',           'batsman',      10.0, 'England', 'Right-handed', 'Right-arm off break',      NULL),
  ('Harry Brook',        'batsman',       9.5, 'England', 'Right-handed', 'Right-arm medium',         NULL),
  ('Ben Duckett',        'batsman',       9.0, 'England', 'Left-handed',  'Right-arm off break',      NULL),
  ('Zak Crawley',        'batsman',       8.5, 'England', 'Right-handed', 'Right-arm medium',         NULL),
  ('Ollie Pope',         'batsman',       8.5, 'England', 'Right-handed', NULL,                       NULL),
  ('Jacob Bethell',      'batsman',       8.5, 'England', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Dan Lawrence',       'batsman',       8.0, 'England', 'Right-handed', 'Right-arm off break',      'Q19875023'),
  ('Jos Buttler',        'wicket_keeper', 9.5, 'England', 'Right-handed', NULL,                       NULL),
  ('Jamie Smith',        'wicket_keeper', 9.0, 'England', 'Right-handed', NULL,                       NULL),
  ('Phil Salt',          'wicket_keeper', 9.0, 'England', 'Right-handed', NULL,                       'Q21030613'),
  ('Ben Stokes',         'all_rounder',  10.0, 'England', 'Left-handed',  'Right-arm fast-medium',    NULL),
  ('Chris Woakes',       'all_rounder',   9.0, 'England', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Liam Livingstone',   'all_rounder',   8.5, 'England', 'Right-handed', 'Right-arm leg break',      NULL),
  ('Sam Curran',         'all_rounder',   8.5, 'England', 'Left-handed',  'Left-arm medium-fast',     NULL),
  ('Will Jacks',         'all_rounder',   8.0, 'England', 'Right-handed', 'Right-arm off break',      NULL),
  ('Jamie Overton',      'all_rounder',   8.0, 'England', 'Right-handed', 'Right-arm fast',           NULL),
  ('Jofra Archer',       'bowler',        9.5, 'England', 'Right-handed', 'Right-arm fast',           NULL),
  ('Mark Wood',          'bowler',        9.0, 'England', 'Right-handed', 'Right-arm fast',           NULL),
  ('Gus Atkinson',       'bowler',        9.0, 'England', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Adil Rashid',        'bowler',        9.0, 'England', 'Right-handed', 'Right-arm leg break',      NULL),
  ('Brydon Carse',       'bowler',        8.5, 'England', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Shoaib Bashir',      'bowler',        8.0, 'England', 'Right-handed', 'Right-arm off break',      NULL),
  ('Jack Leach',         'bowler',        8.0, 'England', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Josh Tongue',        'bowler',        8.0, 'England', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Reece Topley',       'bowler',        8.0, 'England', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Matthew Potts',      'bowler',        7.5, 'England', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Tom Hartley',        'bowler',        7.5, 'England', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Saqib Mahmood',      'bowler',        7.5, 'England', 'Right-handed', 'Right-arm fast-medium',    'Q21061963'),
  ('Olly Stone',         'bowler',        7.5, 'England', 'Right-handed', 'Right-arm fast',           'Q7086767'),
  ('Sonny Baker',        'bowler',        7.5, 'England', 'Right-handed', 'Right-arm fast-medium',    NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'england' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_eng v
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
FROM curated_squad_eng v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every England player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'england' LIMIT 1)
WHERE team_name = 'England' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_eng;
