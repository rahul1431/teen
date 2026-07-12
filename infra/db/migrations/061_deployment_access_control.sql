-- Deployment Access Control
-- Adds DevAdmin role for restricted deployment access
-- DevAdmin: Can trigger deployments, review git status
-- Support/Finance/Readonly: Can view deployment history but not deploy
--
-- Role hierarchy:
-- - readonly (0) < support (1) < finance (2) < DevAdmin (3) < superadmin (4)

-- Update admin_users role enum if using explicit type
-- Note: Current schema uses VARCHAR for role, so no migration needed
-- But documenting that these values are now valid:
-- 'readonly', 'support', 'finance', 'DevAdmin', 'superadmin'

-- Add index for deployment access auditing
CREATE INDEX IF NOT EXISTS idx_admin_audit_deployment_access
  ON admin_audit_log(admin_id, action, created_at DESC)
  WHERE action IN ('deployment_access_denied', 'deployment_triggered', 'deployment_blocked_safety_check', 'deployment_cancelled');

-- Add index for tracking failed deployment access attempts
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_created
  ON admin_audit_log(admin_id, created_at DESC);

-- Document: Deployment access control
-- - Only DevAdmin and superadmin can call POST /api/dev/deploy
-- - Only DevAdmin and superadmin can call POST /api/dev/rollback/:id
-- - All admins can view GET /api/dev/deployment-status/:id (read-only)
-- - All admins can view GET /api/dev/deployment-history (read-only)
-- - All admins can view GET /api/dev/git-status (read-only)
--
-- Audit logging:
-- - Log failed access attempts (deployment_access_denied)
-- - Log successful deployments (deployment_triggered)
-- - Log blocked deployments (deployment_blocked_safety_check)
-- - Log deployment cancellations (deployment_cancelled)
-- - Rate limiting: Track failed attempts per admin_id with 10-min window
-- - Alert if same admin fails 3+ times in 10 minutes
