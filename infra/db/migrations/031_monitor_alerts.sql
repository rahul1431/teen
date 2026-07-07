-- Migration 031: monitor alerts (app-monitor alerting engine)
CREATE TABLE IF NOT EXISTS monitor_alerts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind          VARCHAR(50) NOT NULL,     -- service_down | api_error_rate | error_spike
  severity      VARCHAR(10) NOT NULL DEFAULT 'warning',  -- warning | critical
  message       TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}',
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitor_alerts_created ON monitor_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_alerts_unacked ON monitor_alerts(acknowledged) WHERE acknowledged = FALSE;
