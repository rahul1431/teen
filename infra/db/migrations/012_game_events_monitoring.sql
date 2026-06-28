-- Migration 012: Game Events Monitoring Table
-- Purpose: Store all game events for real-time analytics and anomaly detection

CREATE TABLE IF NOT EXISTS game_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  game_type VARCHAR(50),
  room_id UUID,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100),
  amount DECIMAL(15,2),
  player_count INT,
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_game_events_game_type_created (game_type, created_at),
  INDEX idx_game_events_user_created (user_id, created_at),
  INDEX idx_game_events_room_created (room_id, created_at),
  INDEX idx_game_events_event_type (event_type),
  INDEX idx_game_events_created (created_at)
);

-- Add retention policy (optional, comment out if using infinite storage)
-- Events older than 30 days can be archived
-- CREATE POLICY game_events_retention AS
-- SELECT * FROM game_events WHERE created_at > NOW() - INTERVAL '30 days'
-- WITH (check_filter = 'created_at > NOW() - INTERVAL \'30 days\'');

-- Create continuous aggregate for minute-level metrics (requires TimescaleDB extension)
-- If TimescaleDB not available, use PostgreSQL MATERIALIZED VIEW instead
CREATE MATERIALIZED VIEW IF NOT EXISTS game_events_minute_metrics AS
SELECT
  DATE_TRUNC('minute', created_at) as minute,
  game_type,
  event_type,
  COUNT(*) as event_count,
  COUNT(DISTINCT user_id) as unique_players,
  COUNT(DISTINCT room_id) as active_rooms,
  AVG(CAST(amount AS DECIMAL)) as avg_amount,
  MAX(CAST(amount AS DECIMAL)) as max_amount
FROM game_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY minute, game_type, event_type;

-- Index on materialized view for fast queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_events_minute_metrics
ON game_events_minute_metrics(minute, game_type, event_type);

-- Grant permissions
GRANT SELECT ON game_events TO readonly_user;
GRANT INSERT ON game_events TO monitoring_user;
GRANT SELECT ON game_events_minute_metrics TO readonly_user;
