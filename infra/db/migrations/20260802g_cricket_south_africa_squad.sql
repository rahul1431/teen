-- South Africa: country row + curated squad, the sixth team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo, DOB and Wikidata ID are
-- filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team South Africa in the admin panel after
-- migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q258 is the country; unlike England and the
-- West Indies this DOES help the resolver, whose prefilter matches citizenship
-- (P27) — verified Temba Bavuma is a Q258 citizen, and South Africa fields a
-- single national side so every player in this squad should match.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'sa', 'South Africa',
       'https://upload.wikimedia.org/wikipedia/commons/a/af/Flag_of_South_Africa.svg',
       'Q258'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'south africa');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q258'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/a/af/Flag_of_South_Africa.svg')
WHERE lower(name) = 'south africa';

-- ── Curated South Africa squad ──
-- All 30 names were checked individually against Wikidata before being
-- committed here: every one matches exactly one "occupation: cricketer"
-- entity under its exact English label, so — unlike India, Australia,
-- England, West Indies and especially Pakistan — no pinned wikidata_id is
-- needed anywhere in this squad.
--
-- Batsmen who don't bowl and keepers carry NULL bowling_style.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_sa;
CREATE TEMP TABLE curated_squad_sa (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT
);

INSERT INTO curated_squad_sa (name, role, credits, team_name, batting_style, bowling_style)
VALUES
  ('Heinrich Klaasen',        'wicket_keeper', 9.5, 'South Africa', 'Right-handed', NULL),
  ('Kyle Verreynne',          'wicket_keeper', 8.0, 'South Africa', 'Right-handed', NULL),
  ('Ryan Rickelton',          'wicket_keeper', 8.5, 'South Africa', 'Left-handed',  NULL),
  ('Temba Bavuma',            'batsman',       9.0, 'South Africa', 'Right-handed', NULL),
  ('Aiden Markram',           'batsman',       9.0, 'South Africa', 'Right-handed', 'Right-arm off break'),
  ('Tony de Zorzi',           'batsman',       8.0, 'South Africa', 'Right-handed', NULL),
  ('Tristan Stubbs',          'batsman',       8.5, 'South Africa', 'Right-handed', 'Right-arm medium'),
  ('David Bedingham',         'batsman',       8.0, 'South Africa', 'Right-handed', NULL),
  ('Dewald Brevis',           'batsman',       8.5, 'South Africa', 'Right-handed', 'Right-arm leg break'),
  ('Reeza Hendricks',         'batsman',       7.5, 'South Africa', 'Right-handed', NULL),
  ('Rassie van der Dussen',   'batsman',       8.5, 'South Africa', 'Right-handed', 'Right-arm leg break'),
  ('Matthew Breetzke',        'batsman',       7.5, 'South Africa', 'Right-handed', NULL),
  ('Lhuan-dre Pretorius',     'batsman',       7.5, 'South Africa', 'Left-handed',  NULL),
  ('Wiaan Mulder',            'all_rounder',   8.5, 'South Africa', 'Right-handed', 'Right-arm fast-medium'),
  ('Marco Jansen',            'all_rounder',   9.0, 'South Africa', 'Left-handed',  'Left-arm fast-medium'),
  ('Andile Phehlukwayo',      'all_rounder',   8.0, 'South Africa', 'Right-handed', 'Right-arm medium'),
  ('Wayne Parnell',           'all_rounder',   7.5, 'South Africa', 'Left-handed',  'Left-arm fast-medium'),
  ('Senuran Muthusamy',       'all_rounder',   7.5, 'South Africa', 'Left-handed',  'Slow left-arm orthodox'),
  ('George Linde',            'all_rounder',   7.5, 'South Africa', 'Left-handed',  'Slow left-arm orthodox'),
  ('Corbin Bosch',            'all_rounder',   7.5, 'South Africa', 'Right-handed', 'Right-arm fast-medium'),
  ('Kagiso Rabada',           'bowler',        9.5, 'South Africa', 'Right-handed', 'Right-arm fast'),
  ('Anrich Nortje',           'bowler',        9.0, 'South Africa', 'Right-handed', 'Right-arm fast'),
  ('Lungi Ngidi',             'bowler',        8.5, 'South Africa', 'Right-handed', 'Right-arm fast-medium'),
  ('Gerald Coetzee',          'bowler',        8.5, 'South Africa', 'Right-handed', 'Right-arm fast'),
  ('Keshav Maharaj',          'bowler',        8.5, 'South Africa', 'Left-handed',  'Slow left-arm orthodox'),
  ('Simon Harmer',            'bowler',        8.0, 'South Africa', 'Right-handed', 'Right-arm off break'),
  ('Bjorn Fortuin',           'bowler',        7.5, 'South Africa', 'Left-handed',  'Slow left-arm orthodox'),
  ('Nandre Burger',           'bowler',        7.5, 'South Africa', 'Left-handed',  'Left-arm fast-medium'),
  ('Ottniel Baartman',        'bowler',        7.5, 'South Africa', 'Right-handed', 'Right-arm fast-medium'),
  ('Lizaad Williams',         'bowler',        7.5, 'South Africa', 'Right-handed', 'Right-arm fast-medium');

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'south africa' LIMIT 1),
       v.batting_style, v.bowling_style
FROM curated_squad_sa v
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
    bowling_style = COALESCE(p.bowling_style, v.bowling_style)
FROM curated_squad_sa v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL);

-- Point every South Africa player at the country row, including any that
-- predate country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'south africa' LIMIT 1)
WHERE team_name = 'South Africa' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_sa;
