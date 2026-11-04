-- Migration to add marketing session persistence and campaign queue tables
CREATE TABLE IF NOT EXISTS marketing_sessions (
  id VARCHAR(50) PRIMARY KEY,
  protocol VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  phone_number VARCHAR(50),
  handle VARCHAR(50),
  dc VARCHAR(50),
  battery INTEGER,
  subscribers INTEGER,
  logs TEXT[] NOT NULL DEFAULT '{}',
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_queue_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES notification_campaigns(id) ON DELETE CASCADE,
  target_phone VARCHAR(50) NOT NULL,
  target_name VARCHAR(100),
  resolved_message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'skipped'
  channel VARCHAR(20) NOT NULL,
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_campaign_queue_items_campaign_id ON campaign_queue_items(campaign_id);
CREATE INDEX idx_campaign_queue_items_status ON campaign_queue_items(status);
