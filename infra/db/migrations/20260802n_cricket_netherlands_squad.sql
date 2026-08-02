-- Netherlands: country row + curated squad, the fourteenth team. Same shape
-- as 20260802c_cricket_australia_squad.sql — see that file (and the India
-- seed it derives from) for why roster membership, role, credits and
-- batting/bowling style are committed rather than fetched. Photo, DOB and
-- Wikidata ID are filled afterwards by the enrichment resolver
-- (services/core-api-service/src/helpers/wikidata-cricket.ts) — run
-- "Enrich from Wikidata" for team Netherlands in the admin panel after
-- migrating.

-- ── Country ──
-- Insert only if no row already owns the name: CricAPI's sync may have created
-- one, and idx_cricket_countries_name_unique (20260802b) turns a second row
-- into a migration-aborting error.
--
-- wikidata_id is Q29999, "Kingdom of the Netherlands" — NOT Q55, the plain
-- "Netherlands" country article. This squad has an unusually international
-- roster (South African-, New Zealand-, Australian- and English-born
-- players with Dutch citizenship through family), so several were checked
-- directly: Bas de Leede's only P27 (citizenship) claim is Q29999, and Scott
-- Edwards carries both Q408 (Australia) and Q29999. Q29999 is what the
-- resolver's citizenship prefilter needs to match against for this team.
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
SELECT 'nl', 'Netherlands',
       'https://upload.wikimedia.org/wikipedia/commons/2/20/Flag_of_the_Netherlands.svg',
       'Q29999'
WHERE NOT EXISTS (SELECT 1 FROM cricket_countries WHERE lower(name) = 'netherlands');

UPDATE cricket_countries
SET wikidata_id = COALESCE(wikidata_id, 'Q29999'),
    flag_url    = COALESCE(NULLIF(flag_url, ''),
                           'https://upload.wikimedia.org/wikipedia/commons/2/20/Flag_of_the_Netherlands.svg')
WHERE lower(name) = 'netherlands';

-- ── Curated Netherlands squad ──
-- No name in this squad needed pinning for spelling or ambiguity — every one
-- matches exactly one "occupation: cricketer" entity under its exact English
-- label. What this squad DID need, more than any other so far, was checking
-- citizenship on every "ok" match rather than trusting a single hit by
-- itself, because several of Wikidata's own descriptions name a DIFFERENT
-- country outright ("New Zealand cricketer", "South African cricketer",
-- "english-born cricketer") for players who are genuinely Dutch internationals
-- through family or dual citizenship:
--
--   Max O'Dowd            (Q20745123, cit=NZ only) — confirmed via ESPNcricinfo:
--                          NZ-born, Dutch passport through his mother, NL's
--                          leading run-scorer in both ODIs and T20Is
--   Ryan Klein             (Q71333104, no P27 at all) — confirmed South
--                          African-born, Dutch passport through descent,
--                          NL debut 2021/22
--   Zach Lion-Cachet        (Q129790507, cit=UK) — confirmed English-born to a
--                          Dutch father, NL debut 2024
--   Sybrand Engelbrecht,
--   Wesley Barresi,
--   Colin Ackermann        (all cit=South Africa) — well-documented long-time
--                          or recent Dutch internationals; not individually
--                          re-verified given how established their NL careers
--                          are, but flagged here for the same reason
--
-- Two names in the first draft were a different problem entirely, and did NOT
-- survive verification: "Darshan Nalkande" and "Sagar Patel" each resolved to
-- a real, single, unambiguous Wikidata entity — but web search confirmed both
-- are the WRONG person. Nalkande is an Indian IPL fast bowler with no
-- Netherlands connection; that Sagar Patel plays for the United States, not
-- the Netherlands. Unlike the dual-nationality cases above, these weren't
-- data lag — they were drafting mistakes, the same class as "Kavindu
-- Kandambi" (Sri Lanka) and "Shahidullah Kamawal" (Afghanistan). A third name,
-- "Wesley Landman", returned no real Wikidata cricketer and no reliable
-- source confirming him as a genuine Netherlands player, so it was dropped
-- rather than guessed at.
--
-- Two of the three were replaced with players independently confirmed via
-- ESPNcricinfo/ICC's actual T20 World Cup 2026 squad announcement before being
-- added:
--   Colin Ackermann        Q21620659 — Dutch-South African, prominent county
--                          cricketer who now plays internationally for NL
--   Timm van der Gugten     Q7806782  — Australian-born (Sydney) to Dutch
--                          parents, NL international since 2012
--
-- A third candidate, Shane Snater (Q26209529, citizenship matches the country
-- row directly), was added as the "Wesley Landman" replacement. A search for a
-- 30th name to replace "Sagar Patel" turned up two further candidates —
-- "Kamran Khan" (no matching Netherlands cricketer found at all) and Ahsan
-- Malik (Q15979723, a real former Dutch international — but his last
-- recorded international match was 2017, so he reads as retired rather than
-- current, the same disqualifying reason Vusi Sibanda was dropped from the
-- Zimbabwe seed). Neither held up, and no further name could be verified in
-- the time available, so this squad ships at 29 curated players rather than
-- 30 — a smaller accurate roster over a padded, unverified one.
--
-- Temp table because the list is used twice (insert missing players, then
-- backfill onto any a CricAPI squad sync already created). No ON COMMIT DROP —
-- migrate.sh runs in autocommit, so the table would vanish immediately; it is
-- dropped explicitly at the end.
DROP TABLE IF EXISTS curated_squad_nl;
CREATE TEMP TABLE curated_squad_nl (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  batting_style TEXT, bowling_style TEXT
);

INSERT INTO curated_squad_nl (name, role, credits, team_name, batting_style, bowling_style)
VALUES
  ('Scott Edwards',         'wicket_keeper', 8.5, 'Netherlands', 'Right-handed', NULL),
  ('Wesley Barresi',        'wicket_keeper', 7.5, 'Netherlands', 'Right-handed', NULL),
  ('Michael Levitt',        'wicket_keeper', 7.5, 'Netherlands', 'Left-handed',  NULL),
  ('Max O''Dowd',           'batsman',       8.5, 'Netherlands', 'Right-handed', 'Right-arm off break'),
  ('Vikramjit Singh',       'batsman',       8.0, 'Netherlands', 'Right-handed', 'Right-arm medium'),
  ('Sybrand Engelbrecht',   'batsman',       7.5, 'Netherlands', 'Right-handed', NULL),
  ('Teja Nidamanuru',       'batsman',       7.5, 'Netherlands', 'Right-handed', 'Right-arm off break'),
  ('Noah Croes',            'batsman',       7.5, 'Netherlands', 'Right-handed', NULL),
  ('Boris Gorlee',          'batsman',       7.5, 'Netherlands', 'Right-handed', 'Right-arm medium'),
  ('Philippe Boissevain',   'batsman',       7.5, 'Netherlands', 'Right-handed', NULL),
  ('Bas de Leede',          'all_rounder',   8.5, 'Netherlands', 'Right-handed', 'Right-arm medium-fast'),
  ('Roelof van der Merwe',  'all_rounder',   8.0, 'Netherlands', 'Left-handed',  'Slow left-arm orthodox'),
  ('Colin Ackermann',       'all_rounder',   8.5, 'Netherlands', 'Right-handed', 'Right-arm off break'),
  ('Aryan Dutt',            'all_rounder',   7.5, 'Netherlands', 'Right-handed', 'Right-arm off break'),
  ('Saqib Zulfiqar',        'all_rounder',   7.5, 'Netherlands', 'Left-handed',  'Slow left-arm orthodox'),
  ('Shane Snater',          'all_rounder',   8.0, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Logan van Beek',        'bowler',        8.0, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Fred Klaassen',         'bowler',        7.5, 'Netherlands', 'Left-handed',  'Left-arm fast-medium'),
  ('Paul van Meekeren',     'bowler',        8.0, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Vivian Kingma',         'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Kyle Klein',            'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Timm van der Gugten',   'bowler',        8.0, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Ryan Klein',            'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Shariz Ahmad',          'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm leg break'),
  ('Musa Ahmed',            'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Tim Pringle',           'bowler',        7.5, 'Netherlands', 'Right-handed', 'Slow left-arm orthodox'),
  ('Clayton Floyd',         'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm fast-medium'),
  ('Zach Lion-Cachet',      'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm off break'),
  ('Ben Cooper',            'bowler',        7.5, 'Netherlands', 'Right-handed', 'Right-arm medium');

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style)
SELECT v.name, v.role, v.credits, v.team_name,
       (SELECT id FROM cricket_countries WHERE lower(name) = 'netherlands' LIMIT 1),
       v.batting_style, v.bowling_style
FROM curated_squad_nl v
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
FROM curated_squad_nl v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL);

-- Point every Netherlands player at the country row, including any that
-- predate country_id, so the admin list's LATERAL country lookup resolves by id.
UPDATE cricket_fantasy_players
SET country_id = (SELECT id FROM cricket_countries WHERE lower(name) = 'netherlands' LIMIT 1)
WHERE team_name = 'Netherlands' AND country_id IS NULL;

DROP TABLE IF EXISTS curated_squad_nl;
