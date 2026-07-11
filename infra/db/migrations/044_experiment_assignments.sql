-- infra/db/migrations/044_experiment_assignments.sql
-- Task 16: A/B Experiment Tracking — table for tracking player experiment assignments and outcomes

BEGIN;

CREATE TABLE IF NOT EXISTS experiment_assignments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id                   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  experiment_id               UUID NOT NULL REFERENCES a_b_experiments(id) ON DELETE CASCADE,
  variant                     VARCHAR(20) NOT NULL CHECK (variant IN ('control', 'experimental')),
  assigned_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_status            VARCHAR(20),
  roi                         NUMERIC(10,2),
  win_rate                    NUMERIC(5,4),
  games_played                INTEGER DEFAULT 0,
  profit_loss                 NUMERIC(15,2),
  deposit_amount              NUMERIC(15,2),
  last_activity_at            TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, experiment_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_experiment_assignments_experiment_id
  ON experiment_assignments(experiment_id);

CREATE INDEX IF NOT EXISTS idx_experiment_assignments_player_id
  ON experiment_assignments(player_id);

CREATE INDEX IF NOT EXISTS idx_experiment_assignments_variant
  ON experiment_assignments(experiment_id, variant);

CREATE INDEX IF NOT EXISTS idx_experiment_assignments_assigned_at
  ON experiment_assignments(assigned_at DESC);

COMMIT;
