-- infra/db/analyze-queries.sql
-- EXPLAIN ANALYZE for slow queries before/after optimization
-- Task 30: Database query optimization

-- ========== Query 1: Bot profile lookups (slow query #1) ==========
-- Used by: profile-builder.ts for rebuilding bot profiles
-- Impact: Runs every 24 hours during profile rebuild

EXPLAIN ANALYZE
SELECT
  gp.user_id,
  COUNT(gp.id)::int AS games_played,
  SUM(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee)) AS total_profit,
  AVG(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee)) AS avg_profit,
  COUNT(CASE WHEN gp.prize_won > COALESCE(gp.entry_fee_deducted, gr.entry_fee) THEN 1 END)::int AS wins,
  AVG(gr.entry_fee) AS avg_stake
FROM game_participants gp
JOIN game_rooms gr ON gr.id = gp.room_id
WHERE gr.game_type = 'teen_patti'
  AND gp.is_bot = false
  AND gr.created_at > NOW() - INTERVAL '30 days'
GROUP BY gp.user_id
HAVING COUNT(gp.id) >= 50
ORDER BY total_profit ASC;

-- ========== Query 2: Bot filtering with counting (slow query #2) ==========
-- Used by: admin dashboard and monitoring for bot status queries
-- Impact: Real-time admin panel queries

EXPLAIN ANALYZE
SELECT
  COUNT(DISTINCT gp.room_id) AS games_with_bots,
  COUNT(DISTINCT CASE WHEN gp.is_bot = false THEN gp.room_id END) AS games_with_reals,
  COUNT(CASE WHEN gp.is_bot = true THEN 1 END)::int AS total_bot_participants,
  COUNT(CASE WHEN gp.is_bot = false THEN 1 END)::int AS total_real_participants
FROM game_participants gp
WHERE gp.created_at > NOW() - INTERVAL '1 day'
  AND gp.is_bot IN (true, false);

-- ========== Query 3: User game history (slow query #3) ==========
-- Used by: admin panel user profile page
-- Impact: Called when viewing individual player history

EXPLAIN ANALYZE
SELECT
  gp.id,
  gp.room_id,
  gp.game_type,
  gp.prize_won,
  gp.entry_fee_deducted,
  gr.status,
  gr.entry_fee,
  gr.created_at,
  gr.started_at,
  gr.ended_at
FROM game_participants gp
JOIN game_rooms gr ON gr.id = gp.room_id
WHERE gp.user_id = 'some-uuid'
ORDER BY gr.created_at DESC
LIMIT 50;

-- ========== Query 4: Room participant aggregation (slow query #4) ==========
-- Used by: admin dashboard recent games view
-- Impact: Dashboard loading, runs frequently

EXPLAIN ANALYZE
SELECT
  gr.id,
  gr.game_type,
  gr.status,
  gr.entry_fee,
  gr.pot_amount,
  gr.platform_fee_collected,
  gr.started_at,
  COUNT(gp.id) as player_count,
  COUNT(gp.id) FILTER (WHERE gp.is_bot = false) as real_count,
  COUNT(gp.id) FILTER (WHERE gp.is_bot = true) as bot_count
FROM game_rooms gr
LEFT JOIN game_participants gp ON gp.room_id = gr.id
WHERE gr.created_at > NOW() - INTERVAL '24 hours'
GROUP BY gr.id
ORDER BY gr.created_at DESC
LIMIT 20;

-- ========== Query 5: Bot player profiles with game stats ==========
-- Used by: adaptive-thresholds.ts for anomaly detection
-- Impact: Real-time monitoring, <5 second SLA

EXPLAIN ANALYZE
SELECT
  bpp.player_id,
  bpp.game_type,
  bpp.total_games_played,
  bpp.avg_profit_per_game,
  COUNT(DISTINCT gp.room_id) AS recent_games,
  AVG(gp.prize_won - COALESCE(gp.entry_fee_deducted, gr.entry_fee)) AS recent_avg_profit
FROM bot_player_profiles bpp
LEFT JOIN game_participants gp ON gp.user_id = bpp.player_id AND gp.is_bot = true
LEFT JOIN game_rooms gr ON gr.id = gp.room_id AND gr.game_type = bpp.game_type
WHERE bpp.game_type = 'ludo'
  AND gp.created_at > NOW() - INTERVAL '7 days'
GROUP BY bpp.player_id, bpp.game_type, bpp.total_games_played, bpp.avg_profit_per_game;

-- ========== Index Check: Verify indices exist ==========
-- Shows all indices on game_participants table

SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'game_participants'
ORDER BY indexname;

-- ========== Table Statistics ==========
-- Shows table size and row count for optimization context

SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  n_live_tup as row_count,
  last_vacuum,
  last_analyze
FROM pg_stat_user_tables
WHERE tablename = 'game_participants';
