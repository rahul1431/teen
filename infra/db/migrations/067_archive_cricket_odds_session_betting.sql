-- Removing Match-Odds betting (Match Winner/Toss/Top Batsman markets) and
-- Session/Fancy betting (odd-even runs brackets) — these were bookmaker-style
-- features unrelated to the Dream11/MPL-style fantasy contest system, which
-- is what's being built out instead. Verified zero pending or historical
-- bets on either system before this migration (both tables were empty of
-- real activity), so renaming to archived_* (not dropping) is a zero-cost
-- safety net rather than a real data-preservation need.
ALTER TABLE IF EXISTS cricket_bets RENAME TO archived_cricket_bets;
ALTER TABLE IF EXISTS cricket_markets RENAME TO archived_cricket_markets;
ALTER TABLE IF EXISTS cricket_sessions RENAME TO archived_cricket_sessions;
ALTER TABLE IF EXISTS cricket_session_bets RENAME TO archived_cricket_session_bets;
