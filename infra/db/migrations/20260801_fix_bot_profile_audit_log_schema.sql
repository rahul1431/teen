-- bot_profile_audit_log was created with (previous_config, new_config,
-- created_at) but audit-logger.ts has always queried/inserted
-- (admin_user_id, changes, timestamp) -- a schema/code mismatch that was
-- never caught because the INSERT's error was only logged, not surfaced,
-- until profile-builder.ts's buildProfiles started re-throwing it (see
-- 2026-08-01 teen_patti_move_decisions work) and it turned out to silently
-- abort every "Rebuild Now" partway through the FIRST difficulty tier of
-- the FIRST game type, for every game, indefinitely.
ALTER TABLE bot_profile_audit_log ADD COLUMN IF NOT EXISTS admin_user_id UUID;
ALTER TABLE bot_profile_audit_log ADD COLUMN IF NOT EXISTS changes JSONB;
ALTER TABLE bot_profile_audit_log ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_bot_profile_audit_log_timestamp ON bot_profile_audit_log(timestamp);
