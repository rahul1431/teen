-- Allows a user to join the same fantasy contest multiple times (Dream11-
-- style multi-entry), as long as each entry uses a different drafted team.
-- The old UNIQUE(league_id, user_id) constraint capped each user to exactly
-- one entry per contest; UNIQUE(league_id, team_id) instead just blocks the
-- same team roster from being entered into the same contest twice (distinct
-- rosters are enforced at the application layer, since that needs to compare
-- player_ids/captain/vice_captain rather than a single column).
ALTER TABLE cricket_fantasy_entries DROP CONSTRAINT IF EXISTS cricket_fantasy_entries_league_id_user_id_key;
ALTER TABLE cricket_fantasy_entries ADD CONSTRAINT cricket_fantasy_entries_league_id_team_id_key UNIQUE (league_id, team_id);
