-- Add rollback tracking to deployment system
-- Stores reference to deployment being rolled back from (if applicable)

ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS rollback_from VARCHAR(36) REFERENCES deployments(id) ON DELETE SET NULL;

-- Index for finding rollbacks
CREATE INDEX IF NOT EXISTS idx_deployments_rollback_from ON deployments(rollback_from);

-- Add comment for documentation
COMMENT ON COLUMN deployments.rollback_from IS 'If this is a rollback deployment, stores the ID of the deployment being rolled back from';
