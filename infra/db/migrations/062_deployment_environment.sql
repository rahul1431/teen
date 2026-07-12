-- Add environment tracking to deployment system
-- Tracks which environment (dev or prod) each deployment targets
-- Essential for multi-environment deployments with environment isolation

ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'prod'
  CHECK (environment IN ('dev', 'prod'));

-- Index for filtering deployments by environment
CREATE INDEX IF NOT EXISTS idx_deployments_environment ON deployments(environment);

-- Composite index for common queries: recent deployments by environment
CREATE INDEX IF NOT EXISTS idx_deployments_environment_created
  ON deployments(environment, created_at DESC);

-- Add comment for documentation
COMMENT ON COLUMN deployments.environment IS 'Target environment for deployment: dev (ports 3200-3299, teen_db_dev, REDIS 6380) or prod (ports 3000-3099, teen_db_prod, REDIS 6379)';

-- Update existing deployments to prod (backwards compatibility)
UPDATE deployments SET environment = 'prod' WHERE environment IS NULL;
