# Task Management System — Design

## Purpose
Give admins a way to create and assign work items to employees inside the existing admin panel, with deadlines, priority, status, a blocker/issue flag, and a comment thread. First iteration — more features (kanban, notifications, multi-assignee) explicitly deferred to future upgrades.

## Roles
- Add `employee` to the role hierarchy in `services/admin-service/src/index.ts`, ranked between `readonly` and `support`:
  `readonly (0) < employee (1) < support (2) < finance (3) < DevAdmin (4) < superadmin (5)`
- Employees log into the same admin panel (`admin_users` table, no new auth system) but only see the Tasks page in the sidebar.

## Data model — migration `064_task_management.sql`
```sql
CREATE TABLE tasks (
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

CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_status ON tasks(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_due_date ON tasks(due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
```

## Backend — `services/admin-service/src/task-routes.ts`
Follows the existing `player-anomalies-routes.ts` pattern (Fastify + zod + pg pool, registered from `index.ts`).

- `GET /api/admin/tasks` — list, paginated. Employees are forced to `assigned_to = req.user.sub` server-side (never trust a client-supplied filter for this). Admin/superadmin get full list plus filters: `status`, `priority`, `assignee_id`, `overdue=true`.
- `POST /api/admin/tasks` — create. Requires `support` role or above per the hierarchy... actually per the approved design, **admin/superadmin only** create — enforce with a dedicated `requireRole('DevAdmin')`-style check reused as `requireTaskAdmin` (superadmin + any role above employee that we designate as task-admin; concretely: `finance`, `DevAdmin`, `superadmin` are excluded from creating by default — only `superadmin` for v1, simplest and matches "admin" in the request). Body: `title`, `description?`, `assigned_to`, `priority?`, `due_date?`.
- `PATCH /api/admin/tasks/:id` — edit. Superadmin can edit any field. Employees may only patch `status` (`todo`→`in_progress`→`done`, or set `cancelled` is admin-only) and `has_issue`/`issue_note`, and only on tasks where `assigned_to = self`.
- `DELETE /api/admin/tasks/:id` — soft delete (`deleted_at = now()`), superadmin only.
- `GET /api/admin/tasks/:id/comments`, `POST /api/admin/tasks/:id/comments` — any admin/employee who can see the task can read/post comments.
- Every create/edit/delete/comment writes an `admin_audit_log` row (`action` in `task_created`, `task_updated`, `task_deleted`, `task_commented`), matching existing convention.

## Frontend
- `admin-panel/src/pages/Tasks.tsx` — new page registered in `main.tsx` at `/admin/tasks`, added to the sidebar in `Layout.tsx` as "📋 Tasks" (visible to all roles; content self-adjusts by role).
- Table: title, assignee, priority badge, status tag, due date (🔴 overdue / 🟡 due within 2 days / plain otherwise), ⚠️ issue badge when `has_issue`.
- Superadmin: "New Task" button → modal (title, description, assignee select from `/api/admin/admin-users` list, priority, due date). Row actions: edit, delete (soft), open detail drawer.
- Employee: no create button, no assignee filter; row click opens detail drawer where they can change status and toggle/edit the issue flag.
- Detail drawer (both roles): full description, comment thread (list + add-comment box), status changer appropriate to role.

## Explicitly deferred (future upgrades)
- Kanban/custom columns, multi-assignee tasks, push notifications on deadlines, attachments, task categories/projects, hard-delete/trash view UI.

## Deployment
Ship to the **dev** environment first (`teen_db_dev`, `teen-admin-svc-dev`, dev admin-panel build) per the user's stated plan to verify the dev→prod push workflow afterward via the existing deployment feature — not by hand-editing prod directly.
