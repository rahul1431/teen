-- Migration 015: Analytics time-series tables
-- Used by Phase 2 analytics service for pre-aggregated metrics

CREATE TABLE IF NOT EXISTS analytics_hourly (
  id          SERIAL PRIMARY KEY,
  hour        TIMESTAMP NOT NULL,
  game_type   VARCHAR(50),           -- NULL = aggregate across all games
  active_players  INT DEFAULT 0,
  games_started   INT DEFAULT 0,
  games_completed INT DEFAULT 0,
  total_stake     DECIMAL(15,2) DEFAULT 0,
  total_rake      DECIMAL(15,2) DEFAULT 0,
  total_prize     DECIMAL(15,2) DEFAULT 0,
  new_players     INT DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(hour, COALESCE(game_type, ''))
);

CREATE INDEX IF NOT EXISTS idx_analytics_hourly_hour ON analytics_hourly(hour DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_game ON analytics_hourly(game_type, hour DESC);

CREATE TABLE IF NOT EXISTS player_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  game_type   VARCHAR(50),
  room_id     UUID,
  started_at  TIMESTAMP DEFAULT NOW(),
  ended_at    TIMESTAMP,
  duration_sec INT,
  stake       DECIMAL(15,2),
  result      VARCHAR(20),
  profit_loss DECIMAL(15,2)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON player_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_game    ON player_sessions(game_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON player_sessions(started_at DESC);

-- View: GGR (Gross Gaming Revenue) by day, last 30 days
-- Joins game_rooms (has platform_fee) with game_types
CREATE OR REPLACE VIEW ggr_daily AS
SELECT
  DATE_TRUNC('day', ended_at)  AS day,
  game_type,
  COUNT(*)                      AS games_played,
  SUM(platform_fee)             AS ggr,
  SUM(prize_pool)               AS total_wagered,
  COUNT(DISTINCT winner_id)     AS unique_winners
FROM game_rooms
WHERE status = 'completed'
  AND ended_at > NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- View: churn risk candidates — users inactive >= 7 days who played before that
CREATE OR REPLACE VIEW churn_risk_users AS
SELECT
  u.id,
  u.username,
  u.email,
  MAX(gr.ended_at)              AS last_played_at,
  COUNT(gp.id)                  AS total_games,
  SUM(gp.prize_won)             AS total_prize_won,
  NOW() - MAX(gr.ended_at)      AS inactive_duration
FROM users u
JOIN game_participants gp ON gp.user_id = u.id
JOIN game_rooms gr ON gr.id = gp.room_id
WHERE gr.ended_at < NOW() - INTERVAL '7 days'
  AND u.is_bot = false
GROUP BY u.id, u.username, u.email
HAVING MAX(gr.ended_at) < NOW() - INTERVAL '7 days'
ORDER BY inactive_duration DESC;
