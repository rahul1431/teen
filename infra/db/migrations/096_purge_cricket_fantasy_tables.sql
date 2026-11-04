-- Migration: 096_purge_cricket_fantasy_tables.sql
-- Purges all legacy cricket fantasy tables, indices, and views to dedicate the
-- database purely to Cricket Odds (Match Winner, Toss Winner, Outrights) & Session Betting.

DROP TABLE IF EXISTS cricket_fantasy_entries CASCADE;
DROP TABLE IF EXISTS cricket_fantasy_players CASCADE;
DROP TABLE IF EXISTS cricket_match_players CASCADE;
DROP TABLE IF EXISTS cricket_player_profiles CASCADE;
DROP TABLE IF EXISTS cricket_fantasy_teams CASCADE;
DROP TABLE IF EXISTS cricket_fantasy_leagues CASCADE;
DROP TABLE IF EXISTS cricket_league_participants CASCADE;
DROP TABLE IF EXISTS archived_cricket_fantasy_teams CASCADE;
DROP TABLE IF EXISTS archived_cricket_fantasy_leagues CASCADE;
DROP TABLE IF EXISTS archived_cricket_league_participants CASCADE;
DROP TABLE IF EXISTS archived_cricket_player_profiles CASCADE;
DROP TABLE IF EXISTS archived_cricket_countries CASCADE;
DROP TABLE IF EXISTS archived_cricket_api_usage CASCADE;
DROP TABLE IF EXISTS archived_cricket_markets CASCADE;
DROP TABLE IF EXISTS archived_cricket_bets CASCADE;

-- Ensure indexes on cricket odds and session tables for maximum query speed
CREATE INDEX IF NOT EXISTS idx_cricket_matches_status_start ON cricket_matches (status, start_time);
CREATE INDEX IF NOT EXISTS idx_cricket_markets_match_status ON cricket_markets (match_id, status);
CREATE INDEX IF NOT EXISTS idx_cricket_bets_user_id ON cricket_bets (user_id);
CREATE INDEX IF NOT EXISTS idx_cricket_bets_match_id ON cricket_bets (match_id);
CREATE INDEX IF NOT EXISTS idx_cricket_sessions_match_status ON cricket_sessions (match_id, status);
CREATE INDEX IF NOT EXISTS idx_cricket_session_bets_user_id ON cricket_session_bets (user_id);
CREATE INDEX IF NOT EXISTS idx_cricket_session_bets_session_id ON cricket_session_bets (session_id);
