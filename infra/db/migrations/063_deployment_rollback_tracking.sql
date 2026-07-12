-- Enhanced rollback tracking with step-by-step progress
-- Tracks rollback events with detailed progress information and safety constraints

-- Deployment rollback events table
CREATE TABLE IF NOT EXISTS deployment_rollbacks (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  deployment_id VARCHAR(36) NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  rolled_back_to_deployment_id VARCHAR(36) NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  environment VARCHAR(20) NOT NULL CHECK (environment IN ('dev', 'prod')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'success', 'failed', 'cancelled')),

  -- Tracking information
  triggered_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  triggered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  -- Rollback details
  reason TEXT,
  previous_commit_hash VARCHAR(40),
  new_commit_hash VARCHAR(40),

  -- Safety constraints
  consecutive_rollback_count INT DEFAULT 0,
  is_rollback_of_rollback BOOLEAN DEFAULT FALSE,

  -- Progress tracking
  current_step INT DEFAULT 0,
  total_steps INT DEFAULT 8,
  progress_percent INT DEFAULT 0,

  -- Audit trail
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_rollbacks_deployment_id ON deployment_rollbacks(deployment_id);
CREATE INDEX IF NOT EXISTS idx_rollbacks_environment ON deployment_rollbacks(environment);
CREATE INDEX IF NOT EXISTS idx_rollbacks_status ON deployment_rollbacks(status);
CREATE INDEX IF NOT EXISTS idx_rollbacks_created_at ON deployment_rollbacks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rollbacks_environment_status ON deployment_rollbacks(environment, status);

-- Rollback steps table for tracking individual steps
CREATE TABLE IF NOT EXISTS deployment_rollback_steps (
  id SERIAL PRIMARY KEY,
  rollback_id VARCHAR(36) NOT NULL REFERENCES deployment_rollbacks(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  step_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'complete', 'failed')),

  start_time TIMESTAMP,
  end_time TIMESTAMP,
  duration_ms INT,

  error_message TEXT,
  error_details TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rollback_steps_rollback_id ON deployment_rollback_steps(rollback_id);
CREATE INDEX IF NOT EXISTS idx_rollback_steps_status ON deployment_rollback_steps(status);

-- Safety checks table for rollback validation
CREATE TABLE IF NOT EXISTS deployment_rollback_checks (
  id SERIAL PRIMARY KEY,
  rollback_id VARCHAR(36) NOT NULL REFERENCES deployment_rollbacks(id) ON DELETE CASCADE,
  check_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('passed', 'failed', 'warning')),

  message TEXT,
  details TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rollback_checks_rollback_id ON deployment_rollback_checks(rollback_id);
CREATE INDEX IF NOT EXISTS idx_rollback_checks_status ON deployment_rollback_checks(status);

-- Update trigger for deployment_rollbacks
CREATE OR REPLACE FUNCTION update_deployment_rollbacks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deployment_rollbacks_update_timestamp ON deployment_rollbacks;
CREATE TRIGGER deployment_rollbacks_update_timestamp BEFORE UPDATE ON deployment_rollbacks
FOR EACH ROW EXECUTE FUNCTION update_deployment_rollbacks_timestamp();

-- Update trigger for deployment_rollback_steps
CREATE OR REPLACE FUNCTION update_deployment_rollback_steps_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deployment_rollback_steps_update_timestamp ON deployment_rollback_steps;
CREATE TRIGGER deployment_rollback_steps_update_timestamp BEFORE UPDATE ON deployment_rollback_steps
FOR EACH ROW EXECUTE FUNCTION update_deployment_rollback_steps_timestamp();

-- Add comments for documentation
COMMENT ON TABLE deployment_rollbacks IS 'Tracks rollback operations with progress and safety constraints';
COMMENT ON COLUMN deployment_rollbacks.consecutive_rollback_count IS 'Counts consecutive rollbacks; resets when a non-rollback deployment succeeds';
COMMENT ON COLUMN deployment_rollbacks.is_rollback_of_rollback IS 'True if rolling back a rollback; limited to max 2 consecutive rollbacks';
COMMENT ON TABLE deployment_rollback_steps IS 'Individual steps in a rollback operation for detailed progress tracking';
COMMENT ON TABLE deployment_rollback_checks IS 'Pre-rollback safety checks validation results';

-- Add helper view for monitoring rollback status
CREATE OR REPLACE VIEW v_rollback_progress AS
SELECT
  dr.id,
  dr.deployment_id,
  dr.environment,
  dr.status,
  dr.progress_percent,
  dr.current_step,
  dr.total_steps,
  COUNT(CASE WHEN drs.status = 'complete' THEN 1 END) as completed_steps,
  COUNT(CASE WHEN drs.status = 'failed' THEN 1 END) as failed_steps,
  dr.triggered_at,
  EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - dr.started_at))::INT as duration_seconds
FROM deployment_rollbacks dr
LEFT JOIN deployment_rollback_steps drs ON dr.id = drs.rollback_id
GROUP BY dr.id, dr.deployment_id, dr.environment, dr.status, dr.progress_percent,
         dr.current_step, dr.total_steps, dr.triggered_at, dr.started_at;
