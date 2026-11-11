-- Migration 112: Enterprise Notification Infrastructure
-- 1. Agents table FCM token support
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(512);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fcm_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_agents_fcm_token ON agents(fcm_token) WHERE fcm_token IS NOT NULL;

-- 2. Notification Campaign Conversion & Attribution Analytics
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS clicked_count INTEGER DEFAULT 0;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS converted_count INTEGER DEFAULT 0;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS conversion_revenue NUMERIC(14, 2) DEFAULT 0;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN DEFAULT true;

-- 3. Notifications Table Click & Deep Link Action Tracking
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS clicked BOOLEAN DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;

-- 4. Abandoned Cashier / Deposit Intent Recovery
CREATE TABLE IF NOT EXISTS abandoned_cashier_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    promo_code VARCHAR(50),
    notified BOOLEAN DEFAULT false,
    completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abandoned_cashier_user_pending 
ON abandoned_cashier_events(user_id, notified, completed, created_at);
