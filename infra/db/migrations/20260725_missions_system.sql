-- Missions system: admin-configurable Weekly/Monthly/One-time player rewards.
-- See docs/superpowers/specs/2026-07-25-daily-bonus-removal-task-system-design.md
-- Named "mission" (not "task") to avoid colliding with the existing employee
-- task-tracker (tasks/task_comments, migration 064_task_management.sql).

CREATE TABLE player_missions (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                       VARCHAR(200) NOT NULL,
  description                 TEXT,
  emoji                       VARCHAR(10) NOT NULL DEFAULT '🎯',
  category                    VARCHAR(10) NOT NULL CHECK (category IN ('weekly', 'monthly', 'one_time')),
  metric_type                 VARCHAR(20) NOT NULL CHECK (metric_type IN ('deposit_amount', 'referral_count', 'game_played', 'telegram_join', 'manual_proof')),
  game_type                   VARCHAR(20),
  min_stake                   NUMERIC(15,2),
  target_value                NUMERIC(15,2) NOT NULL CHECK (target_value > 0),
  reward_amount               NUMERIC(15,2) NOT NULL CHECK (reward_amount > 0),
  reward_wallet_type          VARCHAR(10) NOT NULL DEFAULT 'bonus' CHECK (reward_wallet_type IN ('real', 'bonus')),
  max_completions_per_period  INT CHECK (max_completions_per_period IS NULL OR max_completions_per_period > 0),
  verification_type           VARCHAR(15) NOT NULL CHECK (verification_type IN ('auto', 'telegram_bot', 'manual_review')),
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  sort_order                  INT NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_player_missions_active ON player_missions(is_active, category, sort_order);

CREATE TABLE user_mission_completions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id        UUID NOT NULL REFERENCES player_missions(id) ON DELETE CASCADE,
  period_key        VARCHAR(10) NOT NULL,
  completion_number INT NOT NULL,
  reward_amount     NUMERIC(15,2) NOT NULL,
  status            VARCHAR(15) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending_review', 'rejected')),
  proof_url         TEXT,
  admin_note        TEXT,
  reviewed_by       UUID REFERENCES admin_users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mission_id, period_key, completion_number)
);

CREATE INDEX idx_user_mission_completions_user ON user_mission_completions(user_id, mission_id, period_key);
CREATE INDEX idx_user_mission_completions_pending ON user_mission_completions(status) WHERE status = 'pending_review';

CREATE TABLE user_telegram_links (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id  BIGINT UNIQUE NOT NULL,
  telegram_username TEXT,
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
