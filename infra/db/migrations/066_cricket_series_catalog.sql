-- Cricket series/tournament catalog (IPL, ICC World Cup, Big Bash, etc.)
-- The "Add Match" admin form used a free-text Series field with no fixed
-- list, so admins retyped/misspelled the same tournament name differently
-- across matches. This gives them a managed catalog to pick from instead,
-- seeded with well-known real-world series so it's not empty on day one.
CREATE TABLE IF NOT EXISTS cricket_series (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  short_name VARCHAR(50),
  api_series_id VARCHAR(100), -- cricapi series id, set when imported via Sync Series
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cricket_series (name, short_name) VALUES
  ('Indian Premier League', 'IPL'),
  ('ICC Cricket World Cup', 'ICC ODI WC'),
  ('ICC T20 World Cup', 'ICC T20 WC'),
  ('ICC Champions Trophy', 'ICC CT'),
  ('ICC World Test Championship', 'ICC WTC'),
  ('Big Bash League', 'BBL'),
  ('Pakistan Super League', 'PSL'),
  ('Caribbean Premier League', 'CPL'),
  ('The Hundred', 'THE100'),
  ('Asia Cup', 'ASIA CUP'),
  ('Bilateral Series', 'BILATERAL'),
  ('Others', 'OTHERS')
ON CONFLICT (name) DO NOTHING;
