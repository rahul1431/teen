-- Zimbabwe: country row + curated squad, the twelfth team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo, DOB and Wikidata ID are
-- filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Zimbabwe in the admin panel after
-- migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q954 is Zimbabwe; verified it matches Sean
-- Williams's own citizenship claim, so the resolver's citizenship prefilter
-- (P27) is meaningful for this squad.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'zw', 'Zimbabwe',
       'https://upload.wikimedia.org/wikipedia/commons/6/6a/Flag_of_Zimbabwe.svg',
       'Q954'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'zimbabwe');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q954'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/6/6a/Flag_of_Zimbabwe.svg')
WHERE lower(name) = 'zimbabwe';

-- ── Curated Zimbabwe squad ──
-- All 30 names were checked against Wikidata before being committed here.
-- Three needed pinning, all plain label mismatches:
--
--   Wessly Madhevere         Q84599686  — labelled "Wesley Madhevere"
--   Takudzwanashe Kaitano    Q28813075  — labelled "Tafadzwanashe Kaitano";
--                                          confirmed same player via
--                                          ESPNcricinfo (matching DOB,
--                                          1993-06-15, and career details:
--                                          Test debut July 2021 vs Bangladesh,
--                                          87 on debut, a Zimbabwe Test-opener
--                                          record)
--
-- One planned entry, Vusi Sibanda, was dropped after a status check —
-- ESPNcricinfo confirms he retired from professional cricket in 2019 and now
-- coaches in Australia, so he does not belong in a current-squad seed the way
-- the other 30 names in this file do. Replaced with Graeme Cremer (Q5592242,
-- born 1986), the veteran leg-spinner and former captain, confirmed via
-- ICC/ESPNcricinfo reporting to be part of Zimbabwe's actual T20 World Cup
-- 2026 squad before being added here.
--
-- Every other name matches exactly one "occupation: cricketer" entity under
-- its exact English label.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_zw;
CREATE TEMP TABLE curated_squad_zw (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_zw (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Tadiwanashe Marumani',    'wicket_keeper', 8.0, 'Zimbabwe', 'Right-handed', NULL,                       NULL),
  ('Clive Madande',           'wicket_keeper', 7.5, 'Zimbabwe', 'Right-handed', NULL,                       NULL),
  ('Tafadzwa Tsiga',          'wicket_keeper', 7.5, 'Zimbabwe', 'Right-handed', NULL,                       NULL),
  ('Craig Ervine',            'batsman',       9.0, 'Zimbabwe', 'Left-handed',  NULL,                       NULL),
  ('Ben Curran',              'batsman',       8.0, 'Zimbabwe', 'Left-handed',  NULL,                       NULL),
  ('Brian Bennett',           'batsman',       8.0, 'Zimbabwe', 'Left-handed',  NULL,                       NULL),
  ('Takudzwanashe Kaitano',   'batsman',       7.5, 'Zimbabwe', 'Right-handed', NULL,                       'Q28813075'),
  ('Dion Myers',              'batsman',       7.5, 'Zimbabwe', 'Right-handed', NULL,                       NULL),
  ('Nick Welch',              'batsman',       7.5, 'Zimbabwe', 'Right-handed', 'Right-arm off break',      NULL),
  ('Innocent Kaia',           'batsman',       7.5, 'Zimbabwe', 'Right-handed', NULL,                       NULL),
  ('Milton Shumba',           'batsman',       7.5, 'Zimbabwe', 'Right-handed', 'Right-arm off break',      NULL),
  ('Sean Williams',           'all_rounder',   9.0, 'Zimbabwe', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Sikandar Raza',           'all_rounder',   9.5, 'Zimbabwe', 'Right-handed', 'Right-arm off break',      NULL),
  ('Wessly Madhevere',        'all_rounder',   8.0, 'Zimbabwe', 'Right-handed', 'Right-arm off break',      'Q84599686'),
  ('Ryan Burl',               'all_rounder',   8.0, 'Zimbabwe', 'Left-handed',  'Right-arm off break',      NULL),
  ('Johnathan Campbell',      'all_rounder',   7.5, 'Zimbabwe', 'Right-handed', 'Right-arm medium',         NULL),
  ('Wellington Masakadza',    'all_rounder',   7.5, 'Zimbabwe', 'Right-handed', 'Right-arm off break',      NULL),
  ('Graeme Cremer',           'all_rounder',   7.5, 'Zimbabwe', 'Right-handed', 'Right-arm leg break',      'Q5592242'),
  ('Blessing Muzarabani',     'bowler',        9.0, 'Zimbabwe', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Richard Ngarava',         'bowler',        8.5, 'Zimbabwe', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Victor Nyauchi',          'bowler',        7.5, 'Zimbabwe', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Tanaka Chivanga',         'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm fast',           NULL),
  ('Brad Evans',              'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm medium-fast',   NULL),
  ('Trevor Gwandu',           'bowler',        7.5, 'Zimbabwe', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Tony Munyonga',           'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Faraz Akram',             'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm off break',      NULL),
  ('Newman Nyamhuri',         'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Ainsley Ndlovu',          'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Antum Naqvi',             'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm leg break',      NULL),
  ('Tashinga Musekiwa',       'bowler',        7.5, 'Zimbabwe', 'Right-handed', 'Right-arm off break',      NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'zimbabwe' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_zw v
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
FROM curated_squad_zw v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Zimbabwe player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'zimbabwe' LIMIT 1)
WHERE team_name = 'Zimbabwe' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_zw;
