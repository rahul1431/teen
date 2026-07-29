-- Corrective migration: 005_risk_status.sql targeted a type named
-- "user_status" which never existed (the real type, created in
-- 001_initial.sql, is "user_status_enum"). That statement failed
-- outright, but migrate.sh has no ON_ERROR_STOP, so the failure was
-- silently swallowed and 005_risk_status.sql was still recorded as
-- applied. 'suspicious' was therefore never actually added to the
-- enum, breaking admin-service's "flag user as suspicious" action and
-- the Risk Center's suspicious-user KPI tile.
-- See docs/Bugs/risk-center-suspicious-status-enum-never-created.md.
ALTER TYPE user_status_enum ADD VALUE IF NOT EXISTS 'suspicious';
