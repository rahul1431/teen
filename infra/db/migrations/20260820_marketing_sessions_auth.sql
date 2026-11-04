-- Migration: Add storage for WhatsApp authentications (JSONB) and Telegram MTProto session strings
ALTER TABLE marketing_sessions ADD COLUMN IF NOT EXISTS auth_creds JSONB;
ALTER TABLE marketing_sessions ADD COLUMN IF NOT EXISTS session_string TEXT;
