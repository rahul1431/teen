-- Afghanistan: country row + curated squad, the eleventh team. Same shape as
-- 20260802c_cricket_australia_squad.sql — see that file (and the India seed it
-- derives from) for why roster membership, role, credits and batting/bowling
-- style are committed rather than fetched. Photo, DOB and Wikidata ID are
-- filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Afghanistan in the admin panel after
-- migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error. Q889 is Afghanistan; verified it matches
-- Riaz Hussan's own citizenship claim, so the resolver's citizenship prefilter
-- (P27) is meaningful for this squad.
--
-- flag_url is the 2013–2021 black-red-green tricolor, not Afghanistan's
-- current de facto state flag: that is what the Afghanistan Cricket Board and
-- ICC still display for the national team internationally, and it is the flag
-- Wikidata's own Afghanistan entity (Q889) lists among its P41 flag claims.
-- Verified to return 200 image/svg+xml — a first guess at a different filename
-- 404'd, so this was pulled from Commons search rather than assumed.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'af', 'Afghanistan',
       'https://upload.wikimedia.org/wikipedia/commons/c/cd/Flag_of_Afghanistan_%282013%E2%80%932021%29.svg',
       'Q889'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'afghanistan');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q889'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/c/cd/Flag_of_Afghanistan_%282013%E2%80%932021%29.svg')
WHERE lower(name) = 'afghanistan';

-- ── Curated Afghanistan squad ──
-- All 30 names were checked against Wikidata before being committed here, with
-- ESPNcricinfo and other player-profile sites used to confirm identity and
-- real existence — this squad needed that more than any other so far, because
-- Pashto/Dari names are transliterated inconsistently across sources. Nine
-- names needed pinning, more than any squad except Pakistan:
--
--   Ibrahim Zadran     Q35952969  — Wikidata carries a duplicate stub entity
--                                   (Q98930213) with the same DOB but no
--                                   citizenship or sitelink; this is the one
--                                   with both
--   Riaz Hassan        Q51751272  — labelled "Riaz Hussan"; his own Wikipedia
--                                   article is titled "Riaz Hassan (cricketer)"
--   Gulbadin Naib       Q3232386   — labelled "Gulbudeen Naib"
--   Rashid Khan         Q21621685  — shared exactly with a Pakistani cricketer
--                                   (born 1959) and a Nepalese one (born 2001)
--   Zia-ur-Rehman       Q28536847  — labelled "Ziaurrahman Akbar"
--   Bahir Shah          Q42293086  — labelled "Baheer Shah"
--   Wafadar Momand      Q35953048  — labelled "Wafadar" (surname dropped)
--   Mohammad Ishaq      Q53868628  — shared with a Pakistani cricketer (born
--                                    1963); the bare Wikipedia article
--                                    "Mohammad Ishaq" is itself a
--                                    disambiguation page, so even the
--                                    resolver's article fallback would find
--                                    nothing without this pin
--   Shahidullah Kamal   Q28534267  — labelled bare "Shahidullah"; this name
--                                    also corrects a mistake caught before
--                                    it reached this file — "Shahidullah
--                                    Kamawal" is not a real spelling of
--                                    anyone's name, confirmed by web search
--                                    turning up the genuine "Shahidullah
--                                    Kamal" instead (international debut
--                                    March 2021, born 1999-02-06), the same
--                                    class of drafting mistake as
--                                    "Kavindu Kandambi" in the Sri Lanka seed
--
-- Every other name matches exactly one "occupation: cricketer" entity under
-- its exact English label.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_af;
CREATE TEMP TABLE curated_squad_af (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_af (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Rahmanullah Gurbaz',       'wicket_keeper', 9.0, 'Afghanistan', 'Right-handed', NULL,                       NULL),
  ('Ikram Alikhil',            'wicket_keeper', 7.5, 'Afghanistan', 'Right-handed', NULL,                       NULL),
  ('Sediqullah Atal',          'batsman',       8.0, 'Afghanistan', 'Right-handed', NULL,                       NULL),
  ('Ibrahim Zadran',           'batsman',       9.0, 'Afghanistan', 'Right-handed', NULL,                       'Q35952969'),
  ('Rahmat Shah',              'batsman',       8.0, 'Afghanistan', 'Right-handed', 'Right-arm off break',      NULL),
  ('Riaz Hassan',              'batsman',       7.5, 'Afghanistan', 'Right-handed', NULL,                       'Q51751272'),
  ('Hazratullah Zazai',        'batsman',       8.0, 'Afghanistan', 'Left-handed',  NULL,                       NULL),
  ('Bahir Shah',               'batsman',       7.5, 'Afghanistan', 'Left-handed',  NULL,                       'Q42293086'),
  ('Abdul Malik',              'batsman',       7.5, 'Afghanistan', 'Left-handed',  NULL,                       NULL),
  ('Azmatullah Omarzai',       'all_rounder',   8.5, 'Afghanistan', 'Right-handed', 'Right-arm medium-fast',    NULL),
  ('Mohammad Nabi',            'all_rounder',   8.5, 'Afghanistan', 'Right-handed', 'Right-arm off break',      NULL),
  ('Gulbadin Naib',            'all_rounder',   8.0, 'Afghanistan', 'Right-handed', 'Right-arm medium',         'Q3232386'),
  ('Karim Janat',              'all_rounder',   7.5, 'Afghanistan', 'Right-handed', 'Right-arm medium',         NULL),
  ('Najibullah Zadran',        'all_rounder',   8.0, 'Afghanistan', 'Left-handed',  'Right-arm off break',      NULL),
  ('Darwish Rasooli',          'all_rounder',   7.5, 'Afghanistan', 'Right-handed', NULL,                       NULL),
  ('Shahidullah Kamal',        'all_rounder',   7.5, 'Afghanistan', 'Left-handed',  'Slow left-arm orthodox',   'Q28534267'),
  ('Sharafuddin Ashraf',       'all_rounder',   7.5, 'Afghanistan', 'Left-handed',  'Slow left-arm orthodox',   NULL),
  ('Rashid Khan',              'bowler',        9.5, 'Afghanistan', 'Right-handed', 'Right-arm leg break',      'Q21621685'),
  ('Mujeeb Ur Rahman',         'bowler',        9.0, 'Afghanistan', 'Right-handed', 'Right-arm off break',      NULL),
  ('Noor Ahmad',               'bowler',        8.5, 'Afghanistan', 'Left-handed',  'Slow left-arm wrist-spin', NULL),
  ('Naveen-ul-Haq',            'bowler',        8.5, 'Afghanistan', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Fazalhaq Farooqi',         'bowler',        8.5, 'Afghanistan', 'Left-handed',  'Left-arm fast-medium',     NULL),
  ('Fareed Ahmad',             'bowler',        7.5, 'Afghanistan', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Allah Mohammad Ghazanfar', 'bowler',        8.0, 'Afghanistan', 'Right-handed', 'Right-arm off break',      NULL),
  ('Nangeyalia Kharote',       'bowler',        7.5, 'Afghanistan', 'Right-handed', 'Right-arm off break',      NULL),
  ('Zia-ur-Rehman',            'bowler',        7.5, 'Afghanistan', 'Right-handed', 'Right-arm fast-medium',    'Q28536847'),
  ('Yamin Ahmadzai',           'bowler',        7.5, 'Afghanistan', 'Right-handed', 'Right-arm fast-medium',    NULL),
  ('Wafadar Momand',           'bowler',        7.5, 'Afghanistan', 'Right-handed', 'Right-arm fast-medium',    'Q35953048'),
  ('Mohammad Ishaq',           'bowler',        7.5, 'Afghanistan', 'Right-handed', 'Right-arm off break',      'Q53868628'),
  ('Qais Ahmad',               'bowler',        8.0, 'Afghanistan', 'Right-handed', 'Right-arm leg break',      NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'afghanistan' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_af v
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
FROM curated_squad_af v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every Afghanistan player at the country row, including any that
-- predate country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'afghanistan' LIMIT 1)
WHERE team_name = 'Afghanistan' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_af;
