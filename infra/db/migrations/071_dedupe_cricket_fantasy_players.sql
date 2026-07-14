-- sync-squad only deduped by external_id, so every pre-existing (manually
-- seeded) player without one got a duplicate row inserted the first time a
-- real API sync ran for their team. Merges each duplicate pair back onto
-- the original (manually-curated) row — which has more accurate role data
-- (e.g. Jos Buttler/KL Rahul are keepers; the API's role-guess mis-tagged
-- them as batsman) — backfilling external_id so future syncs match instead
-- of duplicating again (see the accompanying code fix in betting.ts).
DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT
      old.id AS old_id, new.id AS new_id, new.external_id AS ext_id
    FROM cricket_fantasy_players old
    JOIN cricket_fantasy_players new
      ON new.name = old.name AND new.team_name = old.team_name AND new.id <> old.id
    WHERE old.external_id IS NULL AND new.external_id IS NOT NULL
  LOOP
    -- Move match-performance rows, skipping ones that would collide with a
    -- row the old id already has for that same match.
    DELETE FROM cricket_match_players mp
    WHERE mp.player_id = pair.new_id
      AND EXISTS (SELECT 1 FROM cricket_match_players x WHERE x.match_id = mp.match_id AND x.player_id = pair.old_id);
    UPDATE cricket_match_players SET player_id = pair.old_id WHERE player_id = pair.new_id;

    -- Repoint any drafted fantasy teams from the duplicate onto the original.
    UPDATE user_fantasy_teams SET captain_id = pair.old_id WHERE captain_id = pair.new_id;
    UPDATE user_fantasy_teams SET vice_captain_id = pair.old_id WHERE vice_captain_id = pair.new_id;
    UPDATE user_fantasy_teams SET player_ids = array_replace(player_ids, pair.new_id, pair.old_id)
      WHERE pair.new_id = ANY(player_ids);

    -- Tag the original with the external_id so future sync-squad calls
    -- match it directly instead of inserting yet another duplicate.
    UPDATE cricket_fantasy_players SET external_id = pair.ext_id WHERE id = pair.old_id;

    DELETE FROM cricket_fantasy_players WHERE id = pair.new_id;
  END LOOP;
END $$;
