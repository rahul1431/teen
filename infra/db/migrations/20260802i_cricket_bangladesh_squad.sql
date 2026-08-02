-- Bangladesh: country row + curated squad, the ninth team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo, DOB and Wikidata ID are
-- filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Bangladesh in the admin panel after
-- migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q902 is Bangladesh; verified it matches
-- Tawhid Hridoy's own citizenship claim, so the resolver's citizenship
-- prefilter (P27) is meaningful for this squad.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'bd', 'Bangladesh',
       'https://upload.wikimedia.org/wikipedia/commons/f/f9/Flag_of_Bangladesh.svg',
       'Q902'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'bangladesh');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q902'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/f/f9/Flag_of_Bangladesh.svg')
WHERE lower(name) = 'bangladesh';

-- ── Curated Bangladesh squad ──
-- All 30 names were checked against Wikidata before being committed here, with
-- ESPNcricinfo/other player-profile sites used to confirm identity where
-- Wikidata alone left ambiguity (a wider check than earlier squads, at the
-- user's request — Wikidata search entities can miss a current player
-- entirely when its label differs from common usage). Five needed pinning:
--
--   Towhid Hridoy        Q41864142  — labelled "Tawhid Hridoy"
--   Mehidy Hasan Miraz    Q20676918  — labelled "Mehedi Hasan"; the bare label
--                                      "Mehidy Hasan Miraz" matches nobody
--   Shoriful Islam        Q39901288  — labelled "Shariful Islam"
--   Zakir Hasan           Q22004822  — shared with a 1972-born cricketer of
--                                      the same name; confirmed via
--                                      ESPNcricinfo/ICC rankings that the
--                                      current international (Test debut
--                                      Dec 2022) is the one born 1998-02-01
--   Shahadat Hossain      Q103942184 — shared with TWO other cricketers of the
--                                      same name (born 1986 and 1999);
--                                      confirmed via ESPNcricinfo that the
--                                      current international (Test debut late
--                                      2023, Under-19 World Cup winner 2020)
--                                      is the one born 2002-02-04
--
-- Every other name matches exactly one "occupation: cricketer" entity under
-- its exact English label.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_bd;
CREATE TEMP TABLE curated_squad_bd (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_bd (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Litton Das',              'wicket_keeper', 9.0, 'Bangladesh', 'Right-handed', NULL,                        NULL),
  ('Mushfiqur Rahim',         'wicket_keeper', 9.0, 'Bangladesh', 'Right-handed', NULL,                        NULL),
  ('Jaker Ali',               'wicket_keeper', 8.0, 'Bangladesh', 'Right-handed', NULL,                        NULL),
  ('Zakir Hasan',             'wicket_keeper', 7.5, 'Bangladesh', 'Left-handed',  NULL,                        'Q22004822'),
  ('Najmul Hossain Shanto',   'batsman',       8.5, 'Bangladesh', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Soumya Sarkar',           'batsman',       8.0, 'Bangladesh', 'Left-handed',  'Right-arm medium',         NULL),
  ('Tanzid Hasan',            'batsman',       8.0, 'Bangladesh', 'Left-handed',  NULL,                        NULL),
  ('Towhid Hridoy',           'batsman',       8.5, 'Bangladesh', 'Right-handed', 'Right-arm off break',      'Q41864142'),
  ('Parvez Hossain Emon',     'batsman',       7.5, 'Bangladesh', 'Left-handed',  NULL,                        NULL),
  ('Rony Talukdar',           'batsman',       7.5, 'Bangladesh', 'Right-handed', NULL,                        NULL),
  ('Anamul Haque',            'batsman',       7.5, 'Bangladesh', 'Right-handed', NULL,                        NULL),
  ('Mohammad Naim',           'batsman',       7.5, 'Bangladesh', 'Left-handed',  NULL,                        NULL),
  ('Shakib Al Hasan',         'all_rounder',   9.5, 'Bangladesh', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Mahmudullah',             'all_rounder',   8.0, 'Bangladesh', 'Right-handed', 'Right-arm off break',      NULL),
  ('Mehidy Hasan Miraz',      'all_rounder',   9.0, 'Bangladesh', 'Right-handed', 'Right-arm off break',      'Q20676918'),
  ('Afif Hossain',            'all_rounder',   8.0, 'Bangladesh', 'Left-handed',  'Right-arm off break',      NULL),
  ('Shamim Hossain',          'all_rounder',   7.5, 'Bangladesh', 'Right-handed', 'Right-arm off break',      NULL),
  ('Mahedi Hasan',            'all_rounder',   7.5, 'Bangladesh', 'Right-handed', 'Right-arm off break',      NULL),
  ('Nasum Ahmed',             'bowler',        8.0, 'Bangladesh', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Rishad Hossain',          'bowler',        8.5, 'Bangladesh', 'Right-handed', 'Right-arm leg break',      NULL),
  ('Taskin Ahmed',            'bowler',        9.0, 'Bangladesh', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Mustafizur Rahman',       'bowler',        9.0, 'Bangladesh', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Shoriful Islam',          'bowler',        8.0, 'Bangladesh', 'Left-handed',  'Left-arm fast-medium',     'Q39901288'),
  ('Hasan Mahmud',            'bowler',        8.0, 'Bangladesh', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Tanzim Hasan Sakib',      'bowler',        7.5, 'Bangladesh', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Nahid Rana',              'bowler',        8.0, 'Bangladesh', 'Right-handed', 'Right-arm fast',           NULL),
  ('Taijul Islam',            'bowler',        8.0, 'Bangladesh', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Khaled Ahmed',            'bowler',        7.5, 'Bangladesh', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Shahadat Hossain',        'bowler',        7.5, 'Bangladesh', 'Right-handed', NULL,                        'Q103942184'),
  ('Tanvir Islam',            'bowler',        7.5, 'Bangladesh', 'Left-handed',  'Slow left-arm orthodox',   NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'bangladesh' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_bd v
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
FROM curated_squad_bd v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Bangladesh player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'bangladesh' LIMIT 1)
WHERE team_name = 'Bangladesh' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_bd;
