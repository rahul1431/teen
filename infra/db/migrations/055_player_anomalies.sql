-- infra/db/migrations/055_player_anomalies.sql
-- Phase 2: Adaptive Features — player anomaly detection
-- Stores anomaly detection results for real-time player monitoring and fraud prevention

BEGIN;

-- Create player_anomalies table to store detected anomalies
CREATE TABLE IF NOT EXISTS player_anomalies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anomaly_type          VARCHAR(50) NOT NULL CHECK (anomaly_type IN (
    'win_rate_spike',
    'session_change',
    'bet_aggression',
    'churn_risk',
    'game_frequency'
  )),
  confidence            NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  anomaly_score         NUMERIC(5,3),
  feature_zscore        NUMERIC(5,2),
  feature_value         NUMERIC(10,4),
  cohort_average        NUMERIC(10,4),
  details               JSONB,
  is_active             BOOLEAN DEFAULT TRUE,
  dismissed_at          TIMESTAMPTZ,
  dismissed_by          UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  dismissal_reason      VARCHAR(255),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_player_anomalies_player_id
  ON player_anomalies(player_id);

CREATE INDEX IF NOT EXISTS idx_player_anomalies_anomaly_type
  ON player_anomalies(anomaly_type);

CREATE INDEX IF NOT EXISTS idx_player_anomalies_created_at
  ON player_anomalies(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_anomalies_is_active
  ON player_anomalies(is_active);

-- Composite index for efficient filtering and sorting
CREATE INDEX IF NOT EXISTS idx_player_anomalies_player_active_created
  ON player_anomalies(player_id, is_active, created_at DESC);

-- Composite index for anomaly type filtering by recency
CREATE INDEX IF NOT EXISTS idx_player_anomalies_type_active_created
  ON player_anomalies(anomaly_type, is_active, created_at DESC);

-- Create anomaly_model_state table to store model metadata for versioning
CREATE TABLE IF NOT EXISTS anomaly_model_state (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version             VARCHAR(30) NOT NULL UNIQUE,
  model_type                VARCHAR(50) DEFAULT 'isolation_forest',
  contamination             NUMERIC(4,3) DEFAULT 0.05,
  n_estimators              INTEGER DEFAULT 100,
  training_samples          INTEGER,
  training_date             TIMESTAMPTZ DEFAULT NOW(),
  feature_means             JSONB,
  feature_stds              JSONB,
  threshold                 NUMERIC(4,3) DEFAULT 0.7,
  is_active                 BOOLEAN DEFAULT TRUE,
  accuracy_metrics          JSONB,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active model lookup
CREATE INDEX IF NOT EXISTS idx_anomaly_model_state_active
  ON anomaly_model_state(is_active, training_date DESC);

-- Create table to store anomaly detection statistics for monitoring
CREATE TABLE IF NOT EXISTS anomaly_detection_stats (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_date            DATE DEFAULT CURRENT_DATE,
  anomaly_type              VARCHAR(50),
  detection_count           INTEGER DEFAULT 0,
  unique_player_count       INTEGER DEFAULT 0,
  average_confidence        NUMERIC(5,3),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_anomaly_stats UNIQUE (detection_date, anomaly_type)
);

-- Index for stats lookups
CREATE INDEX IF NOT EXISTS idx_anomaly_detection_stats_date
  ON anomaly_detection_stats(detection_date DESC);

COMMIT;

-- ========== DOWN: Drop tables (for manual rollback) ==========
-- To rollback, run:
-- DROP TABLE IF EXISTS anomaly_detection_stats CASCADE;
-- DROP TABLE IF EXISTS anomaly_model_state CASCADE;
-- DROP TABLE IF EXISTS player_anomalies CASCADE;
