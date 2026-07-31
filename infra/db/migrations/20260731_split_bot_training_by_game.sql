-- bot_learning_sessions had no game_type column, so the Bot Training
-- coordination config/session-history/trend chart were a single global
-- setting shared by every game with 3-bot coordination (Teen Patti and
-- Ludo) even though the admin panel now shows them on separate per-game
-- tabs — editing "Teen Patti"'s sliders silently changed Ludo's too.
-- game_id stores the room UUID (see gameRecorder.ts), so every historical
-- row can be backfilled from game_rooms.

ALTER TABLE bot_learning_sessions ADD COLUMN IF NOT EXISTS game_type VARCHAR(30);

UPDATE bot_learning_sessions bls
SET game_type = gr.game_type
FROM game_rooms gr
WHERE gr.id::text = bls.game_id
  AND bls.game_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_bot_learning_sessions_game_type ON bot_learning_sessions(game_type, created_at);

-- Fail loudly (mirrors the lottery/rummy bot-fill migrations' guard pattern)
-- if any row couldn't be backfilled — new rows are always written with a
-- game_type going forward (see GameOutcome.gameType in gameRecorder.ts), so
-- a NULL here would only mean a row whose game_id no longer matches any
-- game_rooms.id, and the operator should know before this becomes load-bearing.
DO $$
DECLARE
  missing_game_type INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_game_type FROM bot_learning_sessions WHERE game_type IS NULL;
  IF missing_game_type > 0 THEN
    RAISE EXCEPTION 'bot_learning_sessions game_type backfill incomplete: % row(s) still NULL', missing_game_type;
  END IF;
END $$;

ALTER TABLE bot_learning_sessions ALTER COLUMN game_type SET NOT NULL;

-- Split the single shared admin_config 'ludo_bot_training_config' key into
-- one row per game, seeded from the current shared value so behavior is
-- unchanged until an admin edits either game's sliders going forward.
INSERT INTO admin_config (key, value)
SELECT 'bot_training_config:teen_patti', value FROM admin_config WHERE key = 'ludo_bot_training_config'
ON CONFLICT (key) DO NOTHING;

INSERT INTO admin_config (key, value)
SELECT 'bot_training_config:ludo', value FROM admin_config WHERE key = 'ludo_bot_training_config'
ON CONFLICT (key) DO NOTHING;
