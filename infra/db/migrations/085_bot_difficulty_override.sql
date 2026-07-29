-- Per-bot difficulty override. NULL means "use the game-wide
-- game_configs.bot_difficulty default" -- every existing bot keeps
-- today's behavior automatically. See
-- docs/superpowers/specs/2026-07-21-bot-management-ui-design.md

ALTER TABLE users ADD COLUMN bot_difficulty VARCHAR(10)
  CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));
