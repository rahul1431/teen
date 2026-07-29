-- Migration 065: de-duplicate game_emojis and enforce uniqueness going forward
--
-- 018_game_emojis_gifts.sql seeded 8 default emojis with `ON CONFLICT DO NOTHING`
-- but never defined a UNIQUE constraint on `emoji` for that clause to target, so
-- every manual re-run of the seed insert (across earlier ad-hoc deploys, before
-- schema_migrations tracking existed) silently duplicated all 8 rows. Live prod
-- ended up with 233 rows (8 emojis x ~29 copies each) instead of ~10.

-- Keep the oldest row per distinct emoji value, drop the rest.
DELETE FROM game_emojis a
USING game_emojis b
WHERE a.emoji = b.emoji
  AND (a.created_at, a.id) > (b.created_at, b.id);

ALTER TABLE game_emojis ADD CONSTRAINT game_emojis_emoji_unique UNIQUE (emoji);
