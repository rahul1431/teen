-- Migration 018: game emojis and gifts with pricing
-- Admins manage these via the admin panel; mobile app fetches active ones.

CREATE TABLE IF NOT EXISTS game_emojis (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  emoji       VARCHAR(16) NOT NULL,
  label       VARCHAR(64) NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default emojis
INSERT INTO game_emojis (emoji, label, sort_order) VALUES
  ('😀', 'Happy',    1),
  ('😂', 'LOL',      2),
  ('😎', 'Cool',     3),
  ('😮', 'Shocked',  4),
  ('😭', 'Cry',      5),
  ('🔥', 'Fire',     6),
  ('👏', 'Clap',     7),
  ('🤔', 'Think',    8)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS game_gifts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  icon        VARCHAR(16) NOT NULL,
  name        VARCHAR(64) NOT NULL,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default gifts
INSERT INTO game_gifts (icon, name, price, sort_order) VALUES
  ('🌹', 'Rose',    5.00,  1),
  ('🎁', 'Gift',    10.00, 2),
  ('💎', 'Diamond', 50.00, 3),
  ('🍺', 'Beer',    15.00, 4),
  ('🚀', 'Rocket',  25.00, 5),
  ('👑', 'Crown',   100.00, 6)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_game_emojis_active ON game_emojis(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_game_gifts_active ON game_gifts(is_active, sort_order);
