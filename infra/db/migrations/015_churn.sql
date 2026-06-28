-- infra/db/migrations/015_churn.sql
-- Phase 2: Churn Prediction — user scoring and config tables

CREATE TABLE IF NOT EXISTS user_churn_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score               NUMERIC(5,2) NOT NULL DEFAULT 0,
  risk_level          VARCHAR(10) CHECK (risk_level IN ('none','low','medium','high')) DEFAULT 'none',
  days_since_deposit  NUMERIC(10,2),
  last_deposit_at     TIMESTAMPTZ,
  action_taken        VARCHAR(50),
  action_taken_at     TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_user_churn_scores_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_churn_scores_risk_level ON user_churn_scores(risk_level);
CREATE INDEX IF NOT EXISTS idx_churn_scores_score      ON user_churn_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_churn_scores_updated_at ON user_churn_scores(updated_at DESC);

CREATE TABLE IF NOT EXISTS churn_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO churn_config (key, value) VALUES
  ('low_threshold_days',    '3'),
  ('medium_threshold_days', '7'),
  ('high_threshold_days',   '14'),
  ('high_bonus_amount',     '50'),
  ('action_cooldown_days',  '7'),
  ('grace_period_days',     '3'),
  ('cron_interval_minutes', '60')
ON CONFLICT (key) DO NOTHING;
