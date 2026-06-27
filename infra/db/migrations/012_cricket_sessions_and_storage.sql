-- Add tables for Cricket Session (Fancy) betting and improved team storage

-- Teams storage to cache data from API
CREATE TABLE IF NOT EXISTS cricket_teams (
  id VARCHAR(50) PRIMARY KEY, -- API ID
  name VARCHAR(100) NOT NULL,
  short_name VARCHAR(10),
  flag_url VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions (Fancy bets) e.g. "6 Over Session - India"
CREATE TABLE IF NOT EXISTS cricket_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES cricket_matches(id) ON DELETE CASCADE,
  label VARCHAR(120) NOT NULL,
  min_runs INT NOT NULL, -- e.g. 45
  max_runs INT NOT NULL, -- e.g. 47
  odds_yes NUMERIC(8,2) NOT NULL DEFAULT 1.0, -- Usually 1.0 (90/100 or similar in real world, but simplified here)
  odds_no NUMERIC(8,2) NOT NULL DEFAULT 1.0,
  status VARCHAR(12) NOT NULL DEFAULT 'open', -- open | suspended | settled | cancelled
  result_runs INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cricket_sessions_match ON cricket_sessions(match_id);

-- Bets placed on sessions
CREATE TABLE IF NOT EXISTS cricket_session_bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  match_id UUID NOT NULL REFERENCES cricket_matches(id),
  session_id UUID NOT NULL REFERENCES cricket_sessions(id),
  selection VARCHAR(4) NOT NULL, -- yes | no
  runs_bracket INT NOT NULL, -- the line at which the bet was placed
  amount NUMERIC(12,2) NOT NULL,
  potential_payout NUMERIC(14,2) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | won | lost | void
  payout NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cricket_session_bets_user ON cricket_session_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_cricket_session_bets_match ON cricket_session_bets(match_id);

-- Cache for Match Commentary / Live Events
CREATE TABLE IF NOT EXISTS cricket_match_cache (
  match_id UUID PRIMARY KEY REFERENCES cricket_matches(id) ON DELETE CASCADE,
  commentary JSONB DEFAULT '[]',
  scorecard JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
