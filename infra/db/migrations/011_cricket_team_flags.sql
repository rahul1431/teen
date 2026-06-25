-- Migration: CricAPI Countries list, match team flags and fantasy player external IDs

CREATE TABLE IF NOT EXISTS cricket_countries (
  id VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  flag_url VARCHAR(255) NOT NULL
);

ALTER TABLE cricket_matches ADD COLUMN IF NOT EXISTS team_a_flag VARCHAR(255);
ALTER TABLE cricket_matches ADD COLUMN IF NOT EXISTS team_b_flag VARCHAR(255);

ALTER TABLE cricket_fantasy_players ADD COLUMN IF NOT EXISTS external_id VARCHAR(50) UNIQUE;
