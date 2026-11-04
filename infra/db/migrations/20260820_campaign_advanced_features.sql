-- Migration: Add A/B testing fields, retry count, and WhatsApp/Telegram active check status columns
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS template_b TEXT;
ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS is_ab_test BOOLEAN DEFAULT FALSE;

ALTER TABLE campaign_queue_items ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE campaign_queue_items ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE marketing_leads ADD COLUMN IF NOT EXISTS whatsapp_exists BOOLEAN DEFAULT NULL;
ALTER TABLE marketing_leads ADD COLUMN IF NOT EXISTS telegram_exists BOOLEAN DEFAULT NULL;
ALTER TABLE marketing_leads ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT NULL;
