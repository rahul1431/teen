-- Upgrade Cricket Betting: add tables for Fantasy Leagues and Live Scoring columns

-- Add live scoring and tv fields to cricket_matches
ALTER TABLE cricket_matches ADD COLUMN IF NOT EXISTS live_score JSONB DEFAULT '{}';
ALTER TABLE cricket_matches ADD COLUMN IF NOT EXISTS live_tv_url VARCHAR(255);
ALTER TABLE cricket_matches ADD COLUMN IF NOT EXISTS match_api_id VARCHAR(50);

-- Fantasy players definition
CREATE TABLE IF NOT EXISTS cricket_fantasy_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  role VARCHAR(32) NOT NULL, -- wicket_keeper | batsman | all_rounder | bowler
  credits NUMERIC(4,1) NOT NULL DEFAULT 9.0,
  team_name VARCHAR(80) NOT NULL,
  avatar_url VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Player performance records per match (used to compute points)
CREATE TABLE IF NOT EXISTS cricket_match_players (
  match_id UUID NOT NULL REFERENCES cricket_matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES cricket_fantasy_players(id) ON DELETE CASCADE,
  runs_scored INT NOT NULL DEFAULT 0,
  balls_faced INT NOT NULL DEFAULT 0,
  fours INT NOT NULL DEFAULT 0,
  sixes INT NOT NULL DEFAULT 0,
  wickets INT NOT NULL DEFAULT 0,
  runs_conceded INT NOT NULL DEFAULT 0,
  overs_bowled NUMERIC(3,1) NOT NULL DEFAULT 0.0,
  catches INT NOT NULL DEFAULT 0,
  stumpings INT NOT NULL DEFAULT 0,
  run_outs INT NOT NULL DEFAULT 0,
  fantasy_points NUMERIC(6,1) NOT NULL DEFAULT 0.0,
  PRIMARY KEY (match_id, player_id)
);

-- Fantasy entry contests/leagues
CREATE TABLE IF NOT EXISTS cricket_fantasy_leagues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES cricket_matches(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  entry_fee NUMERIC(10,2) NOT NULL DEFAULT 0.0,
  prize_pool NUMERIC(12,2) NOT NULL DEFAULT 0.0,
  max_entries INT NOT NULL DEFAULT 100,
  current_entries INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'open', -- open | closed | settled | cancelled
  prize_distribution JSONB NOT NULL DEFAULT '[]', -- JSON array of rank payouts e.g. [{"rank_start": 1, "rank_end": 1, "payout": 500}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cricket_fantasy_leagues_match ON cricket_fantasy_leagues(match_id);

-- User-created fantasy rosters (exactly 11 players)
CREATE TABLE IF NOT EXISTS user_fantasy_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES cricket_matches(id) ON DELETE CASCADE,
  player_ids UUID[] NOT NULL, -- Array of 11 player UUIDs
  captain_id UUID NOT NULL REFERENCES cricket_fantasy_players(id),
  vice_captain_id UUID NOT NULL REFERENCES cricket_fantasy_players(id),
  points_total NUMERIC(6,1) NOT NULL DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_fantasy_teams_user ON user_fantasy_teams(user_id);
CREATE INDEX IF NOT EXISTS idx_user_fantasy_teams_match ON user_fantasy_teams(match_id);

-- Contest entries joining a user team into a league
CREATE TABLE IF NOT EXISTS cricket_fantasy_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES cricket_fantasy_leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES user_fantasy_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points NUMERIC(6,1) NOT NULL DEFAULT 0.0,
  final_rank INT,
  payout_received NUMERIC(10,2) NOT NULL DEFAULT 0.0,
  status VARCHAR(16) NOT NULL DEFAULT 'joined', -- joined | settled | voided
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cricket_fantasy_entries_user ON cricket_fantasy_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cricket_fantasy_entries_league ON cricket_fantasy_entries(league_id);
