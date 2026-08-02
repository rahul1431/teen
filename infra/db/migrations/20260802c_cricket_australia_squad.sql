-- Australia: country row + curated squad, the second country after India.
--
-- Same shape as 20260802_cricket_player_profiles_and_india_squad.sql — see that
-- file for why roster membership, role, credits and batting/bowling style are
-- committed here rather than fetched: Wikidata's team-membership statements
-- have no end dates (so a bulk squad query returns retired and women's-team
-- players), and its batting-style (P741) / bowling-style (P5126) properties are
-- effectively unpopulated for cricketers. Photo, DOB and Wikidata ID ARE filled
-- automatically afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Australia in the admin panel after migrating.

-- ── Country ──
-- Deliberately NOT a plain INSERT with a chosen id. CricAPI's sync-countries
-- may already have created an Australia row under its own id ('au'), and
-- idx_cricket_countries_name_unique (added by 20260802b) makes a second row
-- with the same name a hard failure that aborts the migration. Insert only if
-- no row owns the name; either way, key the surviving row to Wikidata's Q408
-- so enrichment and flag lookups have something exact to join on.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'au', 'Australia',
       'https://upload.wikimedia.org/wikipedia/commons/8/88/Flag_of_Australia_%28converted%29.svg',
       'Q408'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'australia');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q408'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/8/88/Flag_of_Australia_%28converted%29.svg')
WHERE lower(name) = 'australia';

-- ── Curated Australia squad ──
-- Names are spelled to match the exact English Wikidata label, because the
-- resolver looks players up by rdfs:label — a misspelling silently yields no
-- photo rather than an error. Keepers who don't bowl carry NULL bowling_style.
--
-- Temp table, as in the India seed: the list is needed twice (insert the
-- missing players, then backfill styles onto any that a CricAPI squad sync
-- already created). No ON COMMIT DROP — migrate.sh runs in autocommit, so the
-- table would vanish the moment it was created; dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_au;
--
-- wikidata_id is normally left for the resolver to discover, and is set here
-- only where the name alone is ambiguous. The resolver matches on English
-- label + "occupation: cricketer" and takes the first hit: two Australian
-- internationals are labelled "Steve Smith" (the other is Q5368718, born 1961),
-- and "Cameron Green" also matches an English cricketer born 1968. A pinned id
-- short-circuits the label search so those two can't pick up a stranger's photo
-- and date of birth. Every other name was checked against Wikidata and returns
-- exactly one cricketer.
CREATE TEMP TABLE curated_squad_au (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_au (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Travis Head',          'batsman',      10.0, 'Australia', 'Left-handed',  'Right-arm off break', NULL),
  ('Steve Smith',          'batsman',       9.5, 'Australia', 'Right-handed', 'Right-arm leg break', 'Q7613970'),
  ('Cameron Green',        'all_rounder',   9.5, 'Australia', 'Right-handed', 'Right-arm fast-medium', 'Q28180521'),
  ('Marnus Labuschagne',   'batsman',       9.0, 'Australia', 'Right-handed', 'Right-arm leg break', NULL),
  ('Usman Khawaja',        'batsman',       8.5, 'Australia', 'Left-handed',  'Right-arm medium', NULL),
  ('Jake Fraser-McGurk',   'batsman',       8.5, 'Australia', 'Right-handed', 'Right-arm medium', NULL),
  ('Matthew Short',        'batsman',       8.0, 'Australia', 'Right-handed', 'Right-arm off break', NULL),
  ('Sam Konstas',          'batsman',       8.0, 'Australia', 'Right-handed', NULL, NULL),
  ('Nathan McSweeney',     'batsman',       7.5, 'Australia', 'Right-handed', 'Right-arm off break', NULL),
  ('Alex Carey',           'wicket_keeper', 9.0, 'Australia', 'Left-handed',  NULL, NULL),
  ('Josh Inglis',          'wicket_keeper', 8.5, 'Australia', 'Right-handed', NULL, NULL),
  ('Josh Philippe',        'wicket_keeper', 8.0, 'Australia', 'Right-handed', NULL, NULL),
  ('Mitchell Marsh',       'all_rounder',   9.5, 'Australia', 'Right-handed', 'Right-arm medium', NULL),
  ('Glenn Maxwell',        'all_rounder',   9.0, 'Australia', 'Right-handed', 'Right-arm off break', NULL),
  ('Marcus Stoinis',       'all_rounder',   8.5, 'Australia', 'Right-handed', 'Right-arm medium', NULL),
  ('Beau Webster',         'all_rounder',   8.5, 'Australia', 'Right-handed', 'Right-arm medium', NULL),
  ('Aaron Hardie',         'all_rounder',   8.0, 'Australia', 'Right-handed', 'Right-arm medium-fast', NULL),
  ('Sean Abbott',          'all_rounder',   8.0, 'Australia', 'Right-handed', 'Right-arm fast-medium', NULL),
  ('Pat Cummins',          'bowler',       10.0, 'Australia', 'Right-handed', 'Right-arm fast', NULL),
  ('Mitchell Starc',       'bowler',        9.5, 'Australia', 'Left-handed',  'Left-arm fast', NULL),
  ('Josh Hazlewood',       'bowler',        9.5, 'Australia', 'Left-handed',  'Right-arm fast-medium', NULL),
  ('Nathan Lyon',          'bowler',        9.0, 'Australia', 'Right-handed', 'Right-arm off break', NULL),
  ('Adam Zampa',           'bowler',        9.0, 'Australia', 'Right-handed', 'Right-arm leg break', NULL),
  ('Scott Boland',         'bowler',        8.5, 'Australia', 'Right-handed', 'Right-arm fast-medium', NULL),
  ('Spencer Johnson',      'bowler',        8.5, 'Australia', 'Left-handed',  'Left-arm fast', NULL),
  ('Nathan Ellis',         'bowler',        8.0, 'Australia', 'Right-handed', 'Right-arm fast-medium', NULL),
  ('Xavier Bartlett',      'bowler',        8.0, 'Australia', 'Right-handed', 'Right-arm fast-medium', NULL),
  ('Ben Dwarshuis',        'bowler',        7.5, 'Australia', 'Left-handed',  'Left-arm fast-medium', NULL),
  ('Todd Murphy',          'bowler',        7.5, 'Australia', 'Right-handed', 'Right-arm off break', NULL),
  ('Lance Morris',         'bowler',        7.5, 'Australia', 'Right-handed', 'Right-arm fast', NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'australia' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_au v
WHERE NOT EXISTS (
  SELECT 1 FROM cricket_fantasy_players p
  WHERE lower(p.name) = lower(v.name) AND p.team_name = v.team_name
);

-- 2. Backfill styles onto players a squad sync already created. COALESCE only,
--    so a style an admin corrected by hand survives. Role and credits are left
--    alone on purpose: those may have been tuned in the admin panel, and
--    overwriting them would silently change every player's draft cost.
UPDATE cricket_fantasy_players p
SET batting_style = COALESCE(p.batting_style, v.batting_style),
    bowling_style = COALESCE(p.bowling_style, v.bowling_style),
    wikidata_id   = COALESCE(p.wikidata_id, v.wikidata_id)
FROM curated_squad_au v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Australia player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'australia' LIMIT 1)
WHERE team_name = 'Australia' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_au;
