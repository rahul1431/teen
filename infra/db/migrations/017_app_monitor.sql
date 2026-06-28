-- infra/db/migrations/017_app_monitor.sql
-- App Monitor SDK — sessions and event tables

BEGIN;

CREATE TABLE IF NOT EXISTS app_sessions (
  id            VARCHAR(36) PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id     VARCHAR(100),
  app_version   VARCHAR(20),
  platform      VARCHAR(10) CHECK (platform IN ('android', 'ios')),
  os_version    VARCHAR(20),
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    VARCHAR(36) REFERENCES app_sessions(id) ON DELETE CASCADE,
  user_id       UUID,
  event_type    VARCHAR(30) NOT NULL
                CHECK (event_type IN ('screen_view','api_call','ws_event','error','lifecycle')),
  screen        VARCHAR(100),
  endpoint      VARCHAR(200),
  method        VARCHAR(10),
  status_code   INT,
  duration_ms   INT,
  error_message TEXT,
  ws_status     VARCHAR(30),
  properties    JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_session   ON app_events(session_id);
CREATE INDEX IF NOT EXISTS idx_app_events_type_time ON app_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_error     ON app_events(created_at)
  WHERE event_type = 'error';
CREATE INDEX IF NOT EXISTS idx_app_events_api       ON app_events(endpoint, created_at)
  WHERE event_type = 'api_call';
CREATE INDEX IF NOT EXISTS idx_app_sessions_user    ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_active  ON app_sessions(last_seen_at);

COMMIT;
