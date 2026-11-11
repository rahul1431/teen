-- 120_enterprise_notifications_phase3.sql
-- Omnichannel Cascade, Delivery Channel Attribution, Soft Delete & Categorized In-App Inbox

-- 1. notifications table upgrades
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS delivery_channel VARCHAR(32) DEFAULT 'push',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_channel_read
  ON notifications (user_id, channel_id, read) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_active
  ON notifications (user_id, created_at DESC) WHERE deleted_at IS NULL;

-- 2. agent_notifications table upgrades
ALTER TABLE agent_notifications
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS action_url TEXT,
  ADD COLUMN IF NOT EXISTS action_buttons JSONB,
  ADD COLUMN IF NOT EXISTS delivery_channel VARCHAR(32) DEFAULT 'push',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_notifs_agent_active
  ON agent_notifications (agent_id, created_at DESC) WHERE deleted_at IS NULL;

-- 3. notification_campaigns omnichannel counters
ALTER TABLE notification_campaigns
  ADD COLUMN IF NOT EXISTS delivery_channels VARCHAR(64) DEFAULT 'push',
  ADD COLUMN IF NOT EXISTS whatsapp_sent_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_sent_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fallback_triggered_count INTEGER DEFAULT 0;

-- 4. abandoned_cashier_events omnichannel follow-up
ALTER TABLE abandoned_cashier_events
  ADD COLUMN IF NOT EXISTS whatsapp_fallback_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_fallback_sent_at TIMESTAMPTZ DEFAULT NULL;
