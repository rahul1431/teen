-- infra/db/migrations/041_add_profile_rebuild_index.sql
-- Composite indices for bot profile rebuild query performance
-- Optimizes queries used in the AI Control Center for bot profile analysis
-- targeting game_participants table lookups with improved selectivity

-- ========== UP: Create composite indices ==========
BEGIN;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_participants_rebuild
  ON game_participants (joined_at DESC, is_bot, status)
  INCLUDE (profit, user_id, game_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_participants_active
  ON game_participants (is_bot, created_at DESC)
  WHERE status = 'completed';

COMMIT;

-- ========== DOWN: Drop indices (for manual rollback) ==========
-- To rollback, run:
-- DROP INDEX IF EXISTS idx_game_participants_rebuild;
-- DROP INDEX IF EXISTS idx_game_participants_active;
