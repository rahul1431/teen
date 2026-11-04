-- Migration: 116_table_anti_collusion.sql
-- Description: Multi-Agent Anti-Collusion Sentinel Swarm
-- Tracks table action variance, soft-playing, whipsawing, and syndicate pairing between human players.
-- Flags suspicious player syndicates and enforces matchmaking quarantine.

CREATE TABLE IF NOT EXISTS table_collusion_alerts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type               VARCHAR(30) NOT NULL,
  room_id                 VARCHAR(100),
  player_a_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_b_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collusion_score         NUMERIC(4,3) NOT NULL DEFAULT 0.000, -- 0.000 (safe) to 1.000 (blatant syndicate)
  shared_hands_count      INTEGER NOT NULL DEFAULT 1,
  passive_checkdown_rate  NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  whipsaw_count           INTEGER NOT NULL DEFAULT 0,
  evidence                JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                  VARCHAR(20) NOT NULL DEFAULT 'flagged', -- 'flagged', 'quarantined', 'dismissed', 'banned'
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_different_players CHECK (player_a_id <> player_b_id)
);

CREATE INDEX IF NOT EXISTS idx_table_collusion_alerts_players 
  ON table_collusion_alerts(player_a_id, player_b_id, game_type);
CREATE INDEX IF NOT EXISTS idx_table_collusion_alerts_score 
  ON table_collusion_alerts(collusion_score DESC);
CREATE INDEX IF NOT EXISTS idx_table_collusion_alerts_status 
  ON table_collusion_alerts(status, game_type);
CREATE INDEX IF NOT EXISTS idx_table_collusion_alerts_created 
  ON table_collusion_alerts(created_at DESC);

