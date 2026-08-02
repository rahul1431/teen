-- West Indies: country row + curated squad, the fourth team after India,
-- Australia and England. Same shape as 20260802c_cricket_australia_squad.sql —
-- see that file (and the India seed it derives from) for why roster membership,
-- role, credits and batting/bowling style are committed rather than fetched.
-- Photo, DOB and Wikidata ID are filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team West Indies in the admin panel after
-- migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error.
--
-- Q912881 is the West Indies cricket team, not a country — deliberately. The
-- West Indies is not a nation: the squad is drawn from Barbados, Jamaica,
-- Guyana, Trinidad and Tobago, Antigua and elsewhere, so no country entity
-- describes this row. The island region (Q669037) would be wrong too, since it
-- covers territories that have nothing to do with the team. As with England,
-- the ID buys no disambiguation here — the resolver's prefilter matches
-- citizenship (P27), which for these players is their individual island nation,
-- so it finds nothing and falls back to the plain name lookup.
--
-- flag_url is the Cricket West Indies emblem, not a flag: the team has no
-- national flag of its own (it is a multinational side), and the emblem is what
-- the entity itself carries as its logo. Verified to return 200 image/svg+xml.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'wi', 'West Indies',
       'https://upload.wikimedia.org/wikipedia/commons/1/1b/Cricket_West_Indies_Logo_2017.svg',
       'Q912881'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'west indies');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q912881'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/1/1b/Cricket_West_Indies_Logo_2017.svg')
WHERE lower(name) = 'west indies';

-- ── Curated West Indies squad ──
-- All 30 names were checked against Wikidata. Only one needed pinning:
--
--   Nicholas Pooran  Q17484247 — Wikidata labels him "Nicolas Pooran"
--
-- The resolver's Wikipedia-article fallback (added alongside the India fix)
-- would find him regardless, since his article title uses the spelling below.
-- Pinning is kept anyway so the lookup is exact and doesn't depend on a
-- fallback network round-trip. No other name is ambiguous or misspelt upstream.
--
-- Batsmen who don't bowl carry NULL bowling_style, same as keepers.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_wi;
CREATE TEMP TABLE curated_squad_wi (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT, wikidata_id TEXT
);

INSERT INTO curated_squad_wi (name, role, credits, team_name, batting_style, bowling_style, wikidata_id)
VALUES
  ('Shai Hope',              'wicket_keeper', 9.5, 'West Indies', 'Right-handed', NULL,                     NULL),
  ('Nicholas Pooran',        'wicket_keeper', 9.5, 'West Indies', 'Left-handed',  NULL,                     'Q17484247'),
  ('Joshua Da Silva',        'wicket_keeper', 8.0, 'West Indies', 'Right-handed', NULL,                     NULL),
  ('Shimron Hetmyer',        'batsman',       8.5, 'West Indies', 'Left-handed',  NULL,                     NULL),
  ('Evin Lewis',             'batsman',       8.5, 'West Indies', 'Left-handed',  NULL,                     NULL),
  ('Brandon King',           'batsman',       8.5, 'West Indies', 'Right-handed', NULL,                     NULL),
  ('Kraigg Brathwaite',      'batsman',       8.0, 'West Indies', 'Right-handed', 'Right-arm off break',    NULL),
  ('Johnson Charles',        'batsman',       8.0, 'West Indies', 'Right-handed', NULL,                     NULL),
  ('Alick Athanaze',         'batsman',       8.0, 'West Indies', 'Left-handed',  'Right-arm off break',    NULL),
  ('Keacy Carty',            'batsman',       8.0, 'West Indies', 'Right-handed', NULL,                     NULL),
  ('Kavem Hodge',            'batsman',       8.0, 'West Indies', 'Left-handed',  'Right-arm off break',    NULL),
  ('Tagenarine Chanderpaul', 'batsman',       7.5, 'West Indies', 'Left-handed',  'Right-arm leg break',    NULL),
  ('John Campbell',          'batsman',       7.5, 'West Indies', 'Left-handed',  NULL,                     NULL),
  ('Andre Russell',          'all_rounder',   9.5, 'West Indies', 'Right-handed', 'Right-arm fast',         NULL),
  ('Jason Holder',           'all_rounder',   9.0, 'West Indies', 'Right-handed', 'Right-arm fast-medium',  NULL),
  ('Roston Chase',           'all_rounder',   8.5, 'West Indies', 'Right-handed', 'Right-arm off break',    NULL),
  ('Rovman Powell',          'all_rounder',   8.5, 'West Indies', 'Right-handed', 'Right-arm medium',       NULL),
  ('Sherfane Rutherford',    'all_rounder',   8.5, 'West Indies', 'Left-handed',  'Right-arm medium',       NULL),
  ('Romario Shepherd',       'all_rounder',   8.0, 'West Indies', 'Right-handed', 'Right-arm fast-medium',  NULL),
  ('Justin Greaves',         'all_rounder',   8.0, 'West Indies', 'Right-handed', 'Right-arm medium',       NULL),
  ('Alzarri Joseph',         'bowler',        9.0, 'West Indies', 'Right-handed', 'Right-arm fast',         NULL),
  ('Shamar Joseph',          'bowler',        8.5, 'West Indies', 'Right-handed', 'Right-arm fast',         NULL),
  ('Jayden Seales',          'bowler',        8.5, 'West Indies', 'Right-handed', 'Right-arm fast-medium',  NULL),
  ('Kemar Roach',            'bowler',        8.5, 'West Indies', 'Right-handed', 'Right-arm fast-medium',  NULL),
  ('Gudakesh Motie',         'bowler',        8.5, 'West Indies', 'Left-handed',  'Slow left-arm orthodox', NULL),
  ('Akeal Hosein',           'bowler',        8.0, 'West Indies', 'Left-handed',  'Slow left-arm orthodox', NULL),
  ('Obed McCoy',             'bowler',        8.0, 'West Indies', 'Left-handed',  'Left-arm fast-medium',   NULL),
  ('Jomel Warrican',         'bowler',        7.5, 'West Indies', 'Left-handed',  'Slow left-arm orthodox', NULL),
  ('Matthew Forde',          'bowler',        7.5, 'West Indies', 'Right-handed', 'Right-arm medium-fast',  NULL),
  ('Anderson Phillip',       'bowler',        7.5, 'West Indies', 'Right-handed', 'Right-arm fast-medium',  NULL);

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style, wikidata_id)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'west indies' LIMIT 1),
       v.batting_style, v.bowling_style, v.wikidata_id
FROM curated_squad_wi v
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
FROM curated_squad_wi v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL OR
       (p.wikidata_id IS NULL AND v.wikidata_id IS NOT NULL));

-- Point every West Indies player at the country row, including any that predate
-- country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'west indies' LIMIT 1)
WHERE team_name = 'West Indies' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_wi;
