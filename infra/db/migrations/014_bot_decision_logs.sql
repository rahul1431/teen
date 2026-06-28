-- Migration 014: Bot Decision Logs
-- Purpose: Log every bot decision with context for ML training (Phase 3 bot learner)

CREATE TABLE IF NOT EXISTS bot_decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  game_type VARCHAR(50) NOT NULL,         -- 'teen_patti' | 'ludo'
  decision_context JSONB NOT NULL,        -- pot_size, player_count, dice, positions, etc.
  action_taken VARCHAR(50) NOT NULL,      -- 'call'/'fold'/'raise' | 'capture'/'advance'/'no_move'
  outcome VARCHAR(20),                    -- 'win'/'lose'/'draw' — backfilled after game ends
  profit_loss DECIMAL(15,2),              -- backfilled after game ends
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_room     ON bot_decision_logs(room_id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_user     ON bot_decision_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_gametype ON bot_decision_logs(game_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_outcome  ON bot_decision_logs(outcome) WHERE outcome IS NOT NULL;
