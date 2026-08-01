-- Cricket player profiles: richer per-player data (photo, styles, DOB, country)
-- plus a curated India squad to seed the pilot.
--
-- Why curated rather than synced: bulk-querying "the current India squad" from
-- Wikidata is unusable — it returns retired players, women's-team players and
-- even other nations' internationals mixed together, with no batting/bowling
-- style at all. Roster membership, role and fantasy credits are therefore
-- committed here as reviewed data (credits are a game-balance decision, not a
-- lookup-able fact). Photo/DOB/styles ARE fetched automatically afterwards by
-- the enrichment resolver (services/core-api-service/src/helpers/wikidata-cricket.ts),
-- which resolves per player name and is safe to re-run.

-- ── Countries: key flags off a stable Wikidata ID ──
-- findCountryFlag() currently matches a team name against cricket_countries.name
-- by fuzzy substring, which misfires on multi-word names. wikidata_id gives the
-- enrichment path something exact to join on.
ALTER TABLE cricket_countries ADD COLUMN IF NOT EXISTS wikidata_id VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cricket_countries_wikidata
  ON cricket_countries(wikidata_id) WHERE wikidata_id IS NOT NULL;

-- ── Player profile fields ──
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS country_id VARCHAR(10) REFERENCES cricket_countries(id);
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS batting_style VARCHAR(60);
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS bowling_style VARCHAR(60);
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS wikidata_id VARCHAR(16);
-- Commons photos are CC-licensed: the credit string and source page must be
-- retained and surfaced somewhere in the app to satisfy attribution.
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS image_credit VARCHAR(500);
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS image_source_url VARCHAR(500);
-- Set false to retire a player from selection without deleting their history.
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Records the last successful enrichment run so the admin UI can show staleness
-- and so re-runs can skip players already resolved.
ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cricket_players_country ON cricket_fantasy_players(country_id);

-- ── India ──
INSERT INTO cricket_countries (id, name, flag_url, wikidata_id)
VALUES ('india', 'India', 'https://upload.wikimedia.org/wikipedia/en/4/41/Flag_of_India.svg', 'Q668')
ON CONFLICT (id) DO UPDATE SET wikidata_id = EXCLUDED.wikidata_id;

-- ── Curated India squad ──
-- name, role, credits, team_name. Everything else is filled by enrichment.
--
-- Deliberately NOT using a unique index + ON CONFLICT here: migration 071 only
-- merged case-sensitive duplicate pairs where exactly one side lacked an
-- external_id, so a live database may still hold pairs that would make
-- CREATE UNIQUE INDEX fail mid-migration. Insert-if-absent is idempotent
-- without needing the constraint, and leaves any existing row (including an
-- admin's hand-tuned credits) untouched.
-- Batting/bowling style is curated here too, not enriched. Wikidata's
-- batting-style (P741) and bowling-style (P5126) properties are effectively
-- unpopulated for cricketers — a survey of 121 India-linked player entities
-- returned zero of either — so leaving them to the resolver would leave every
-- row blank. Keepers who don't bowl carry NULL bowling_style.
-- Held in a temp table because the list is needed twice: once to insert the
-- players who aren't in the database yet, and once to backfill styles onto the
-- ones that already are. A dry run against production found 23 of these 32 were
-- already present (from earlier seeds and squad syncs), so an insert-only seed
-- would have left the best-known players with no batting/bowling style at all.
CREATE TEMP TABLE curated_squad (
  name TEXT, role TEXT, credits NUMERIC(4,1), team_name TEXT,
  country_id TEXT, batting_style TEXT, bowling_style TEXT
) ON COMMIT DROP;

INSERT INTO curated_squad (name, role, credits, team_name, country_id, batting_style, bowling_style)
VALUES
  ('Rohit Sharma',        'batsman',       9.5, 'India', 'india', 'Right-handed', 'Right-arm off break'),
  ('Virat Kohli',         'batsman',      10.0, 'India', 'india', 'Right-handed', 'Right-arm medium'),
  ('Shubman Gill',        'batsman',       9.5, 'India', 'india', 'Right-handed', 'Right-arm off break'),
  ('Yashasvi Jaiswal',    'batsman',       9.0, 'India', 'india', 'Left-handed',  'Right-arm leg break'),
  ('Shreyas Iyer',        'batsman',       8.5, 'India', 'india', 'Right-handed', 'Right-arm leg break'),
  ('Tilak Varma',         'batsman',       8.5, 'India', 'india', 'Left-handed',  'Right-arm off break'),
  ('Abhishek Sharma',     'batsman',       8.5, 'India', 'india', 'Left-handed',  'Slow left-arm orthodox'),
  ('Ruturaj Gaikwad',     'batsman',       8.0, 'India', 'india', 'Right-handed', 'Right-arm off break'),
  ('Sai Sudharsan',       'batsman',       8.0, 'India', 'india', 'Left-handed',  'Right-arm leg break'),
  ('Rinku Singh',         'batsman',       8.0, 'India', 'india', 'Left-handed',  'Right-arm off break'),
  ('Rishabh Pant',        'wicket_keeper', 9.5, 'India', 'india', 'Left-handed',  NULL),
  ('KL Rahul',            'wicket_keeper', 9.0, 'India', 'india', 'Right-handed', NULL),
  ('Sanju Samson',        'wicket_keeper', 8.5, 'India', 'india', 'Right-handed', NULL),
  ('Dhruv Jurel',         'wicket_keeper', 8.0, 'India', 'india', 'Right-handed', NULL),
  ('Ishan Kishan',        'wicket_keeper', 8.0, 'India', 'india', 'Left-handed',  NULL),
  ('Hardik Pandya',       'all_rounder',   9.5, 'India', 'india', 'Right-handed', 'Right-arm fast-medium'),
  ('Ravindra Jadeja',     'all_rounder',   9.5, 'India', 'india', 'Left-handed',  'Slow left-arm orthodox'),
  ('Axar Patel',          'all_rounder',   9.0, 'India', 'india', 'Left-handed',  'Slow left-arm orthodox'),
  ('Washington Sundar',   'all_rounder',   8.5, 'India', 'india', 'Left-handed',  'Right-arm off break'),
  ('Shivam Dube',         'all_rounder',   8.0, 'India', 'india', 'Left-handed',  'Right-arm medium'),
  ('Nitish Kumar Reddy',  'all_rounder',   8.0, 'India', 'india', 'Right-handed', 'Right-arm medium'),
  ('Jasprit Bumrah',      'bowler',       10.0, 'India', 'india', 'Right-handed', 'Right-arm fast'),
  ('Mohammed Siraj',      'bowler',        9.0, 'India', 'india', 'Right-handed', 'Right-arm fast-medium'),
  ('Kuldeep Yadav',       'bowler',        9.0, 'India', 'india', 'Left-handed',  'Slow left-arm wrist-spin'),
  ('Mohammed Shami',      'bowler',        8.5, 'India', 'india', 'Right-handed', 'Right-arm fast'),
  ('Arshdeep Singh',      'bowler',        8.5, 'India', 'india', 'Left-handed',  'Left-arm medium-fast'),
  ('Varun Chakravarthy',  'bowler',        8.5, 'India', 'india', 'Right-handed', 'Right-arm leg break'),
  ('Yuzvendra Chahal',    'bowler',        8.0, 'India', 'india', 'Right-handed', 'Right-arm leg break'),
  ('Ravi Bishnoi',        'bowler',        8.0, 'India', 'india', 'Right-handed', 'Right-arm leg break'),
  ('Prasidh Krishna',     'bowler',        7.5, 'India', 'india', 'Right-handed', 'Right-arm fast-medium'),
  ('Harshit Rana',        'bowler',        7.5, 'India', 'india', 'Right-handed', 'Right-arm fast-medium'),
  ('Akash Deep',          'bowler',        7.5, 'India', 'india', 'Right-handed', 'Right-arm fast-medium');

-- 1. Add the players who aren't in the database yet.
INSERT INTO cricket_fantasy_players
  (name, role, credits, team_name, country_id, batting_style, bowling_style)
SELECT v.name, v.role, v.credits, v.team_name, v.country_id, v.batting_style, v.bowling_style
FROM curated_squad v
WHERE NOT EXISTS (
  SELECT 1 FROM cricket_fantasy_players p
  WHERE lower(p.name) = lower(v.name) AND p.team_name = v.team_name
);

-- 2. Backfill styles onto players who already existed. Only fills columns that
--    are still empty, so a style an admin has already corrected is preserved.
--    Role and credits are deliberately NOT touched here: those may have been
--    tuned in the admin panel, and overwriting them would silently change game
--    balance and every player's draft cost.
UPDATE cricket_fantasy_players p
SET batting_style = COALESCE(p.batting_style, v.batting_style),
    bowling_style = COALESCE(p.bowling_style, v.bowling_style)
FROM curated_squad v
WHERE lower(p.name) = lower(v.name)
  AND p.team_name = v.team_name
  AND (p.batting_style IS NULL OR p.bowling_style IS NULL);

-- Backfill country_id onto any India players that already existed (e.g. seeded
-- by migration 039 or by a past squad sync) so the whole roster joins to the
-- country row consistently.
UPDATE cricket_fantasy_players
SET country_id = 'india'
WHERE team_name = 'India' AND country_id IS NULL;
