-- Agent / sub-agent commission system. Agents are a separate identity
-- (not `users`) — they don't need to be registered players. Commission is
-- computed from the existing wallet_transactions ledger, so no game engine
-- changes are needed. See docs/superpowers/specs/2026-07-20-agent-commission-system-design.md

CREATE TABLE agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username          VARCHAR(50) UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  display_name      VARCHAR(100) NOT NULL,
  phone             VARCHAR(20),
  status            VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  parent_agent_id   UUID REFERENCES agents(id),
  commission_rate   NUMERIC(5,2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
  referral_code     VARCHAR(20) UNIQUE NOT NULL,
  created_by        UUID NOT NULL REFERENCES admin_users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_parent_agent_id ON agents(parent_agent_id);
CREATE INDEX idx_agents_referral_code ON agents(referral_code);

CREATE TABLE agent_commission_ledger (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id              UUID NOT NULL REFERENCES agents(id),
  date                  DATE NOT NULL,
  direct_commission     NUMERIC(15,2) NOT NULL DEFAULT 0,
  override_commission   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_commission      NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                VARCHAR(20) NOT NULL DEFAULT 'settled' CHECK (status IN ('settled', 'voided')),
  flagged_for_review    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, date)
);

CREATE INDEX idx_agent_ledger_agent_id ON agent_commission_ledger(agent_id);
CREATE INDEX idx_agent_ledger_date ON agent_commission_ledger(date);

CREATE TABLE agent_wallets (
  agent_id        UUID PRIMARY KEY REFERENCES agents(id),
  balance         NUMERIC(15,2) NOT NULL DEFAULT 0,
  locked_balance  NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_earned    NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_paid_out  NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id),
  amount        NUMERIC(15,2) NOT NULL CHECK (amount >= 100),
  metadata      JSONB,
  status        VARCHAR(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'rejected')),
  reference     TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  processed_by  UUID REFERENCES admin_users(id)
);

CREATE INDEX idx_agent_payouts_agent_id ON agent_payouts(agent_id);
CREATE INDEX idx_agent_payouts_status ON agent_payouts(status);

ALTER TABLE users ADD COLUMN agent_id UUID REFERENCES agents(id);
CREATE INDEX idx_users_agent_id ON users(agent_id);
