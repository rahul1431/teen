-- Migration: 113_bot_cognitive_memory.sql
-- Description: Creates persistent episodic cognitive memory tables for AI game bots.
-- Tracks individual human player behavioral patterns (VPIP, fold-to-raise, bluff call tendency, tilt, discard patterns)
-- so bots remember specific players and exploit their habits.

CREATE TABLE IF NOT EXISTS bot_player_memories (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  games_analyzed              INTEGER NOT NULL DEFAULT 0,
  vpip_rate                   NUMERIC(5,2) NOT NULL DEFAULT 50.00,  -- % of hands voluntarily entered
  fold_to_raise_ratio         NUMERIC(5,2) NOT NULL DEFAULT 50.00,  -- % folds against aggressive raises
  bluff_call_tendency         NUMERIC(5,2) NOT NULL DEFAULT 50.00,  -- % of calls on weak/bluff showdowns
  tilt_score                  NUMERIC(4,2) NOT NULL DEFAULT 1.00,   -- 1.0 = baseline, > 2.0 = tilted / reckless
  consecutive_losses          INTEGER NOT NULL DEFAULT 0,
  biggest_loss_recent         NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  rummy_discard_preference    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Discard habits and preferred suits
  teen_patti_blind_ratio      NUMERIC(5,2) NOT NULL DEFAULT 30.00,  -- % of hands played blind
  ludo_aggression_factor      NUMERIC(4,2) NOT NULL DEFAULT 1.00,   -- Aggressive captures vs star camping
  last_game_type              VARCHAR(30),
  last_action_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_player_memories_user_id ON bot_player_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_player_memories_tilt ON bot_player_memories(tilt_score);

-- Tactical decision logs for self-learning and model retraining
CREATE TABLE IF NOT EXISTS bot_decision_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type       VARCHAR(30) NOT NULL,
  room_id         VARCHAR(100) NOT NULL,
  bot_user_id     VARCHAR(100) NOT NULL,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  decision_type   VARCHAR(50) NOT NULL,
  state_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_chosen   VARCHAR(50) NOT NULL,
  ev_estimate     NUMERIC(8,2),
  was_successful  BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_decision_logs_game_created ON bot_decision_logs(game_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_decision_logs_target ON bot_decision_logs(target_user_id);

