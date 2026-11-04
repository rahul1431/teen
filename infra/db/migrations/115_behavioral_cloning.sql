-- Migration: 115_behavioral_cloning.sql
-- Description: Behavioral Cloning (Imitation Learning from Top 5% Human Winners)
-- Adds rummy_move_decisions table and bot_behavioral_clones tracking table.

-- 1. Rummy Move Decisions table (mirroring teen_patti_move_decisions & ludo_move_decisions)
CREATE TABLE IF NOT EXISTS rummy_move_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          VARCHAR(20) NOT NULL, -- 'drop' | 'draw_open' | 'draw_closed' | 'discard' | 'declare'
  card_id         TEXT,
  deadwood_points INTEGER,
  turn_number     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rummy_move_decisions_user_created ON rummy_move_decisions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rummy_move_decisions_created ON rummy_move_decisions(created_at);

-- 2. Behavioral Clones Telemetry & Model Tracking
CREATE TABLE IF NOT EXISTS bot_behavioral_clones (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type                     VARCHAR(30) NOT NULL,
  tier                          VARCHAR(20) NOT NULL DEFAULT 'hard',
  top_percentile_cutoff         NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  players_analyzed              INTEGER NOT NULL,
  elite_player_ids              JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions_extracted           INTEGER NOT NULL,
  extracted_action_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  cloned_weights                JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active                     BOOLEAN NOT NULL DEFAULT true,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_behavioral_clones_game_active ON bot_behavioral_clones(game_type, is_active, created_at DESC);

