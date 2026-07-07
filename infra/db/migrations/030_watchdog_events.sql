-- Migration 030: watchdog event log (idle-game reaper visibility in admin panel)
CREATE TABLE IF NOT EXISTS watchdog_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL,
  game_type       VARCHAR(50) NOT NULL,
  action          VARCHAR(30) NOT NULL DEFAULT 'reaped',
  refunds         JSONB NOT NULL DEFAULT '[]',  -- [{user_id, username, is_bot, amount}]
  total_refunded  NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watchdog_events_created ON watchdog_events(created_at DESC);
