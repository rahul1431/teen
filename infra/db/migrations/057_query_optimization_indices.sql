-- infra/db/migrations/057_query_optimization_indices.sql
-- Database query optimization and indexing for performance scaling
-- Addresses Task 30: Optimize database queries and implement connection pooling
-- Creates composite and covering indices for game_participants table lookups

-- ========== UP: Create optimized indices ==========
BEGIN;

-- Composite index for bot profile lookups (game_type, difficulty, is_bot)
-- Used by profile-builder queries that filter on game_type + is_bot + user status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_participants_profile_lookup
  ON game_participants (game_type, difficulty, is_bot)
  INCLUDE (profit, user_id, created_at, entry_fee_deducted);

-- Covering index for bot identifier queries and time-based filtering
-- Used by admin/monitoring queries that filter on is_bot + created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_participants_bot_created
  ON game_participants (is_bot, created_at DESC)
  INCLUDE (profit, user_id, game_type, room_id);

-- Index for user game history queries (frequently accessed by admin panel)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_participants_user_created
  ON game_participants (user_id, created_at DESC)
  INCLUDE (room_id, game_type, prize_won, entry_fee_deducted);

-- Index for room-based queries and join operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_participants_room_user
  ON game_participants (room_id, user_id)
  INCLUDE (is_bot, prize_won, created_at);

COMMIT;

-- ========== DOWN: Drop indices (for manual rollback) ==========
-- To rollback, run:
-- DROP INDEX IF EXISTS idx_game_participants_profile_lookup;
-- DROP INDEX IF EXISTS idx_game_participants_bot_created;
-- DROP INDEX IF EXISTS idx_game_participants_user_created;
-- DROP INDEX IF EXISTS idx_game_participants_room_user;
