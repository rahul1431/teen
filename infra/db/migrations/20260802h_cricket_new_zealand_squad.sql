-- New Zealand: country row + curated squad, the seventh team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo and Wikidata ID are filled
-- afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team New Zealand in the admin panel after
-- migrating.
--
-- IMPORTANT — do not run a FORCE re-enrichment for New Zealand (or a global
-- force pass that includes it) without re-checking Tom Latham afterwards.
-- See the note by his row below: this squad has a curated date_of_birth
-- override because Wikidata's own birth-date claim is wrong, and `force`
-- (added to let a re-enrichment clear fabricated dates) overwrites a date
-- outright, including a correct curated one.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q664 is the country; the resolver's
-- citizenship prefilter (P27) matches it directly, same as India/Australia/
-- South Africa.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'nz', 'New Zealand',
       'https://upload.wikimedia.org/wikipedia/commons/3/3e/Flag_of_New_Zealand.svg',
       'Q664'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'new zealand');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q664'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/3/3e/Flag_of_New_Zealand.svg')
WHERE lower(name) = 'new zealand';

-- ── Curated New Zealand squad ──
-- All 30 names were checked against Wikidata before being committed here.
-- Five needed intervention:
--
--   Daryl Mitchell    Q21622066  — shared exactly with an English cricketer
--                                  (Q5226212, born 1983); this is the Kiwi
--                                  all-rounder, born 1988
--   Nathan Smith      Q24005445  — shared with an Irish cricketer (Q30123019,
--                                  born 1995); this is the NZ seamer, born 1998.
--                                  The bare Wikipedia article "Nathan Smith" is
--                                  itself a disambiguation page, so even the
--                                  resolver's article fallback would find
--                                  nothing without this pin
--   William O'Rourke  Q117485056 — labelled "William O'Rourke" but the article
--                                  the squad knows him by, "Will O'Rourke
--                                  (cricketer)", is a different title; the bare
--                                  "William O'Rourke" article is also a
--                                  disambiguation page
--   Zak Foulkes       Q116153706 — labelled "Zakary Foulkes"
--
--   Tom Latham        — NOT a naming problem. His Wikidata entity (Q7816540)
--                       is correctly identified — right label, right
--                       description ("New Zealand cricketer"), right sitelink
--                       ("Tom Latham (cricketer)") — but its own P569 birth-date
--                       claim is wrong: 1923-04-30, sourced from an English-
--                       Wikipedia import, when the real Tom Latham (Test
--                       captain, wicketkeeper) was born 1992-04-02 (confirmed
--                       independently — see cricketnmore/CREX player profiles).
--                       This is the first data-quality bug found on the
--                       CORRECT entity rather than a naming collision, and no
--                       pin can fix it since pinning would still fetch the same
--                       bad claim. date_of_birth is therefore curated directly
--                       below, like batting_style, instead of left to the
--                       resolver. Only ever backfilled if empty (see step 1/2),
--                       so this survives the normal enrichment run that follows
--                       this migration — but NOT a `force` run, which is why
--                       the warning at the top of this file exists.
--
-- Every other name matches exactly one "occupation: cricketer" entity under
-- its exact English label.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_nz;
CREATE TEMP TABLE curated_squad_nz (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT, date_of_birth DATE
);

INSERT INTO curated_squad_nz (name, role, credits, team_name, batting_style, bowling_style, wikidata_id, date_of_birth)
VALUES
  ('Tom Latham',           'wicket_keeper', 9.5, 'New Zealand', 'Left-handed',  NULL,                      NULL,          '1992-04-02'),
  ('Tom Blundell',         'wicket_keeper', 8.0, 'New Zealand', 'Right-handed', NULL,                      NULL,          NULL),
  ('Kane Williamson',      'batsman',      10.0, 'New Zealand', 'Right-handed', 'Right-arm off break',     NULL,          NULL),
  ('Devon Conway',         'batsman',       9.0, 'New Zealand', 'Left-handed',  NULL,                      NULL,          NULL),
  ('Will Young',           'batsman',       7.5, 'New Zealand', 'Right-handed', NULL,                      NULL,          NULL),
  ('Rachin Ravindra',      'batsman',       9.0, 'New Zealand', 'Left-handed',  'Slow left-arm orthodox',  NULL,          NULL),
  ('Henry Nicholls',       'batsman',       8.0, 'New Zealand', 'Left-handed',  NULL,                      NULL,          NULL),
  ('Finn Allen',           'batsman',       8.0, 'New Zealand', 'Right-handed', NULL,                      NULL,          NULL),
  ('Mark Chapman',         'batsman',       7.5, 'New Zealand', 'Left-handed',  'Right-arm off break',     NULL,          NULL),
  ('Josh Clarkson',        'batsman',       7.5, 'New Zealand', 'Right-handed', 'Right-arm off break',     NULL,          NULL),
  ('Bevon Jacobs',         'batsman',       7.5, 'New Zealand', 'Right-handed', NULL,                      NULL,          NULL),
  ('Daryl Mitchell',       'all_rounder',   9.0, 'New Zealand', 'Right-handed', 'Right-arm medium-fast',   'Q21622066',   NULL),
  ('Glenn Phillips',       'all_rounder',   9.0, 'New Zealand', 'Right-handed', 'Right-arm off break',     NULL,          NULL),
  ('Mitchell Santner',     'all_rounder',   9.0, 'New Zealand', 'Left-handed',  'Slow left-arm orthodox',  NULL,          NULL),
  ('Michael Bracewell',    'all_rounder',   8.0, 'New Zealand', 'Right-handed', 'Right-arm off break',     NULL,          NULL),
  ('James Neesham',        'all_rounder',   8.0, 'New Zealand', 'Left-handed',  'Right-arm medium-fast',   NULL,          NULL),
  ('Muhammad Abbas',       'all_rounder',   7.5, 'New Zealand', 'Right-handed', 'Right-arm medium',        NULL,          NULL),
  ('Tim Southee',          'bowler',        9.0, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   NULL,          NULL),
  ('Trent Boult',          'bowler',        9.5, 'New Zealand', 'Left-handed',  'Left-arm fast-medium',    NULL,          NULL),
  ('Kyle Jamieson',        'bowler',        8.5, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   NULL,          NULL),
  ('Matt Henry',           'bowler',        8.5, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   NULL,          NULL),
  ('Lockie Ferguson',      'bowler',        8.5, 'New Zealand', 'Right-handed', 'Right-arm fast',          NULL,          NULL),
  ('Ish Sodhi',            'bowler',        8.0, 'New Zealand', 'Right-handed', 'Right-arm leg break',     NULL,          NULL),
  ('Ajaz Patel',           'bowler',        8.0, 'New Zealand', 'Left-handed',  'Slow left-arm orthodox',  NULL,          NULL),
  ('Adam Milne',           'bowler',        8.0, 'New Zealand', 'Right-handed', 'Right-arm fast',          NULL,          NULL),
  ('Jacob Duffy',          'bowler',        7.5, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   NULL,          NULL),
  ('William O''Rourke',    'bowler',        7.5, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   'Q117485056', NULL),
  ('Ben Sears',            'bowler',        7.5, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   NULL,          NULL),
  ('Nathan Smith',         'bowler',        7.5, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   'Q24005445',   NULL),
  ('Zak Foulkes',          'bowler',        7.5, 'New Zealand', 'Right-handed', 'Right-arm fast-medium',   'Q116153706',  NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id, date_of_birth)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'new zealand' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id, v.date_of_birth
FROM curated_squad_nz v
WHERE NOT EXISTS (
  SELECT 1 FROM cricket_fantasy_players p
  WHERE lower(p.name) = lower(v.name) AND p.team_name = v.team_name
);

-- 2. Backfill onto players a squad sync already created. COALESCE only, so an
--    admin's correction (or, for Tom Latham, the curated date above) survives.
--    Role and credits are deliberately untouched: those may have been tuned in
--    the admin panel and overwriting them would silently change every
--    player's draft cost.
UPDATE cricket_fantasy_players p
SET batting_style = COALESCE(p.batting_style, v.batting_style),
    bowling_style = COALESCE(p.bowling_style, v.bowling_style),
    wikidata_id   = COALESCE(p.wikidata_id, v.wikidata_id),
    date_of_birth = COALESCE(p.date_of_birth, v.date_of_birth)
FROM curated_squad_nz v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL) OR
       (p.date_of_birth IS NULL AND v.date_of_birth IS NOT NULL));

-- Point every New Zealand player at the country row, including any that
-- predate country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'new zealand' LIMIT 1)
WHERE team_name = 'New Zealand' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_nz;
