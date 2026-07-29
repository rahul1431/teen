-- Agent-submitted marketing channels (Telegram/WhatsApp/other groups they
-- run to promote their referral link). Internal-only oversight registry —
-- no public visibility anywhere. See
-- docs/superpowers/specs/2026-07-22-agent-marketing-channels-design.md
CREATE TABLE agent_channels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES agents(id),
  platform          VARCHAR(20) NOT NULL CHECK (platform IN ('telegram', 'whatsapp', 'other')),
  label             VARCHAR(100) NOT NULL,
  url               VARCHAR(300) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES admin_users(id)
);

CREATE INDEX idx_agent_channels_agent_id ON agent_channels(agent_id);
CREATE INDEX idx_agent_channels_status ON agent_channels(status);
