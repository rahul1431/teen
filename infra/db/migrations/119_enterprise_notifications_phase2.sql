-- Migration 119: Enterprise Notifications Phase 2
-- 1. Anti-Fatigue Engine & Frequency Capping in Campaigns
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS skipped_fatigue_count INTEGER DEFAULT 0;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS frequency_cap INTEGER DEFAULT 3;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS action_buttons JSONB DEFAULT '[]'::jsonb;

-- 2. Interactive Action Buttons & Channel Routing in In-App & Push Notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_buttons JSONB DEFAULT '[]'::jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel_id VARCHAR(100) DEFAULT 'general';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'high';

-- 3. User Fatigue Controls & Retention Preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_quiet_hours_enabled BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_daily_promo_push INTEGER DEFAULT 3;
