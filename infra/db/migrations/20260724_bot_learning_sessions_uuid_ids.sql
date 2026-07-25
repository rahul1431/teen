-- Migration: bot_learning_sessions bot/RP identifiers must be UUID, not BIGINT
-- Bot and real-player user IDs in this platform are UUIDs (users.id). The
-- original schema assumed numeric bot IDs, which made every write from the
-- coordination pipeline (BigInt(uuid)) throw. Table has never had a
-- successful insert, so this is a straight column-type change, no backfill.

ALTER TABLE bot_learning_sessions
  ALTER COLUMN winner_bot_id TYPE UUID USING winner_bot_id::text::uuid,
  ALTER COLUMN actual_winner_id TYPE UUID USING actual_winner_id::text::uuid,
  ALTER COLUMN rp_id TYPE UUID USING rp_id::text::uuid;
