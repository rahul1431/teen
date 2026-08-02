-- Sri Lanka: country row + curated squad, the tenth team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo, DOB and Wikidata ID are
-- filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Sri Lanka in the admin panel after
-- migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q854 is Sri Lanka; verified it matches
-- Pathum Nissanka's own citizenship claim, so the resolver's citizenship
-- prefilter (P27) is meaningful for this squad.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'sl', 'Sri Lanka',
       'https://upload.wikimedia.org/wikipedia/commons/1/11/Flag_of_Sri_Lanka.svg',
       'Q854'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'sri lanka');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q854'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/1/11/Flag_of_Sri_Lanka.svg')
WHERE lower(name) = 'sri lanka';

-- ── Curated Sri Lanka squad ──
-- All 30 names were checked against Wikidata before being committed here, with
-- ESPNcricinfo/other player-profile sites used to confirm identity wherever
-- Wikidata left ambiguity. Five needed intervention:
--
--   Maheesh Theekshana   Q59656519  — labelled "Mahesh Theekshana" (one 'e')
--   Milan Rathnayake     Q29154593  — labelled "Milan Priyanath", his full
--                                     given name; known publicly by his
--                                     surname pairing
--   Avishka Fernando     Q26704448  — shares the name with another Sri Lankan
--                                     cricketer (Q30056653, no recorded DOB,
--                                     no Wikipedia article); this is the
--                                     capped international, born 1998
--   Lahiru Kumara        Q27107109  — shares the name with a second Sri Lankan
--                                     cricketer (Q97317002, born 1995);
--                                     confirmed via ESPNcricinfo the capped
--                                     fast bowler (playing since 2016, third
--                                     on Sri Lanka's Test wicket-takers list
--                                     among quicks) is the one born 1997-02-13
--   "Kavindu Kandambi" was dropped entirely — checked against ESPNcricinfo and
--     Wikidata and no such player exists; this looks like a name I
--     misremembered while drafting the list, not a real gap in Wikidata's
--     coverage (contrast Sonal Dinusha and others, who are real, checked,
--     single-match players). Replaced with Dushmantha Chameera (Q18921524,
--     born 1992), the senior fast bowler, confirmed via ESPNcricinfo to be in
--     Sri Lanka's ICC T20 World Cup 2026 squad — a single unambiguous
--     Wikidata match.
--
-- Every other name matches exactly one "occupation: cricketer" entity under
-- its exact English label.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_sl;
CREATE TEMP TABLE curated_squad_sl (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_sl (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Kusal Mendis',            'wicket_keeper', 9.0, 'Sri Lanka', 'Right-handed', NULL,                       NULL),
  ('Sadeera Samarawickrama',  'wicket_keeper', 8.0, 'Sri Lanka', 'Right-handed', NULL,                       NULL),
  ('Pathum Nissanka',         'batsman',       9.0, 'Sri Lanka', 'Right-handed', NULL,                       NULL),
  ('Avishka Fernando',        'batsman',       8.0, 'Sri Lanka', 'Left-handed',  NULL,                       'Q26704448'),
  ('Kamindu Mendis',          'batsman',       8.5, 'Sri Lanka', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Charith Asalanka',        'batsman',       8.5, 'Sri Lanka', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Nishan Madushka',         'batsman',       7.5, 'Sri Lanka', 'Left-handed',  NULL,                       NULL),
  ('Ashen Bandara',           'batsman',       7.5, 'Sri Lanka', 'Right-handed', 'Right-arm off break',      NULL),
  ('Dhananjaya de Silva',     'all_rounder',   8.5, 'Sri Lanka', 'Right-handed', 'Right-arm off break',      NULL),
  ('Angelo Mathews',          'all_rounder',   8.5, 'Sri Lanka', 'Right-handed', 'Right-arm medium',         NULL),
  ('Dasun Shanaka',           'all_rounder',   8.5, 'Sri Lanka', 'Right-handed', 'Right-arm medium',         NULL),
  ('Wanindu Hasaranga',       'all_rounder',   9.5, 'Sri Lanka', 'Right-handed', 'Right-arm leg break',      NULL),
  ('Dunith Wellalage',        'all_rounder',   8.5, 'Sri Lanka', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Janith Liyanage',         'all_rounder',   7.5, 'Sri Lanka', 'Right-handed', 'Right-arm medium',         NULL),
  ('Chamika Karunaratne',     'all_rounder',   8.0, 'Sri Lanka', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Maheesh Theekshana',      'bowler',        9.0, 'Sri Lanka', 'Right-handed', 'Right-arm off break',      'Q59656519'),
  ('Jeffrey Vandersay',       'bowler',        8.0, 'Sri Lanka', 'Right-handed', 'Right-arm leg break',      NULL),
  ('Nuwan Thushara',          'bowler',        8.0, 'Sri Lanka', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Matheesha Pathirana',     'bowler',        9.0, 'Sri Lanka', 'Right-handed', 'Right-arm fast',           NULL),
  ('Dilshan Madushanka',      'bowler',        8.0, 'Sri Lanka', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Lahiru Kumara',           'bowler',        8.0, 'Sri Lanka', 'Right-handed', 'Right-arm fast',           'Q27107109'),
  ('Asitha Fernando',         'bowler',        7.5, 'Sri Lanka', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Kasun Rajitha',           'bowler',        7.5, 'Sri Lanka', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Vishwa Fernando',         'bowler',        7.5, 'Sri Lanka', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Pramod Madushan',         'bowler',        7.5, 'Sri Lanka', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Milan Rathnayake',        'bowler',        7.5, 'Sri Lanka', 'Right-handed', 'Right-arm medium-fast',    'Q29154593'),
  ('Ramesh Mendis',           'bowler',        7.5, 'Sri Lanka', 'Right-handed', 'Right-arm off break',      NULL),
  ('Dushmantha Chameera',     'bowler',        8.0, 'Sri Lanka', 'Right-handed', 'Right-arm fast',           'Q18921524'),
  ('Sonal Dinusha',           'bowler',        7.5, 'Sri Lanka', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Eshan Malinga',           'bowler',        7.5, 'Sri Lanka', 'Right-handed', 'Right-arm fast',           NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'sri lanka' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_sl v
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
FROM curated_squad_sl v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Sri Lanka player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'sri lanka' LIMIT 1)
WHERE team_name = 'Sri Lanka' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_sl;
