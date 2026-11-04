-- Migration: Mass Dispatcher Upgrades
-- Add support for media attachments, quick reply buttons, recurring campaigns, and link tracking

ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS button_text VARCHAR(100);
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS button_url TEXT;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS cron_expression VARCHAR(100);
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ DEFAULT NULL;

CREATE TABLE IF NOT EXISTS campaign_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES notification_campaigns(id) ON DELETE CASCADE,
  target_phone VARCHAR(50) NOT NULL,
  short_code VARCHAR(20) UNIQUE NOT NULL,
  redirect_url TEXT NOT NULL,
  click_count INT DEFAULT 0,
  first_clicked_at TIMESTAMPTZ DEFAULT NULL,
  last_clicked_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_links_short_code ON campaign_links(short_code);
CREATE INDEX IF NOT EXISTS idx_campaign_links_campaign_id ON campaign_links(campaign_id);
