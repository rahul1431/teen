-- Admin notes/flags on users. Each note is timestamped and attributed to the
-- admin who wrote it. Used by the User Management module to track context
-- (e.g. "called support 2024-01-12 re: failed deposit").
CREATE TABLE user_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  note TEXT NOT NULL,
  is_flag BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_notes_user_id ON user_notes(user_id, created_at DESC);
CREATE INDEX idx_user_notes_flag ON user_notes(user_id) WHERE is_flag = true;
