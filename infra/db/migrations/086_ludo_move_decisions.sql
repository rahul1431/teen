-- Logs real players' actual capture/safety decisions in Ludo, so bot
-- behavior can be trained from real tendencies instead of a fixed rule.
-- See docs/superpowers/specs/2026-07-21-ludo-training-pipeline-design.md

CREATE TABLE ludo_move_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               TEXT NOT NULL,
  user_id               UUID NOT NULL REFERENCES users(id),
  dice                  INTEGER NOT NULL,
  capture_available     BOOLEAN NOT NULL,
  capture_taken         BOOLEAN NOT NULL,
  safe_move_available   BOOLEAN NOT NULL,
  chose_safe_move       BOOLEAN NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ludo_move_decisions_user_created ON ludo_move_decisions(user_id, created_at);
CREATE INDEX idx_ludo_move_decisions_created ON ludo_move_decisions(created_at);

ALTER TABLE bot_profiles ADD COLUMN capture_probability NUMERIC(5,4);
ALTER TABLE bot_profiles ADD COLUMN safe_play_probability NUMERIC(5,4);
