-- Migration 096: Widen cricket matches format and add unique match_api_id constraint
BEGIN;

ALTER TABLE cricket_matches ALTER COLUMN format TYPE VARCHAR(50);

-- Delete duplicates of match_api_id keeping the first one
DELETE FROM cricket_matches a USING cricket_matches b
WHERE a.id > b.id AND a.match_api_id = b.match_api_id AND a.match_api_id IS NOT NULL;

-- Add unique constraint
ALTER TABLE cricket_matches ADD CONSTRAINT cricket_matches_match_api_id_key UNIQUE (match_api_id);

COMMIT;
