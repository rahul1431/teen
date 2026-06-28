-- Migration 014: Widen varchar limits for Cricket matches, teams, and fantasy players
ALTER TABLE cricket_matches ALTER COLUMN series TYPE VARCHAR(255);
ALTER TABLE cricket_matches ALTER COLUMN team_a TYPE VARCHAR(255);
ALTER TABLE cricket_matches ALTER COLUMN team_b TYPE VARCHAR(255);
ALTER TABLE cricket_matches ALTER COLUMN team_a_short TYPE VARCHAR(50);
ALTER TABLE cricket_matches ALTER COLUMN team_b_short TYPE VARCHAR(50);
ALTER TABLE cricket_matches ALTER COLUMN result_winner TYPE VARCHAR(255);

ALTER TABLE cricket_teams ALTER COLUMN name TYPE VARCHAR(255);
ALTER TABLE cricket_teams ALTER COLUMN short_name TYPE VARCHAR(50);

ALTER TABLE cricket_fantasy_players ALTER COLUMN team_name TYPE VARCHAR(255);
