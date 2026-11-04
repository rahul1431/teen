-- infra/db/migrations/057_query_optimization_indices.sql
-- Database query optimization and indexing for performance scaling
-- Addresses Task 30: Optimize database queries and implement connection pooling
-- Creates composite and covering indices for game_participants table lookups

-- ========== UP: Create optimized indices ==========

-- Index for user game history queries (frequently accessed by admin panel)
CREATE INDEX IF NOT EXISTS idx_game_participants_user_created
  ON game_participants (user_id, joined_at DESC)
  INCLUDE (room_id, prize_won, entry_fee_deducted);

-- Index for room-based queries and join operations
CREATE INDEX IF NOT EXISTS idx_game_participants_room_user
  ON game_participants (room_id, user_id)
  INCLUDE (is_bot, prize_won, joined_at);

-- ========== DOWN: Drop indices (for manual rollback) ==========
-- To rollback, run:
-- DROP INDEX IF EXISTS idx_game_participants_user_created;
-- DROP INDEX IF EXISTS idx_game_participants_room_user;
