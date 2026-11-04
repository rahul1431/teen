-- Migration: Add scheduling, targeting segments, rich images, and templates to notifications
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'sent'; -- 'pending', 'processing', 'sent', 'failed'
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS segment_type VARCHAR(30) DEFAULT 'all'; -- 'all', 'active_7d', 'inactive_7d', 'low_balance'

-- Add columns to notifications table to support campaigns and image URLs
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Create Notification Templates Table
CREATE TABLE IF NOT EXISTS notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'general',
  route VARCHAR(255),
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for pending scheduler query
CREATE INDEX IF NOT EXISTS idx_notification_campaigns_pending ON notification_campaigns (status, scheduled_for) WHERE status = 'pending';
