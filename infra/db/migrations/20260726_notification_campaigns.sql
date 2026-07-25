-- Groups the per-recipient rows one admin-initiated push send creates
-- (broadcast or specific-user) into a single trackable record, so the
-- admin panel can show send history + delivery/read analytics instead of
-- losing that data the moment the send completes. System-triggered sends
-- (KYC/deposit/withdrawal confirmations) never populate campaign_id, so
-- they stay invisible to this history — only sends through the Notifications
-- page's Send form (POST /api/admin/notifications/broadcast|send) do.
CREATE TABLE notification_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('all', 'specific_user')),
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_by UUID NOT NULL REFERENCES admin_users(id),
  total_recipients INT NOT NULL DEFAULT 0,
  delivered_count INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_campaigns_created_at ON notification_campaigns(created_at DESC);
CREATE INDEX idx_notification_campaigns_type ON notification_campaigns(type);

ALTER TABLE notifications ADD COLUMN campaign_id UUID REFERENCES notification_campaigns(id) ON DELETE SET NULL;
CREATE INDEX idx_notifications_campaign_id ON notifications(campaign_id) WHERE campaign_id IS NOT NULL;
