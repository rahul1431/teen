-- Add 'suspicious' as a valid user status for Risk Center flagging
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'suspicious';
