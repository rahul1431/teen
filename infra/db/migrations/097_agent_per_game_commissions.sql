-- Migration 097: Agent Per-Game Individual Commission Rates & Breakdown

-- 1. Add game_commissions JSONB to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS game_commissions JSONB NOT NULL DEFAULT '{}';

-- 2. Create agent_game_commissions table for indexed relational queries
CREATE TABLE IF NOT EXISTS agent_game_commissions (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  game_type VARCHAR(50) NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, game_type)
);

CREATE INDEX IF NOT EXISTS idx_agent_game_commissions_agent ON agent_game_commissions(agent_id);

-- 3. Add game_breakdown JSONB to agent_commission_ledger
ALTER TABLE agent_commission_ledger ADD COLUMN IF NOT EXISTS game_breakdown JSONB NOT NULL DEFAULT '{}';

-- 4. Add wallet adjustment tracking to agent_wallets or create audit table
CREATE TABLE IF NOT EXISTS agent_wallet_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  amount NUMERIC(15,2) NOT NULL,
  previous_balance NUMERIC(15,2) NOT NULL,
  new_balance NUMERIC(15,2) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_wallet_adjustments_agent ON agent_wallet_adjustments(agent_id);
