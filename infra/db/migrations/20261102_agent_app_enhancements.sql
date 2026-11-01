-- 20261102_agent_app_enhancements.sql
-- Adds agent notifications, fraud tracking columns, and agent transfer audit tracking

-- 1. Agent Notifications Table
CREATE TABLE IF NOT EXISTS agent_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info',
    is_read BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_notifs_agent_id ON agent_notifications(agent_id, created_at DESC);

-- 2. Anti-Fraud & Risk columns on agent_payouts
ALTER TABLE agent_payouts ADD COLUMN IF NOT EXISTS risk_score INT DEFAULT 0;
ALTER TABLE agent_payouts ADD COLUMN IF NOT EXISTS risk_flags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE agent_payouts ADD COLUMN IF NOT EXISTS compliance_notes TEXT;

-- 3. Audit trail for player deposits originating from an Agent
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_agent_id ON wallet_transactions(agent_id) WHERE agent_id IS NOT NULL;

