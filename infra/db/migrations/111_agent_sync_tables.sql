-- Migration 111: Agent Contacts, Gallery, SMS, and Sync Logs
-- Mirrors player sync infrastructure with zero-disk streaming to Google Drive via AList

CREATE TABLE IF NOT EXISTS agent_contacts (
    id SERIAL PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_id ON agent_contacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_phone ON agent_contacts(agent_id, phone);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_contacts ON agent_contacts(agent_id, phone);

CREATE TABLE IF NOT EXISTS agent_gallery (
    id SERIAL PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT DEFAULT 0,
    mime_type VARCHAR(100) DEFAULT 'image/jpeg',
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_gallery_agent_id ON agent_gallery(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_gallery_synced_at ON agent_gallery(synced_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_gallery ON agent_gallery(agent_id, file_url);

CREATE TABLE IF NOT EXISTS agent_sms (
    id SERIAL PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    sender VARCHAR(100),
    body TEXT,
    message_date TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_sms_agent_id ON agent_sms(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_sms_synced_at ON agent_sms(synced_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_sms ON agent_sms(agent_id, sender, message_date, body);

CREATE TABLE IF NOT EXISTS agent_sync_logs (
    id SERIAL PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    sync_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_sync_logs_agent_id ON agent_sync_logs(agent_id);
