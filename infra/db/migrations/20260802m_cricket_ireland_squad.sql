-- Ireland: country row + curated squad, the thirteenth team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo, DOB and Wikidata ID are
-- filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Ireland in the admin panel after migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q27 is Ireland; verified it matches Andrew
-- McBrine's own citizenship claim, so the resolver's citizenship prefilter
-- (P27) is meaningful for this squad.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'ie', 'Ireland',
       'https://upload.wikimedia.org/wikipedia/commons/4/45/Flag_of_Ireland.svg',
       'Q27'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'ireland');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q27'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/4/45/Flag_of_Ireland.svg')
WHERE lower(name) = 'ireland';

-- ── Curated Ireland squad ──
-- All 30 names were checked against Wikidata before being committed here.
-- Four needed pinning, all label mismatches:
--
--   Josh Little      Q26838122  — labelled "Joshua Little"
--   Ben Calitz        Q136187197 — labelled exactly this; confirmed current
--                                  (2026 T20 World Cup squad, per ESPNcricinfo)
--                                  since his name reads unusually for an
--                                  Ireland squad at first glance
--   Andy McBrine      Q16224833  — labelled "Andrew McBrine"
--   Thomas Mayes      Q118920128 — labelled "Thomas Mayes"; publicly known
--                                  and displayed here as "Tom Mayes" (South
--                                  African-born, four uncapped players picked
--                                  for a Test vs New Zealand per ESPNcricinfo)
--
-- Two slots needed real replacements before this file reached 30 unique,
-- verified names: the first draft repeated "Ross Adair" once by mistake, and
-- "PJ Moor" / "Peter Moor" resolved to a single, correctly-identified
-- Wikidata entity (Q18637757) whose own citizenship claim is Zimbabwe (Q954),
-- not Ireland — a drafting mix-up with Zimbabwe's actual wicketkeeper Peter
-- Moor, not a real Irish player at all. All three replacements below were
-- independently confirmed via ESPNcricinfo/ICC/Cricket Ireland before being
-- added, not assumed from memory:
--   Tim Tector       Q87254976  — Harry Tector's brother
--   Sam Topping       (no Wikidata entry yet) — uncapped T20 World Cup 2026
--                                call-up replacing an injured Paul Stirling
--   Murray Commins    Q27662881 — South African-born, Ireland debut 2023;
--                                Wikidata's own citizenship claim on this
--                                entity is still South Africa (Q258), evidently
--                                not yet updated for his country switch — the
--                                match is still correct: single result, exact
--                                name, and a birth date (1997-01-02) matching
--                                his player-profile bio
--
-- Every other name matches exactly one "occupation: cricketer" entity under
-- its exact English label.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_ie;
CREATE TEMP TABLE curated_squad_ie (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_ie (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Lorcan Tucker',        'wicket_keeper', 8.5, 'Ireland', 'Right-handed', NULL,                      NULL),
  ('Stephen Doheny',       'wicket_keeper', 7.5, 'Ireland', 'Left-handed',  NULL,                      NULL),
  ('Neil Rock',            'wicket_keeper', 7.5, 'Ireland', 'Right-handed', NULL,                      NULL),
  ('Paul Stirling',        'batsman',       9.0, 'Ireland', 'Right-handed', 'Right-arm off break',     NULL),
  ('Andrew Balbirnie',     'batsman',       8.5, 'Ireland', 'Right-handed', NULL,                      NULL),
  ('Harry Tector',         'batsman',       8.5, 'Ireland', 'Right-handed', 'Right-arm medium',        NULL),
  ('Ross Adair',           'batsman',       7.5, 'Ireland', 'Right-handed', NULL,                      NULL),
  ('Ben Calitz',           'batsman',       7.5, 'Ireland', 'Right-handed', 'Right-arm medium',        'Q136187197'),
  ('Tim Tector',           'batsman',       7.5, 'Ireland', 'Right-handed', 'Right-arm medium',        'Q87254976'),
  ('Sam Topping',          'wicket_keeper', 7.5, 'Ireland', 'Left-handed',  NULL,                      NULL),
  ('Murray Commins',       'batsman',       7.5, 'Ireland', 'Left-handed',  'Right-arm medium',        'Q27662881'),
  ('Curtis Campher',       'all_rounder',   8.5, 'Ireland', 'Right-handed', 'Right-arm medium-fast',   NULL),
  ('George Dockrell',      'all_rounder',   8.0, 'Ireland', 'Left-handed',  'Slow left-arm orthodox',  NULL),
  ('Gareth Delany',        'all_rounder',   7.5, 'Ireland', 'Right-handed', 'Right-arm leg break',     NULL),
  ('Mark Adair',           'all_rounder',   8.5, 'Ireland', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Simi Singh',           'all_rounder',   7.5, 'Ireland', 'Right-handed', 'Right-arm off break',     NULL),
  ('Thomas Mayes',         'all_rounder',   7.5, 'Ireland', 'Right-handed', 'Right-arm medium-fast',   'Q118920128'),
  ('Fionn Hand',           'all_rounder',   7.5, 'Ireland', 'Right-handed', 'Right-arm medium',        NULL),
  ('Josh Little',          'bowler',        8.5, 'Ireland', 'Left-handed',  'Left-arm fast-medium',    'Q26838122'),
  ('Barry McCarthy',       'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Craig Young',          'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Graham Hume',          'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Ben White',            'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm off break',     NULL),
  ('Matthew Humphreys',    'bowler',        7.5, 'Ireland', 'Left-handed',  'Slow left-arm orthodox',  NULL),
  ('David Delany',         'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm medium-fast',   NULL),
  ('Liam McCarthy',        'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm medium-fast',   NULL),
  ('Andy McBrine',         'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm off break',     'Q16224833'),
  ('Conor Olphert',        'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm fast-medium',   NULL),
  ('Adam Dennison',        'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm medium',        NULL),
  ('Ryan Hunter',          'bowler',        7.5, 'Ireland', 'Right-handed', 'Right-arm medium-fast',   NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'ireland' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_ie v
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
FROM curated_squad_ie v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Ireland player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'ireland' LIMIT 1)
WHERE team_name = 'Ireland' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_ie;
