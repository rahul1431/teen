-- Real per-decision logging for Teen Patti, mirroring ludo_move_decisions
-- (086_ludo_move_decisions.sql). bot_learning_service's profile-builder
-- already computes fold_probability/call_probability for every game type
-- via getStreamActionData() -- but that function was a permanent stub
-- (always returned {}), so every rebuild fell through to a win-rate-only
-- heuristic instead of learning from real players' actual pack/chaal/raise
-- choices. This table is what that function now reads from for teen_patti.
CREATE TABLE IF NOT EXISTS teen_patti_move_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(10) NOT NULL, -- 'fold' | 'call' | 'raise'
  is_seen BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teen_patti_move_decisions_created ON teen_patti_move_decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_teen_patti_move_decisions_user_created ON teen_patti_move_decisions(user_id, created_at);
