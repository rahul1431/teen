-- Removes the self-service deployment/rollback dashboard (DevAdmin panel) and
-- its RBAC role. Feature removed; no admin_users rows used role='DevAdmin' at
-- the time of this migration.

DROP VIEW IF EXISTS v_rollback_progress;
DROP TABLE IF EXISTS deployment_rollback_checks;
DROP TABLE IF EXISTS deployment_rollback_steps;
DROP TABLE IF EXISTS deployment_rollbacks;
DROP TABLE IF EXISTS deployment_logs;
DROP TABLE IF EXISTS deployments;

DROP INDEX IF EXISTS idx_admin_audit_deployment_access;
DROP INDEX IF EXISTS idx_admin_audit_log_admin_created;
