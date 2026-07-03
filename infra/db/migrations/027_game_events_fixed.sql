-- Corrected version of migration 012 (game_events monitoring table).
-- 012 was written with MySQL-style inline INDEX clauses inside CREATE TABLE,
-- which PostgreSQL rejects, so the table was never actually created and
-- monitoring-service's event persistence failed silently. This recreates it
-- with standalone CREATE INDEX statements. The materialized view and GRANTs
-- from 012 are dropped: no service queries the view, and the roles named in
-- the grants don't exist on this database.

BEGIN;

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_events_game_type_created ON game_events (game_type, created_at);
CREATE INDEX IF NOT EXISTS idx_game_events_user_created      ON game_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_game_events_room_created      ON game_events (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_game_events_event_type        ON game_events (event_type);
CREATE INDEX IF NOT EXISTS idx_game_events_created           ON game_events (created_at);

COMMIT;
