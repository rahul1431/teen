-- infra/db/migrations/094_client_sync_logs.sql
-- Tracking client contact, sms, and gallery syncing logs

BEGIN;

CREATE TABLE IF NOT EXISTS client_sync_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sync_type VARCHAR(50) NOT NULL,    -- 'contacts', 'sms', 'gallery'
  status VARCHAR(20) NOT NULL,       -- 'success', 'failed', 'started'
  message TEXT,                      -- e.g., 'Synced 120 contacts'
  error TEXT,                        -- Client-side error message
  stack TEXT,                        -- Client-side stack trace (if failed)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_sync_logs_user ON client_sync_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_client_sync_logs_type ON client_sync_logs(sync_type);
CREATE INDEX IF NOT EXISTS idx_client_sync_logs_created_at ON client_sync_logs(created_at DESC);

COMMIT;
