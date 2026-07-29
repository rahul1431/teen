-- Deployment tracking tables
-- Stores deployment jobs and their logs for audit trail and debugging

CREATE TABLE IF NOT EXISTS deployments (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'deploying', 'success', 'failed', 'rolled_back')),
  branch VARCHAR(255) NOT NULL,
  commit_hash VARCHAR(40) NOT NULL,
  created_by UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deployments_status ON deployments(status);
CREATE INDEX idx_deployments_created_at ON deployments(created_at DESC);
CREATE INDEX idx_deployments_created_by ON deployments(created_by);

CREATE TABLE IF NOT EXISTS deployment_logs (
  id SERIAL PRIMARY KEY,
  deployment_id VARCHAR(36) NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  level VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error', 'success')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deployment_logs_deployment_id ON deployment_logs(deployment_id);
CREATE INDEX idx_deployment_logs_created_at ON deployment_logs(created_at DESC);

-- Add update trigger to set updated_at
CREATE OR REPLACE FUNCTION update_deployments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deployments_update_timestamp ON deployments;
CREATE TRIGGER deployments_update_timestamp BEFORE UPDATE ON deployments
FOR EACH ROW EXECUTE FUNCTION update_deployments_timestamp();
