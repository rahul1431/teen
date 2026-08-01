-- Fix duplicate country rows, and stop them from silently duplicating players.
--
-- 20260802_cricket_player_profiles_and_india_squad.sql inserted a country row
-- with id 'india' without checking whether a row for the same country already
-- existed under a different id — CricAPI's sync had already created 'in'
-- (name 'India'). Nothing enforced uniqueness on name, so both survived.
--
-- That mattered because the admin players list joins countries on NAME
-- (`LEFT JOIN cricket_countries c ON c.name = p.team_name`), so two rows named
-- 'India' returned every India player twice — the admin panel showed 72 players
-- where the table holds 36. The accompanying code change switches that join to
-- country_id via a LATERAL pick-one so a duplicate can never fan out rows again;
-- this migration removes the existing duplicates and adds the constraint that
-- should have been there from the start.

-- Merge duplicates onto one surviving row per country name.
-- Survivor rule: the shortest id, tie-broken alphabetically. That keeps the
-- CricAPI-generated id ('in') rather than the one the seed invented ('india'),
-- so existing flag lookups and any external references keep working.
DO $$
DECLARE
  dup RECORD;
  donor_wikidata VARCHAR(16);
  donor_flag     VARCHAR(255);
BEGIN
  FOR dup IN
    SELECT lower(name) AS lname,
           (ARRAY_AGG(id ORDER BY length(id), id))[1] AS keep_id,
           ARRAY_AGG(id ORDER BY length(id), id) AS all_ids
    FROM cricket_countries
    GROUP BY lower(name)
    HAVING count(*) > 1
  LOOP
    -- Read the values worth keeping BEFORE deleting the duplicates. Writing
    -- them onto the survivor first fails: wikidata_id carries a unique index,
    -- so copying Q668 across while the duplicate still holds it is a conflict.
    SELECT MAX(wikidata_id), MAX(flag_url)
    INTO donor_wikidata, donor_flag
    FROM cricket_countries
    WHERE id = ANY(dup.all_ids) AND id <> dup.keep_id;

    -- Repoint players before deleting, or the FK would block the delete.
    UPDATE cricket_fantasy_players
    SET country_id = dup.keep_id
    WHERE country_id = ANY(dup.all_ids) AND country_id <> dup.keep_id;

    DELETE FROM cricket_countries
    WHERE id = ANY(dup.all_ids) AND id <> dup.keep_id;

    -- Now the unique index is free, carry across anything the survivor lacks.
    UPDATE cricket_countries
    SET wikidata_id = COALESCE(wikidata_id, donor_wikidata),
        flag_url    = COALESCE(NULLIF(flag_url, ''), donor_flag)
    WHERE id = dup.keep_id;
  END LOOP;
END $$;

-- Prevent a second row for the same country from ever being created again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cricket_countries_name_unique
  ON cricket_countries (lower(name));
