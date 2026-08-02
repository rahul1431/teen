-- Pakistan: country row + curated squad, the fifth team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo, DOB and Wikidata ID are
-- filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Pakistan in the admin panel after migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q843 is Pakistan; unlike England and the
-- West Indies this DOES help the resolver, whose prefilter matches citizenship
-- (P27) and every player below is a Pakistani citizen.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'pk', 'Pakistan',
       'https://upload.wikimedia.org/wikipedia/commons/3/32/Flag_of_Pakistan.svg',
       'Q843'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'pakistan');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q843'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/3/32/Flag_of_Pakistan.svg')
WHERE lower(name) = 'pakistan';

-- ── Curated Pakistan squad ──
-- This squad needed far more pinning than any before it — 10 of 30 — because
-- Pakistani names are both frequently shared and transliterated inconsistently.
-- All 30 were checked against Wikidata individually. Three groups:
--
-- 1. Wikidata spells the name differently from the form the player is known by
--    (kept as-is below, since `name` is what the app and admin panel display):
--      Babar Azam      Q4837515    labelled "Mohammad Babar Azam"
--      Sarfaraz Ahmed  Q3535421    labelled "Sarfraz Ahmed"
--      Faheem Ashraf   Q21620774   labelled "Fahim Ashraf"
--      Noman Ali       Q21642240   labelled "Nauman Ali"
--      Sufiyan Muqeem  Q124757396  labelled "Sufyan Moqeem"
--
-- 2. Several cricketers share the exact name, so the unpinned lookup is a
--    coin flip:
--      Mohammad Rizwan Q19577671   the keeper (born 1992), not the 1979 player
--      Abrar Ahmed     Q28741335   the Pakistani (1998), not the Indian (1971)
--      Mohammad Nawaz  Q21622188   the Pakistan all-rounder born 1994-03-21;
--                                  a second cricketer of the same name and
--                                  birth year (Q24005284) also exists
--      Usman Khan      Q42289487   the batter born 1995, not the 1985 player
--
-- 3. The English Wikipedia article of that name is a DISAMBIGUATION page, so
--    even the resolver's article fallback finds no player:
--      Mohammad Nawaz, Mohammad Wasim, Usman Khan
--    Mohammad Wasim is pinned to Q102355560 — the fast bowler born 2001, whose
--    article is "Mohammad Wasim Jr.". Without these pins the three would come
--    back empty rather than wrong (the fallback keeps an "occupation:
--    cricketer" condition, so a disambiguation item is refused), but empty is
--    still a blank profile.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_pk;
CREATE TEMP TABLE curated_squad_pk (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_pk (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Mohammad Rizwan',   'wicket_keeper', 9.5, 'Pakistan', 'Right-handed', NULL,                        'Q19577671'),
  ('Mohammad Haris',    'wicket_keeper', 8.0, 'Pakistan', 'Right-handed', NULL,                        NULL),
  ('Sarfaraz Ahmed',    'wicket_keeper', 8.0, 'Pakistan', 'Right-handed', NULL,                        'Q3535421'),
  ('Babar Azam',        'batsman',      10.0, 'Pakistan', 'Right-handed', 'Right-arm off break',       'Q4837515'),
  ('Saim Ayub',         'batsman',       9.0, 'Pakistan', 'Left-handed',  'Right-arm off break',       NULL),
  ('Abdullah Shafique', 'batsman',       8.5, 'Pakistan', 'Right-handed', NULL,                        NULL),
  ('Imam-ul-Haq',       'batsman',       8.5, 'Pakistan', 'Left-handed',  NULL,                        NULL),
  ('Fakhar Zaman',      'batsman',       8.5, 'Pakistan', 'Left-handed',  'Slow left-arm orthodox',    NULL),
  ('Shan Masood',       'batsman',       8.0, 'Pakistan', 'Left-handed',  NULL,                        NULL),
  ('Saud Shakeel',      'batsman',       8.0, 'Pakistan', 'Left-handed',  NULL,                        NULL),
  ('Kamran Ghulam',     'batsman',       8.0, 'Pakistan', 'Right-handed', 'Right-arm off break',       NULL),
  ('Usman Khan',        'batsman',       7.5, 'Pakistan', 'Right-handed', NULL,                        'Q42289487'),
  ('Shadab Khan',       'all_rounder',   9.0, 'Pakistan', 'Right-handed', 'Right-arm leg break',       NULL),
  ('Salman Ali Agha',   'all_rounder',   8.5, 'Pakistan', 'Right-handed', 'Right-arm off break',       NULL),
  ('Mohammad Nawaz',    'all_rounder',   8.0, 'Pakistan', 'Left-handed',  'Slow left-arm orthodox',    'Q21622188'),
  ('Faheem Ashraf',     'all_rounder',   8.0, 'Pakistan', 'Left-handed',  'Right-arm fast-medium',     'Q21620774'),
  ('Khushdil Shah',     'all_rounder',   8.0, 'Pakistan', 'Left-handed',  'Slow left-arm orthodox',    NULL),
  ('Aamer Jamal',       'all_rounder',   8.0, 'Pakistan', 'Right-handed', 'Right-arm fast-medium',     NULL),
  ('Shaheen Afridi',    'bowler',        9.5, 'Pakistan', 'Left-handed',  'Left-arm fast',             NULL),
  ('Naseem Shah',       'bowler',        9.0, 'Pakistan', 'Right-handed', 'Right-arm fast',            NULL),
  ('Haris Rauf',        'bowler',        9.0, 'Pakistan', 'Right-handed', 'Right-arm fast',            NULL),
  ('Abrar Ahmed',       'bowler',        8.5, 'Pakistan', 'Right-handed', 'Right-arm leg break',       'Q28741335'),
  ('Mohammad Abbas',    'bowler',        8.0, 'Pakistan', 'Right-handed', 'Right-arm fast-medium',     NULL),
  ('Hasan Ali',         'bowler',        8.0, 'Pakistan', 'Right-handed', 'Right-arm fast-medium',     NULL),
  ('Mohammad Wasim',    'bowler',        8.0, 'Pakistan', 'Right-handed', 'Right-arm fast',            'Q102355560'),
  ('Noman Ali',         'bowler',        8.0, 'Pakistan', 'Left-handed',  'Slow left-arm orthodox',    'Q21642240'),
  ('Sajid Khan',        'bowler',        7.5, 'Pakistan', 'Right-handed', 'Right-arm off break',       NULL),
  ('Mir Hamza',         'bowler',        7.5, 'Pakistan', 'Left-handed',  'Left-arm fast-medium',      NULL),
  ('Abbas Afridi',      'bowler',        7.5, 'Pakistan', 'Right-handed', 'Right-arm fast-medium',     NULL),
  ('Sufiyan Muqeem',    'bowler',        7.5, 'Pakistan', 'Left-handed',  'Slow left-arm wrist-spin',  'Q124757396');

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'pakistan' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_pk v
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
FROM curated_squad_pk v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Pakistan player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'pakistan' LIMIT 1)
WHERE team_name = 'Pakistan' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_pk;
