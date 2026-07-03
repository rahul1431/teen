-- infra/db/migrations/028_player_tracking.sql
-- Player Tracking — session enrichment (device, IP, geo, last screen/game) + GPS history
BEGIN;

ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS device_model  VARCHAR(120);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS manufacturer  VARCHAR(80);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS ip_address    INET;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_city      VARCHAR(120);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_region    VARCHAR(120);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_country   VARCHAR(80);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_lat       DOUBLE PRECISION;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS geo_lon       DOUBLE PRECISION;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS last_screen   VARCHAR(100);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS last_game     VARCHAR(60);

CREATE TABLE IF NOT EXISTS app_device_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  VARCHAR(36) REFERENCES app_sessions(id) ON DELETE CASCADE,
  user_id     UUID,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  accuracy_m  INT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_loc_user ON app_device_locations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_loc_time ON app_device_locations(created_at);

-- Allow the two new event types the mobile SDK already emits / will emit.
ALTER TABLE app_events DROP CONSTRAINT IF EXISTS app_events_event_type_check;
ALTER TABLE app_events ADD CONSTRAINT app_events_event_type_check
  CHECK (event_type IN ('screen_view','api_call','ws_event','error','lifecycle','game_event','location'));

COMMIT;
