-- Restores cricket session (fancy) betting — un-archives the tables that
-- were archived in 067. Match-odds (cricket_bets/cricket_markets) stays
-- archived; only session betting is being brought back.
ALTER TABLE IF EXISTS archived_cricket_sessions RENAME TO cricket_sessions;
ALTER TABLE IF EXISTS archived_cricket_session_bets RENAME TO cricket_session_bets;

-- Backfill team_a_flag/team_b_flag for matches added manually (via "+ Add
-- Match" in the admin panel), which never populated these columns — only
-- the sync-api/import-series-matches flows did. Same fuzzy substring match
-- as the app-level findFlag()/findCountryFlag() helpers.
UPDATE cricket_matches m
SET team_a_flag = c.flag_url
FROM cricket_countries c
WHERE m.team_a_flag IS NULL
  AND (m.team_a ILIKE '%' || c.name || '%' OR c.name ILIKE '%' || m.team_a || '%');

UPDATE cricket_matches m
SET team_b_flag = c.flag_url
FROM cricket_countries c
WHERE m.team_b_flag IS NULL
  AND (m.team_b ILIKE '%' || c.name || '%' OR c.name ILIKE '%' || m.team_b || '%');
