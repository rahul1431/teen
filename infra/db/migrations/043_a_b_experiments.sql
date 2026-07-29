-- infra/db/migrations/043_a_b_experiments.sql
-- Task 13: A/B Experiment Routing — table for experiment configurations and metrics

BEGIN;

CREATE TABLE IF NOT EXISTS a_b_experiments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        VARCHAR(255) NOT NULL,
  game_type                   VARCHAR(30) NOT NULL,
  difficulty                  VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  control_profile_id          UUID NOT NULL REFERENCES bot_profiles(id) ON DELETE RESTRICT,
  experimental_profile_id     UUID NOT NULL REFERENCES bot_profiles(id) ON DELETE RESTRICT,
  traffic_allocation_pct      INTEGER NOT NULL CHECK (traffic_allocation_pct > 0 AND traffic_allocation_pct <= 100),
  start_date                  DATE NOT NULL,
  end_date                    DATE NOT NULL,
  status                      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
  control_retention           NUMERIC(5,2),
  control_avg_roi             NUMERIC(10,2),
  experimental_retention      NUMERIC(5,2),
  experimental_avg_roi        NUMERIC(10,2),
  winner                      VARCHAR(20),
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_end_after_start CHECK (end_date >= start_date),
  CONSTRAINT chk_winner_validity CHECK (winner IS NULL OR winner IN ('control','experimental','inconclusive'))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_a_b_experiments_game_type
  ON a_b_experiments(game_type);

CREATE INDEX IF NOT EXISTS idx_a_b_experiments_game_type_status
  ON a_b_experiments(game_type, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_a_b_experiments_difficulty
  ON a_b_experiments(difficulty);

CREATE INDEX IF NOT EXISTS idx_a_b_experiments_created_at
  ON a_b_experiments(created_at DESC);

COMMIT;
