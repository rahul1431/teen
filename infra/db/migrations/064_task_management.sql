-- Task Management System
-- Admin/superadmin create and assign tasks to employees (or other admins).
-- Employees can only update status + issue flag on tasks assigned to them.
-- See docs/superpowers/specs/2026-07-12-task-management-design.md

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'todo', -- todo | in_progress | done | cancelled
  priority VARCHAR(10) NOT NULL DEFAULT 'medium', -- low | medium | high | urgent
  due_date DATE,
  assigned_to UUID REFERENCES admin_users(id),
  created_by UUID NOT NULL REFERENCES admin_users(id),
  has_issue BOOLEAN NOT NULL DEFAULT FALSE,
  issue_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);

-- Role hierarchy note: 'employee' role added at the application layer
-- (services/admin-service/src/index.ts ROLES/ROLE_INDEX). admin_users.role
-- is a plain VARCHAR, so no schema migration is needed for the new role value.
