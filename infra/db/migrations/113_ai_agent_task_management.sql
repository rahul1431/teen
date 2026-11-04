-- Migration 113: AI Agent Task Management & Human Verification Bridge
-- Enables AI Department Heads (Argus, Atlas, Midas, Zeus, Athena, Pythia, Aegis) to raise tasks,
-- assign them to specific agents or staff, and allows human administrators to verify/resolve them.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS raised_by_ai VARCHAR(50);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_ai_agent VARCHAR(50);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS issue_type VARCHAR(80);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'unverified';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES admin_users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verification_notes TEXT;
ALTER TABLE tasks ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE task_comments ALTER COLUMN admin_id DROP NOT NULL;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS author_name VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_tasks_raised_by_ai ON tasks(raised_by_ai) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_target_ai_agent ON tasks(target_ai_agent) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_verification_status ON tasks(verification_status) WHERE deleted_at IS NULL;
