-- RBAC + 2FA support for admin users.
--
-- Roles: superadmin · finance · support · readonly
--   superadmin — everything (user CRUD, role assignment, finance, game config, settings)
--   finance   — finance/payments + user lookup (no role changes, no game config)
--   support   — user lookup, notes, status changes (suspend/activate); no wallet writes, no finance
--   readonly  — read-only across all dashboards
--
-- 2FA is opt-in per admin; superadmin can enforce a require_2fa flag globally later.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Normalize the existing seed superadmin row to the new role name (was 'superadmin' already, defensive)
UPDATE admin_users SET role = 'superadmin' WHERE username = 'superadmin' AND role NOT IN ('superadmin');
