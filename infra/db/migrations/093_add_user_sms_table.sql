-- Migration: 093_add_user_sms_table
-- Description: Creates the user_sms table to store synced SMS messages.

CREATE TABLE IF NOT EXISTS user_sms (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address VARCHAR(255),
  body TEXT,
  date TIMESTAMP,
  type VARCHAR(50), -- e.g., 'inbox', 'sent', 'draft'
  synced_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, address, date, body)
);

CREATE INDEX IF NOT EXISTS idx_user_sms_user_id ON user_sms(user_id);
